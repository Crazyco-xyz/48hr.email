const express = require('express')
const router = express.Router()
const { body, validationResult } = require('express-validator')
const createAuthenticator = require('../middleware/authenticator')

/**
 * Inbox Lock Management API Routes
 * GET / - List user's locked inboxes
 * POST / - Lock an inbox
 * DELETE /:address - Unlock/release inbox
 * GET /:address/status - Check if inbox is locked
 */
function createLocksRouter(dependencies) {
    const { inboxLock, userRepository, apiTokenRepository, config } = dependencies

    if (!inboxLock || !config.user.authEnabled) {
        router.all('*', (req, res) => {
            res.apiError('Inbox locking is disabled', 'FEATURE_DISABLED', 503)
        })
        return router
    }

    const { requireAuth, optionalAuth } = createAuthenticator(userRepository)

    /**
     * GET / - List user's locked inboxes
     */
    router.get('/', requireAuth, async(req, res, next) => {
        try {
            const userId = req.user.id;
            const locks = inboxLock.getUserLockedInboxes(userId);
            const templateContext = { userId, config: { maxLockedInboxes: config.user.maxLockedInboxes } };
            res.apiList(locks, null, 200, templateContext);
        } catch (error) {
            next(error);
        }
    })

    /**
     * POST / - Lock an inbox
     */
    router.post('/',
        requireAuth,
        body('address').isEmail().normalizeEmail(),
        body('password').optional().isString(),
        async(req, res, next) => {
            try {
                const errors = validationResult(req)
                if (!errors.isEmpty()) {
                    return res.apiError('Invalid email address', 'VALIDATION_ERROR', 400, { userId: req.user.id })
                }

                const { address } = req.body
                const userId = req.user.id

                // Check if user can lock more inboxes
                if (!inboxLock.canLockMore(userId)) {
                    return res.apiError(
                        `Maximum ${config.user.maxLockedInboxes} locked inboxes allowed`,
                        'MAX_LOCKS_REACHED',
                        400, { userId, config: { maxLockedInboxes: config.user.maxLockedInboxes } }
                    )
                }

                // Check if inbox is already locked
                if (inboxLock.isLocked(address)) {
                    const isOwner = inboxLock.isOwner(address, userId)
                    if (isOwner) {
                        return res.apiError('You already own this lock', 'ALREADY_LOCKED', 400, { userId })
                    }
                    return res.apiError('Inbox is locked by another user', 'LOCKED_BY_OTHER', 403)
                    return res.apiError('Inbox is locked by another user', 'LOCKED_BY_OTHER', 403, { userId })
                }

                // Lock inbox
                inboxLock.lock(userId, address, '')

                res.apiSuccess({
                    message: 'Inbox locked successfully',
                    address: address
                }, 201, { userId, address })
            } catch (error) {
                next(error)
            }
        }
    )

    /**
     * DELETE /:address - Unlock/release inbox
     */
    router.delete('/:address', requireAuth, async(req, res, next) => {
        try {
            const address = req.params.address.toLowerCase()
            const userId = req.user.id

            // Check if user owns this lock
            if (!inboxLock.isOwner(address, userId)) {
                return res.apiError('Lock not found or unauthorized', 'NOT_FOUND', 404, { userId, address })
            }

            // Release lock
            inboxLock.release(userId, address)

            res.apiSuccess({ message: 'Inbox unlocked successfully' }, 200, { userId, address })
        } catch (error) {
            next(error)
        }
    })

    /**
     * GET /:address/status - Check if inbox is locked
     */
    router.get('/:address/status', optionalAuth, async(req, res, next) => {
        try {
            const address = req.params.address.toLowerCase();
            const isLocked = inboxLock.isLocked(address);
            const templateContext = { address, isLocked };
            const response = {
                address: address,
                locked: isLocked
            };
            // If user is authenticated, check if they own the lock
            if (req.user && isLocked) {
                response.ownedByYou = inboxLock.isOwner(address, req.user.id);
                templateContext.ownedByYou = response.ownedByYou;
            }
            res.apiSuccess(response, 200, templateContext);
        } catch (error) {
            next(error)
        }
    })

    return router
}

module.exports = createLocksRouter