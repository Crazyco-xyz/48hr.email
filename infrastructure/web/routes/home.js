const express = require('express')
const router = new express.Router()
const { check, validationResult } = require('express-validator')
const debug = require('debug')('48hr-email:routes')
const randomWord = require('random-word')
const config = require('../../../application/config')
const templateContext = require('../template-context')

router.get('/', async(req, res, next) => {
    try {
        const mailProcessingService = req.app.get('mailProcessingService')
        if (!mailProcessingService) {
            throw new Error('Mail processing service not available')
        }
        debug('Home page requested')
        const context = templateContext.build(req, {
            username: randomWord()
        })
        res.render('home', {
            ...context,
            title: `${context.branding[0]} | Your temporary Inbox`
        })
    } catch (error) {
        debug('Error loading home page:', error.message)
        console.error('Error while loading home page', error)
        next(error)
    }
})

router.get('/inbox/random', (req, res, _next) => {
    const randomDomain = config.email.domains[Math.floor(Math.random() * config.email.domains.length)]
    const inbox = `${randomWord()}@${randomDomain}`
    debug(`Generated random inbox: ${inbox}`)
    res.redirect(`/inbox/${inbox}`)
})

// Legacy logout route removed - handled by auth.js

router.post(
    '/', [
        check('username').isLength({ min: 1 }),
        check('domain').isIn(config.email.domains)
    ],
    async(req, res, next) => {
        try {
            const mailProcessingService = req.app.get('mailProcessingService')
            if (!mailProcessingService) {
                throw new Error('Mail processing service not available')
            }
            const errors = validationResult(req)
            if (!errors.isEmpty()) {
                debug(`Home validation failed for ${req.body.username}@${req.body.domain}: ${errors.array().map(e => e.msg).join(', ')}`)
                const context = templateContext.build(req, {
                    userInputError: true,
                    username: randomWord()
                })
                return res.render('home', {
                    ...context,
                    title: `${context.branding[0]} | Your temporary Inbox`
                })
            }

            const inbox = `${req.body.username}@${req.body.domain}`
            debug(`Home validation successful, redirecting to inbox: ${inbox}`)
            res.redirect(`/inbox/${inbox}`)
        } catch (error) {
            debug('Error processing request:', error.message)
            console.error('Error while processing request', error)
            next(error)
        }
    }
)

module.exports = router