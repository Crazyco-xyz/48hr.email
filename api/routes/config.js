const express = require('express')
const router = express.Router()

/**
 * Configuration API Routes (Public)
 * GET /domains - Get allowed email domains
 * GET /limits - Get rate limits and constraints
 * GET /features - Get enabled features
 */
function createConfigRouter(dependencies) {
    // Ensure router is declared before any usage
    const router = express.Router()
    const { config } = dependencies
    // API enabled toggle
    router.use((req, res, next) => {
        if (!config.apiEnabled) {
            return res.apiError('API is disabled', 'API_DISABLED', 503);
        }
        next();
    });

    /**
     * GET /domains - Get allowed email domains
     */
    router.get('/domains', (req, res) => {
        res.apiSuccess({
            domains: config.email.domains
        })
    })

    /**
     * GET /limits - Get rate limits and constraints
     */
    router.get('/limits', (req, res) => {
        res.apiSuccess({
            api: {
                rateLimit: {
                    requests: 100,
                    window: '1 minute'
                }
            },
            email: {
                purgeTime: config.email.purgeTime,
                purgeUnit: config.email.purgeUnit,
                maxForwardedPerRequest: 25
            },
            user: {
                maxVerifiedEmails: config.user.maxVerifiedEmails || 5,
                maxLockedInboxes: config.user.maxLockedInboxes || 5,
                lockReleaseHours: config.user.lockReleaseHours || 168
            }
        })
    })

    /**
     * GET /features - Get enabled features
     */
    router.get('/features', (req, res) => {
        res.apiSuccess({
            authentication: config.user.authEnabled,
            forwarding: config.smtp.enabled,
            statistics: config.http.statisticsEnabled,
            inboxLocking: config.user.authEnabled
        })
    })

    return router
}

module.exports = createConfigRouter