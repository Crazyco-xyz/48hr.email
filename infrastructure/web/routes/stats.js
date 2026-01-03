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

// GET /statsdemo - Demo page with fake data for testing
router.get('/demo', async(req, res) => {
    try {
        const config = req.app.get('config')
        const Helper = require('../../../application/helper')
        const helper = new Helper()
        const purgeTime = helper.purgeTimeElemetBuilder()
        
        // Generate fake 24-hour timeline data
        const now = Date.now()
        const timeline = []
        
        for (let i = 23; i >= 0; i--) {
            const timestamp = now - (i * 60 * 60 * 1000) // Hourly data points
            const receives = Math.floor(Math.random() * 100) + 200 // 200-300 receives per hour (~6k/day)
            const deletes = Math.floor(receives * 0.85) + Math.floor(Math.random() * 10) // ~85% deletion rate
            const forwards = Math.floor(receives * 0.01) + (Math.random() < 0.3 ? 1 : 0) // ~1% forward rate
            
            timeline.push({
                timestamp,
                receives,
                deletes,
                forwards
            })
        }
        
        // Calculate totals
        const totalReceives = timeline.reduce((sum, d) => sum + d.receives, 0)
        const totalDeletes = timeline.reduce((sum, d) => sum + d.deletes, 0)
        const totalForwards = timeline.reduce((sum, d) => sum + d.forwards, 0)
        
        const fakeStats = {
            currentCount: 6500,
            historicalTotal: 124893,
            last24Hours: {
                receives: totalReceives,
                deletes: totalDeletes,
                forwards: totalForwards,
                timeline: timeline
            }
        }
        
        debug(`Stats demo page requested with fake data`)
        
        res.render('stats', {
            title: `Statistics Demo | ${config.http.branding[0]}`,
            branding: config.http.branding,
            purgeTime: purgeTime,
            stats: fakeStats,
            authEnabled: config.user.authEnabled,
            currentUser: req.session && req.session.username
        })
    } catch (error) {
        debug(`Error loading stats demo page: ${error.message}`)
        console.error('Error while loading stats demo page', error)
        res.status(500).send('Error loading statistics demo')
    }
})

module.exports = router
