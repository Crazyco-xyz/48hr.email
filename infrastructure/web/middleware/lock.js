function checkLockAccess(req, res, next) {
    const inboxLock = req.app.get('inboxLock')
    const address = req.params.address
    const userId = req.session ? .userId
    const isAuthenticated = req.session ? .isAuthenticated

    if (!address || !inboxLock) {
        return next()
    }

    const isLocked = inboxLock.isLocked(address)

    // For authenticated users, check database ownership
    // Also allow session-based access for immediate unlock after locking
    const hasAccess = isAuthenticated && userId ?
        (inboxLock.isLockedByUser(address, userId) || req.session.lockedInbox === address.toLowerCase()) :
        (req.session ? .lockedInbox === address.toLowerCase())

    // Block access to locked inbox without proper authentication
    if (isLocked && !hasAccess) {
        const count = req.app.get('mailProcessingService').getCount()
        const unlockError = req.session ? req.session.unlockError : undefined
        if (req.session) delete req.session.unlockError

        return res.render('error', {
            purgeTime: require('../../../application/helper').prototype.purgeTimeElemetBuilder(),
            address: address,
            count: count,
            message: 'This inbox is locked by another user. Only the owner can access it.',
            branding: req.app.get('config').http.branding,
            currentUser: req.session ? .username,
            authEnabled: req.app.get('config').user.authEnabled
        })
    }

    // Update last access if they have access and are authenticated
    if (isLocked && hasAccess && isAuthenticated && userId) {
        inboxLock.updateAccess(userId, address)
    }

    next()
}

module.exports = { checkLockAccess }
