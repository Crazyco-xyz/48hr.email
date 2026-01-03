const express = require('express')
const router = new express.Router()
const { body, validationResult } = require('express-validator')
const debug = require('debug')('48hr-email:auth-routes')
const { redirectIfAuthenticated } = require('../middleware/auth')
const config = require('../../../application/config')
const Helper = require('../../../application/helper')
const helper = new Helper()

const purgeTime = helper.purgeTimeElemetBuilder()

// Simple in-memory rate limiters for registration and login
const registrationRateLimitStore = new Map()
const loginRateLimitStore = new Map()

// Registration rate limiter: 5 attempts per IP per hour
const registrationRateLimiter = (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress
    const now = Date.now()
    const windowMs = 60 * 60 * 1000 // 1 hour
    const maxRequests = 5

    // Clean up old entries
    for (const [key, data] of registrationRateLimitStore.entries()) {
        if (now - data.resetTime > windowMs) {
            registrationRateLimitStore.delete(key)
        }
    }

    // Get or create entry for this IP
    let ipData = registrationRateLimitStore.get(ip)
    if (!ipData || now - ipData.resetTime > windowMs) {
        ipData = { count: 0, resetTime: now }
        registrationRateLimitStore.set(ip, ipData)
    }

    // Check if limit exceeded
    if (ipData.count >= maxRequests) {
        debug(`Registration rate limit exceeded for IP ${ip}`)
        req.session.errorMessage = 'Too many registration attempts. Please try again after 1 hour.'
        return res.redirect('/register')
    }

    // Increment counter
    ipData.count++
        next()
}

// Login rate limiter: 10 attempts per IP per 15 minutes
const loginRateLimiter = (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress
    const now = Date.now()
    const windowMs = 15 * 60 * 1000 // 15 minutes
    const maxRequests = 10

    // Clean up old entries
    for (const [key, data] of loginRateLimitStore.entries()) {
        if (now - data.resetTime > windowMs) {
            loginRateLimitStore.delete(key)
        }
    }

    // Get or create entry for this IP
    let ipData = loginRateLimitStore.get(ip)
    if (!ipData || now - ipData.resetTime > windowMs) {
        ipData = { count: 0, resetTime: now }
        loginRateLimitStore.set(ip, ipData)
    }

    // Check if limit exceeded
    if (ipData.count >= maxRequests) {
        debug(`Login rate limit exceeded for IP ${ip}`)
        req.session.errorMessage = 'Too many login attempts. Please try again after 15 minutes.'
        return res.redirect('/login')
    }

    // Increment counter
    ipData.count++
        next()
}

// GET /auth - Show unified auth page (login or register)
router.get('/auth', redirectIfAuthenticated, (req, res) => {
    const config = req.app.get('config')
    const errorMessage = req.session.errorMessage
    const successMessage = req.session.successMessage

    // Clear messages after reading
    delete req.session.errorMessage
    delete req.session.successMessage

    res.render('auth', {
        title: `Login or Register | ${config.http.branding[0]}`,
        branding: config.http.branding,
        purgeTime: purgeTime,
        errorMessage,
        successMessage
    })
})

// POST /register - Process registration
router.post('/register',
    redirectIfAuthenticated,
    registrationRateLimiter,
    body('username').trim().notEmpty().withMessage('Username is required'),
    body('password').notEmpty().withMessage('Password is required'),
    body('confirmPassword').notEmpty().withMessage('Password confirmation is required'),
    async(req, res) => {
        try {
            const errors = validationResult(req)
            if (!errors.isEmpty()) {
                const firstError = errors.array()[0].msg
                debug(`Registration validation failed: ${firstError}`)
                req.session.errorMessage = firstError
                return res.redirect('/auth')
            }

            const { username, password, confirmPassword } = req.body

            // Check if passwords match
            if (password !== confirmPassword) {
                debug('Registration failed: Passwords do not match')
                req.session.errorMessage = 'Passwords do not match'
                return res.redirect('/auth')
            }

            const authService = req.app.get('authService')
            const result = await authService.register(username, password)

            if (result.success) {
                debug(`User registered successfully: ${username}`)
                req.session.successMessage = 'Registration successful! Please log in.'
                return res.redirect('/auth')
            } else {
                debug(`Registration failed: ${result.error}`)
                req.session.errorMessage = result.error
                return res.redirect('/auth')
            }
        } catch (error) {
            debug(`Registration error: ${error.message}`)
            console.error('Error during registration', error)
            req.session.errorMessage = 'An unexpected error occurred. Please try again.'
            res.redirect('/auth')
        }
    }
)

