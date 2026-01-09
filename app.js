#!/usr/bin/env node

/* eslint unicorn/no-process-exit: 0 */

// Check .env file permissions before loading config
const fs = require('fs')
const path = require('path')
const envPath = path.resolve('.env')
if (fs.existsSync(envPath)) {
    const mode = fs.statSync(envPath).mode
    const perms = (mode & parseInt('777', 8)).toString(8)
    const groupReadable = parseInt(perms[1], 10) >= 4
    const otherReadable = parseInt(perms[2], 10) >= 4
    if (groupReadable || otherReadable) {
        console.error(`\nSECURITY ERROR: .env file has insecure permissions (${perms})`)
        console.error(`Run: chmod 600 ${envPath}\n`)
        process.exit(1)
    }
}

const config = require('./application/config-service')
const debug = require('debug')('48hr-email:app')
const Helper = require('./application/helper-service')
const helper = new(Helper)
const { app, io, server } = require('./infrastructure/web/web')
const ClientNotification = require('./infrastructure/web/client-notification')
const ImapService = require('./application/imap-service')
const MockMailService = require('./application/mocks/mock-mail-service')
const MailProcessingService = require('./application/mail-processing-service')
const SmtpService = require('./application/smtp-service')
const AuthService = require('./application/auth-service')
const MockAuthService = require('./application/mocks/mock-auth-service')
const MailRepository = require('./domain/mail-repository')
const InboxLock = require('./domain/inbox-lock')
const MockInboxLock = require('./application/mocks/mock-inbox-lock')
const VerificationStore = require('./domain/verification-store')
const UserRepository = require('./domain/user-repository')
const MockUserRepository = require('./application/mocks/mock-user-repository')
const StatisticsStore = require('./domain/statistics-store')
const ApiTokenRepository = require('./domain/api-token-repository')

const clientNotification = new ClientNotification()
debug('Client notification service initialized')
clientNotification.use(io)

// Initialize SMTP service only if not in UX debug mode
const smtpService = config.uxDebugMode ? null : new SmtpService(config)
if (smtpService) {
    debug('SMTP service initialized')
} else {
    debug('SMTP service disabled (UX debug mode)')
}
app.set('smtpService', smtpService)

const verificationStore = new VerificationStore()
debug('Verification store initialized')
app.set('verificationStore', verificationStore)

// Set config in app for route access
app.set('config', config)

// Initialize user repository and auth service (if enabled)
let inboxLock = null
let statisticsStore = null
let apiTokenRepository = null

if (config.user.authEnabled && !config.uxDebugMode) {
    // Migrate legacy database files for backwards compatibility
    Helper.migrateDatabase(config.user.databasePath)

    const userRepository = new UserRepository(config.user.databasePath)
    debug('User repository initialized')
    app.set('userRepository', userRepository)

    // Initialize API token repository with same database connection
    apiTokenRepository = new ApiTokenRepository(userRepository.db)
    debug('API token repository initialized')
    app.set('apiTokenRepository', apiTokenRepository)

    // Initialize statistics store with database connection
    statisticsStore = new StatisticsStore(userRepository.db)
    debug('Statistics store initialized with database persistence')
    app.set('statisticsStore', statisticsStore)

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
} else {
    // No auth enabled OR UX debug mode - initialize statistics store without persistence
    statisticsStore = new StatisticsStore()
    if (config.uxDebugMode) {
        debug('Statistics store initialized (UX debug mode - clean slate)')

        // In UX debug mode, create mock auth system
        const mockUserRepository = new MockUserRepository(config)
        debug('Mock user repository initialized')
        app.set('userRepository', mockUserRepository)

        const mockAuthService = new MockAuthService()
        debug('Mock auth service initialized')
        app.set('authService', mockAuthService)

        inboxLock = new MockInboxLock(mockUserRepository)
        app.set('inboxLock', inboxLock)
        debug('Mock inbox lock service initialized')

        debug('Mock authentication system enabled for UX debug mode')
    } else {
        debug('Statistics store initialized (in-memory only, no database)')
        app.set('userRepository', null)
        app.set('apiTokenRepository', null)
        app.set('authService', null)
        app.set('inboxLock', null)
        debug('User authentication system disabled')
    }
    app.set('statisticsStore', statisticsStore)

    if (!config.uxDebugMode) {
        debug('User authentication system disabled')
    }
}

// Initialize IMAP or Mock service based on debug mode
const imapService = config.uxDebugMode ?
    new MockMailService(config) :
    new ImapService(config, inboxLock)

