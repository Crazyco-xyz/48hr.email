const EventEmitter = require('events')
const imaps = require('imap-simple')
const { simpleParser } = require('mailparser')
const addressparser = require('nodemailer/lib/addressparser')
const retry = require('async-retry')
const debug = require('debug')('48hr-email:imap-manager')
const Mail = require('../domain/mail')
const Helper = require('./helper')
const helper = new(Helper)
const config = require('./config')


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

        this.once(ImapService.EVENT_INITIAL_LOAD_DONE, () =>
            this._doAfterInitialLoad()
        )

        await this._connectWithRetry(imapConfig)

        // Load all messages in the background. (ASYNC)
        this._loadMailSummariesAndEmitAsEvents()
    }

    async _connectWithRetry(configWithListener) {
        try {
            await retry(
                async _bail => {
                    // If anything throws, we retry
                    this.connection = await imaps.connect(configWithListener)

                    this.connection.on('error', err => {
                        // We assume that the app will be restarted after a crash.
                        console.error('Got fatal error during imap operation, stop app.', err)
                        this.emit('error', err)
                    })

                    await this.connection.openBox('INBOX')
                    debug('Connected to imap Server at ' + this.config.imap.host)
                }, {
                    retries: 5
                }
            )
        } catch (error) {
            console.error('Cant connect, even after retrying, stopping app', error)
            throw error
        }
    }

    _doOnNewMail() {
        // Only react to new mails after the initial load, otherwise it might load the same mails twice.
        if (this.initialLoadDone) {
            this._loadMailSummariesAndEmitAsEvents()
        }
    }

    _doAfterInitialLoad() {
        // During initial load we ignored new incoming emails. In order to catch up with those, we have to refresh
        // the mails once after the initial load. (async)
        this._loadMailSummariesAndEmitAsEvents()

        // If the above trigger on new mails does not work reliable, we have to regularly check
        // for new mails on the server. This is done only after all the mails have been loaded for the
        // first time. (Note: set the refresh higher than the time it takes to download the mails).
        if (this.config.imap.refreshIntervalSeconds) {
            // Track when refreshes happen
            this.lastRefreshTime = Date.now()

            setInterval(
                () => {
                    this.lastRefreshTime = Date.now()
                    this._loadMailSummariesAndEmitAsEvents()
                },
                this.config.imap.refreshIntervalSeconds * 1000
            )
        }
    }

    async _loadMailSummariesAndEmitAsEvents() {
        // Prevent overlapping loads which can inflate counts
        if (this.loadingInProgress) {
            debug('Load skipped: another load already in progress')
            return
        }

        this.loadingInProgress = true
        if (this.initialLoadDone) {
            debug('Updating mail summaries from server...')
        } else {
            debug('Fetching mail summaries from server...')
        }

        const uids = await this._getAllUids()
        const newUids = uids.filter(uid => !this.loadedUids.has(uid))
        debug(`UIDs on server: ${uids.length}, new UIDs to fetch: ${newUids.length}, already loaded: ${this.loadedUids.size}`)

        // Tuneable chunk size & concurrency for faster initial loads
        const chunkSize = this.config.imap.fetchChunkSize
        const concurrency = this.config.imap.fetchConcurrency

        // Chunk newest-first UIDs to balance speed and first-paint
        const uidChunks = []
        for (let i = 0; i < newUids.length; i += chunkSize) {
            uidChunks.push(newUids.slice(i, i + chunkSize))
        }
        debug(`Chunk size: ${chunkSize}, concurrency: ${concurrency}, chunks to process: ${uidChunks.length}`)

        // Limited-concurrency worker
        const pool = []
        let workerId = 0
        const runNext = async() => {
            if (workerId >= uidChunks.length) return
            const chunkId = workerId++
                const chunk = uidChunks[chunkId]
            try {
                debug(`Worker processing chunk ${chunkId + 1}/${uidChunks.length} (size: ${chunk.length})`)
                await this._getMailHeadersAndEmitAsEvents(chunk)
                debug(`Completed chunk ${chunkId + 1}/${uidChunks.length}; loadedUids size now: ${this.loadedUids.size}`)
            } finally {
                await runNext()
            }
        }

        // Start workers
        const workers = Math.min(concurrency, uidChunks.length)
        for (let i = 0; i < workers; i++) {
            pool.push(runNext())
        }
        await Promise.all(pool)
        debug(`All chunks processed. Final loadedUids size: ${this.loadedUids.size}`)

        // Mark initial load done only after all chunks complete to avoid double-runs
        if (!this.initialLoadDone) {
            this.initialLoadDone = true
            this.emit(ImapService.EVENT_INITIAL_LOAD_DONE)
            debug('Emitted initial load done')
        }

        this.loadingInProgress = false
        debug('Finished updating mail summary list')
    }

    /**
     *
     * @param {Date} deleteMailsBefore delete mails before this date instance
     */
    async deleteOldMails(deleteMailsBefore) {
        let uids;

        // IMAP date filters are unreliable - some servers search internal date, not Date header
        // Always fetch all UIDs and filter by date header in JavaScript instead
        const searchQuery = [
            ['!DELETED']
        ];

        uids = await this._searchWithoutFetch(searchQuery);

        if (uids.length === 0) return;

        const deleteOlderThan = helper.purgeTimeStamp();
        const exampleUids = this.config.email.examples.uids.map(x => parseInt(x));
        const headers = await this._getMailHeaders(uids);

        // Get locked inboxes if available
        let lockedAddresses = [];
        if (this.inboxLock && typeof this.inboxLock.getAllLocked === 'function') {
            try {
                lockedAddresses = this.inboxLock.getAllLocked().map(addr => addr.toLowerCase());
                debug(`Locked inboxes (excluded from purge): ${lockedAddresses.length > 0 ? lockedAddresses.join(', ') : '0'}`);
            } catch (err) {
                debug('Could not get locked inboxes for purge:', err.message);
            }
        }

        // Filter out mails that are too new, whitelisted, or belong to locked inboxes
        const toDelete = headers
            .filter(mail => {
                const date = mail.attributes.date;
                const uid = parseInt(mail.attributes.uid);
                const toAddresses = Array.isArray(mail.parts[0].body.to) ?
                    mail.parts[0].body.to.map(a => a.toLowerCase()) : [String(mail.parts[0].body.to).toLowerCase()];

                if (exampleUids.includes(uid)) return false;
                if (toAddresses.some(addr => lockedAddresses.includes(addr))) return false;
                return date <= deleteOlderThan;
            })
            .map(mail => parseInt(mail.attributes.uid));

        if (toDelete.length === 0) {
            debug('No mails to delete. (after locked inbox exclusion)');
            return;
        }

        debug(`Deleting mails ${toDelete}`);
        // Batch deletes to avoid IMAP argument limits
        const BATCH_SIZE = 100;
        for (let i = 0; i < toDelete.length; i += BATCH_SIZE) {
            const batch = toDelete.slice(i, i + BATCH_SIZE);
            await this.connection.deleteMessage(batch);
            batch.forEach(uid => {
                this.emit(ImapService.EVENT_DELETED_MAIL, uid);
            });
        }
    }


    /**
     *
     * @param uid delete specific mail per UID
     */
    async deleteSpecificEmail(uid) {
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
    async _searchWithoutFetch(searchCriteria) {
        const imapUnderlying = this.connection.imap

        return new Promise((resolve, reject) => {
            imapUnderlying.search(searchCriteria, (err, uids) => {
                if (err) {
                    reject(err)
                } else {
                    resolve(uids || [])
                }
            })
        })
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


    async _getAllUids() {
        // We ignore mails that are flagged as DELETED, but have not been removed (expunged) yet.
        const uids = await this._searchWithoutFetch([
                ['!DELETED']
            ])
            // Create copy to not mutate the original array. Sort with newest first (DESC).
        return [...uids].sort().reverse()
    }

    async _getMailHeadersAndEmitAsEvents(uids) {
        try {
            const mails = await this._getMailHeaders(uids)
            debug(`Fetched headers for ${uids.length} UIDs; server returned ${mails.length} messages`)
            mails.forEach(mail => {
                this.loadedUids.add(mail.attributes.uid)
                    // Some broadcast messages have no TO field. We have to ignore those messages.
                if (mail.parts[0].body.to) {
                    this.emit(ImapService.EVENT_NEW_MAIL, this._createMailSummary(mail))
                }
            })
        } catch (error) {
            debug('Cant fetch', error)
            throw error
        }
    }

    async _getMailHeaders(uids) {
        const fetchOptions = {
            envelope: true,
            bodies: ['HEADER.FIELDS (FROM TO SUBJECT DATE)'],
            struct: false
        }
        const searchCriteria = [
            ['UID', ...uids]
        ]
        return this.connection.search(searchCriteria, fetchOptions)
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

module.exports = ImapService