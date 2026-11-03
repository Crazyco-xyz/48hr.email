const EventEmitter = require('events')
const imaps = require('imap-simple')
const { simpleParser } = require('mailparser')
const addressparser = require('nodemailer/lib/addressparser')
const retry = require('async-retry')
const debug = require('debug')('48hr-email:imap-manager')
const Mail = require('../domain/mail')
const Helper = require('./helper-service')
const helper = new(Helper)
const config = require('./config-service')


// Just adding some missing functions to imap-simple... :-)

/**
 * Deletes the specified message(s).
 *
 * @param {string|Array} uid The uid or array of uids indicating the messages to be deleted
 * @param {function} [callback] Optional callback, receiving signature (err)
 * @returns {undefined|Promise} Returns a promise when no callback is specified, resolving when the action succeeds.
 * @memberof ImapSimple
 */
imaps.ImapSimple.prototype.deleteMessage = function(uid, callback) {
    var self = this;

    if (callback) {
        return nodeify(self.deleteMessage(uid), callback);
    }

    return new Promise(function(resolve, reject) {
        self.imap.addFlags(uid, '\\Deleted', function(err) {
            if (err) {
                reject(err);
                return;
            }
            self.imap.expunge(function(err) {
                if (err) {
                    reject(err);
                    return;
                }
                resolve();
            });
        });
    });
};

/**
 * Close a mailbox
 *
 * @param {boolean} [autoExpunge=true] If autoExpunge is true, any messages marked as Deleted in the currently open mailbox will be removed
 * @param {function} [callback] Optional callback, receiving signature (err)
 * @returns {undefined|Promise} Returns a promise when no callback is specified, resolving to `boxName`
 * @memberof ImapSimple
 */
imaps.ImapSimple.prototype.closeBox = function(autoExpunge = true, callback) {
    var self = this;

    if (typeof(autoExpunge) == 'function') {
        callback = autoExpunge;
        autoExpunge = true;
    }

    if (callback) {
        return nodeify(this.closeBox(autoExpunge), callback);
    }

    return new Promise(function(resolve, reject) {

        self.imap.closeBox(autoExpunge, function(err, result) {

            if (err) {
                reject(err);
                return;
            }

            resolve(result);
        });
    });
};


/**
 * Fetches emails from the imap server. It is a facade against the more complicated imap-simple api. It keeps the connection
 * as a member field.
 *
 * With this abstraction it would be easy to replace this with any inbound mail service like mailgun.com.
 */
class ImapService extends EventEmitter {
    constructor(config, inboxLock = null) {
        super()
        if (!config || !config.imap) {
            throw new Error("ImapService requires a valid config with 'imap' object");
        }
        this.config = config
        this.inboxLock = inboxLock
        this.loadedUids = new Set()
        this.connection = null
        this.initialLoadDone = false
        this.loadingInProgress = false
        this.lastRefreshTime = null

        // Reconnection state. A dropped connection is recovered from instead of
        // being treated as fatal (see issue #24).
        this._imapConfig = null
        this.reconnecting = false
        this.reconnectAttempts = 0
        this.intentionallyClosed = false
        this._reconnectPromise = null
        this._purgeRun = null
        this._loadRun = null
    }

    async connectAndLoadMessages() {
        // Map config.imap.secure to config.imap.tls for imap-simple library compatibility
        const imapConfig = {
            imap: {
                user: this.config.imap.user,
                password: this.config.imap.password,
                host: this.config.imap.host,
                port: this.config.imap.port,
                tls: this.config.imap.secure,
                authTimeout: this.config.imap.authTimeout,
                tlsOptions: { rejectUnauthorized: false }
            },
            // 'onmail' adds a callback when new mails arrive. With this we can keep the imap refresh interval very low (or even disable it).
            onmail: () => this._doOnNewMail()
        }

        // Reuse the same IMAP options for every reconnect attempt.
        this._imapConfig = imapConfig

        this.once(ImapService.EVENT_INITIAL_LOAD_DONE, () =>
            this._doAfterInitialLoad()
        )

        await this._connectWithRetry(imapConfig)

        // Load all messages in the background. (ASYNC)
        this._loadMailSummariesAndEmitAsEvents().catch(error =>
            debug('Initial load failed:', error.message))
    }

