const config = require('../../application/config-service')
const Helper = require('../../application/helper-service')

/**
 * Template Context Builder
 * Generates common variables for all template renders
 */
class TemplateContext {
    constructor() {
        this.helper = new Helper()
        this.purgeTime = this.helper.purgeTimeElemetBuilder()
            // Cache domains to avoid reprocessing on every request
        this.cachedDomains = this.helper.getDomains()
    }

    /**
     * Get base context that should be available in all templates
     * @param {Object} req - Express request object
     * @returns {Object} Base template context
     */
    getBaseContext(req) {
        const inboxLock = req.app.get('inboxLock')
        const address = req.params && req.params.address
        const userId = req.session && req.session.userId
        const isAuthenticated = !!(req.session && req.session.userId)

        // Calculate lock status for current address
        const isLocked = address && inboxLock ? inboxLock.isLocked(address) : false
        const hasAccess = address && isAuthenticated && userId && inboxLock ?
            (inboxLock.isLockedByUser(address, userId) || req.session.lockedInbox === address) :
            (address && req.session && req.session.lockedInbox === address)

        // Get user's verified forward emails if logged in
        let userForwardEmails = []
        if (isAuthenticated && userId) {
            const userRepository = req.app.get('userRepository')
            if (userRepository) {
                userForwardEmails = userRepository.getForwardEmails(userId)
            }
        }

        return {
            // Config values
            config: config,
            branding: config.http.features.branding || ['48hr.email', 'Service', 'https://example.com'],
            purgeTime: this.purgeTime,
            purgeTimeRaw: config.email.purgeTime,
            expiryTime: config.email.purgeTime.time,
            expiryUnit: config.email.purgeTime.unit,
            refreshInterval: config.imap.refreshIntervalSeconds,
            locktimer: config.user.lockReleaseHours,

            // Feature flags
            authEnabled: config.user.authEnabled,
            statisticsEnabled: config.http.features.statistics,
            smtpEnabled: config.email.features.smtp,
            showInfoSection: config.http.features.infoSection,

            // User session & authentication
            currentUser: req.session && req.session.username ? req.session.username : null,
            isAuthenticated: isAuthenticated,
            userForwardEmails: userForwardEmails,

            // Lock status
            isLocked: isLocked,
            hasAccess: hasAccess,

            // Session messages/errors (auto-clear after reading)
            error: this._getAndClearSession(req, 'lockError'),
            unlockError: this._getAndClearSession(req, 'unlockError'),
            errorMessage: this._getAndClearSession(req, 'errorMessage'),

            // Query parameters
            verificationSent: req.query && req.query.verificationSent === 'true',
            verificationEmail: req.query && req.query.email || '',
            forwardSuccess: req.query && req.query.forwarded === 'true',
            forwardAllSuccess: req.query && req.query.forwardedAll ? parseInt(req.query.forwardedAll) : null,

            // Request info
            redirectTo: req.originalUrl,
            address: address,

            // Common data
            domains: this.cachedDomains,
            example: config.email.examples.account
        }
    }

    /**
     * Helper to get and clear session value
     * @private
     */
    _getAndClearSession(req, key) {
        if (!req.session) return undefined
        const value = req.session[key]
        delete req.session[key]
        return value
    }

    /**
     * Merge base context with page-specific data
     * @param {Object} req - Express request object
     * @param {Object} pageData - Page-specific template data
     * @returns {Object} Complete template context
     */
    build(req, pageData = {}) {
        return {
            ...this.getBaseContext(req),
            ...pageData
        }
    }
}

// Export singleton instance
module.exports = new TemplateContext()
