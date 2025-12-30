const debug = require('debug')('48hr-email:mail-summary-store')
const MultiMap = require('mnemonist/multi-map')
const _ = require('lodash')
const config = require('../application/config')

class MailRepository {
    constructor() {
        // MultiMap docs: https://yomguithereal.github.io/mnemonist/multi-map
        this.mailSummaries = new MultiMap()
        this.config = config
    }

    getForRecipient(address) {
        let mails = this.mailSummaries.get(address) || []
        const mailsToDelete = []

        mails.forEach(mail => {
            if (mail.to == this.config.email.examples.account && !this.config.email.examples.uids.includes(parseInt(mail.uid))) {
                mailsToDelete.push(mail.uid)
                debug('Marking non-example email for deletion from example inbox', mail.uid)
            }
        })

        // Delete the non-example mails
        mailsToDelete.forEach(uid => {
            this.removeUid(uid, address)
        })

        // Get fresh list after deletions
        mails = this.mailSummaries.get(address) || []
        return _.orderBy(mails, mail => Date.parse(mail.date), ['desc'])
    }

    getAll() {
        const mails = [...this.mailSummaries.values()]
        return _.orderBy(mails, mail => Date.parse(mail.date), ['desc'])
    }

    add(to, mailSummary) {
        if (to !== undefined) {
            this.mailSummaries.set(to.toLowerCase(), mailSummary)
        } else {
            debug('IMAP reported no recipient for mail, ignoring', mailSummary)
        }
    }

    removeUid(uid, address) {
        if (!this.config.email.examples.uids.includes(parseInt(uid))) {
            var deleted = false

            if (address) {
                // Efficient path: only search the specific address's emails
                const mails = this.mailSummaries.get(address) || []
                const mailToDelete = mails.find(mail => mail.uid === parseInt(uid))
                if (mailToDelete) {
                    this.mailSummaries.remove(address, mailToDelete)
                    deleted = true
                }
            } else {
                // Fallback: search all emails (needed when address is unknown)
                this.mailSummaries.forEachAssociation((mails, to) => {
                    mails
                        .filter(mail => mail.uid === parseInt(uid))
                        .forEach(mail => {
                            this.mailSummaries.remove(to, mail)
                            debug('Removed ', mail.date, to, mail.subject)
                            deleted = true
                        })
                })
            }
            return deleted
        }
        return false
    }

    mailCount() {
        return this.mailSummaries.size
    }
}

module.exports = MailRepository