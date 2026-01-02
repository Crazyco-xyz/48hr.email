const express = require('express')
const router = new express.Router()
const { param, body, validationResult } = require('express-validator')
const debug = require('debug')('48hr-email:routes')

const config = require('../../../application/config')
const Helper = require('../../../application/helper')
const CryptoDetector = require('../../../application/crypto-detector')
const helper = new(Helper)
const cryptoDetector = new CryptoDetector()
const { checkLockAccess } = require('../middleware/lock')

const purgeTime = helper.purgeTimeElemetBuilder()


const sanitizeAddress = param('address').customSanitizer(
    (value, { req }) => {
        return req.params.address
            .replace(/[^A-Za-z0-9_.+@-]/g, '') // Remove special characters
            .toLowerCase()
    }
)

// Middleware to validate domain is in allowed list
const validateDomain = (req, res, next) => {
    const address = req.params.address
    const domain = address.split('@')[1]

    if (!domain) {
        req.session.errorMessage = 'Invalid email address format.'
        return res.redirect(`/error/${address}/400`)
    }

    const allowedDomains = config.email.domains.map(d => d.toLowerCase())
    if (!allowedDomains.includes(domain.toLowerCase())) {
        req.session.errorMessage = `Domain '${domain}' is not supported by this service.`
        return res.redirect(`/error/${address}/403`)
    }

    next()
}

// Simple in-memory rate limiter for forwarding (5 requests per 15 minutes per IP)
const forwardRateLimitStore = new Map()
const forwardLimiter = (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress
    const now = Date.now()
    const windowMs = 15 * 60 * 1000 // 15 minutes
    const maxRequests = 5

    // Clean up old entries
    for (const [key, data] of forwardRateLimitStore.entries()) {
        if (now - data.resetTime > windowMs) {
            forwardRateLimitStore.delete(key)
        }
    }

    // Get or create entry for this IP
    let ipData = forwardRateLimitStore.get(ip)
    if (!ipData || now - ipData.resetTime > windowMs) {
        ipData = { count: 0, resetTime: now }
        forwardRateLimitStore.set(ip, ipData)
    }

    // Check if limit exceeded
    if (ipData.count >= maxRequests) {
        debug(`Rate limit exceeded for IP ${ip}`)
        req.session.errorMessage = 'Too many forward requests. Please try again after 15 minutes.'
        return res.redirect(`/inbox/${req.params.address}`)
    }

    // Increment counter
    ipData.count++
        next()
}

// Email validation middleware for forwarding
const validateForwardRequest = [
    sanitizeAddress,
    body('destinationEmail')
    .trim()
    .isEmail()
    .withMessage('Invalid email address format')
    .normalizeEmail()
    .custom((value) => {
        // Prevent forwarding to temporary email addresses
        const domain = value.split('@')[1]
        if (!domain) {
            throw new Error('Invalid email address')
        }

        const tempDomains = config.email.domains.map(d => d.toLowerCase())
        if (tempDomains.includes(domain.toLowerCase())) {
            throw new Error('Cannot forward to temporary email addresses')
        }
        return true
    })
]

