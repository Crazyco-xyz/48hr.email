const express = require('express')

const router = new express.Router()
const config = require('../../../application/config')
const Helper = require('../../../application/helper')
const helper = new(Helper)

const purgeTime = helper.purgeTimeElemetBuilder()

router.get('/:address/:errorCode', async(req, res) => {
    const mailProcessingService = req.app.get('mailProcessingService')
    const count = await mailProcessingService.getCount()

    const errorCode = parseInt(req.params.errorCode) || 404
    const message = req.query.message || (req.session && req.session.errorMessage) || 'An error occurred'

    res.status(errorCode)
    res.render('error', {
        title: `${config.http.branding[0]} | ${errorCode}`,
        purgeTime: purgeTime,
        address: req.params.address,
        count: count,
        message: message,
        status: errorCode,
        branding: config.http.branding
    })
})

module.exports = router
