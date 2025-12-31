const EventEmitter = require('events')
const debug = require('debug')('48hr-email:imap-processor')
const ImapService = require('./imap-service')
const Helper = require('./helper')
const config = require('./config')
const helper = new(Helper)


class MailProcessingService extends EventEmitter {
    constructor(mailRepository, imapService, clientNotification, config) {
        super()
        this.mailRepository = mailRepository
        this.clientNotification = clientNotification
        this.imapService = imapService
        this.config = config

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
        console.log(`Initial load done, got ${this.mailRepository.mailCount()} mails`)
        console.log(`Fetching and deleting mails every ${this.config.imap.refreshIntervalSeconds} seconds`)
        console.log(`Mails older than ${this.config.email.purgeTime.time} ${this.config.email.purgeTime.unit} will be deleted`)
        console.log(`The example emails are: ${this.config.email.examples.uids.join(', ')}, on the account ${this.config.email.examples.account}`)
    }

    onNewMail(mail) {
        debug('onNewMail called for:', mail.to)
        if (this.initialLoadDone) {
            // For now, only log messages if they arrive after the initial load
            debug('New mail for', mail.to[0])
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