router.get('^/:address([^@/]+@[^@/]+)', sanitizeAddress, validateDomain, checkLockAccess, async(req, res, next) => {
    try {
        const mailProcessingService = req.app.get('mailProcessingService')
        if (!mailProcessingService) {
            throw new Error('Mail processing service not available')
        }
        debug(`Inbox request for ${req.params.address}`)
        const inboxLock = req.app.get('inboxLock')
        const count = await mailProcessingService.getCount()
        const largestUid = await req.app.locals.imapService.getLargestUid()
        const totalcount = helper.countElementBuilder(count, largestUid)
        debug(`Rendering inbox with ${count} total mails`)
        const isLocked = inboxLock && inboxLock.isLocked(req.params.address)
        const hasAccess = req.session && req.session.lockedInbox === req.params.address

        // Pull any lock error from session and clear it after reading
        const lockError = req.session ? req.session.lockError : undefined
        const unlockErrorSession = req.session ? req.session.unlockError : undefined
        const errorMessage = req.session ? req.session.errorMessage : undefined
        if (req.session) {
            delete req.session.lockError
            delete req.session.unlockError
            delete req.session.errorMessage
        }

        // Check for forward all success flag
        const forwardAllSuccess = req.query.forwardedAll ? parseInt(req.query.forwardedAll) : null

        // Check for verification sent flag
        const verificationSent = req.query.verificationSent === 'true'
        const verificationEmail = req.query.email || ''

        res.render('inbox', {
            title: `${config.http.branding[0]} | ` + req.params.address,
            purgeTime: purgeTime,
            address: req.params.address,
            count: count,
            totalcount: totalcount,
            mailSummaries: mailProcessingService.getMailSummaries(req.params.address),
            branding: config.http.branding,
            authEnabled: config.user.authEnabled,
            isLocked: isLocked,
            hasAccess: hasAccess,
            unlockError: unlockErrorSession,
            locktimer: config.user.lockReleaseHours,
            error: lockError,
            redirectTo: req.originalUrl,
            expiryTime: config.email.purgeTime.time,
            expiryUnit: config.email.purgeTime.unit,
            refreshInterval: config.imap.refreshIntervalSeconds,
            errorMessage: errorMessage,
            forwardAllSuccess: forwardAllSuccess,
            verificationSent: verificationSent,
            verificationEmail: verificationEmail
        })
    } catch (error) {
        debug(`Error loading inbox for ${req.params.address}:`, error.message)
        console.error('Error while loading inbox', error)
        next(error)
    }
})

router.get(
    '^/:address/:uid([0-9]+)',
    sanitizeAddress,
    validateDomain,
    checkLockAccess,
    async(req, res, next) => {
        try {
            const mailProcessingService = req.app.get('mailProcessingService')
            debug(`Viewing email ${req.params.uid} for ${req.params.address}`)
            const count = await mailProcessingService.getCount()
            const largestUid = await req.app.locals.imapService.getLargestUid()
            const totalcount = helper.countElementBuilder(count, largestUid)
            const mail = await mailProcessingService.getOneFullMail(
                req.params.address,
                req.params.uid
            )
            if (mail) {
                // Set a default subject if none is present
                if (!mail.subject) {
                    mail.subject = 'No Subject'
                }

                // Emails are immutable, cache if found
                res.set('Cache-Control', 'private, max-age=600')

                // Detect cryptographic keys in attachments
                const cryptoAttachments = cryptoDetector.detectCryptoAttachments(mail.attachments)
                debug(`Found ${cryptoAttachments.length} cryptographic attachments`)

                const inboxLock = req.app.get('inboxLock')
                const isLocked = inboxLock && inboxLock.isLocked(req.params.address)
                const hasAccess = req.session && req.session.lockedInbox === req.params.address

                // Pull error message from session and clear it
                const errorMessage = req.session ? req.session.errorMessage : undefined
                if (req.session) {
                    delete req.session.errorMessage
                }

                // Check for forward success flag
                const forwardSuccess = req.query.forwarded === 'true'

                // Check for verification sent flag
                const verificationSent = req.query.verificationSent === 'true'
                const verificationEmail = req.query.email || ''

                debug(`Rendering email view for UID ${req.params.uid}`)
                res.render('mail', {
                    title: mail.subject + " | " + req.params.address,
                    purgeTime: purgeTime,
                    address: req.params.address,
                    count: count,
                    totalcount: totalcount,
                    mail,
                    cryptoAttachments: cryptoAttachments,
                    uid: req.params.uid,
                    branding: config.http.branding,
                    authEnabled: config.user.authEnabled,
                    isLocked: isLocked,
                    hasAccess: hasAccess,
                    errorMessage: errorMessage,
                    forwardSuccess: forwardSuccess,
                    verificationSent: verificationSent,
                    verificationEmail: verificationEmail
                })
            } else {
                debug(`Email ${req.params.uid} not found for ${req.params.address}`)
                req.session.errorMessage = 'This mail could not be found. It either does not exist or has been deleted from our servers!'
                res.redirect(`/error/${req.params.address}/404`)
            }
        } catch (error) {
            debug(`Error fetching email ${req.params.uid} for ${req.params.address}:`, error.message)
            console.error('Error while fetching email', error)
            next(error)
        }
    }
)

