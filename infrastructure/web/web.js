const botDetect = require('./middleware/bot-detect')
const path = require('path')
const http = require('http')
const debug = require('debug')('48hr-email:server')
const express = require('express')
const session = require('express-session')
const cookieParser = require('cookie-parser')
const logger = require('morgan')
const Twig = require('twig')
const compression = require('compression')
const helmet = require('helmet')
const socketio = require('socket.io')

const config = require('../../application/config-service')
const createApiRouter = require('./api/router')
const inboxRouter = require('./routes/inbox')
const homeRouter = require('./routes/home')
const errorRouter = require('./routes/error')
const lockRouter = require('./routes/lock')
const authRouter = require('./routes/auth')
const accountRouter = require('./routes/account')
const statsRouter = require('./routes/stats')
const templateContext = require('./template-context')
const { sanitizeHtmlTwigFilter, readablePurgeTime } = require('./views/twig-filters')

// Utility function for consistent error handling in routes
const handleRouteError = (error, req, res, next, context = 'route') => {
    debug(`Error in ${context}:`, error.message)
    console.error(`Error in ${context}`, error)
    next(error)
}

// Init express middleware
const app = express()
app.use(helmet())
app.use(compression())
app.set('config', config)
const server = http.createServer(app)
const io = socketio(server)

app.set('socketio', io)

// HTTP request logging - only enable with DEBUG environment variable
if (process.env.DEBUG && process.env.DEBUG.includes('48hr-email')) {
    app.use(logger('dev'))
}

app.use(express.json())
app.use(express.urlencoded({ extended: false }))

// Cookie parser for signed cookies (email verification)
app.use(cookieParser(config.http.sessionSecret))

// Session support (always enabled for forward verification and inbox locking)
app.use(session({
    secret: config.http.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24 hours
}))



// Bot detection middleware (after cookies/session, before routes)
app.use(botDetect)

// If bot detected and not suppressed, render only the popup page and halt further processing
app.use((req, res, next) => {
    // Allow static assets (css, js, images, favicon, etc) and all /api/* routes even if bot detected
    if (res.locals.suspectedBot && !(req.cookies && req.cookies.bot_check_passed)) {
        const asset = req.path.match(/\.(css|js|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot)$/i);
        if (asset) return next();
        if (req.path.startsWith('/api/')) return next();
        // For non-asset, non-API requests, render only the popup page
        return res.status(200).render('bot-popup');
    }
    next();
});

// Clear lock session data when user goes Home (but preserve authentication)
app.get('/', (req, res, next) => {
    if (req.session && req.session.lockedInbox) {
        // Only clear lock-related data, preserve user authentication
        delete req.session.lockedInbox
        req.session.save(() => next())
    } else {
        next()
    }
})

// Remove trailing slash middleware (except for root)
app.use((req, res, next) => {
    if (req.path.length > 1 && req.path.endsWith('/')) {
        const query = req.url.slice(req.path.length) // preserve query string
        return res.redirect(301, req.path.slice(0, -1) + query)
    }
    next()
})

// View engine setup
app.set('views', path.join(__dirname, 'views'))
app.set('view engine', 'twig')
app.set('twig options', {
    autoescape: true
})

// Application code:
app.use(
    express.static(path.join(__dirname, 'public'), {
        immutable: true,
        maxAge: '1h'
    })
)
Twig.extendFilter('sanitizeHtml', sanitizeHtmlTwigFilter)
Twig.extendFilter('readablePurgeTime', readablePurgeTime)

// Middleware to expose user session to all templates
app.use((req, res, next) => {
    res.locals.authEnabled = config.user.authEnabled
    res.locals.config = config
    res.locals.currentUser = null
    res.locals.alertMessage = req.session ? req.session.alertMessage : null

    // Clear alert after reading
    if (req.session && req.session.alertMessage) {
        delete req.session.alertMessage
    }

    if (req.session && req.session.userId && req.session.username && req.session.isAuthenticated) {
        res.locals.currentUser = {
            id: req.session.userId,
            username: req.session.username
        }
    }
    next()
})

