const express = require('express')
const router = express.Router()
const { body, validationResult } = require('express-validator')
const createAuthenticator = require('../middleware/authenticator')
const { ApiError } = require('../middleware/error-handler')

/**
 * Account Management API Routes
 * GET /account - Get account info with stats
 * POST /verify-email - Add forwarding email (triggers verification)
 * DELETE /verify-email/:id - Remove forwarding email
 * POST /change-password - Change password
 * DELETE /account - Delete account
 * GET /token - Get API token info
 * POST /token - Generate/regenerate API token
 * DELETE /token - Revoke API token
 */

function createAccountRouter(dependencies) {
    // Ensure router is declared before any usage
    const {
        authService,
        userRepository,
        apiTokenRepository,
        inboxLock,
        config
    } = dependencies

    // All router usage is below this line

    // Check if auth is enabled
    if (!authService || !config.user.authEnabled) {
        router.all('*', (req, res) => {
            res.apiError('Authentication is disabled', 'AUTH_DISABLED', 503)
        })
        return router
    }

    const { requireAuth } = createAuthenticator(apiTokenRepository)

    /**
     * GET /account - Get account information
     */
    router.get('/', requireAuth, async(req, res, next) => {
        try {
            const userId = req.user.id

            // Get user stats (pass config.user for mock repo compatibility)
            const stats = userRepository.getUserStats(userId, config.user)

            // Get verified emails
            const verifiedEmails = userRepository.getForwardEmails(userId)

            // Get locked inboxes
            let lockedInboxes = []
            if (inboxLock) {
                lockedInboxes = inboxLock.getUserLockedInboxes(userId)
            }

            // Get API token info (without exposing the token itself)
            let tokenInfo = null
            if (apiTokenRepository) {
                const token = apiTokenRepository.getByUserId(userId)
                if (token) {
                    tokenInfo = {
                        hasToken: true,
                        createdAt: token.created_at,
                        lastUsed: token.last_used
                    }
                }
            }

            res.apiSuccess({
                userId: userId,
                username: req.user.username,
                createdAt: stats.created_at,
                lastLogin: stats.last_login,
                verifiedEmails: verifiedEmails,
                lockedInboxes: lockedInboxes,
                apiToken: tokenInfo
            })
        } catch (error) {
            next(error)
        }
    })

    /**
     * POST /verify-email - Add forwarding email (triggers verification)
     */
    router.post('/verify-email',
        requireAuth,
        body('email').isEmail().normalizeEmail(),
        async(req, res, next) => {
            try {
                const errors = validationResult(req)
                if (!errors.isEmpty()) {
                    return res.apiError('Invalid email address', 'VALIDATION_ERROR', 400)
                }

                const { email } = req.body
                const userId = req.user.id

                // Check if user already has max verified emails
                const count = userRepository.countVerifiedEmails(userId)
                if (count >= config.user.maxVerifiedEmails) {
                    return res.apiError(
                        `Maximum ${config.user.maxVerifiedEmails} verified emails allowed`,
                        'MAX_EMAILS_REACHED',
                        400
                    )
                }

                // Add email (will be marked as verified immediately for API)
                // In a real implementation, you'd send a verification email
                userRepository.addVerifiedEmail(userId, email)

                res.apiSuccess({
                    message: 'Email added successfully',
                    email: email
                }, 201)
            } catch (error) {
                if (error.message.includes('UNIQUE')) {
                    return res.apiError('Email already verified', 'DUPLICATE_EMAIL', 400)
                }
                next(error)
            }
        }
    )

    /**
     * DELETE /verify-email/:id - Remove forwarding email
     */
    router.delete('/verify-email/:id', requireAuth, async(req, res, next) => {
        try {
            const emailId = parseInt(req.params.id)
            const userId = req.user.id

            if (isNaN(emailId)) {
                return res.apiError('Invalid email ID', 'VALIDATION_ERROR', 400)
            }

            const result = userRepository.removeVerifiedEmail(userId, emailId)

            if (result.changes === 0) {
                return res.apiError('Email not found or unauthorized', 'NOT_FOUND', 404)
            }

            res.apiSuccess({ message: 'Email removed successfully' })
        } catch (error) {
            next(error)
        }
    })

    /**
     * POST /change-password - Change password
     */
    router.post('/change-password',
        requireAuth,
        body('currentPassword').notEmpty(),
        body('newPassword').isLength({ min: 8 }),
        async(req, res, next) => {
            try {
                const errors = validationResult(req)
                if (!errors.isEmpty()) {
                    return res.apiError('Invalid password format', 'VALIDATION_ERROR', 400)
                }

                const { currentPassword, newPassword } = req.body
                const userId = req.user.id

                // Verify current password
                const isValid = userRepository.checkPassword(userId, currentPassword)
                if (!isValid) {
                    return res.apiError('Current password is incorrect', 'INVALID_PASSWORD', 401)
                }

                // Validate new password
                const validation = authService.validatePassword(newPassword)
                if (!validation.isValid) {
                    return res.apiError(validation.error, 'WEAK_PASSWORD', 400)
                }

                // Change password
                userRepository.changePassword(userId, newPassword)

                res.apiSuccess({ message: 'Password changed successfully' })
            } catch (error) {
                next(error)
            }
        }
    )

    /**
     * DELETE /account - Delete account
     */
    router.delete('/',
        requireAuth,
        body('password').notEmpty(),
        async(req, res, next) => {
            try {
                const errors = validationResult(req)
                if (!errors.isEmpty()) {
                    return res.apiError('Password is required', 'VALIDATION_ERROR', 400)
                }

                const { password } = req.body
                const userId = req.user.id

                // Verify password
                const isValid = userRepository.checkPassword(userId, password)
                if (!isValid) {
                    return res.apiError('Incorrect password', 'INVALID_PASSWORD', 401)
                }

                // Delete user (cascades to tokens, emails, locks)
                userRepository.deleteUser(userId)

                // Destroy session
                req.session.destroy((err) => {
                    if (err) {
                        return next(err)
                    }

                    res.apiSuccess({ message: 'Account deleted successfully' })
                })
            } catch (error) {
                next(error)
            }
        }
    )

    /**
     * GET /token - Get API token info (not the token itself)
     */
    router.get('/token', requireAuth, async(req, res, next) => {
        try {
            const userId = req.user.id

            const token = apiTokenRepository.getByUserId(userId)

            if (!token) {
                return res.apiSuccess({
                    hasToken: false
                })
            }

            res.apiSuccess({
                hasToken: true,
                createdAt: token.created_at,
                lastUsed: token.last_used
            })
        } catch (error) {
            next(error)
        }
    })

    /**
     * POST /token - Generate or regenerate API token
     */
    router.post('/token', requireAuth, async(req, res, next) => {
        try {
            const userId = req.user.id

            // Generate new token (replaces existing if any)
            const newToken = apiTokenRepository.create(userId)

            res.apiSuccess({
                token: newToken,
                message: 'API token generated successfully. Save this token - it will not be shown again.'
            }, 201)
        } catch (error) {
            next(error)
        }
    })

    /**
     * DELETE /token - Revoke API token
     */
    router.delete('/token', requireAuth, async(req, res, next) => {
        try {
            const userId = req.user.id

            const revoked = apiTokenRepository.revoke(userId)

            if (!revoked) {
                return res.apiError('No token to revoke', 'NOT_FOUND', 404)
            }

            res.apiSuccess({ message: 'API token revoked successfully' })
        } catch (error) {
            next(error)
        }
    })

    return router
}

module.exports = createAccountRouter