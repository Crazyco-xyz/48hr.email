const path = require('path')
const http = require('http')
const debug = require('debug')('48hr-email:server')
const express = require('express')
const session = require('express-session')
const logger = require('morgan')
const Twig = require('twig')
const compression = require('compression')
const helmet = require('helmet')
const socketio = require('socket.io')

const config = require('../../application/config')
const inboxRouter = require('./routes/inbox')
const loginRouter = require('./routes/login')
const errorRouter = require('./routes/error')
const lockRouter = require('./routes/lock')
const { sanitizeHtmlTwigFilter } = require('./views/twig-filters')

const Helper = require('../../application/helper')
const helper = new(Helper)
const purgeTime = helper.purgeTimeElemetBuilder()

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
app.use(logger('dev'))
app.use(express.json())
app.use(express.urlencoded({ extended: false }))

// Session support for inbox locking
if (config.lock.enabled) {
    const session = require('express-session')
    app.use(session({
        secret: config.lock.sessionSecret,
        resave: false,
        saveUninitialized: false,
        cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24 hours
    }))
}

// Clear session when user goes Home so locked inboxes require password again
app.get('/', (req, res, next) => {
    if (config.lock.enabled && req.session) {
        req.session.destroy(() => next())
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

app.use('/', loginRouter)
app.use('/inbox', inboxRouter)
app.use('/error', errorRouter)
if (config.lock.enabled) {
    app.use('/lock', lockRouter)
}

// Catch 404 and forward to error handler
app.use((req, res, next) => {
    next({ message: 'Page not found', status: 404 })
})

// Error handler
app.use(async(err, req, res, _next) => {
    try {
        debug('Error handler triggered:', err.message)
        const mailProcessingService = req.app.get('mailProcessingService')
        const count = await mailProcessingService.getCount()

        // Set locals, only providing error in development
        res.locals.message = err.message
        res.locals.error = req.app.get('env') === 'development' ? err : {}

        // Render the error page
        res.status(err.status || 500)
        res.render('error', {
            purgeTime: purgeTime,
            address: req.params && req.params.address,
            count: count,
            branding: config.http.branding
        })
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
})

module.exports = { app, io, server }