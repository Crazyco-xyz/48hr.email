const express = require('express')
const { body, validationResult } = require('express-validator')
const { ApiError } = require('../middleware/error-handler')

/**
 * Authentication API Routes
 * POST /register - Register new user
 * POST /login - Login user
 * POST /logout - Logout user
 * GET /session - Get current session info
 */
function createAuthRouter(dependencies) {
    const router = express.Router()
    const { authService, config } = dependencies

    // Check if auth is enabled
    if (!authService || !config.user.authEnabled) {
        router.all('*', (req, res) => {
            res.apiError('Authentication is disabled', 'AUTH_DISABLED', 503)
        })
        return router
    }

    /**
     * POST /register - Register new user
     */
    router.post('/register',
        body('username').trim().isLength({ min: 3, max: 20 }).matches(/^[a-zA-Z0-9_]+$/),
        body('password').isLength({ min: 8 }),
        async(req, res, next) => {
            try {
                const errors = validationResult(req)
                if (!errors.isEmpty()) {
                    return res.apiError('Invalid username or password format', 'VALIDATION_ERROR', 400)
                }

                const { username, password } = req.body

                // Attempt to create user
                const result = await authService.register(username, password)

                if (!result.success) {
                    return res.apiError(result.error, 'REGISTRATION_FAILED', 400)
                }

                // Create session
                req.session.userId = result.user.id
                req.session.username = username
                req.session.isAuthenticated = true
                req.session.createdAt = Date.now()

                res.apiSuccess({
                    userId: result.user.id,
                    username: username,
                    message: 'Registration successful'
                }, 201)
            } catch (error) {
                next(error)
            }
        }
    )

    /**
     * POST /login - Login user
     */
    router.post('/login',
        body('username').trim().notEmpty(),
        body('password').notEmpty(),
        async(req, res, next) => {
            try {
                const errors = validationResult(req)
                if (!errors.isEmpty()) {
                    return res.apiError('Username and password are required', 'VALIDATION_ERROR', 400)
                }

                const { username, password } = req.body

                // Authenticate user
                const result = await authService.login(username, password)

                if (!result.success) {
                    return res.apiError('Invalid username or password', 'INVALID_CREDENTIALS', 401)
                }

                // Regenerate session to prevent fixation
                req.session.regenerate((err) => {
                    if (err) {
                        return next(err)
                    }

                    req.session.userId = result.user.id
                    req.session.username = username
                    req.session.isAuthenticated = true
                    req.session.createdAt = Date.now()

                    res.apiSuccess({
                        userId: result.user.id,
                        username: username,
                        message: 'Login successful'
                    })
                })
            } catch (error) {
                next(error)
            }
        }
    )

    /**
     * POST /logout - Logout user
     */
    router.post('/logout', (req, res, next) => {
        try {
            if (!req.session || !req.session.isAuthenticated) {
                return res.apiError('Not logged in', 'NOT_AUTHENTICATED', 401)
            }

            req.session.destroy((err) => {
                if (err) {
                    return next(err)
                }

                res.apiSuccess({ message: 'Logout successful' })
            })
        } catch (error) {
            next(error)
        }
    })

    /**
     * GET /session - Get current session info
     */
    router.get('/session', (req, res) => {
        if (req.session && req.session.isAuthenticated && req.session.userId) {
            res.apiSuccess({
                authenticated: true,
                userId: req.session.userId,
                username: req.session.username,
                createdAt: req.session.createdAt
            })
        } else {
            res.apiSuccess({
                authenticated: false
            })
        }
    })

    return router
}

module.exports = createAuthRouter