// Catch-all for invalid UIDs (non-numeric)
router.get(
    '^/:address/delete-all',
    sanitizeAddress,
    validateDomain,
    checkLockAccess,
    async(req, res, next) => {
        try {
            const mailProcessingService = req.app.get('mailProcessingService')
            debug(`Deleting all emails for ${req.params.address}`)
            const mailSummaries = await mailProcessingService.getMailSummaries(req.params.address)
                // Create a copy of the array to avoid modification during iteration
            const summariesToDelete = [...mailSummaries]

            let deletedCount = 0
            for (const mail of summariesToDelete) {
                await mailProcessingService.deleteSpecificEmail(req.params.address, mail.uid)
                deletedCount++
                debug(`Successfully deleted UID ${mail.uid}`)
            }

            debug(`Deleted all ${deletedCount} emails for ${req.params.address}`)
            res.redirect(`/inbox/${req.params.address}`)
        } catch (error) {
            debug(`Error deleting all emails for ${req.params.address}:`, error.message)
            console.error('Error while deleting email', error)
            next(error)
        }
    }
)



router.get(
    '^/:address/:uid/delete',
    sanitizeAddress,
    validateDomain,
    checkLockAccess,
    async(req, res, next) => {
        try {
            const mailProcessingService = req.app.get('mailProcessingService')
            mailProcessingService.deleteSpecificEmail(req.params.address, req.params.uid)
            res.redirect(`/inbox/${req.params.address}`)
        } catch (error) {
            debug(`Error deleting email ${req.params.uid} for ${req.params.address}:`, error.message)
            console.error('Error while deleting email', error)
            next(error)
        }
    }
)

router.get(
    '^/:address/:uid/:checksum([a-f0-9]+)',
    sanitizeAddress,
    validateDomain,
    checkLockAccess,
    async(req, res, next) => {
        try {
            const mailProcessingService = req.app.get('mailProcessingService')
            debug(`Fetching attachment ${req.params.checksum} for email ${req.params.uid} (${req.params.address})`)
            const uid = parseInt(req.params.uid, 10)
            const count = await mailProcessingService.getCount()

            // Validate UID is a valid integer
            if (isNaN(uid) || uid <= 0) {
                debug(`Invalid UID provided: ${req.params.uid}`)
                req.session.errorMessage = 'Invalid/Malformed UID provided.'
                return res.redirect(`/error/${req.params.address}/400`)
            }

            const mail = await mailProcessingService.getOneFullMail(
                req.params.address,
                uid
            )

            if (!mail || !mail.attachments) {
                debug(`Email ${uid} or attachments not found for ${req.params.address}`)
                req.session.errorMessage = 'This email could not be found. It either does not exist or has been deleted from our servers!'
                return res.redirect(`/error/${req.params.address}/404`)
            }

            var index = mail.attachments.findIndex(attachment => attachment.checksum === req.params.checksum);
            const attachment = mail.attachments[index];

            if (attachment) {
                try {
                    debug(`Serving attachment: ${attachment.filename}`)
                    res.set('Content-Disposition', `attachment; filename=${attachment.filename}`);
                    res.set('Content-Type', attachment.contentType);
                    res.send(attachment.content);
                    return;
                } catch (error) {
                    debug(`Error serving attachment: ${error.message}`)
                    console.error('Error while fetching attachment', error);
                    next(error);
                    return;
                }
            } else {
                debug(`Attachment ${req.params.checksum} not found in email ${uid}`)
                req.session.errorMessage = 'This attachment could not be found. It either does not exist or has been deleted from our servers!'
                return res.redirect(`/error/${req.params.address}/404`)
            }
        } catch (error) {
            debug(`Error fetching attachment: ${error.message}`)
            console.error('Error while fetching attachment', error)
            next(error)
        }
    }
)