// Middleware to expose mail count to all templates
app.use(async(req, res, next) => {
    const mailProcessingService = req.app.get('mailProcessingService')
    const imapService = req.app.get('imapService')
    const Helper = require('../../application/helper-service')
    const helper = new Helper()

    if (mailProcessingService) {
        const count = mailProcessingService.getCount()
        let largestUid = null

        if (imapService) {
            try {
                largestUid = await imapService.getLargestUid()
            } catch (e) {
                debug('Error getting largest UID:', e.message)
            }
        }

        res.locals.mailCount = helper.mailCountBuilder(count, largestUid)
    } else {
        res.locals.mailCount = ''
    }
    next()
})

// Middleware to show loading page until IMAP is ready
app.use((req, res, next) => {
    const isImapReady = req.app.get('isImapReady')
    if (!isImapReady && !req.path.startsWith('/images') && !req.path.startsWith('/javascripts') && !req.path.startsWith('/stylesheets') && !req.path.startsWith('/dependencies')) {
        return res.render('loading', templateContext.build(req, {
            title: 'Loading...'
        }))
    }
    next()
})

// Redirect /api/* to /api/v1/* if version is missing
app.use((req, res, next) => {
    // Only match /api/ (not /api/v1/ or /api/v2/ etc.)
    const apiMatch = req.path.match(/^\/api\/(?!v\d+\/)([^/?#]+)(.*)/)
    if (apiMatch) {
        // Redirect to latest stable version (v1)
        const rest = apiMatch[1] + (apiMatch[2] || '')
        return res.redirect(307, `/api/v1/${rest}`)
    }
    next()
})

// Mount API router (v1)
app.use('/api/v1', (req, res, next) => {
    const apiTokenRepository = req.app.get('apiTokenRepository')
    const dependencies = {
        apiTokenRepository,
        mailProcessingService: req.app.get('mailProcessingService'),
        authService: req.app.get('authService'),
        userRepository: req.app.get('userRepository'),
        imapService: req.app.get('imapService'),
        inboxLock: req.app.get('inboxLock'),
        statisticsStore: req.app.get('statisticsStore'),
        smtpService: req.app.get('smtpService'),
        verificationStore: req.app.get('verificationStore'),
        config: req.app.get('config')
    }
    const apiRouter = createApiRouter(dependencies)
    apiRouter(req, res, next)
})

// Web routes
app.use('/', homeRouter)
if (config.user.authEnabled) {
    app.use('/', authRouter)
    app.use('/', accountRouter)
}
app.use('/inbox', inboxRouter)
app.use('/error', errorRouter)
app.use('/lock', lockRouter)
app.use('/stats', statsRouter)

// Catch 404 and forward to error handler
app.use((req, res, next) => {
    next({ message: 'Page not found', status: 404 })
})

// Error handler
app.use(async(err, req, res, _next) => {
    try {
        debug('Error handler triggered:', err.message)

        // Set locals, only providing error in development
        res.locals.message = err.message
        res.locals.error = req.app.get('env') === 'development' ? err : {}

        // Render the error page
        res.status(err.status || 500)
        res.render('error', templateContext.build(req, {
            title: 'Error',
            message: err.message,
            status: err.status || 500
        }))
    } catch (renderError) {
        debug('Error in error handler:', renderError.message)
        console.error('Critical error in error handler', renderError)
            // Fallback: send plain text error if rendering fails
        res.status(500).send('Internal Server Error')
    }
})

/**
 * Get port from environment and store in Express.
 */

app.set('port', config.http.port)

/**
 * Listen on provided port, on all network interfaces.
 */
server.listen(config.http.port)
server.on('listening', () => {
    const addr = server.address()
    const bind = typeof addr === 'string' ? 'pipe ' + addr : 'port ' + addr.port
    debug('Listening on ' + bind)

    // Emit event for app.js to display startup banner
    server.emit('ready')
})

module.exports = { app, io, server }