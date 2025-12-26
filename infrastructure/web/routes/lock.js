const express = require('express')
const router = express.Router()
const debug = require('debug')('48hr-email:lock')

router.post('/lock', async(req, res) => {
    const { address, password } = req.body
    debug(`Lock attempt for inbox: ${address}`);

    if (!address || !password || password.length < 8) {
        debug(`Lock error for ${address}: invalid input`);
        if (req.session) req.session.lockError = 'invalid'
        return res.redirect(`/inbox/${address}`)
    }

    try {
        const inboxLock = req.app.get('inboxLock')
        const mailProcessingService = req.app.get('mailProcessingService')
        const config = req.app.get('config')

        // Prevent locking the example inbox; allow UI but block DB insert
        if (config && config.email && config.email.examples && config.email.examples.account && address.toLowerCase() === config.email.examples.account.toLowerCase()) {
            debug(`Lock error for ${address}: locking disabled for example inbox`);
            if (req.session) req.session.lockError = 'locking_disabled_for_example'
            return res.redirect(`/inbox/${address}`)
        }

        await inboxLock.lock(address, password)
        debug(`Inbox locked: ${address}`);

        // Clear cache for this inbox
        if (mailProcessingService.cachedFetchFullMail && mailProcessingService.cachedFetchFullMail.clear) {
            debug(`Clearing lock cache for: ${address}`);
            mailProcessingService.cachedFetchFullMail.clear()
        }

        req.session.lockedInbox = address
        res.redirect(`/inbox/${address}`)
    } catch (error) {
        debug(`Lock error for ${address}: ${error.message}`);
        console.error('Lock error:', error)
        if (req.session) req.session.lockError = 'server_error'
        res.redirect(`/inbox/${address}`)
    }
})

router.post('/unlock', async(req, res) => {
    const { address, password, redirectTo } = req.body
    const destination = redirectTo && redirectTo.startsWith('/') ? redirectTo : `/inbox/${address}`
    debug(`Unlock attempt for inbox: ${address}`);

    if (!address || !password) {
        debug(`Unlock error for ${address}: missing fields`);
        if (req.session) req.session.unlockError = 'missing_fields'
        return res.redirect(destination)
    }

    try {
        const inboxLock = req.app.get('inboxLock')
        const inbox = await inboxLock.unlock(address, password)

        if (!inbox) {
            debug(`Unlock error for ${address}: invalid password`);
            if (req.session) req.session.unlockError = 'invalid_password'
            return res.redirect(destination)
        }

        debug(`Inbox unlocked: ${address}`);
        req.session.lockedInbox = address
        res.redirect(destination)
    } catch (error) {
        debug(`Unlock error for ${address}: ${error.message}`);
        console.error('Unlock error:', error)
        if (req.session) req.session.unlockError = 'server_error'
        res.redirect(destination)
    }
})

router.get('/logout', (req, res) => {
    const mailProcessingService = req.app.get('mailProcessingService')

    // Clear cache before logout
    if (mailProcessingService.cachedFetchFullMail && mailProcessingService.cachedFetchFullMail.clear) {
        debug('Clearing lock cache for logout');
        mailProcessingService.cachedFetchFullMail.clear()
    }

    debug('Lock session destroyed (logout)');
    req.session.destroy()
    res.redirect('/')
})

router.post('/remove', async(req, res) => {
    const { address } = req.body
    debug(`Remove lock attempt for inbox: ${address}`);

    if (!address) {
        debug('Remove lock error: missing address');
        return res.redirect('/')
    }

    // Check if user has access to this locked inbox
    const hasAccess = req.session && req.session.lockedInbox === address.toLowerCase()
    debug(`Lock middleware: ${address} - hasAccess: ${hasAccess}`);

    if (!hasAccess) {
        debug(`Remove lock error: no access for ${address}`);
        return res.redirect(`/inbox/${address}`)
    }

    try {
        const inboxLock = req.app.get('inboxLock')
        const mailProcessingService = req.app.get('mailProcessingService')

        await inboxLock.release(address)
        debug(`Lock removed for inbox: ${address}`);

        // Clear cache when removing lock
        if (mailProcessingService.cachedFetchFullMail && mailProcessingService.cachedFetchFullMail.clear) {
            debug(`Clearing lock cache for: ${address}`);
            mailProcessingService.cachedFetchFullMail.clear()
        }

        debug('Lock session destroyed (remove)');
        req.session.destroy()
        res.redirect(`/inbox/${address}`)
    } catch (error) {
        debug(`Remove lock error for ${address}: ${error.message}`);
        console.error('Remove lock error:', error)
        if (req.session) req.session.lockError = 'remove_failed'
        res.redirect(`/inbox/${address}`)
    }
})

module.exports = router