router.get(
    '^/:address/:uid/raw',
    sanitizeAddress,
    validateDomain,
    checkLockAccess,
    async(req, res, next) => {
        try {
            const mailProcessingService = req.app.get('mailProcessingService')
            debug(`Fetching raw email ${req.params.uid} for ${req.params.address}`)
            const uid = parseInt(req.params.uid, 10)
            const count = await mailProcessingService.getCount()
            const largestUid = await req.app.locals.imapService.getLargestUid()
            const totalcount = helper.countElementBuilder(count, largestUid)

            // Validate UID is a valid integer
            if (isNaN(uid) || uid <= 0) {
                debug(`Invalid UID provided for raw view: ${req.params.uid}`)
                req.session.errorMessage = 'Invalid/Malformed UID provided.'
                return res.redirect(`/error/${req.params.address}/400`)
            }

            mail = await mailProcessingService.getOneFullMail(
                req.params.address,
                uid,
                true
            )
            if (mail) {
                const decodeQuotedPrintable = (input) => {
                    if (!input) return '';
                    // Remove soft line breaks
                    let cleaned = input.replace(/=\r?\n/g, '');
                    // Decode =XX hex escapes
                    cleaned = cleaned.replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => {
                        try {
                            return String.fromCharCode(parseInt(hex, 16));
                        } catch {
                            return '=' + hex;
                        }
                    });
                    return cleaned;
                };

                const decodedMail = decodeQuotedPrintable(mail);

                // Keep raw content but add literal newlines after <br> tags for readability
                const rawMail = mail.replace(/<br\s*\/?\s*>/gi, '<br>\n');

                // Emails are immutable, cache if found
                res.set('Cache-Control', 'private, max-age=600')
                debug(`Rendering raw email view for UID ${req.params.uid}`)
                res.render('raw', {
                    title: req.params.uid + " | raw | " + req.params.address,
                    mail: rawMail,
                    decoded: decodedMail,
                    totalcount: totalcount
                })
            } else {
                debug(`Raw email ${uid} not found for ${req.params.address}`)
                req.session.errorMessage = 'This mail could not be found. It either does not exist or has been deleted from our servers!'
                res.redirect(`/error/${req.params.address}/404`)
            }
        } catch (error) {
            debug(`Error fetching raw email ${req.params.uid}: ${error.message}`)
            console.error('Error while fetching raw email', error)
            next(error)
        }
    }
)

// POST route for forwarding a single email
router.post(
    '^/:address/:uid/forward',
    forwardLimiter,
    validateDomain,
    checkLockAccess,
    validateForwardRequest,
    async(req, res, next) => {
        try {
            const errors = validationResult(req)
            if (!errors.isEmpty()) {
                const firstError = errors.array()[0].msg
                debug(`Forward validation failed for ${req.params.address}: ${firstError}`)
                req.session.errorMessage = firstError
                return res.redirect(`/inbox/${req.params.address}/${req.params.uid}`)
            }

            const mailProcessingService = req.app.get('mailProcessingService')
            const { destinationEmail } = req.body
            const uid = parseInt(req.params.uid, 10)

            // Check if destination email is verified via signed cookie
            const verifiedEmail = req.signedCookies.verified_email

            if (verifiedEmail && verifiedEmail.toLowerCase() === destinationEmail.toLowerCase()) {
                // Email is verified, proceed with forwarding
                debug(`Forwarding email ${uid} from ${req.params.address} to ${destinationEmail} (verified)`)

                const result = await mailProcessingService.forwardEmail(
                    req.params.address,
                    uid,
                    destinationEmail
                )

                if (result.success) {
                    debug(`Email ${uid} forwarded successfully to ${destinationEmail}`)
                    return res.redirect(`/inbox/${req.params.address}/${uid}?forwarded=true`)
                } else {
                    debug(`Failed to forward email ${uid}: ${result.error}`)
                    req.session.errorMessage = result.error
                    return res.redirect(`/inbox/${req.params.address}/${uid}`)
                }
            } else {
                // Email not verified, initiate verification flow
                debug(`Email ${destinationEmail} not verified, initiating verification`)

                const verificationResult = await mailProcessingService.initiateForwardVerification(
                    req.params.address,
                    destinationEmail, [uid]
                )

                if (verificationResult.success) {
                    debug(`Verification email sent to ${destinationEmail}`)
                    return res.redirect(`/inbox/${req.params.address}/${uid}?verificationSent=true&email=${encodeURIComponent(destinationEmail)}`)
                } else if (verificationResult.cooldownSeconds) {
                    debug(`Verification rate limited for ${destinationEmail}`)
                    req.session.errorMessage = verificationResult.error
                    return res.redirect(`/inbox/${req.params.address}/${uid}`)
                } else {
                    debug(`Failed to send verification email: ${verificationResult.error}`)
                    req.session.errorMessage = verificationResult.error || 'Failed to send verification email'
                    return res.redirect(`/inbox/${req.params.address}/${uid}`)
                }
            }
        } catch (error) {
            debug(`Error forwarding email ${req.params.uid}: ${error.message}`)
            console.error('Error while forwarding email', error)
            req.session.errorMessage = 'An unexpected error occurred while forwarding the email.'
            res.redirect(`/inbox/${req.params.address}/${req.params.uid}`)
        }
    }
)

