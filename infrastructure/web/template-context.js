const config = require('../../application/config')
const Helper = require('../../application/helper')

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
        return {
            // Config values
            config: config,
            branding: config.http.features.branding || ['48hr.email', 'Service', 'https://example.com'],
            purgeTime: this.purgeTime,
            purgeTimeRaw: config.email.purgeTime,

            // Feature flags
            authEnabled: config.user.authEnabled,
            statisticsEnabled: config.http.features.statistics,
            smtpEnabled: config.email.features.smtp,
            showInfoSection: config.http.features.infoSection,

            // User session
            currentUser: req.session && req.session.username ? req.session.username : null,

            // Common data
            domains: this.cachedDomains,
            example: config.email.examples.account
        }
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
