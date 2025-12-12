const EventEmitter = require('events')
const debug = require('debug')('48hr-email:imap-manager')
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

        console.log(`Running old mail deletion every ${this.config.imap.refreshIntervalSeconds} seconds`)

        setInterval(() => {
            this._deleteOldMails()
        }, this.config.imap.refreshIntervalSeconds * 1000)
    }

    getMailSummaries(address) {
        return this.mailRepository.getForRecipient(address)
    }

    deleteSpecificEmail(adress, uid) {
        if (this.mailRepository.removeUid(uid, adress) == true) {
            this.imapService.deleteSpecificEmail(uid)
        }
    }

    getOneFullMail(address, uid, raw = false) {
        return this.cachedFetchFullMail(address, uid, raw)
    }

    getAllMailSummaries() {
        return this.mailRepository.getAll()
    }

    onInitialLoadDone() {
        this.initialLoadDone = true
        console.log(`initial load done, got ${this.mailRepository.mailCount()} mails`)
    }

    onNewMail(mail) {
        if (this.initialLoadDone) {
            // For now, only log messages if they arrive after the initial load
            debug('new mail for', mail.to[0])
        }

        mail.to.forEach(to => {
            this.mailRepository.add(to, mail)
            return this.clientNotification.emit(to)
        })
    }

    onMailDeleted(uid) {
        debug('mail deleted with uid', uid)
        this.mailRepository.removeUid(uid)
    }

    async _deleteOldMails() {
        try {
            await this.imapService.deleteOldMails(helper.purgeTimeStamp())
        } catch (error) {
            console.log('can not delete old messages', error)
        }
    }

    _saveToFile(mails, filename) {
        const fs = require('fs')
        fs.writeFile(filename, JSON.stringify(mails), err => {
            if (err) {
                console.error('can not save mails to file', err)
            }
        })
    }
}

module.exports = MailProcessingService