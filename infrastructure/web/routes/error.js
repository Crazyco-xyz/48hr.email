const express = require('express')

const router = new express.Router()
const config = require('../../../application/config')
const Helper = require('../../../application/helper')
const helper = new(Helper)
const debug = require('debug')('48hr-email:routes')

const purgeTime = helper.purgeTimeElemetBuilder()

router.get('/:address/:errorCode', async(req, res, next) => {
    try {
        const mailProcessingService = req.app.get('mailProcessingService')
        if (!mailProcessingService) {
            throw new Error('Mail processing service not available')
        }
        debug(`Error page requested: ${req.params.errorCode} for ${req.params.address}`)
        const errorCode = parseInt(req.params.errorCode) || 404
        const message = req.query.message || (req.session && req.session.errorMessage) || 'An error occurred'

        debug(`Rendering error page ${errorCode} with message: ${message}`)
        res.status(errorCode)
        res.render('error', {
            title: `${config.http.branding[0]} | ${errorCode}`,
            purgeTime: purgeTime,
            address: req.params.address,
            message: message,
            status: errorCode,
            branding: config.http.branding
        })
    } catch (error) {
        debug('Error loading error page:', error.message)
        console.error('Error while loading error page', error)
            // For error pages, we should still try to render something basic
        res.status(500).send('Internal Server Error')
    }
})

module.exports = router