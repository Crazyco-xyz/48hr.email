const express = require('express')
const router = express.Router()
const debug = require('debug')('48hr-email:lock')
const { requireAuth } = require('../middleware/auth')

router.post('/lock', requireAuth, async(req, res) => {
    const { address } = req.body
    const userId = req.session.userId
    debug(`Lock attempt for inbox: ${address} by user ${userId}`)

    if (!address) {
        debug(`Lock error for ${address}: missing address`)
        if (req.session) req.session.lockError = 'invalid'
        return res.redirect(`/inbox/${address}`)
    }

    try {
        const inboxLock = req.app.get('inboxLock')
        const mailProcessingService = req.app.get('mailProcessingService')
        const config = req.app.get('config')

        if (!inboxLock) {
            debug('Lock error: inboxLock service not available')
            if (req.session) req.session.lockError = 'service_unavailable'
            return res.redirect(`/inbox/${address}`)
        }

        // Prevent locking the example inbox
        if (config && config.email && config.email.examples && config.email.examples.account && address.toLowerCase() === config.email.examples.account.toLowerCase()) {
            debug(`Lock error for ${address}: locking disabled for example inbox`)
            if (req.session) req.session.lockError = 'locking_disabled_for_example'
            return res.redirect(`/inbox/${address}`)
        }

        // Check if user can lock more inboxes (5 max)
        if (!inboxLock.canLockMore(userId)) {
            debug(`Lock error for ${address}: user ${userId} has reached 5-inbox limit`)
            if (req.session) req.session.lockError = 'max_locked_inboxes'
            return res.redirect(`/inbox/${address}`)
        }

        await inboxLock.lock(userId, address)
        debug(`Inbox locked: ${address} by user ${userId}`)

        // Clear cache for this inbox
        if (mailProcessingService.cachedFetchFullMail && mailProcessingService.cachedFetchFullMail.clear) {
            debug(`Clearing lock cache for: ${address}`)
            mailProcessingService.cachedFetchFullMail.clear()
        }

        // Store in session for immediate access
        req.session.lockedInbox = address
        res.redirect(`/inbox/${address}`)
    } catch (error) {
        debug(`Lock error for ${address}: ${error.message}`)
        console.error('Lock error:', error)
        if (req.session) {
            if (error.message.includes('already locked')) {
                req.session.lockError = 'already_locked'
            } else if (error.message.includes('maximum')) {
                req.session.lockError = 'max_locked_inboxes'
            } else {
                req.session.lockError = 'server_error'
            }
        }
        res.redirect(`/inbox/${address}`)
    }
})

router.post('/unlock', requireAuth, async(req, res) => {
    const { address, redirectTo } = req.body
    const userId = req.session.userId
    const destination = redirectTo && redirectTo.startsWith('/') ? redirectTo : `/inbox/${address}`
    debug(`Unlock attempt for inbox: ${address} by user ${userId}`)

    if (!address) {
        debug(`Unlock error for ${address}: missing address`)
        if (req.session) req.session.unlockError = 'missing_fields'
        return res.redirect(destination)
    }

    try {
        const inboxLock = req.app.get('inboxLock')

        if (!inboxLock) {
            debug('Unlock error: inboxLock service not available')
            if (req.session) req.session.unlockError = 'service_unavailable'
            return res.redirect(destination)
        }

        const inbox = await inboxLock.unlock(userId, address)

        if (!inbox) {
            debug(`Unlock error for ${address}: not owned by user ${userId}`)
            if (req.session) req.session.unlockError = 'not_your_lock'
            return res.redirect(destination)
        }

        debug(`Inbox ${address} unlocked by user ${userId}`)
        req.session.lockedInbox = address
        res.redirect(destination)
    } catch (error) {
        debug(`Unlock error for ${address}: ${error.message}`)
        console.error('Unlock error:', error)
        if (req.session) req.session.unlockError = 'server_error'
        res.redirect(destination)
    }
})

router.get('/logout', (req, res) => {
    const mailProcessingService = req.app.get('mailProcessingService')

    // Clear cache before logout
    if (mailProcessingService.cachedFetchFullMail && mailProcessingService.cachedFetchFullMail.clear) {
        debug('Clearing lock cache for logout')
        mailProcessingService.cachedFetchFullMail.clear()
    }

    debug('Clearing lockedInbox from session (lock logout)')
    delete req.session.lockedInbox
    res.redirect('/')
})

router.post('/remove', requireAuth, async(req, res) => {
    const { address } = req.body
    const userId = req.session.userId
    debug(`Remove lock attempt for inbox: ${address} by user ${userId}`)

    if (!address) {
        debug('Remove lock error: missing address')
        return res.redirect('/')
    }

    try {
        const inboxLock = req.app.get('inboxLock')
        const mailProcessingService = req.app.get('mailProcessingService')

        if (!inboxLock) {
            debug('Remove lock error: inboxLock service not available')
            return res.redirect(`/inbox/${address}`)
        }

        // Verify user owns this lock
        if (!inboxLock.isLockedByUser(address, userId)) {
            debug(`Remove lock error: inbox ${address} not owned by user ${userId}`)
            if (req.session) req.session.lockError = 'not_your_lock'
            return res.redirect(`/inbox/${address}`)
        }

        await inboxLock.release(userId, address)
        debug(`Lock removed for inbox: ${address} by user ${userId}`)

        // Clear cache when removing lock
        if (mailProcessingService.cachedFetchFullMail && mailProcessingService.cachedFetchFullMail.clear) {
            debug(`Clearing lock cache for: ${address}`)
            mailProcessingService.cachedFetchFullMail.clear()
        }

        // Clear from session
        if (req.session.lockedInbox === address.toLowerCase()) {
            delete req.session.lockedInbox
        }

        res.redirect(`/inbox/${address}`)
    } catch (error) {
        debug(`Remove lock error for ${address}: ${error.message}`)
        console.error('Remove lock error:', error)
        if (req.session) req.session.lockError = 'remove_failed'
        res.redirect(`/inbox/${address}`)
    }
})

module.exports = router
