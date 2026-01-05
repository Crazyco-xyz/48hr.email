const express = require('express')
const cors = require('cors')
const responseFormatter = require('./middleware/response-formatter')
const createRateLimiter = require('./middleware/rate-limiter')
const { errorHandler } = require('./middleware/error-handler')

/**
 * Main API Router (v1)
 * Mounts all API endpoints under /api/v1
 */
function createApiRouter(dependencies) {
    const router = express.Router()
    const { apiTokenRepository } = dependencies

    // CORS - allow all origins for public API
    router.use(cors({
        origin: true, // Allow all origins
        credentials: true, // Allow cookies/session
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization']
    }))

    // Response formatting helpers
    router.use(responseFormatter)

    // Rate limiting - 100 requests per minute per token/IP
    router.use(createRateLimiter(100, 60000))

    // Health check endpoint
    router.get('/health', (req, res) => {
        res.apiSuccess({
            status: 'ok',
            version: '1.0.0',
            timestamp: new Date().toISOString()
        })
    })

    // Mount sub-routers
    router.use('/auth', require('./routes/auth')(dependencies))
    router.use('/account', require('./routes/account')(dependencies))
    router.use('/inbox', require('./routes/inbox')(dependencies))
    router.use('/mail', require('./routes/mail')(dependencies))
    router.use('/locks', require('./routes/locks')(dependencies))
    router.use('/stats', require('./routes/stats')(dependencies))
    router.use('/config', require('./routes/config')(dependencies))

    // 404 handler for API routes
    router.use((req, res) => {
        res.apiError('Endpoint not found', 'NOT_FOUND', 404)
    })

    // Error handler (must be last)
    router.use(errorHandler)

    return router
}

module.exports = createApiRouter