    async _connectWithRetry(configWithListener, retries = 5) {
        try {
            await retry(
                async _bail => {
                    // If anything throws, we retry
                    await this._connectOnce(configWithListener)
                }, {
                    retries
                }
            )
        } catch (error) {
            console.error('Cant connect, even after retrying, stopping app', error)
            throw error
        }
    }

    /**
     * Open a single connection, select INBOX and start watching it for drops.
     * The previous connection (if any) is abandoned; its late events are ignored.
     * @param {Object} configWithListener
     * @private
     */
    async _connectOnce(configWithListener) {
        const connection = await imaps.connect(configWithListener)

        try {
            await connection.openBox('INBOX')
        } catch (error) {
            // Don't leak a half-open connection and don't let its events schedule
            // a reconnect for a connection we never adopted.
            try { connection.end() } catch { /* ignore */ }
            throw error
        }

        this._attachConnection(connection)
        debug('Connected to imap Server at ' + this.config.imap.host)
    }

    /**
     * Adopt a live connection and watch it for failure. A dropped connection is no
     * longer fatal: it schedules a reconnect instead of taking the whole app down.
     * @param {Object} connection
     * @private
     */
    _attachConnection(connection) {
        const previous = this.connection
        if (previous !== connection) this._cancelMailLoad()
        this.connection = connection
        if (previous && previous !== connection) this._discardConnection(previous)

        const onError = error => {
            if (connection !== this.connection) return
            debug('IMAP connection error:', error.message)
            console.error('IMAP connection error:', error.message)
            this._onConnectionLost(error)
        }
        const onClose = () => {
            if (connection !== this.connection) return
            if (this.intentionallyClosed) return
            debug('IMAP connection closed')
            this._onConnectionLost(new Error('IMAP connection closed'))
        }

        connection.on('error', onError)
        connection.on('close', onClose)
        connection.on('end', onClose)
    }

    _onConnectionLost(error) {
        // Drop the dead reference so callers fail fast and loading pauses until
        // a live connection is back.
        const connection = this.connection
        this.connection = null
        this._cancelMailLoad()
        if (connection) this._discardConnection(connection)
        this.emit(ImapService.EVENT_CONNECTION_LOST, error)
        this._scheduleReconnect()
    }

    _discardConnection(connection) {
        // LOGOUT can remain queued behind the abandoned request. A failed
        // connection must release that queue rather than block its replacement.
        try {
            if (typeof connection.imap?.destroy === 'function') connection.imap.destroy()
            else connection.end()
        } catch (error) {
            debug('Discarding IMAP connection failed:', error.message)
        }
    }

    /**
     * Start the reconnect loop if one is not already running. Safe to call repeatedly.
     * @private
     */
    _scheduleReconnect() {
        if (this.intentionallyClosed || this.reconnecting) return

        this.reconnecting = true
        this.reconnectAttempts = 0
        this.emit(ImapService.EVENT_RECONNECTING)

        this._reconnectPromise = this._reconnectLoop()
            .catch(error => {
                debug('Reconnect loop ended unexpectedly:', error.message)
            })
            .finally(() => {
                this.reconnecting = false
                this._reconnectPromise = null
            })
    }

    /**
     * Keep trying until a live connection is re-established, with exponential backoff.
     * On success the connection is adopted, INBOX is re-opened and messages are re-synced.
     * @private
     */
    async _reconnectLoop() {
        const baseDelay = this.config.imap.reconnectBaseDelayMs || 1000
        const maxDelay = this.config.imap.reconnectMaxDelayMs || 30000

        while (!this.intentionallyClosed) {
            this.reconnectAttempts++
            const delay = Math.min(maxDelay, baseDelay * Math.pow(2, this.reconnectAttempts - 1))
            debug(`IMAP reconnect attempt ${this.reconnectAttempts} in ${delay}ms`)
            await this._sleep(delay)

            if (this.intentionallyClosed) break

            try {
                await this._connectOnce(this._imapConfig)
                const attempts = this.reconnectAttempts
                this.reconnectAttempts = 0
                // Announce only once the loop is no longer reconnecting.
                this.reconnecting = false
                this.emit(ImapService.EVENT_RECONNECTED, { attempts })
                debug(`Reconnected to IMAP after ${attempts} attempt(s)`)

                // Catch up on whatever arrived while we were disconnected.
                this._loadMailSummariesAndEmitAsEvents().catch(error =>
                    debug('Post-reconnect load failed:', error.message))
                return
            } catch (error) {
                debug(`IMAP reconnect attempt ${this.reconnectAttempts} failed:`, error.message)
            }
        }
    }

