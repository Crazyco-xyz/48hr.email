function checkLockAccess(req, res, next) {
    const inboxLock = req.app.get('inboxLock')
    const address = req.params.address

    if (!address || !inboxLock) {
        return next()
    }

    const isLocked = inboxLock.isLocked(address)
    const hasAccess = req.session && req.session.lockedInbox === address.toLowerCase()

    // Block access to locked inbox without proper authentication
    if (isLocked && !hasAccess) {
        const count = req.app.get('mailProcessingService').getCount()
        const unlockError = req.session ? req.session.unlockError : undefined
        if (req.session) delete req.session.unlockError

        return res.render('error', {
            purgeTime: require('../../../application/helper').prototype.purgeTimeElemetBuilder(),
            address: address,
            count: count,
            message: 'This inbox is locked. Please unlock it to access.',
            branding: req.app.get('config').http.branding,
            showUnlockButton: true,
            unlockError: unlockError,
            redirectTo: req.originalUrl
        })
    }

    // Update last access if they have access
    if (isLocked && hasAccess) {
        inboxLock.updateAccess(address)
    }

    next()
}

module.exports = { checkLockAccess }