// POST route for forwarding all emails in an inbox
router.post(
    '^/:address/forward-all',
    forwardLimiter,
    validateDomain,
    checkLockAccess,
    validateForwardRequest,
    async(req, res, next) => {
        try {
            const validationErrors = validationResult(req)
            if (!validationErrors.isEmpty()) {
                const firstError = validationErrors.array()[0].msg
                debug(`Forward all validation failed for ${req.params.address}: ${firstError}`)
                req.session.errorMessage = firstError
                return res.redirect(`/inbox/${req.params.address}`)
            }

            const mailProcessingService = req.app.get('mailProcessingService')
            const { destinationEmail } = req.body

            // Check if destination email is verified via signed cookie
            const verifiedEmail = req.signedCookies.verified_email

            if (!verifiedEmail || verifiedEmail.toLowerCase() !== destinationEmail.toLowerCase()) {
                // Email not verified, initiate verification flow
                debug(`Email ${destinationEmail} not verified, initiating verification for forward-all`)

                const mailSummaries = await mailProcessingService.getMailSummaries(req.params.address)
                const uids = mailSummaries.map(m => m.uid)

                const verificationResult = await mailProcessingService.initiateForwardVerification(
                    req.params.address,
                    destinationEmail,
                    uids
                )

                if (verificationResult.success) {
                    debug(`Verification email sent to ${destinationEmail}`)
                    return res.redirect(`/inbox/${req.params.address}?verificationSent=true&email=${encodeURIComponent(destinationEmail)}`)
                } else if (verificationResult.cooldownSeconds) {
                    debug(`Verification rate limited for ${destinationEmail}`)
                    req.session.errorMessage = verificationResult.error
                    return res.redirect(`/inbox/${req.params.address}`)
                } else {
                    debug(`Failed to send verification email: ${verificationResult.error}`)
                    req.session.errorMessage = verificationResult.error || 'Failed to send verification email'
                    return res.redirect(`/inbox/${req.params.address}`)
                }
            }

            // Email is verified, proceed with bulk forwarding
            debug(`Forwarding all emails from ${req.params.address} to ${destinationEmail} (verified)`)

            const mailSummaries = await mailProcessingService.getMailSummaries(req.params.address)

            // Limit bulk forwarding to 25 emails
            const MAX_FORWARD_ALL = 25
            if (mailSummaries.length > MAX_FORWARD_ALL) {
                debug(`Forward all blocked: ${mailSummaries.length} emails exceeds limit of ${MAX_FORWARD_ALL}`)
                req.session.errorMessage = `Cannot forward more than ${MAX_FORWARD_ALL} emails at once. You have ${mailSummaries.length} emails.`
                return res.redirect(`/inbox/${req.params.address}`)
            }

            if (mailSummaries.length === 0) {
                debug(`No emails to forward for ${req.params.address}`)
                req.session.errorMessage = 'No emails to forward.'
                return res.redirect(`/inbox/${req.params.address}`)
            }

            let successCount = 0
            let failCount = 0
            const failMessages = []

            for (const mail of mailSummaries) {
                const result = await mailProcessingService.forwardEmail(
                    req.params.address,
                    mail.uid,
                    destinationEmail
                )

                if (result.success) {
                    successCount++
                    debug(`Successfully forwarded email UID ${mail.uid}`)
                } else {
                    failCount++
                    debug(`Failed to forward email UID ${mail.uid}: ${result.error}`)
                    failMessages.push(`UID ${mail.uid}: ${result.error}`)
                }
            }

            debug(`Forward all complete: ${successCount} succeeded, ${failCount} failed`)

            if (successCount > 0 && failCount === 0) {
                return res.redirect(`/inbox/${req.params.address}?forwardedAll=${successCount}`)
            } else if (successCount > 0 && failCount > 0) {
                req.session.errorMessage = `Forwarded ${successCount} email(s), but ${failCount} failed.`
                return res.redirect(`/inbox/${req.params.address}`)
            } else {
                req.session.errorMessage = `Failed to forward emails: ${failMessages[0] || 'Unknown error'}`
                return res.redirect(`/inbox/${req.params.address}`)
            }
        } catch (error) {
            debug(`Error forwarding all emails: ${error.message}`)
            console.error('Error while forwarding all emails', error)
            req.session.errorMessage = 'An unexpected error occurred while forwarding emails.'
            res.redirect(`/inbox/${req.params.address}`)
        }
    }
)

