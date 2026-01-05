const express = require('express')
const { body, validationResult } = require('express-validator')
const createAuthenticator = require('../middleware/authenticator')
const { ApiError } = require('../middleware/error-handler')

/**
 * Mail Operations API Routes
 * DELETE /inbox/:address/:uid - Delete single email
 * DELETE /inbox/:address - Delete all emails in inbox
 * POST /forward - Forward single email
 * POST /forward-all - Forward all emails in inbox
 */
function createMailRouter(dependencies) {
    const router = express.Router()
    const {
        mailProcessingService,
        apiTokenRepository,
        userRepository,
        config
    } = dependencies

    const { requireAuth, optionalAuth } = createAuthenticator(apiTokenRepository)

    /**
     * DELETE /inbox/:address/:uid - Delete single email
     */
    router.delete('/inbox/:address/:uid', optionalAuth, async(req, res, next) => {
        try {
            const address = req.params.address.toLowerCase()
            const uid = parseInt(req.params.uid)

            if (isNaN(uid)) {
                return res.apiError('Invalid UID', 'VALIDATION_ERROR', 400)
            }

            // Check if email exists
            const mails = mailProcessingService.getMailSummaries(address)
            const mailExists = mails.some(m => m.uid === uid)

            if (!mailExists) {
                return res.apiError('Email not found', 'NOT_FOUND', 404)
            }

            // Delete email
            await mailProcessingService.deleteSpecificEmail(address, uid)

            res.apiSuccess({ message: 'Email deleted successfully' })
        } catch (error) {
            next(error)
        }
    })

    /**
     * DELETE /inbox/:address - Delete all emails in inbox
     */
    router.delete('/inbox/:address', optionalAuth, async(req, res, next) => {
        try {
            const address = req.params.address.toLowerCase()
            const { confirm } = req.query

            if (confirm !== 'true') {
                return res.apiError(
                    'Confirmation required. Add ?confirm=true to delete all emails',
                    'CONFIRMATION_REQUIRED',
                    400
                )
            }

            // Get all mail UIDs
            const mails = mailProcessingService.getMailSummaries(address)

            if (mails.length === 0) {
                return res.apiSuccess({
                    message: 'No emails to delete',
                    deleted: 0
                })
            }

            // Delete all emails
            for (const mail of mails) {
                await mailProcessingService.deleteSpecificEmail(address, mail.uid)
            }

            res.apiSuccess({
                message: `Deleted ${mails.length} email(s)`,
                deleted: mails.length
            })
        } catch (error) {
            next(error)
        }
    })

    /**
     * POST /forward - Forward single email
     */
    router.post('/forward',
        requireAuth,
        body('sourceAddress').isEmail().normalizeEmail(),
        body('uid').isInt({ min: 1 }),
        body('destinationEmail').isEmail().normalizeEmail(),
        async(req, res, next) => {
            try {
                const errors = validationResult(req)
                if (!errors.isEmpty()) {
                    return res.apiError('Invalid input parameters', 'VALIDATION_ERROR', 400)
                }

                if (!config.smtp.enabled) {
                    return res.apiError('Email forwarding is disabled', 'FEATURE_DISABLED', 503)
                }

                const { sourceAddress, uid, destinationEmail } = req.body
                const userId = req.user.id

                // Check if destination email is verified
                const forwardEmails = userRepository.getForwardEmails(userId)
                const isVerified = forwardEmails.some(e => e.email.toLowerCase() === destinationEmail.toLowerCase())

                if (!isVerified) {
                    return res.apiError(
                        'Destination email must be verified. Add it in your account settings first.',
                        'EMAIL_NOT_VERIFIED',
                        400
                    )
                }

                // Forward email
                const result = await mailProcessingService.forwardMail(
                    sourceAddress.toLowerCase(),
                    parseInt(uid),
                    destinationEmail.toLowerCase()
                )

                if (!result.success) {
                    return res.apiError(result.error || 'Forward failed', 'FORWARD_FAILED', 400)
                }

                res.apiSuccess({
                    message: 'Email forwarded successfully',
                    destination: destinationEmail
                })
            } catch (error) {
                next(error)
            }
        }
    )

    /**
     * POST /forward-all - Forward all emails in inbox (max 25)
     */
    router.post('/forward-all',
        requireAuth,
        body('sourceAddress').isEmail().normalizeEmail(),
        body('destinationEmail').isEmail().normalizeEmail(),
        async(req, res, next) => {
            try {
                const errors = validationResult(req)
                if (!errors.isEmpty()) {
                    return res.apiError('Invalid input parameters', 'VALIDATION_ERROR', 400)
                }

                if (!config.smtp.enabled) {
                    return res.apiError('Email forwarding is disabled', 'FEATURE_DISABLED', 503)
                }

                const { sourceAddress, destinationEmail } = req.body
                const userId = req.user.id

                // Check if destination email is verified
                const forwardEmails = userRepository.getForwardEmails(userId)
                const isVerified = forwardEmails.some(e => e.email.toLowerCase() === destinationEmail.toLowerCase())

                if (!isVerified) {
                    return res.apiError(
                        'Destination email must be verified. Add it in your account settings first.',
                        'EMAIL_NOT_VERIFIED',
                        400
                    )
                }

                // Get all mails (max 25)
                const mails = mailProcessingService.getMailSummaries(sourceAddress.toLowerCase())
                const mailsToForward = mails.slice(0, 25)

                if (mailsToForward.length === 0) {
                    return res.apiSuccess({
                        message: 'No emails to forward',
                        forwarded: 0
                    })
                }

                // Forward all emails
                let successCount = 0
                const errors = []

                for (const mail of mailsToForward) {
                    try {
                        const result = await mailProcessingService.forwardMail(
                            sourceAddress.toLowerCase(),
                            mail.uid,
                            destinationEmail.toLowerCase()
                        )
                        if (result.success) {
                            successCount++
                        } else {
                            errors.push({ uid: mail.uid, error: result.error })
                        }
                    } catch (error) {
                        errors.push({ uid: mail.uid, error: error.message })
                    }
                }

                res.apiSuccess({
                    message: `Forwarded ${successCount} of ${mailsToForward.length} email(s)`,
                    forwarded: successCount,
                    total: mailsToForward.length,
                    errors: errors.length > 0 ? errors : undefined
                })
            } catch (error) {
                next(error)
            }
        }
    )

    return router
}

module.exports = createMailRouter