if (config.uxDebugMode) {
    debug('Mock Mail Service initialized (UX Debug Mode)')
} else {
    debug('IMAP service initialized')
}
app.set('imapService', imapService)

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
imapService.on(ImapService.EVENT_INITIAL_LOAD_DONE, async() => {
    // In UX debug mode, populate mock emails first
    if (config.uxDebugMode) {
        // Load mock emails into repository
        const mockEmails = imapService.getMockEmails()
        mockEmails.forEach(({ mail }) => {
            mailProcessingService.onNewMail(mail)
        })
        debug(`UX Debug Mode: Loaded ${mockEmails.length} mock emails`)
    }

    // Then initialize statistics with the correct count
    const count = mailProcessingService.getCount()
    statisticsStore.initialize(count)

    if (config.uxDebugMode) {
        statisticsStore.updateLargestUid(2) // 2 mock emails
        debug(`UX Debug Mode: Statistics initialized with ${count} emails, largest UID: 2`)
    } else {
        // Get and set the largest UID for all-time total
        const largestUid = await helper.getLargestUid(imapService)
        statisticsStore.updateLargestUid(largestUid)
        debug(`Statistics initialized with ${count} emails, largest UID: ${largestUid}`)
    }
})

// Set up timer sync broadcasting after IMAP is ready
imapService.on(ImapService.EVENT_INITIAL_LOAD_DONE, () => {
    clientNotification.startTimerSync(imapService)
})

// Display startup banner when everything is ready
let imapReady = false
let serverReady = false

function displayStartupBanner() {
    if (!imapReady || !serverReady) return

    const mailCount = mailProcessingService.getCount()
    const domains = config.email.domains.join(', ')
    const purgeTime = `${config.email.purgeTime.time} ${config.email.purgeTime.unit}`
    const refreshInterval = config.uxDebugMode ? 'N/A' : `${config.imap.refreshIntervalSeconds}s`
    const branding = config.http.features.branding[0] || '48hr.email'
    const baseUrl = config.http.baseUrl

    // Determine mode based on environment
    let mode = 'PRODUCTION'
    if (config.uxDebugMode) {
        mode = 'UX DEBUG'
    } else if (process.env.DEBUG) {
        mode = 'DEBUG'
    }

    console.log('\n' + '═'.repeat(70))
    console.log(`  ${branding} - ${mode} MODE`)
    console.log('═'.repeat(70))
    console.log(`  Server:          ${baseUrl}`)
    console.log(`  Domains:         ${domains}`)
    console.log(`  Emails loaded:   ${mailCount}`)
    console.log(`  Purge after:     ${purgeTime}`)
    console.log(`  IMAP refresh:    ${refreshInterval}`)

    if (!config.uxDebugMode && config.email.examples.account && config.email.examples.uids) {
        console.log(`  Example inbox:   ${config.email.examples.account}`)
        console.log(`  Example UIDs:    ${config.email.examples.uids.join(', ')}`)
    }

    if (config.uxDebugMode) {
        console.log(`  Authentication:  Mock (any username/password works)`)
        const mockUserRepo = app.get('userRepository')
        if (mockUserRepo) {
            console.log(`  Demo forward:    ${mockUserRepo.mockForwardEmail}`)
            console.log(`  Demo locked:     ${mockUserRepo.mockLockedInbox}`)
        }
    } else if (config.user.authEnabled) {
        console.log(`  Authentication:  Enabled`)
    }

    if (config.http.features.statistics) {
        console.log(`  Statistics:      Enabled`)
    }

    console.log('═'.repeat(70))
    console.log(`  Ready! Press Ctrl+C to stop\n`)
}

imapService.on(ImapService.EVENT_INITIAL_LOAD_DONE, () => {
    imapReady = true
    displayStartupBanner()
})

server.on('ready', () => {
    serverReady = true
    displayStartupBanner()
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
    if (!config.uxDebugMode) {
        process.exit(1)
    }
})

imapService.on(ImapService.EVENT_ERROR, error => {
    debug('Fatal error from IMAP service:', error.message)
    console.error('Fatal error from IMAP service', error)
    if (!config.uxDebugMode) {
        process.exit(1)
    }
})

app.set('mailProcessingService', mailProcessingService)
app.set('config', config)

app.locals.imapService = imapService
app.locals.mailProcessingService = mailProcessingService

if (config.uxDebugMode) {
    debug('Starting Mock Mail Service (UX Debug Mode)')
} else {
    debug('Starting IMAP connection and message loading')
}

imapService.connectAndLoadMessages().catch(error => {
    debug('Failed to connect:', error.message)
    console.error('Fatal error from mail service', error)
    if (!config.uxDebugMode) {
        process.exit(1)
    }
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
