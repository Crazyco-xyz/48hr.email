const express = require('express')
const router = new express.Router()
const debug = require('debug')('48hr-email:stats-routes')

// GET /stats - Statistics page
router.get('/', async(req, res) => {
    try {
        const config = req.app.get('config')
        const statisticsStore = req.app.get('statisticsStore')
        const Helper = require('../../../application/helper')
        const helper = new Helper()

        const stats = statisticsStore.getStats()
        const purgeTime = helper.purgeTimeElemetBuilder()

        debug(`Stats page requested: ${stats.currentCount} current, ${stats.historicalTotal} historical`)

        res.render('stats', {
            title: `Statistics | ${config.http.branding[0]}`,
            branding: config.http.branding,
            purgeTime: purgeTime,
            stats: stats,
            authEnabled: config.user.authEnabled,
            currentUser: req.session && req.session.username
        })
    } catch (error) {
        debug(`Error loading stats page: ${error.message}`)
        console.error('Error while loading stats page', error)
        res.status(500).send('Error loading statistics')
    }
})

// GET /stats/api - JSON API for real-time updates
router.get('/api', async(req, res) => {
    try {
        const statisticsStore = req.app.get('statisticsStore')
        const stats = statisticsStore.getStats()

        res.json(stats)
    } catch (error) {
        debug(`Error fetching stats API: ${error.message}`)
        res.status(500).json({ error: 'Failed to fetch statistics' })
    }
})

module.exports = router
