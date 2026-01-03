#!/usr/bin/env node

/* eslint unicorn/no-process-exit: 0 */

const config = require('./application/config')
const debug = require('debug')('48hr-email:app')
const Helper = require('./application/helper')

const { app, io, server } = require('./infrastructure/web/web')
const ClientNotification = require('./infrastructure/web/client-notification')
const ImapService = require('./application/imap-service')
const MailProcessingService = require('./application/mail-processing-service')
const SmtpService = require('./application/smtp-service')
const AuthService = require('./application/auth-service')
const MailRepository = require('./domain/mail-repository')
const InboxLock = require('./domain/inbox-lock')
const VerificationStore = require('./domain/verification-store')
const UserRepository = require('./domain/user-repository')
const StatisticsStore = require('./domain/statistics-store')

const clientNotification = new ClientNotification()
debug('Client notification service initialized')
clientNotification.use(io)

const smtpService = new SmtpService(config)
debug('SMTP service initialized')
app.set('smtpService', smtpService)

const verificationStore = new VerificationStore()
debug('Verification store initialized')
app.set('verificationStore', verificationStore)

const statisticsStore = new StatisticsStore()
debug('Statistics store initialized')
app.set('statisticsStore', statisticsStore)

// Set config in app for route access
app.set('config', config)

// Initialize user repository and auth service (if enabled)
let inboxLock = null
if (config.user.authEnabled) {
    // Migrate legacy database files for backwards compatibility
    Helper.migrateDatabase(config.user.databasePath)

    const userRepository = new UserRepository(config.user.databasePath)
    debug('User repository initialized')
    app.set('userRepository', userRepository)

    const authService = new AuthService(userRepository, config)
    debug('Auth service initialized')
    app.set('authService', authService)

    // Initialize inbox locking with user repository
    inboxLock = new InboxLock(userRepository)
    app.set('inboxLock', inboxLock)
    debug('Inbox lock service initialized (user-based)')

    // Check for inactive locked inboxes (users who haven't logged in for 7 days)
    setInterval(() => {
        const inactive = inboxLock.getInactive(config.user.lockReleaseHours)
        if (inactive.length > 0) {
            debug(`Auto-releasing ${inactive.length} locked inbox(es) due to user inactivity (${config.user.lockReleaseHours} hours without login)`)
            inactive.forEach(lock => {
                try {
                    inboxLock.release(lock.userId, lock.address)
                    debug(`Released lock on ${lock.address} for inactive user ${lock.userId}`)
                } catch (error) {
                    debug(`Failed to release lock on ${lock.address}: ${error.message}`)
                }
            })
        }
    }, config.imap.refreshIntervalSeconds * 1000)

    console.log('User authentication system enabled')
} else {
    app.set('userRepository', null)
    app.set('authService', null)
    app.set('inboxLock', null)
    debug('User authentication system disabled')
}

const imapService = new ImapService(config, inboxLock)
debug('IMAP service initialized')

const mailProcessingService = new MailProcessingService(
    new MailRepository(),
    imapService,
    clientNotification,
    config,
    smtpService,
    verificationStore,
    statisticsStore
)
debug('Mail processing service initialized')

// Initialize statistics with current count
imapService.on(ImapService.EVENT_INITIAL_LOAD_DONE, () => {
    const count = mailProcessingService.getCount()
    statisticsStore.initialize(count)
    debug(`Statistics initialized with ${count} emails`)
})

// Set up timer sync broadcasting after IMAP is ready
imapService.on(ImapService.EVENT_INITIAL_LOAD_DONE, () => {
    clientNotification.startTimerSync(imapService)
})

// Track IMAP initialization state
let isImapReady = false
app.set('isImapReady', false)

// Put everything together:
imapService.on(ImapService.EVENT_NEW_MAIL, mail =>
    mailProcessingService.onNewMail(mail)
)
debug('Bound IMAP new mail event handler')
imapService.on(ImapService.EVENT_INITIAL_LOAD_DONE, () => {
    mailProcessingService.onInitialLoadDone()
    isImapReady = true
    app.set('isImapReady', true)
})
debug('Bound IMAP initial load done event handler')
imapService.on(ImapService.EVENT_DELETED_MAIL, mail =>
    mailProcessingService.onMailDeleted(mail)
)
debug('Bound IMAP deleted mail event handler')

mailProcessingService.on('error', err => {
    debug('Fatal error from mail processing service:', err.message)
    console.error('Error from mailProcessingService, stopping.', err)
    process.exit(1)
})

imapService.on(ImapService.EVENT_ERROR, error => {
    debug('Fatal error from IMAP service:', error.message)
    console.error('Fatal error from IMAP service', error)
    process.exit(1)
})

app.set('mailProcessingService', mailProcessingService)
app.set('config', config)

app.locals.imapService = imapService
app.locals.mailProcessingService = mailProcessingService

debug('Starting IMAP connection and message loading')
imapService.connectAndLoadMessages().catch(error => {
    debug('Failed to connect to IMAP:', error.message)
    console.error('Fatal error from IMAP service', error)
    process.exit(1)
})

server.on('error', error => {
    if (error.syscall !== 'listen') {
        console.error('Fatal web server error', error)
        return
    }

    // Handle specific listen errors with friendly messages
    switch (error.code) {
        case 'EACCES':
            console.error(
                'Port ' + config.http.port + ' requires elevated privileges'
            )
            process.exit(1)
        case 'EADDRINUSE':
            console.error('Port ' + config.http.port + ' is already in use')
            process.exit(1)
        default:
            console.error('Fatal web server error', error)
            process.exit(1)
    }
})