    _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms))
    }

    /**
     * Stop watching and close the connection without triggering a reconnect.
     */
    close() {
        this.intentionallyClosed = true
        const connection = this.connection
        const pendingLoad = Boolean(this._loadRun)
        this.connection = null
        this._cancelMailLoad()
        if (connection) {
            if (pendingLoad) this._discardConnection(connection)
            else try { connection.end() } catch { /* ignore */ }
        }
    }

    _doOnNewMail() {
        // A failed initial load also needs to retry on the next notification.
        // An active load coalesces notifications instead of fetching twice.
        if (this.connection && !this.intentionallyClosed) {
            this._loadMailSummariesAndEmitAsEvents().catch(error =>
                debug('On-new-mail load failed:', error.message))
        }
    }

    _doAfterInitialLoad() {
        // Request a catch-up pass after the initial index. Notifications received
        // during a load coalesce into this serialized refresh.
        this._loadMailSummariesAndEmitAsEvents().catch(error =>
            debug('Post-initial-load refresh failed:', error.message))

        // If the above trigger on new mails does not work reliable, we have to regularly check
        // for new mails on the server. This is done only after all the mails have been loaded for the
        // first time. (Note: set the refresh higher than the time it takes to download the mails).
        if (this.config.imap.refreshIntervalSeconds) {
            // Track when refreshes happen
            this.lastRefreshTime = Date.now()

            setInterval(
                () => {
                    this.lastRefreshTime = Date.now()
                    this._loadMailSummariesAndEmitAsEvents().catch(error =>
                        debug('Scheduled refresh failed:', error.message))
                },
                this.config.imap.refreshIntervalSeconds * 1000
            )
        }
    }

    _loadMailSummariesAndEmitAsEvents() {
        if (!this.connection || this.intentionallyClosed) {
            debug('Load skipped: no live IMAP connection')
            return Promise.resolve()
        }

        if (this._loadRun?.connection === this.connection) {
            this._loadRun.again = true
            return this._loadRun.promise
        }

        const run = {
            connection: this.connection,
            cancelled: null,
            cancelListeners: new Set(),
            again: false,
            promise: null
        }
        this._loadRun = run
        this.loadingInProgress = true
        // Assign the promise before transport callbacks can request a refresh.
        run.promise = Promise.resolve().then(async () => {
            do {
                run.again = false
                await this._loadMailPass(run)
            } while (run.again)
        }).finally(() => {
            if (this._loadRun === run) {
                this._loadRun = null
                this.loadingInProgress = false
            }
        })
        return run.promise
    }

    _cancelMailLoad() {
        const run = this._loadRun
        if (!run) return
        this._loadRun = null
        this.loadingInProgress = false
        const error = new Error('IMAP mail load superseded or closed')
        error.code = 'IMAP_LOAD_CANCELLED'
        run.cancelled = error
        for (const cancel of run.cancelListeners) cancel(error)
        run.cancelListeners.clear()
    }

    _assertMailLoad(run) {
        if (run.cancelled) throw run.cancelled
        if (this._loadRun !== run || this.connection !== run.connection || this.intentionallyClosed) {
            const error = new Error('IMAP mail load no longer owns this connection')
            error.code = 'IMAP_LOAD_CANCELLED'
            throw error
        }
    }

    _awaitMailLoad(run, operation) {
        return new Promise((resolve, reject) => {
            const cancel = error => {
                run.cancelListeners.delete(cancel)
                reject(error)
            }
            run.cancelListeners.add(cancel)
            Promise.resolve(operation).then(value => {
                run.cancelListeners.delete(cancel)
                resolve(value)
            }, error => {
                run.cancelListeners.delete(cancel)
                reject(error)
            })
            if (run.cancelled) cancel(run.cancelled)
        })
    }

    async _loadMailPass(run) {
        this._assertMailLoad(run)
        const uids = await this._awaitMailLoad(run, this._getAllUids(run.connection))
        this._assertMailLoad(run)
        const newUids = uids.filter(uid => !this.loadedUids.has(uid))
        const chunkSize = this.config.imap.fetchChunkSize
        const concurrency = this.config.imap.fetchConcurrency
        if (!Number.isInteger(chunkSize) || chunkSize < 1 ||
            !Number.isInteger(concurrency) || concurrency < 1) {
            throw new Error('Invalid IMAP summary batch configuration')
        }
        const uidChunks = []
        for (let index = 0; index < newUids.length; index += chunkSize) {
            uidChunks.push(newUids.slice(index, index + chunkSize))
        }
        let nextChunk = 0
        let failure = null
        const worker = async () => {
            while (nextChunk < uidChunks.length && !failure) {
                const chunk = uidChunks[nextChunk++]
                try {
                    this._assertMailLoad(run)
                    await this._getMailHeadersAndEmitAsEvents(chunk, run)
                } catch (error) {
                    failure ||= error
                }
            }
        }
        // Wait for every active worker before releasing a live connection's
        // load. A dropped/replaced connection cancels all waits explicitly.
        await Promise.all(Array.from({ length: Math.min(concurrency, uidChunks.length) }, worker))
        if (failure) throw failure
        this._assertMailLoad(run)

        if (!this.initialLoadDone) {
            this.initialLoadDone = true
            this.emit(ImapService.EVENT_INITIAL_LOAD_DONE)
        }
    }
    /**
     *
     * @param {Date} deleteMailsBefore delete mails before this date instance
     */
    async deleteOldMails(deleteMailsBefore) {
        const connection = this.connection
        if (!connection || this._purgeRun?.connection === connection) return

        // A timed-out fetch still occupies the IMAP queue. Keep its connection
        // guarded until those requests settle; a reconnect can start fresh work.
        const run = { connection, pending: new Set(), running: true, stop: false }
        this._purgeRun = run
        try {
            await this._purgeForConnection(connection, run)
        } finally {
            run.running = false
            this._releasePurge(run)
        }
    }

    _releasePurge(run) {
        if (!run.running && run.pending.size === 0 && this._purgeRun === run) {
            this._purgeRun = null
        }
    }

    async _purgeForConnection(connection, run) {
        const cutoff = helper.purgeTimeStamp()
        const uids = await this._searchWithoutFetch([['!DELETED']], connection)
        const batchSize = this.config.imap.fetchChunkSize
        const concurrency = this.config.imap.fetchConcurrency || 4
        if (!Number.isInteger(batchSize) || batchSize < 1 ||
            !Number.isInteger(concurrency) || concurrency < 1) {
            throw new Error('Invalid IMAP purge batch configuration')
        }

        let offset = 0
        const worker = async () => {
            while (offset < uids.length && !run.stop) {
                const batch = uids.slice(offset, offset + batchSize)
                offset += batchSize
                if (this.connection !== connection) return
                let headers, timer
                try {
                    try {
                        const fetch = Promise.resolve(connection.search([['UID', ...batch]], {
                            bodies: ['HEADER.FIELDS (TO)'],
                            envelope: false,
                            struct: false
                        }))
                        run.pending.add(fetch)
                        const settled = () => {
                            run.pending.delete(fetch)
                            this._releasePurge(run)
                        }
                        fetch.then(settled, settled)
                        headers = await Promise.race([
                            fetch,
                            new Promise((_, reject) => {
                                timer = setTimeout(() => reject(new Error('Header fetch timeout')), 30000)
                            })
                        ])
                    } finally {
                        clearTimeout(timer)
                    }
                    if (this.connection !== connection) return
                    // Resolve current inbox locks after the fetch. Only UID
                    // numbers survive while deletes wait in the IMAP queue.
                    const toDelete = this._purgeCandidates(headers, cutoff)
                    headers = null
                    if (toDelete.length) {
                        await connection.deleteMessage(toDelete)
                        toDelete.forEach(uid => this.emit(ImapService.EVENT_DELETED_MAIL, uid))
                    }
                } catch (error) {
                    debug('Purge batch failed:', error.message)
                    run.stop = true
                } finally {
                    headers = null
                }
            }
        }
        await Promise.all(Array.from({ length: Math.min(concurrency, Math.ceil(uids.length / batchSize)) }, worker))
    }

    _purgeCandidates(headers, cutoff) {
        const locked = this.inboxLock && typeof this.inboxLock.getAllLocked === 'function'
            ? this.inboxLock.getAllLocked() : []
        // A failed lock lookup leaves the batch untouched.
        if (!Array.isArray(locked) || locked.some(address => typeof address !== 'string')) {
            throw new Error('Inbox lock lookup failed')
        }
        const lockedAddresses = new Set(locked.map(address => address.toLowerCase()))
        const examples = new Set((this.config.email.examples?.uids || []).map(uid => parseInt(uid)))
        const result = []
        for (const mail of headers) {
            const uid = parseInt(mail.attributes?.uid)
            if (!Number.isSafeInteger(uid) || uid < 1 || examples.has(uid) ||
                !mail.attributes?.date || mail.attributes.date.getTime() > cutoff.getTime() ||
                !Number.isFinite(mail.attributes.date.getTime()) || !mail.parts?.[0]?.body) continue
            const raw = mail.parts[0].body.to
            const recipients = (Array.isArray(raw) ? raw : raw == null ? [] : [String(raw)])
                .flatMap(value => addressparser(value, { flatten: true }))
            if (!recipients.some(recipient => recipient.address && lockedAddresses.has(recipient.address.toLowerCase()))) {
                result.push(uid)
            }
        }
        return result
    }


    /**
     *
     * @param uid delete specific mail per UID
     */
    async deleteSpecificEmail(uid) {
        if (!this.connection) {
            debug(`Cannot delete UID ${uid}: no live IMAP connection`)
            return
        }

        if (!this.config.email.examples.uids.includes(parseInt(uid))) {
            await this.connection.deleteMessage(uid)
            debug(`Deleted UID ${uid}`)
            this.emit(ImapService.EVENT_DELETED_MAIL, uid)
        }
    }

    /**
     * Get seconds remaining until next IMAP refresh
     * @returns {number} Seconds until next refresh, or null if not started
     */
    getSecondsUntilNextRefresh() {
        if (!this.lastRefreshTime || !this.config.imap.refreshIntervalSeconds) {
            return null
        }

        const elapsed = (Date.now() - this.lastRefreshTime) / 1000
        const remaining = Math.max(0, this.config.imap.refreshIntervalSeconds - elapsed)
        return Math.ceil(remaining)
    }

    /**
     * Helper method because ImapSimple#search also fetches each message. We just need the uids here.
     *
     * @param {Object} searchCriteria (see ImapSimple#search)
     * @returns {Promise<Array<Int>>} Array of UIDs
     * @private
     */
    async _searchWithoutFetch(searchCriteria, connection = this.connection) {
        const imapUnderlying = connection.imap;
        // If searching by UID and the list is too long, batch it
        const UID_BATCH_SIZE = this.config.imap.fetchChunkSize;
        // Detect UID search: ['UID', [array]] or ['UID', '1:500']
        if (Array.isArray(searchCriteria) && searchCriteria.length === 1 && Array.isArray(searchCriteria[0]) && searchCriteria[0][0] === 'UID' && Array.isArray(searchCriteria[0][1]) && searchCriteria[0][1].length > UID_BATCH_SIZE) {
            const allUids = searchCriteria[0][1];
            let allResults = [];
            for (let i = 0; i < allUids.length; i += UID_BATCH_SIZE) {
                const batch = allUids.slice(i, i + UID_BATCH_SIZE);
                const batchCriteria = [
                    ['UID', batch]
                ];
                // eslint-disable-next-line no-await-in-loop
                const batchResult = await new Promise((resolve, reject) => {
                    imapUnderlying.search(batchCriteria, (err, uids) => {
                        if (err) reject(err);
                        else resolve(uids || []);
                    });
                });
                allResults = allResults.concat(batchResult);
            }
            return allResults;
        } else {
            return new Promise((resolve, reject) => {
                imapUnderlying.search(searchCriteria, (err, uids) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(uids || []);
                    }
                });
            });
        }
    }

    _createMailSummary(message) {
        const headerPart = message.parts[0].body
        const to = headerPart.to
            .flatMap(to => addressparser(to))
            // The address also contains the name, just keep the email
            .map(addressObj => addressObj.address)

        const from = headerPart.from.flatMap(from => addressparser(from))

        // Specify default subject, in case none exists.
        let subject = "No Subject"
        try {
            subject = headerPart.subject[0]
        } catch {
            // Do nothing
        }
        const rawDate = headerPart.date && headerPart.date[0] ? headerPart.date[0] : undefined
        let date
        if (rawDate) {
            // Parse email date - native Date handles ISO dates and timezones
            date = new Date(rawDate)
                // Fallback to current date if parsing fails
            if (isNaN(date.getTime())) {
                date = new Date()
            }
        } else {
            date = new Date()
        }
        const { uid } = message.attributes

        return Mail.create(to, from, date, subject, uid)
    }

    async fetchOneFullMail(to, uid, raw = false) {
        if (!this.connection) {
            // Here we 'fail fast' instead of waiting for the connection.
            throw new Error('IMAP connection not ready')
        }

        debug(`Fetching full message ${uid}`)

        // For security we also filter TO, so it is harder to just enumerate all messages.
        const searchCriteria = [
            ['UID', uid],
            ['TO', to]
        ]
        const fetchOptions = {
            bodies: ['HEADER', ''], // Empty string means full body
            markSeen: false
        }

        const messages = await this.connection.search(searchCriteria, fetchOptions)
        if (messages.length === 0) {
            return false
        } else if (!raw) {
            const fullBody = messages[0].parts.find(part => part.which === '')
            if (!fullBody || !fullBody.body) {
                throw new Error('Unable to find message body')
            }
            try {
                // Try to parse the email, fallback to raw if parsing fails
                const bodyString = fullBody.body.toString()
                return await simpleParser(bodyString)
            } catch (parseError) {
                debug('Failed to parse email, returning raw data:', parseError.message)
                    // Return raw data as fallback
                return {
                    subject: 'Unable to parse email',
                    text: fullBody.body.toString(),
                    html: `<pre>${fullBody.body.toString()}</pre>`,
                    from: { text: 'Unknown' },
                    to: { text: to },
                    date: new Date()
                }
            }
        } else {
            return messages[0].parts[1].body
        }
    }


    async _getAllUids(connection = this.connection) {
        // We ignore mails that are flagged as DELETED, but have not been removed (expunged) yet.
        const uids = await this._searchWithoutFetch([
                ['!DELETED']
            ], connection)
            // Create copy to not mutate the original array. Sort with newest first (DESC).
        return [...uids].sort().reverse()
    }

    async _getMailHeadersAndEmitAsEvents(uids, run) {
        try {
            const mails = await this._getMailHeaders(uids, run.connection, run)
            this._assertMailLoad(run)
            const requested = new Set(uids)
            debug(`Fetched headers for ${uids.length} UIDs; server returned ${mails.length} messages`)
            mails.forEach(mail => {
                this._assertMailLoad(run)
                if (!Number.isSafeInteger(mail.attributes?.uid) || !requested.has(mail.attributes.uid)) {
                    throw new Error('Unexpected IMAP summary UID')
                }
                const header = mail.parts?.[0]?.body
                if (!header) throw new Error('Missing IMAP summary headers')
                    // Some broadcast messages have no TO field. We have to ignore those messages.
                const summary = header.to ? this._createMailSummary(mail) : null
                this.loadedUids.add(mail.attributes.uid)
                if (summary) this.emit(ImapService.EVENT_NEW_MAIL, summary)
            })
        } catch (error) {
            debug('Cant fetch', error)
            throw error
        }
    }

    _getMailHeaders(uids, connection = this.connection, run = null) {
        const fetchOptions = {
            envelope: true,
            bodies: ['HEADER.FIELDS (FROM TO SUBJECT DATE)'],
            struct: false,
            markSeen: false
        }
        // imap-simple 1.6.3 waits for the searched UID count, even when a UID
        // vanished before FETCH. Complete from actual message/stream/end events.
        return new Promise((resolve, reject) => {
            let fetch, ended = false, pending = 0, settled = false, mails = []
            const cleanup = new Set()
            const finish = error => {
                if (settled) return
                settled = true
                run?.cancelListeners.delete(cancel)
                fetch?.removeListener('message', onMessage)
                fetch?.removeListener('end', onEnd)
                for (const dispose of cleanup) dispose()
                cleanup.clear()
                const result = mails
                mails = []
                if (error) reject(error)
                else resolve(result)
            }
            const complete = () => { if (ended && pending === 0) finish() }
            const cancel = error => finish(error)
            const onError = error => finish(error)
            const onEnd = () => { ended = true; complete() }
            const onMessage = message => {
                if (settled) return
                pending++
                let attributes, messageEnded = false, bodies = 0, done = false
                const parts = []
                const completeMessage = () => {
                    if (settled || done || !messageEnded || bodies) return
                    done = true
                    mails.push({ attributes, parts })
                    pending--
                    dispose()
                    cleanup.delete(dispose)
                    complete()
                }
                const onAttributes = value => { attributes = value }
                const onMessageEnd = () => { messageEnded = true; completeMessage() }
                const onBody = (stream, info) => {
                    if (typeof info?.which !== 'string' || !info.which.startsWith('HEADER.FIELDS ')) {
                        finish(new Error('Unexpected IMAP summary body part'))
                        return
                    }
                    bodies++
                    let body = ''
                    const onData = chunk => { if (!settled) body += chunk.toString('utf8') }
                    const disposeBody = () => {
                        body = ''
                        stream.removeListener('data', onData)
                        stream.removeListener('end', onBodyEnd)
                    }
                    const onBodyEnd = () => {
                        if (settled) return
                        try {
                            parts.push({ which: info.which, size: info.size, body: imaps.parseHeader(body) })
                            bodies--
                            disposeBody()
                            cleanup.delete(disposeBody)
                            completeMessage()
                        } catch (error) { finish(error) }
                    }
                    cleanup.add(disposeBody)
                    stream.on('data', onData)
                    stream.once('end', onBodyEnd)
                    stream.on('error', onError)
                }
                const dispose = () => {
                    message.removeListener('body', onBody)
                    message.removeListener('attributes', onAttributes)
                    message.removeListener('end', onMessageEnd)
                }
                cleanup.add(dispose)
                message.on('body', onBody)
                message.once('attributes', onAttributes)
                message.once('end', onMessageEnd)
                message.on('error', onError)
            }
            try {
                fetch = connection.imap.fetch(uids, fetchOptions)
                fetch.on('message', onMessage)
                // Keep settled error listeners to consume late errors after a
                // disconnect; all body buffers and mutation paths are detached.
                fetch.on('error', onError)
                fetch.once('end', onEnd)
                run?.cancelListeners.add(cancel)
                if (run?.cancelled) cancel(run.cancelled)
            } catch (error) { finish(error) }
        })
    }

    /* 
     * Get the largest UID from all messages in the mailbox.
     */
    async getLargestUid() {
        const uids = await this._getAllUids();
        return uids.length > 0 ? Math.max(...uids) : null;
    }

}


// Consumers should use these constants:
ImapService.EVENT_NEW_MAIL = 'mail'
ImapService.EVENT_DELETED_MAIL = 'mailDeleted'
ImapService.EVENT_INITIAL_LOAD_DONE = 'initial load done'
ImapService.EVENT_ERROR = 'error'
ImapService.EVENT_CONNECTION_LOST = 'connection lost'
ImapService.EVENT_RECONNECTING = 'reconnecting'
ImapService.EVENT_RECONNECTED = 'reconnected'

module.exports = ImapService