// POST /login - Process login
router.post('/login',
    redirectIfAuthenticated,
    loginRateLimiter,
    body('username').trim().notEmpty().withMessage('Username is required'),
    body('password').notEmpty().withMessage('Password is required'),
    async(req, res) => {
        try {
            const errors = validationResult(req)
            if (!errors.isEmpty()) {
                const firstError = errors.array()[0].msg
                debug(`Login validation failed: ${firstError}`)
                req.session.errorMessage = firstError
                return res.redirect('/auth')
            }

            const { username, password } = req.body
            const authService = req.app.get('authService')
            const result = await authService.login(username, password)

            if (result.success) {
                debug(`User logged in successfully: ${username}`)

                // Store redirect URL before regenerating session
                const redirectUrl = req.session.redirectAfterLogin || '/'

                // Regenerate session to prevent fixation attacks
                req.session.regenerate((err) => {
                    if (err) {
                        debug(`Session regeneration error: ${err.message}`)
                        req.session.errorMessage = 'Login failed. Please try again.'
                        return res.redirect('/auth')
                    }

                    // Set session data
                    req.session.userId = result.user.id
                    req.session.username = result.user.username
                    req.session.isAuthenticated = true
                    req.session.createdAt = result.user.created_at

                    req.session.save((err) => {
                        if (err) {
                            debug(`Session save error: ${err.message}`)
                            req.session.errorMessage = 'Login failed. Please try again.'
                            return res.redirect('/auth')
                        }

                        debug(`Session created for user: ${username}, redirecting to: ${redirectUrl}`)
                        res.redirect(redirectUrl)
                    })
                })
            } else {
                debug(`Login failed: ${result.error}`)
                req.session.errorMessage = result.error
                return res.redirect('/auth')
            }
        } catch (error) {
            debug(`Login error: ${error.message}`)
            console.error('Error during login', error)
            req.session.errorMessage = 'An unexpected error occurred. Please try again.'
            res.redirect('/auth')
        }
    }
)

// GET /logout - Logout user
router.get('/logout', (req, res) => {
        // Store redirect URL before destroying session
        const redirectUrl = req.query.redirect || req.get('Referer') || '/'

        debug(`Logout requested with redirect: ${redirectUrl}`)

        if (req.session) {
            const username = req.session.username
            req.session.destroy((err) => {
                if (err) {
                    debug(`Logout error: ${err.message}`)
                    console.error('Error during logout', err)
                    return res.redirect('/')
                }

                debug(`User logged out: ${username}, redirecting to: ${redirectUrl}`)
                    // Clear cookie explicitly
                res.clearCookie('connect.sid')
                res.redirect(redirectUrl)
            })
        } else {
            debug(`No session found, redirecting to: ${redirectUrl}`)
            res.redirect(redirectUrl)
        }
    }) // GET /auth/check - JSON endpoint for checking auth status (AJAX)
router.get('/auth/check', (req, res) => {
    if (req.session && req.session.userId && req.session.isAuthenticated) {
        res.json({
            authenticated: true,
            user: {
                id: req.session.userId,
                username: req.session.username
            }
        })
    } else {
        res.json({
            authenticated: false
        })
    }
})

module.exports = router
