const EventEmitter = require('events')
const debug = require('debug')('48hr-email:imap-processor')
const ImapService = require('./imap-service')
const Helper = require('./helper-service')
const config = require('./config-service')
const helper = new(Helper)


class MailProcessingService extends EventEmitter {
    constructor(mailRepository, imapService, clientNotification, config, smtpService = null, verificationStore = null, statisticsStore = null) {
        super()
        this.mailRepository = mailRepository
        this.clientNotification = clientNotification
        this.imapService = imapService
        this.config = config
        this.smtpService = smtpService
        this.verificationStore = verificationStore
        this.statisticsStore = statisticsStore
        this.helper = new(Helper)

        // Cached methods:
        this._initCache()

        this.initialLoadDone = false

        // Delete old messages now and every few hours
        this.imapService.once(ImapService.EVENT_INITIAL_LOAD_DONE, () =>
            this._deleteOldMails()
        )

        setInterval(() => {
            this._deleteOldMails()
        }, this.config.imap.refreshIntervalSeconds * 1000)

        // Periodically ground largestUid to IMAP state every 5 minutes
        setInterval(async() => {
            try {
                if (this.statisticsStore && this.imapService) {
                    const realLargestUid = await this.imapService.getLargestUid();
                    if (realLargestUid && realLargestUid !== this.statisticsStore.largestUid) {
                        this.statisticsStore.largestUid = realLargestUid;
                        this.statisticsStore._saveToDatabase && this.statisticsStore._saveToDatabase();
                        debug(`Grounded statisticsStore.largestUid to IMAP: ${realLargestUid}`);
                    }
                }
            } catch (err) {
                debug('Error grounding largestUid to IMAP:', err.message);
            }
        }, 60 * 1000); // 1 minute
    }

    _initCache() {
        // Create a cache storage to track entries by UID
        this.cacheStorage = new Map() // Map of "address:uid:raw" -> cached result

        // Wrapper that maintains our own cache with selective deletion
        this.cachedFetchFullMail = async(address, uid, raw) => {
            const cacheKey = `${address}:${uid}:${raw}`

            // Check our cache first
            if (this.cacheStorage.has(cacheKey)) {
                const entry = this.cacheStorage.get(cacheKey)
                if (Date.now() - entry.timestamp < 10 * 60 * 1000) {
                    return entry.value
                } else {
                    this.cacheStorage.delete(cacheKey)
                }
            }

            // Fetch and cache
            const result = await this.imapService.fetchOneFullMail(address, uid, raw)
            this.cacheStorage.set(cacheKey, {
                value: result,
                timestamp: Date.now(),
                uid: uid
            })

            return result
        }

        // Wrap it to use in sync context
        this._wrappedCachedFetch = (address, uid, raw) => {
            return this.cachedFetchFullMail(address, uid, raw)
        }
    }

    _clearCache() {
        // Clear entire cache
        debug('Clearing entire email cache')
        this.cacheStorage.clear()
        this._initCache()
    }

    _clearCacheForUid(uid) {
        // Selectively clear cache entries for a specific UID
        // Normalize UID to integer for comparison
        const normalizedUid = parseInt(uid)
        let cleared = 0

        for (const [key, entry] of this.cacheStorage.entries()) {
            if (parseInt(entry.uid) === normalizedUid) {
                this.cacheStorage.delete(key)
                cleared++
            }
        }

        if (cleared > 0) {
            debug(`Cleared ${cleared} cache entries for UID ${uid}`)
        } else {
            debug(`No cache entries found for UID ${uid}`)
        }
    }

    getMailSummaries(address) {
        debug('Getting mail summaries for', address)
        return this.mailRepository.getForRecipient(address)
    }

    deleteSpecificEmail(adress, uid) {
        if (this.mailRepository.removeUid(uid, adress) == true) {
            // Clear cache immediately for this UID
            debug('Clearing cache for uid', uid)
            this._clearCacheForUid(uid)
            this.imapService.deleteSpecificEmail(uid)
        } else {
            debug('Repository removeUid returned false for', uid)
        }
    }

