const express = require('express')
const router = new express.Router()
const { check, validationResult } = require('express-validator')
const debug = require('debug')('48hr-email:routes')

const randomWord = require('random-word')
const config = require('../../../application/config')
const Helper = require('../../../application/helper')
const helper = new(Helper)

const purgeTime = helper.purgeTimeElemetBuilder()

router.get('/', async(req, res, next) => {
    try {
        const mailProcessingService = req.app.get('mailProcessingService')
        if (!mailProcessingService) {
            throw new Error('Mail processing service not available')
        }
        debug('Login page requested')
        res.render('login', {
            title: `${config.http.branding[0]} | Your temporary Inbox`,
            username: randomWord(),
            purgeTime: purgeTime,
            domains: helper.getDomains(),
            branding: config.http.branding,
            example: config.email.examples.account,
        })
    } catch (error) {
        debug('Error loading login page:', error.message)
        console.error('Error while loading login page', error)
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
                debug(`Login validation failed for ${req.body.username}@${req.body.domain}: ${errors.array().map(e => e.msg).join(', ')}`)
                return res.render('login', {
                    userInputError: true,
                    title: `${config.http.branding[0]} | Your temporary Inbox`,
                    purgeTime: purgeTime,
                    username: randomWord(),
                    domains: helper.getDomains(),
                    branding: config.http.branding,
                })
            }

            const inbox = `${req.body.username}@${req.body.domain}`
            debug(`Login successful, redirecting to inbox: ${inbox}`)
            res.redirect(`/inbox/${inbox}`)
        } catch (error) {
            debug('Error processing login:', error.message)
            console.error('Error while processing login', error)
            next(error)
        }
    }
)

module.exports = router
