const express = require('express')
const router = new express.Router()
const { check, validationResult } = require('express-validator')

const randomWord = require('random-word')
const config = require('../../../application/config')
const Helper = require('../../../application/helper')
const helper = new(Helper)

const purgeTime = helper.purgeTimeElemetBuilder()

router.get('/', async(req, res, _next) => {
    const count = await req.app.get('mailProcessingService').getCount()
    res.render('login', {
        title: `${config.http.branding[0]} | Your temporary Inbox`,
        username: randomWord(),
        purgeTime: purgeTime,
        domains: helper.getDomains(),
        count: count,
        branding: config.http.branding,
        example: config.email.examples.account,
    })
})

router.get('/inbox/random', (req, res, _next) => {
    res.redirect(`/inbox/${randomWord()}@${config.email.domains[Math.floor(Math.random() * config.email.domains.length)]}`)
})

router.get('/logout', (req, res, _next) => {

    /**
     * If we ever need a logout sequence, now we can have one!
     */

    res.redirect('/')
})

router.post(
    '/', [
        check('username').isLength({ min: 1 }),
        check('domain').isIn(config.email.domains)
    ],
    async(req, res) => {
        const errors = validationResult(req)
        const count = await req.app.get('mailProcessingService').getCount()
        if (!errors.isEmpty()) {
            return res.render('login', {
                userInputError: true,
                title: `${config.http.branding[0]} | Your temporary Inbox`,
                purgeTime: purgeTime,
                username: randomWord(),
                domains: helper.getDomains(),
                count: count,
                branding: config.http.branding,
            })
        }

        res.redirect(`/inbox/${req.body.username}@${req.body.domain}`)
    }
)

module.exports = router