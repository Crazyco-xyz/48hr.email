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
const { sanitizeHtmlTwigFilter } = require('./views/twig-filters')

const Helper = require('../../application/helper')
const helper = new(Helper)
const purgeTime = helper.purgeTimeElemetBuilder()

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

// Session middleware
app.use(session({
    secret: '1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ', // They will hate me for this
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 1000 * 60 * 60 * 24 } // 24 hours
}))

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

/**
app.get('/', (req, res, _next) => {
	res.redirect('/login')
})
**/

app.use('/', loginRouter)
app.use('/inbox', inboxRouter)
app.use('/error', errorRouter)

// Catch 404 and forward to error handler
app.use((req, res, next) => {
    next({ message: 'Page not found', status: 404 })
})

// Error handler
app.use(async(err, req, res, _next) => {
    const mailProcessingService = req.app.get('mailProcessingService')
    const count = await mailProcessingService.getCount()

    // Set locals, only providing error in development
    res.locals.message = err.message
    res.locals.error = req.app.get('env') === 'development' ? err : {}

    // Render the error page
    res.status(err.status || 500)
    res.render('error', {
        purgeTime: purgeTime,
        address: req.params.address,
        count: count,
        branding: config.http.branding

    })
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
