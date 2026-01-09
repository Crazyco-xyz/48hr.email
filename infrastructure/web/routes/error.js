const express = require('express')
const router = new express.Router()
const config = require('../../../application/config-service')
const templateContext = require('../template-context')
const debug = require('debug')('48hr-email:routes')

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
        const branding = config.http.features.branding || ['48hr.email', 'Service', 'https://example.com']
        res.status(errorCode)
        res.render('error', templateContext.build(req, {
            title: `${branding[0]} | ${errorCode}`,
            message: message,
            status: errorCode
        }))
    } catch (error) {
        debug('Error loading error page:', error.message)
        console.error('Error while loading error page', error)
            // For error pages, we should still try to render something basic
        res.status(500).send('Internal Server Error')
    }
})

module.exports = router