// Final catch-all for invalid UIDs (non-numeric or unmatched patterns)
router.get(
    '^/:address/:uid',
    sanitizeAddress,
    validateDomain,
    async(req, res) => {
        req.session.errorMessage = 'Invalid/Malformed UID provided.'
        res.redirect(`/error/${req.params.address}/400`)
    }
)

// GET route for email verification (token verification)
router.get('/verify', async(req, res, next) => {
    try {
        const { token } = req.query

        if (!token) {
            debug('Verification attempt without token')
            req.session.errorMessage = 'Verification token is required'
            return res.redirect('/')
        }

        const verificationStore = req.app.get('verificationStore')
        if (!verificationStore) {
            debug('Verification store not available')
            req.session.errorMessage = 'Email verification is not configured'
            return res.redirect('/')
        }

        // Verify the token
        const verification = verificationStore.verifyToken(token)

        if (!verification) {
            debug(`Invalid or expired verification token: ${token}`)
            req.session.errorMessage = 'This verification link is invalid or has expired. Please request a new verification email.'
            return res.redirect('/')
        }

        // Token is valid, set signed cookie
        const destinationEmail = verification.destinationEmail
        const cookieMaxAge = 24 * 60 * 60 * 1000 // 24 hours in milliseconds

        res.cookie('verified_email', destinationEmail, {
            maxAge: cookieMaxAge,
            httpOnly: true,
            signed: true,
            sameSite: 'lax'
        })

        debug(`Email ${destinationEmail} verified successfully, cookie set for 24 hours`)

        // Redirect to success page
        return res.redirect(`/inbox/verify-success?email=${encodeURIComponent(destinationEmail)}`)
    } catch (error) {
        debug(`Error during verification: ${error.message}`)
        console.error('Error during email verification', error)
        req.session.errorMessage = 'An error occurred during verification'
        res.redirect('/')
    }
})

// GET route for verification success page
router.get('/verify-success', async(req, res) => {
    const { email } = req.query

    if (!email) {
        return res.redirect('/')
    }

    const config = req.app.get('config')
    const mailProcessingService = req.app.get('mailProcessingService')
    const count = await mailProcessingService.getCount()
    const largestUid = await req.app.locals.imapService.getLargestUid()
    const totalcount = helper.countElementBuilder(count, largestUid)

    res.render('verify-success', {
        title: `Email Verified | ${config.http.branding[0]}`,
        email: email,
        branding: config.http.branding,
        purgeTime: purgeTime,
        totalcount: totalcount
    })
})


module.exports = router