    getOneFullMail(address, uid, raw = false) {
        debug('Cache lookup for', address + ':' + uid, raw ? '(raw)' : '(parsed)')

        // Check if this UID exists in repository before fetching
        const summaries = this.mailRepository.getForRecipient(address)
        const exists = summaries.some(mail => mail.uid === parseInt(uid))

        if (!exists) {
            debug(`UID ${uid} not found in repository for ${address}, returning null`)
            return Promise.resolve(null)
        }

        return this._wrappedCachedFetch(address, uid, raw)
    }

    getAllMailSummaries() {
        debug('Getting all mail summaries')
        return this.mailRepository.getAll()
    }

    getCount() {
        const count = this.mailRepository.mailCount()
        debug('Mail count requested:', count)
        return count
    }

    onInitialLoadDone() {
        this.initialLoadDone = true
        debug('Initial load completed, total mails:', this.mailRepository.mailCount())

        // Don't print old-style logs here, app.js will handle the startup banner
    }

    onNewMail(mail) {
        debug('onNewMail called for:', mail.to)

        // Check if sender is blacklisted
        const senderAddress = mail.from && mail.from[0] && mail.from[0].address
        if (senderAddress && this.config.email.blacklistedSenders.length > 0) {
            const isBlacklisted = this.config.email.blacklistedSenders.some(blocked =>
                blocked.toLowerCase() === senderAddress.toLowerCase()
            )
            if (isBlacklisted) {
                debug(`Blacklisted sender detected: ${senderAddress}, deleting UID ${mail.uid}`)
                this.imapService.deleteSpecificEmail(mail.uid)
                return
            }
        }

        if (this.initialLoadDone) {
            // For now, only log messages if they arrive after the initial load
            debug('New mail for', mail.to[0])

            // Track email received
            if (this.statisticsStore) {
                this.statisticsStore.recordReceive()
                    // Update all-time total with new UID
                this.statisticsStore.updateLargestUid(mail.uid)
            }
        }

        mail.to.forEach(to => {
            debug('Adding mail to repository for recipient:', to)
            this.mailRepository.add(to, mail)
            debug('Emitting notification for:', to)
            const emitResult = this.clientNotification.emit(to)
            debug('clientNotification.emit result:', emitResult)
            return emitResult
        })
    }

    onMailDeleted(uid) {
        debug('Mail deleted:', uid)

        // Track email deleted
        if (this.statisticsStore) {
            this.statisticsStore.recordDelete()
        }

        // Clear cache for this specific UID
        try {
            this._clearCacheForUid(uid)
        } catch (err) {
            debug('Failed to clear email cache:', err.message)
        }

        // Find which addresses have this UID before removing it
        const affectedAddresses = []
        this.mailRepository.mailSummaries.forEachAssociation((mails, address) => {
            if (mails.some(mail => mail.uid === parseInt(uid))) {
                affectedAddresses.push(address)
            }
        })

        // Remove from repository
        this.mailRepository.removeUid(uid)

        // Notify affected inboxes to reload
        if (this.initialLoadDone) {
            affectedAddresses.forEach(address => {
                debug('Notifying inbox after deletion:', address)
                this.clientNotification.emit(address)
            })
        }
    }

    async _deleteOldMails() {
        try {
            debug('Starting deletion of old mails')
            await this.imapService.deleteOldMails(helper.purgeTimeStamp())
            debug('Completed deletion of old mails')
        } catch (error) {
            debug('Error deleting old messages:', error.message)
            console.log('Cant delete old messages', error)
        }
    }

