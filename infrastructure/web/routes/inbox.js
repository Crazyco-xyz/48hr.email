const express = require('express')
const router = new express.Router()
const { param } = require('express-validator')

const config = require('../../../application/config')
const Helper = require('../../../application/helper')
const helper = new(Helper)

const purgeTime = helper.purgeTimeElemetBuilder()

const sanitizeAddress = param('address').customSanitizer(
    (value, { req }) => {
        return req.params.address
            .replace(/[^A-Za-z0-9_.+@-]/g, '') // Remove special characters
            .toLowerCase()
    }
)

router.get('^/:address([^@/]+@[^@/]+)', sanitizeAddress, async(req, res, _next) => {
    const mailProcessingService = req.app.get('mailProcessingService')
    const count = await mailProcessingService.getCount()
    res.render('inbox', {
        title: `${config.http.branding[0]} | ` + req.params.address,
        purgeTime: purgeTime,
        address: req.params.address,
        count: count,
        mailSummaries: mailProcessingService.getMailSummaries(req.params.address),
        branding: config.http.branding,
    })
})

router.get(
    '^/:address/:uid([0-9]+)',
    sanitizeAddress,
    async(req, res, next) => {
        try {
            const mailProcessingService = req.app.get('mailProcessingService')
            const count = await mailProcessingService.getCount()
            const mail = await mailProcessingService.getOneFullMail(
                req.params.address,
                req.params.uid
            )
            if (mail) {
                // Set a default subject if none is present
                if (!mail.subject) {
                    mail.subject = 'No Subject'
                }

                // Emails are immutable, cache if found
                res.set('Cache-Control', 'private, max-age=600')
                res.render('mail', {
                    title: mail.subject + " | " + req.params.address,
                    purgeTime: purgeTime,
                    address: req.params.address,
                    count: count,
                    mail,
                    uid: req.params.uid,
                    branding: config.http.branding,
                })
            } else {
                req.session.errorMessage = 'This mail could not be found. It either does not exist or has been deleted from our servers!'
                res.redirect(`/error/${req.params.address}/404`)
            }
        } catch (error) {
            console.error('Error while fetching email', error)
            next(error)
        }
    }
)

// Catch-all for invalid UIDs (non-numeric)
router.get(
    '^/:address/:uid',
    sanitizeAddress,
    async(req, res) => {
        req.session.errorMessage = 'Invalid/Malformed UID provided.'
        res.redirect(`/error/${req.params.address}/400`)
    }
)

router.get(
    '^/:address/delete-all',
    sanitizeAddress,
    async(req, res, next) => {
        try {
            const mailProcessingService = req.app.get('mailProcessingService')
            const mailSummaries = await mailProcessingService.getMailSummaries(req.params.address)
            for (mail in mailSummaries) {
                await mailProcessingService.deleteSpecificEmail(req.params.address, mailSummaries[mail].uid)
            }
            res.redirect(`/inbox/${req.params.address}`)
        } catch (error) {
            console.error('Error while deleting email', error)
            next(error)
        }
    }
)


router.get(
    '^/:address/:uid/delete',
    sanitizeAddress,
    async(req, res, next) => {
        try {
            const mailProcessingService = req.app.get('mailProcessingService')
            await mailProcessingService.deleteSpecificEmail(req.params.address, req.params.uid)
            res.redirect(`/inbox/${req.params.address}`)
        } catch (error) {
            console.error('Error while deleting email', error)
            next(error)
        }
    }
)

router.get(
    '^/:address/:uid/:checksum([a-f0-9]+)',
    sanitizeAddress,
    async(req, res, next) => {
        try {
            const mailProcessingService = req.app.get('mailProcessingService')
            const uid = parseInt(req.params.uid, 10)
            const count = await mailProcessingService.getCount()

            // Validate UID is a valid integer
            if (isNaN(uid) || uid <= 0) {
                req.session.errorMessage = 'Invalid/Malformed UID provided.'
                return res.redirect(`/error/${req.params.address}/400`)
            }

            const mail = await mailProcessingService.getOneFullMail(
                req.params.address,
                uid
            )

            if (!mail || !mail.attachments) {
                req.session.errorMessage = 'This email could not be found. It either does not exist or has been deleted from our servers!'
                return res.redirect(`/error/${req.params.address}/404`)
            }

            var index = mail.attachments.findIndex(attachment => attachment.checksum === req.params.checksum);
            const attachment = mail.attachments[index];

            if (attachment) {
                try {
                    res.set('Content-Disposition', `attachment; filename=${attachment.filename}`);
                    res.set('Content-Type', attachment.contentType);
                    res.send(attachment.content);
                    return;
                } catch (error) {
                    console.error('Error while fetching attachment', error);
                    next(error);
                    return;
                }
            } else {
                req.session.errorMessage = 'This attachment could not be found. It either does not exist or has been deleted from our servers!'
                return res.redirect(`/error/${req.params.address}/404`)
            }
        } catch (error) {
            console.error('Error while fetching attachment', error)
            next(error)
        }
    }
)



router.get(
    '^/:address/:uid/raw',
    sanitizeAddress,
    async(req, res, next) => {
        try {
            const mailProcessingService = req.app.get('mailProcessingService')
            const uid = parseInt(req.params.uid, 10)
            const count = await mailProcessingService.getCount()

            // Validate UID is a valid integer
            if (isNaN(uid) || uid <= 0) {
                req.session.errorMessage = 'Invalid/Malformed UID provided.'
                return res.redirect(`/error/${req.params.address}/400`)
            }

            mail = await mailProcessingService.getOneFullMail(
                req.params.address,
                uid,
                true
            )
            if (mail) {
                mail = mail.replace(/(?:\r\n|\r|\n)/g, '<br>')
                    // Emails are immutable, cache if found
                res.set('Cache-Control', 'private, max-age=600')
                res.render('raw', {
                    title: req.params.uid + " | raw | " + req.params.address,
                    mail
                })
            } else {
                req.session.errorMessage = 'This mail could not be found. It either does not exist or has been deleted from our servers!'
                res.redirect(`/error/${req.params.address}/404`)
            }
        } catch (error) {
            console.error('Error while fetching raw email', error)
            next(error)
        }
    }
)


module.exports = router
