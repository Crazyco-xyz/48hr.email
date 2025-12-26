const express = require('express')
const router = express.Router()

router.post('/lock', async(req, res) => {
    const { address, password } = req.body

    if (!address || !password || password.length < 8) {
        if (req.session) req.session.lockError = 'invalid'
        return res.redirect(`/inbox/${address}`)
    }

    try {
        const inboxLock = req.app.get('inboxLock')
        const mailProcessingService = req.app.get('mailProcessingService')
        const config = req.app.get('config')

        // Prevent locking the example inbox; allow UI but block DB insert
        if (config && config.email && config.email.examples && config.email.examples.account && address.toLowerCase() === config.email.examples.account.toLowerCase()) {
            if (req.session) req.session.lockError = 'locking_disabled_for_example'
            return res.redirect(`/inbox/${address}`)
        }

        await inboxLock.lock(address, password)

        // Clear cache for this inbox
        if (mailProcessingService.cachedFetchFullMail && mailProcessingService.cachedFetchFullMail.clear) {
            mailProcessingService.cachedFetchFullMail.clear()
        }

        req.session.lockedInbox = address
        res.redirect(`/inbox/${address}`)
    } catch (error) {
        console.error('Lock error:', error)
        if (req.session) req.session.lockError = 'server_error'
        res.redirect(`/inbox/${address}`)
    }
})

router.post('/unlock', async(req, res) => {
    const { address, password, redirectTo } = req.body
    const destination = redirectTo && redirectTo.startsWith('/') ? redirectTo : `/inbox/${address}`

    if (!address || !password) {
        if (req.session) req.session.unlockError = 'missing_fields'
        return res.redirect(destination)
    }

    try {
        const inboxLock = req.app.get('inboxLock')
        const inbox = await inboxLock.unlock(address, password)

        if (!inbox) {
            if (req.session) req.session.unlockError = 'invalid_password'
            return res.redirect(destination)
        }

        req.session.lockedInbox = address
        res.redirect(destination)
    } catch (error) {
        console.error('Unlock error:', error)
        if (req.session) req.session.unlockError = 'server_error'
        res.redirect(destination)
    }
})

router.get('/logout', (req, res) => {
    const mailProcessingService = req.app.get('mailProcessingService')

    // Clear cache before logout
    if (mailProcessingService.cachedFetchFullMail && mailProcessingService.cachedFetchFullMail.clear) {
        mailProcessingService.cachedFetchFullMail.clear()
    }

    req.session.destroy()
    res.redirect('/')
})

router.post('/remove', async(req, res) => {
    const { address } = req.body

    if (!address) {
        return res.redirect('/')
    }

    // Check if user has access to this locked inbox
    const hasAccess = req.session && req.session.lockedInbox === address.toLowerCase()

    if (!hasAccess) {
        return res.redirect(`/inbox/${address}`)
    }

    try {
        const inboxLock = req.app.get('inboxLock')
        const mailProcessingService = req.app.get('mailProcessingService')

        await inboxLock.release(address)

        // Clear cache when removing lock
        if (mailProcessingService.cachedFetchFullMail && mailProcessingService.cachedFetchFullMail.clear) {
            mailProcessingService.cachedFetchFullMail.clear()
        }

        req.session.destroy()
        res.redirect(`/inbox/${address}`)
    } catch (error) {
        console.error('Remove lock error:', error)
        if (req.session) req.session.lockError = 'remove_failed'
        res.redirect(`/inbox/${address}`)
    }
})

module.exports = router