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
			if (mail) {
				// Emails are immutable, cache if found
				res.set('Cache-Control', 'private, max-age=600')
				res.render('mail', {
					title: mail.subject + " | " + req.params.address,
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
	'^/:address/delete-all',
	sanitizeAddress,
	async (req, res, next) => {
		try {
			const mailProcessingService = req.app.get('mailProcessingService')
			const mailSummaries = await mailProcessingService.getMailSummaries(req.params.address)
			for (mail in mailSummaries) {
				await mailProcessingService.deleteSpecificEmail(req.params.address, mailSummaries[mail].uid)
			}
			res.redirect(`/inbox/${req.params.address}`)
		} catch (error) {
			console.error('error while deleting email', error)
			next(error)
		}
	}
)


router.get(
	'^/:address/:uid/delete',
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

router.get(
	'^/:address/:uid/:checksum([a-f0-9]+$)',
	sanitizeAddress,
	async (req, res, next) => {
		try {
			const mailProcessingService = req.app.get('mailProcessingService')
			const mail = await mailProcessingService.getOneFullMail(
				req.params.address,
				req.params.uid
			)
			var index = mail.attachments.findIndex(attachment => attachment.checksum === req.params.checksum);
			const attachment = mail.attachments[index];
			if (attachment) {
				try {
					res.set('Content-Disposition', `attachment; filename=${attachment.filename}`);
					res.set('Content-Type', attachment.contentType);
					res.send(attachment.content);
					return;
				} catch (error) {
					console.error('error while fetching attachment', error);
					next(error);
				}
			} else {
				res.render(
					'error',
					{
						address: req.params.address,
						message: 'This attachment could not be found. It either does not exist or has been deleted from our servers!',
						madeby: config.http.branding[1],
						madebysite: config.http.branding[2],
					}
				)
			}
			res.redirect(`/inbox/${req.params.address}`)
		} catch (error) {
			console.error('error while deleting email', error)
			next(error)
		}
	}
)



router.get(
	'^/:address/:uid/raw',
	sanitizeAddress,
	async (req, res, next) => {
		try {
			const mailProcessingService = req.app.get('mailProcessingService')
			mail = await mailProcessingService.getOneFullMail(
				req.params.address,
				req.params.uid,
				true
			)
			mail = mail.replace(/(?:\r\n|\r|\n)/g, '<br>')
			if (mail) {
				// Emails are immutable, cache if found
				res.set('Cache-Control', 'private, max-age=600')
				res.render('raw', {
					title: req.params.uid + " | raw | " + req.params.address,
					mail
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


module.exports = router
