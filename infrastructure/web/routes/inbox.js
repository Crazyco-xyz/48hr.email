const express = require('express')

const router = new express.Router()
const {param} = require('express-validator')
const config = require('../../../application/config')
const sanitizeAddress = param('address').customSanitizer(
	(value, {req}) => {
		return req.params.address
			.replace(/[^A-Za-z0-9_.+@-]/g, '') // Remove special characters
			.toLowerCase()
	}
)

router.get('^/:address([^@/]+@[^@/]+)', sanitizeAddress, (req, res, _next) => {
	const mailProcessingService = req.app.get('mailProcessingService')
	res.render('inbox', {
		title: `${config.http.branding[0]} | ` + req.params.address,
		address: req.params.address,
		mailSummaries: mailProcessingService.getMailSummaries(req.params.address),
		madeby: config.http.branding[1],
		madebysite: config.http.branding[2]
	})
})

router.get(
	'^/:address/:uid([0-9]+$)',
	sanitizeAddress,
	async (req, res, next) => {
		try {
			const mailProcessingService = req.app.get('mailProcessingService')
			const mail = await mailProcessingService.getOneFullMail(
				req.params.address,
				req.params.uid
			)
			if (mail && mail != "womp womp") {
				// Emails are immutable, cache if found
				res.set('Cache-Control', 'private, max-age=600')
				res.render('mail', {
					title: req.params.address,
					address: req.params.address,
					mail,
					uid: req.params.uid,
					madeby: config.http.branding[1],
					madebysite: config.http.branding[2]
				})
			} else {
				res.render(
					'error',
					{
						address: req.params.address,
						message: 'This mail could not be found. It either does not exist or has been deleted from our servers!',
						madeby: config.http.branding[1],
						madebysite: config.http.branding[2],
					}
				)
			}
		} catch (error) {
			console.error('error while fetching one email', error)
			next(error)
		}
	}
)

router.get(
	'^/:address/:uid([0-9]+$)/delete',
	sanitizeAddress,
	async (req, res, next) => {
		try {
			const mailProcessingService = req.app.get('mailProcessingService')
			await mailProcessingService.deleteSpecificEmail(req.params.address, req.params.uid)
			res.redirect(`/inbox/${req.params.address}`)
		} catch (error) {
			console.error('error while deleting email', error)
			next(error)
		}
	}
)

module.exports = router