    /**
     * Forward an email to a destination address
     * @param {string} address - The recipient address of the email to forward
     * @param {number|string} uid - The UID of the email to forward
     * @param {string} destinationEmail - The email address to forward to
     * @returns {Promise<{success: boolean, error?: string, messageId?: string}>}
     */
    async forwardEmail(address, uid, destinationEmail) {
        // Check if SMTP service is available
        if (!this.smtpService) {
            debug('Forward attempt failed: SMTP service not configured')
            return {
                success: false,
                error: 'Email forwarding is not configured. Please configure SMTP settings.'
            }
        }

        // Check if email exists in repository
        const mailSummary = this.mailRepository.getForRecipient(address)
            .find(mail => parseInt(mail.uid) === parseInt(uid))

        if (!mailSummary) {
            debug(`Forward attempt failed: Email not found (address: ${address}, uid: ${uid})`)
            return {
                success: false,
                error: 'Email not found'
            }
        }

        try {
            // Fetch full email content using cached method
            debug(`Fetching full email for forwarding (address: ${address}, uid: ${uid})`)
            const fullMail = await this.getOneFullMail(address, uid, false)

            if (!fullMail) {
                debug('Forward attempt failed: Could not fetch full email')
                return {
                    success: false,
                    error: 'Could not retrieve email content'
                }
            }

            // Forward via SMTP service
            debug(`Forwarding email to ${destinationEmail}`)
            const branding = this.config.http.features.branding[0] || '48hr.email'
            const result = await this.smtpService.forwardMail(fullMail, destinationEmail, branding)

            if (result.success) {
                debug(`Email forwarded successfully. MessageId: ${result.messageId}`)

                // Track email forwarded
                if (this.statisticsStore) {
                    this.statisticsStore.recordForward()
                }
            } else {
                debug(`Email forwarding failed: ${result.error}`)
            }

            return result
        } catch (error) {
            debug('Error forwarding email:', error.message)
            return {
                success: false,
                error: `Failed to forward email: ${error.message}`
            }
        }
    }

    /**
     * Initiate email verification for forwarding
     * Sends verification email to destination address
     * @param {string} sourceAddress - The inbox address requesting forwarding
     * @param {string} destinationEmail - The email address to verify and forward to
     * @param {Array<number>} uids - Array of email UIDs to forward (optional, for context)
     * @returns {Promise<{success: boolean, error?: string, cooldownSeconds?: number}>}
     */
    async initiateForwardVerification(sourceAddress, destinationEmail, uids = []) {
        // Check if verification store is available
        if (!this.verificationStore) {
            debug('Verification store not available')
            return {
                success: false,
                error: 'Email verification is not configured'
            }
        }

        // Check if SMTP service is available
        if (!this.smtpService) {
            debug('SMTP service not configured')
            return {
                success: false,
                error: 'Email forwarding is not configured. Please configure SMTP settings.'
            }
        }

        // Check rate limit (5-minute cooldown)
        const canRequest = this.verificationStore.canRequestVerification(destinationEmail)
        if (!canRequest) {
            const lastRequest = this.verificationStore.getLastVerificationTime(destinationEmail)
            const cooldownMs = 5 * 60 * 1000
            const elapsed = Date.now() - lastRequest
            const remainingSeconds = Math.ceil((cooldownMs - elapsed) / 1000)

            debug(`Verification rate limit hit for ${destinationEmail}, ${remainingSeconds}s remaining`)
            return {
                success: false,
                error: `Please wait ${remainingSeconds} seconds before requesting another verification email`,
                cooldownSeconds: remainingSeconds
            }
        }

        try {
            // Generate verification token
            const token = this.helper.generateVerificationToken()

            // Store verification with metadata
            this.verificationStore.createVerification(token, destinationEmail, {
                sourceAddress,
                uids,
                createdAt: new Date().toISOString()
            })

            // Send verification email
            const baseUrl = this.config.http.baseUrl
            const branding = this.config.http.features.branding[0] || '48hr.email'

            debug(`Sending verification email to ${destinationEmail} for source ${sourceAddress}`)
            const result = await this.smtpService.sendVerificationEmail(
                destinationEmail,
                token,
                baseUrl,
                branding
            )

            if (result.success) {
                debug(`Verification email sent successfully. MessageId: ${result.messageId}`)
                return {
                    success: true,
                    messageId: result.messageId
                }
            } else {
                debug(`Failed to send verification email: ${result.error}`)
                return {
                    success: false,
                    error: result.error
                }
            }
        } catch (error) {
            debug('Error initiating verification:', error.message)
            return {
                success: false,
                error: `Failed to send verification email: ${error.message}`
            }
        }
    }

    _saveToFile(mails, filename) {
        const fs = require('fs')
        fs.writeFile(filename, JSON.stringify(mails), err => {
            if (err) {
                console.error('Cant save mails to file', err)
            }
        })
    }
}

module.exports = MailProcessingService
