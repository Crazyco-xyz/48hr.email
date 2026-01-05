const express = require('express')
const createAuthenticator = require('../middleware/authenticator')

/**
 * Inbox & Mail Retrieval API Routes
 * GET /:address - List emails in inbox
 * GET /:address/:uid - Get full email by UID
 * GET /:address/:uid/raw - Get raw email source
 * GET /:address/:uid/attachment/:checksum - Download attachment
 */
function createInboxRouter(dependencies) {
    const router = express.Router()
    const { mailProcessingService, apiTokenRepository } = dependencies

    const { optionalAuth } = createAuthenticator(apiTokenRepository)

    /**
     * GET /:address - List mail summaries for an inbox
     */
    router.get('/:address', optionalAuth, async(req, res, next) => {
        try {
            const address = req.params.address.toLowerCase()

            // Get mail summaries
            const mails = mailProcessingService.getMailSummaries(address)

            res.apiList(mails)
        } catch (error) {
            next(error)
        }
    })

    /**
     * GET /:address/:uid - Get full email by UID
     */
    router.get('/:address/:uid', optionalAuth, async(req, res, next) => {
        try {
            const address = req.params.address.toLowerCase()
            const uid = parseInt(req.params.uid)

            if (isNaN(uid)) {
                return res.apiError('Invalid UID', 'VALIDATION_ERROR', 400)
            }

            // Get full email
            const mail = await mailProcessingService.getOneFullMail(address, uid, false)

            if (!mail) {
                return res.apiError('Email not found', 'NOT_FOUND', 404)
            }

            // Format response
            const response = {
                uid: uid,
                to: mail.to,
                from: mail.from,
                date: mail.date,
                subject: mail.subject,
                text: mail.text,
                html: mail.html,
                attachments: mail.attachments ? mail.attachments.map(att => ({
                    filename: att.filename,
                    contentType: att.contentType,
                    size: att.content ? att.content.length : 0,
                    checksum: att.checksum
                })) : []
            }

            res.apiSuccess(response)
        } catch (error) {
            next(error)
        }
    })

    /**
     * GET /:address/:uid/raw - Get raw email source
     */
    router.get('/:address/:uid/raw', optionalAuth, async(req, res, next) => {
        try {
            const address = req.params.address.toLowerCase()
            const uid = parseInt(req.params.uid)

            if (isNaN(uid)) {
                return res.apiError('Invalid UID', 'VALIDATION_ERROR', 400)
            }

            // Get raw email
            const rawMail = await mailProcessingService.getOneFullMail(address, uid, true)

            if (!rawMail) {
                return res.apiError('Email not found', 'NOT_FOUND', 404)
            }

            // Return as plain text
            res.setHeader('Content-Type', 'text/plain')
            res.send(rawMail)
        } catch (error) {
            next(error)
        }
    })

    /**
     * GET /:address/:uid/attachment/:checksum - Download attachment
     */
    router.get('/:address/:uid/attachment/:checksum', optionalAuth, async(req, res, next) => {
        try {
            const address = req.params.address.toLowerCase()
            const uid = parseInt(req.params.uid)
            const checksum = req.params.checksum

            if (isNaN(uid)) {
                return res.apiError('Invalid UID', 'VALIDATION_ERROR', 400)
            }

            // Get full email to access attachments
            const mail = await mailProcessingService.getOneFullMail(address, uid, false)

            if (!mail || !mail.attachments) {
                return res.apiError('Email or attachment not found', 'NOT_FOUND', 404)
            }

            // Find attachment by checksum
            const attachment = mail.attachments.find(att => att.checksum === checksum)

            if (!attachment) {
                return res.apiError('Attachment not found', 'NOT_FOUND', 404)
            }

            // Send attachment
            res.setHeader('Content-Type', attachment.contentType || 'application/octet-stream')
            res.setHeader('Content-Disposition', `attachment; filename="${attachment.filename}"`)
            res.send(attachment.content)
        } catch (error) {
            next(error)
        }
    })

    return router
}

module.exports = createInboxRouter
