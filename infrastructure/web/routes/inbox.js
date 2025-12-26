const express = require('express')
const router = new express.Router()
const { param } = require('express-validator')
const debug = require('debug')('48hr-email:routes')

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

router.get('^/:address([^@/]+@[^@/]+)', sanitizeAddress, async(req, res, next) => {
    try {
        const mailProcessingService = req.app.get('mailProcessingService')
        if (!mailProcessingService) {
            throw new Error('Mail processing service not available')
        }
        debug(`Inbox request for ${req.params.address}`)
        const count = await mailProcessingService.getCount()
        const largestUid = await req.app.locals.imapService.getLargestUid()
        const totalcount = helper.countElementBuilder(count, largestUid)
        debug(`Rendering inbox with ${count} total mails`)
        res.render('inbox', {
            title: `${config.http.branding[0]} | ` + req.params.address,
            purgeTime: purgeTime,
            address: req.params.address,
            count: count,
            totalcount: totalcount,
            mailSummaries: mailProcessingService.getMailSummaries(req.params.address),
            branding: config.http.branding,
        })
    } catch (error) {
        debug(`Error loading inbox for ${req.params.address}:`, error.message)
        console.error('Error while loading inbox', error)
        next(error)
    }
})

router.get(
    '^/:address/:uid([0-9]+)',
    sanitizeAddress,
    async(req, res, next) => {
        try {
            const mailProcessingService = req.app.get('mailProcessingService')
            debug(`Viewing email ${req.params.uid} for ${req.params.address}`)
            const count = await mailProcessingService.getCount()
            const largestUid = await req.app.locals.imapService.getLargestUid()
            const totalcount = helper.countElementBuilder(count, largestUid)
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
                debug(`Rendering email view for UID ${req.params.uid}`)
                res.render('mail', {
                    title: mail.subject + " | " + req.params.address,
                    purgeTime: purgeTime,
                    address: req.params.address,
                    count: count,
                    totalcount: totalcount,
                    mail,
                    uid: req.params.uid,
                    branding: config.http.branding,
                })
            } else {
                debug(`Email ${req.params.uid} not found for ${req.params.address}`)
                req.session.errorMessage = 'This mail could not be found. It either does not exist or has been deleted from our servers!'
                res.redirect(`/error/${req.params.address}/404`)
            }
        } catch (error) {
            debug(`Error fetching email ${req.params.uid} for ${req.params.address}:`, error.message)
            console.error('Error while fetching email', error)
            next(error)
        }
    }
)

// Catch-all for invalid UIDs (non-numeric)
router.get(
    '^/:address/delete-all',
    sanitizeAddress,
    async(req, res, next) => {
        try {
            const mailProcessingService = req.app.get('mailProcessingService')
            debug(`Deleting all emails for ${req.params.address}`)
            const mailSummaries = await mailProcessingService.getMailSummaries(req.params.address)
            for (mail in mailSummaries) {
                await mailProcessingService.deleteSpecificEmail(req.params.address, mailSummaries[mail].uid)
            }
            debug(`Deleted all emails for ${req.params.address}`)
            res.redirect(`/inbox/${req.params.address}`)
        } catch (error) {
            debug(`Error deleting all emails for ${req.params.address}:`, error.message)
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
            debug(`Deleting email ${req.params.uid} for ${req.params.address}`)
            await mailProcessingService.deleteSpecificEmail(req.params.address, req.params.uid)
            debug(`Successfully deleted email ${req.params.uid} for ${req.params.address}`)
            res.redirect(`/inbox/${req.params.address}`)
        } catch (error) {
            debug(`Error deleting email ${req.params.uid} for ${req.params.address}:`, error.message)
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
            debug(`Fetching attachment ${req.params.checksum} for email ${req.params.uid} (${req.params.address})`)
            const uid = parseInt(req.params.uid, 10)
            const count = await mailProcessingService.getCount()

            // Validate UID is a valid integer
            if (isNaN(uid) || uid <= 0) {
                debug(`Invalid UID provided: ${req.params.uid}`)
                req.session.errorMessage = 'Invalid/Malformed UID provided.'
                return res.redirect(`/error/${req.params.address}/400`)
            }

            const mail = await mailProcessingService.getOneFullMail(
                req.params.address,
                uid
            )

            if (!mail || !mail.attachments) {
                debug(`Email ${uid} or attachments not found for ${req.params.address}`)
                req.session.errorMessage = 'This email could not be found. It either does not exist or has been deleted from our servers!'
                return res.redirect(`/error/${req.params.address}/404`)
            }

            var index = mail.attachments.findIndex(attachment => attachment.checksum === req.params.checksum);
            const attachment = mail.attachments[index];

            if (attachment) {
                try {
                    debug(`Serving attachment: ${attachment.filename}`)
                    res.set('Content-Disposition', `attachment; filename=${attachment.filename}`);
                    res.set('Content-Type', attachment.contentType);
                    res.send(attachment.content);
                    return;
                } catch (error) {
                    debug(`Error serving attachment: ${error.message}`)
                    console.error('Error while fetching attachment', error);
                    next(error);
                    return;
                }
            } else {
                debug(`Attachment ${req.params.checksum} not found in email ${uid}`)
                req.session.errorMessage = 'This attachment could not be found. It either does not exist or has been deleted from our servers!'
                return res.redirect(`/error/${req.params.address}/404`)
            }
        } catch (error) {
            debug(`Error fetching attachment: ${error.message}`)
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
            debug(`Fetching raw email ${req.params.uid} for ${req.params.address}`)
            const uid = parseInt(req.params.uid, 10)
            const count = await mailProcessingService.getCount()
            const largestUid = await req.app.locals.imapService.getLargestUid()
            const totalcount = helper.countElementBuilder(count, largestUid)

            // Validate UID is a valid integer
            if (isNaN(uid) || uid <= 0) {
                debug(`Invalid UID provided for raw view: ${req.params.uid}`)
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
                debug(`Rendering raw email view for UID ${req.params.uid}`)
                res.render('raw', {
                    title: req.params.uid + " | raw | " + req.params.address,
                    mail,
                    totalcount: totalcount
                })
            } else {
                debug(`Raw email ${uid} not found for ${req.params.address}`)
                req.session.errorMessage = 'This mail could not be found. It either does not exist or has been deleted from our servers!'
                res.redirect(`/error/${req.params.address}/404`)
            }
        } catch (error) {
            debug(`Error fetching raw email ${req.params.uid}: ${error.message}`)
            console.error('Error while fetching raw email', error)
            next(error)
        }
    }
)

// Final catch-all for invalid UIDs (non-numeric or unmatched patterns)
router.get(
    '^/:address/:uid',
    sanitizeAddress,
    async(req, res) => {
        req.session.errorMessage = 'Invalid/Malformed UID provided.'
        res.redirect(`/error/${req.params.address}/400`)
    }
)


module.exports = router