const debug = require('debug')('48hr-email:auth-middleware')

/**
 * Authentication middleware functions
 * Handle session-based authentication and authorization
 */

/**
 * Require authenticated user - redirect to login if not authenticated
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Function} next - Express next function
 */
function requireAuth(req, res, next) {
    if (req.session && req.session.userId && req.session.isAuthenticated) {
        // User is authenticated
        debug(`Authenticated request from user ${req.session.username} (ID: ${req.session.userId})`)

        // Populate req.user for convenience
        req.user = {
            id: req.session.userId,
            username: req.session.username,
            created_at: req.session.createdAt
        }

        return next()
    }

    // User is not authenticated
    debug('Unauthenticated request, redirecting to auth page')

    // Store the original URL to redirect back after login
    req.session.redirectAfterLogin = req.originalUrl

    // Redirect to auth page
    return res.redirect('/auth')
}

/**
 * Optional authentication - populate req.user if authenticated, but don't redirect
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Function} next - Express next function
 */
function optionalAuth(req, res, next) {
    if (req.session && req.session.userId && req.session.isAuthenticated) {
        // User is authenticated, populate req.user
        debug(`Optional auth: User ${req.session.username} (ID: ${req.session.userId}) is authenticated`)

        req.user = {
            id: req.session.userId,
            username: req.session.username,
            created_at: req.session.createdAt
        }
    } else {
        // User is not authenticated, set req.user to null
        req.user = null
        debug('Optional auth: User not authenticated')
    }

    next()
}

/**
 * Check if user owns a specific locked inbox
 * Used to verify user can access/modify a locked inbox
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Function} next - Express next function
 */
function checkUserOwnsInbox(req, res, next) {
    if (!req.user) {
        debug('Check inbox ownership: User not authenticated')
        return res.status(401).json({ error: 'Authentication required' })
    }

    const inboxAddress = req.params.address
    if (!inboxAddress) {
        debug('Check inbox ownership: No inbox address provided')
        return res.status(400).json({ error: 'Inbox address required' })
    }

    // Get user repository from app
    const userRepository = req.app.get('userRepository')
    if (!userRepository) {
        debug('Check inbox ownership: User repository not available')
        return res.status(500).json({ error: 'Service not available' })
    }

    try {
        // Check if inbox is in user's locked inboxes
        // This will be implemented when we migrate inbox-lock.js
        // For now, we'll trust the session
        debug(`Check inbox ownership: User ${req.user.username} accessing inbox ${inboxAddress}`)
        next()
    } catch (error) {
        debug(`Check inbox ownership error: ${error.message}`)
        return res.status(500).json({ error: 'Failed to verify inbox ownership' })
    }
}

/**
 * Middleware to prevent access for authenticated users (e.g., login/register pages)
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Function} next - Express next function
 */
function redirectIfAuthenticated(req, res, next) {
    if (req.session && req.session.userId && req.session.isAuthenticated) {
        debug(`User ${req.session.username} already authenticated, redirecting to home`)
        return res.redirect('/')
    }

    next()
}

module.exports = {
    requireAuth,
    optionalAuth,
    checkUserOwnsInbox,
    redirectIfAuthenticated
}
