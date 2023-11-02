const express = require('express')

const router = new express.Router()
const {sanitizeParam} = require('express-validator/filter')
const config = require('../../../application/config')
const sanitizeAddress = sanitizeParam('address').customSanitizer(
	(value, {req}) => {
		return req.params.address
			.replace(/[^A-Za-z0-9_.+@-]/g, '') // Remove special characters
			.toLowerCase()
	}
)

router.get('^/:address([^@/]+@[^@/]+)', sanitizeAddress, (req, res, _next) => {
	const mailProcessingService = req.app.get('mailProcessingService')
	res.render('inbox', {
		title: `${config.branding[0]} | ` + req.params.address,
		address: req.params.address,
		mailSummaries: mailProcessingService.getMailSummaries(req.params.address),
		madeby: config.branding[1],
		madebysite: config.branding[2]
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
			if (mail) {
				// Emails are immutable, cache if found
				res.set('Cache-Control', 'private, max-age=600')
				res.render('mail', {
					title: req.params.address,
					address: req.params.address,
					mail,
					uid: req.params.uid,
					madeby: config.branding[1],
					madebysite: config.branding[2]
				})
			} else {
				next({message: 'email not found', status: 404})
			}
		} catch (error) {
			console.error('error while fetching one email', error)
			next(error)
		}
	}
)

router.get(
	'^/:address/delete/:uid([0-9]+$)',
	sanitizeAddress,
	async (req, res, next) => {
		try {
			const mailProcessingService = req.app.get('mailProcessingService')
			await mailProcessingService.deleteSpecificEmail(req.params.uid)
			res.redirect(`/${req.params.address}`)
		} catch (error) {
			console.error('error while deleting email', error)
			next(error)
		}
	}
)

module.exports = router
