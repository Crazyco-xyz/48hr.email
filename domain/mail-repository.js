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
		mails.forEach(mail => {
			if (mail.to == this.config.http.examples.email && !this.config.http.examples.uids.includes(parseInt(mail.uid))) {
				mails = mails.filter(m => m.uid != mail.uid)
				debug('prevented non-example email from being shown in example inbox', mail.uid)
			}
		})
		return _.orderBy(mails, mail => Date.parse(mail.date), ['desc'])
	}

	getAll() {
		const mails = [...this.mailSummaries.values()]
		return _.orderBy(mails, mail => Date.parse(mail.date), ['desc'])
	}

	add(to, mailSummary) {
		this.mailSummaries.set(to.toLowerCase(), mailSummary)
	}

	removeUid(uid, address) {
		if (!this.config.http.examples.uids.includes(parseInt(uid))) {
			var deleted = false
			// TODO: make this more efficient, looping through each email is not cool.
			this.mailSummaries.forEachAssociation((mails, to) => {
				mails
					.filter(mail => mail.uid === parseInt(uid) && (address ? to == address : true))
					.forEach(mail => {
						this.mailSummaries.remove(to, mail)
						debug('removed ', mail.date, to, mail.subject)
						deleted = true
					})
			})
			return deleted
		}
		return false
	}

	mailCount() {
		return this.mailSummaries.size
	}
}

module.exports = MailRepository
