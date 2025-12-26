#!/usr/bin/env node

/* eslint unicorn/no-process-exit: 0 */

const config = require('./application/config')
const debug = require('debug')('48hr-email:app')

// Until node 11 adds flatmap, we use this:
require('array.prototype.flatmap').shim()

const { app, io, server } = require('./infrastructure/web/web')
const ClientNotification = require('./infrastructure/web/client-notification')
const ImapService = require('./application/imap-service')
const MailProcessingService = require('./application/mail-processing-service')
const MailRepository = require('./domain/mail-repository')
const InboxLock = require('./domain/inbox-lock')

const clientNotification = new ClientNotification()
debug('Client notification service initialized')
clientNotification.use(io)

const imapService = new ImapService(config)
debug('IMAP service initialized')
const mailProcessingService = new MailProcessingService(
    new MailRepository(),
    imapService,
    clientNotification,
    config
)
debug('Mail processing service initialized')

// Put everything together:
imapService.on(ImapService.EVENT_NEW_MAIL, mail =>
    mailProcessingService.onNewMail(mail)
)
debug('Bound IMAP new mail event handler')
imapService.on(ImapService.EVENT_INITIAL_LOAD_DONE, () =>
    mailProcessingService.onInitialLoadDone()
)
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

// Initialize inbox locking if enabled
if (config.lock.enabled) {
    const inboxLock = new InboxLock(config.lock.dbPath)
    app.set('inboxLock', inboxLock)
    console.log(`Inbox locking enabled (auto-release after ${config.lock.releaseHours} hours)`)

    // Check for inactive locked inboxes
    setInterval(() => {
        const inactive = inboxLock.getInactive(config.lock.releaseHours)
        if (inactive.length > 0) {
            console.log(`Releasing ${inactive.length} inactive locked inbox(es)`)
            inactive.forEach(address => inboxLock.release(address))
        }
    }, config.imap.refreshIntervalSeconds * 1000)
}

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
