// Account management routes for registered users
const express = require('express')
const router = express.Router()
const { requireAuth } = require('../middleware/auth')
const { body, validationResult } = require('express-validator')

// GET /account - Account dashboard
router.get('/account', requireAuth, async(req, res) => {
    try {
        const userRepository = req.app.get('userRepository')
        const inboxLock = req.app.get('inboxLock')
        const mailProcessingService = req.app.get('mailProcessingService')
        const Helper = require('../../../application/helper')
        const helper = new Helper()

        // Get user's verified forwarding emails
        const forwardEmails = userRepository.getForwardEmails(req.session.userId)

        // Get user's locked inboxes (if locking is available)
        let lockedInboxes = []
        if (inboxLock) {
            lockedInboxes = inboxLock.getUserLockedInboxes(req.session.userId)
        }

        // Get user stats
        const config = req.app.get('config')
        const stats = userRepository.getUserStats(req.session.userId, config.user)

        // Get mail count for footer
        const count = await mailProcessingService.getCount()
        const imapService = req.app.locals.imapService
        const largestUid = await imapService.getLargestUid()
        const totalcount = helper.countElementBuilder(count, largestUid)
        const purgeTime = helper.purgeTimeElemetBuilder()

        res.render('account', {
            title: 'Account Dashboard',
            username: req.session.username,
            forwardEmails,
            lockedInboxes,
            stats,
            branding: config.http.branding,
            purgeTime: purgeTime,
            totalcount: totalcount,
            successMessage: req.session.accountSuccess,
            errorMessage: req.session.accountError
        })

        // Clear flash messages
        delete req.session.accountSuccess
        delete req.session.accountError
    } catch (error) {
        console.error('Account page error:', error)
        res.status(500).render('error', {
            message: 'Failed to load account page',
            error: error
        })
    }
})

// POST /account/forward-email/add - Add forwarding email (triggers verification)
router.post('/account/forward-email/add',
    requireAuth, [
        body('email').isEmail().normalizeEmail().withMessage('Invalid email address')
    ],
    async(req, res) => {
        const errors = validationResult(req)
        if (!errors.isEmpty()) {
            req.session.accountError = errors.array()[0].msg
            return res.redirect('/account')
        }

        try {
            const userRepository = req.app.get('userRepository')
            const smtpService = req.app.get('smtpService')
            const verificationStore = req.app.get('verificationStore')
            const config = req.app.get('config')
            const crypto = require('crypto')
            const { email } = req.body

            // Check if already verified
            if (userRepository.hasForwardEmail(req.session.userId, email)) {
                req.session.accountError = 'This email is already verified on your account'
                return res.redirect('/account')
            }

            // Check limit
            const emailCount = userRepository.getForwardEmailCount(req.session.userId)
            if (emailCount >= config.user.maxForwardEmails) {
                req.session.accountError = `Maximum ${config.user.maxForwardEmails} forwarding emails allowed`
                return res.redirect('/account')
            }

            // Generate verification token
            const token = crypto.randomBytes(32).toString('hex')
            verificationStore.createVerification(token, email, {
                userId: req.session.userId
            })

            // Send verification email
            const baseUrl = config.http.baseUrl || 'http://localhost:3000'
            const branding = config.http.branding[0] || '48hr.email'

            await smtpService.sendVerificationEmail(
                email,
                token,
                baseUrl,
                branding,
                '/account/verify'
            )

            req.session.accountSuccess = `Verification email sent to ${email}. Check your inbox!`
            res.redirect('/account')
        } catch (error) {
            console.error('Add forward email error:', error)
            req.session.accountError = 'Failed to send verification email. Please try again.'
            res.redirect('/account')
        }
    }
)

// GET /account/verify - Verify forwarding email
router.get('/account/verify', requireAuth, async(req, res) => {
    const { token } = req.query

    if (!token) {
        req.session.accountError = 'Invalid verification link'
        return res.redirect('/account')
    }

    try {
        const verificationStore = req.app.get('verificationStore')
        const userRepository = req.app.get('userRepository')

        const verification = verificationStore.verifyToken(token)

        if (!verification) {
            req.session.accountError = 'Verification link expired or invalid'
            return res.redirect('/account')
        }

        // Check if token belongs to this user
        if (verification.metadata.userId !== req.session.userId) {
            req.session.accountError = 'This verification link belongs to another account'
            return res.redirect('/account')
        }

        // Add email to user's verified emails
        userRepository.addForwardEmail(req.session.userId, verification.destinationEmail)

        req.session.accountSuccess = `Successfully verified ${verification.destinationEmail}!`
        res.redirect('/account')
    } catch (error) {
        console.error('Email verification error:', error)
        req.session.accountError = 'Failed to verify email. Please try again.'
        res.redirect('/account')
    }
})

// POST /account/forward-email/remove - Remove forwarding email
router.post('/account/forward-email/remove',
    requireAuth, [
        body('email').isEmail().normalizeEmail().withMessage('Invalid email address')
    ],
    async(req, res) => {
        const errors = validationResult(req)
        if (!errors.isEmpty()) {
            req.session.accountError = errors.array()[0].msg
            return res.redirect('/account')
        }

        try {
            const userRepository = req.app.get('userRepository')
            const { email } = req.body

            userRepository.removeForwardEmail(req.session.userId, email)

            req.session.accountSuccess = `Removed ${email} from your account`
            res.redirect('/account')
        } catch (error) {
            console.error('Remove forward email error:', error)
            req.session.accountError = 'Failed to remove email. Please try again.'
            res.redirect('/account')
        }
    }
)

// POST /account/locked-inbox/release - Release a locked inbox
router.post('/account/locked-inbox/release',
    requireAuth, [
        body('address').notEmpty().withMessage('Inbox address is required')
    ],
    async(req, res) => {
        const errors = validationResult(req)
        if (!errors.isEmpty()) {
            req.session.accountError = errors.array()[0].msg
            return res.redirect('/account')
        }

        try {
            const inboxLock = req.app.get('inboxLock')
            const { address } = req.body

            if (!inboxLock) {
                req.session.accountError = 'Inbox locking is not available'
                return res.redirect('/account')
            }

            // Check if user owns this locked inbox
            if (!inboxLock.isLockedByUser(address, req.session.userId)) {
                req.session.accountError = 'You do not own this locked inbox'
                return res.redirect('/account')
            }

            // Release the lock
            inboxLock.release(req.session.userId, address)

            req.session.accountSuccess = `Released lock on ${address}`
            res.redirect('/account')
        } catch (error) {
            console.error('Release inbox error:', error)
            req.session.accountError = 'Failed to release inbox. Please try again.'
            res.redirect('/account')
        }
    }
)

module.exports = router
