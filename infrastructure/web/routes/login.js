const express = require('express')

const router = new express.Router()
const randomWord = require('random-word')
const {check, validationResult} = require('express-validator/check')
const config = require('../../../application/config')

router.get('/', (req, res, _next) => {
	res.render('login', {
		title: `${config.branding[0]} | Your temporary Inbox`,
		username: randomWord(),
		domains: config.email.domains,
		madeby: config.branding[1],
		madebysite: config.branding[2]
	})
})

router.get('/inbox/random', (req, res, _next) => {
	res.redirect(`/inbox/${randomWord()}@${config.email.domains[Math.floor(Math.random() * config.email.domains.length)]}`)
})

router.get('/logout', (req, res, _next) => {

	/**
	 * If we ever need a logout sequence, now we can have one!
	 */

	res.redirect('/')
})

router.post(
	'/',
	[
		check('username').isLength({min: 1}),
		check('domain').isIn(config.email.domains)
	],
	(req, res) => {
		const errors = validationResult(req)
		if (!errors.isEmpty()) {
			return res.render('login', {
				title: 'Login',
				username: req.body.username,
				domain: req.body.domain,
				userInputError: true,
				madeby: config.branding[1],
				madebysite: config.branding[2]
			})
		}

		res.redirect(`/inbox/${req.body.username}@${req.body.domain}`)
	}
)

module.exports = router
