const EventEmitter = require('events')
const debug = require('debug')('48hr-email:imap-processor')
const mem = require('mem')
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
        this.cachedFetchFullMail = mem(
            this.imapService.fetchOneFullMail.bind(this.imapService), { maxAge: 10 * 60 * 1000 }
        )

        this.initialLoadDone = false

        // Delete old messages now and every few hours
        this.imapService.once(ImapService.EVENT_INITIAL_LOAD_DONE, () =>
            this._deleteOldMails()
        )

        setInterval(() => {
            this._deleteOldMails()
        }, this.config.imap.refreshIntervalSeconds * 1000)
    }

    getMailSummaries(address) {
        debug('Getting mail summaries for', address)
        return this.mailRepository.getForRecipient(address)
    }

    deleteSpecificEmail(adress, uid) {
        debug('Deleting specific email', adress, uid)
        if (this.mailRepository.removeUid(uid, adress) == true) {
            this.imapService.deleteSpecificEmail(uid)
        }
    }

    getOneFullMail(address, uid, raw = false) {
        debug('Cache lookup for', address + ':' + uid, raw ? '(raw)' : '(parsed)')
        return this.cachedFetchFullMail(address, uid, raw)
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
        if (this.initialLoadDone) {
            // For now, only log messages if they arrive after the initial load
            debug('New mail for', mail.to[0])
        }

        mail.to.forEach(to => {
            debug('Adding mail to repository for recipient:', to)
            this.mailRepository.add(to, mail)
            debug('Emitting notification for:', to)
            return this.clientNotification.emit(to)
        })
    }

    onMailDeleted(uid) {
        debug('Mail deleted with uid', uid)
        this.mailRepository.removeUid(uid)
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