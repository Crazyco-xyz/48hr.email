const express = require('express')
const router = new express.Router()
const debug = require('debug')('48hr-email:stats-routes')

// GET /stats - Statistics page
router.get('/', async(req, res) => {
    try {
        const config = req.app.get('config')

        // Check if statistics are enabled
        if (!config.http.features.statistics) {
            req.session.alertMessage = 'Statistics are disabled'
            const referer = req.get('Referer')
                // Don't redirect to /stats itself to avoid infinite loops
            const redirectUrl = (referer && !referer.includes('/stats')) ? referer : '/'
            return res.redirect(redirectUrl)
        }

        const statisticsStore = req.app.get('statisticsStore')
        const imapService = req.app.get('imapService')
        const mailProcessingService = req.app.get('mailProcessingService')
        const Helper = require('../../../application/helper')
        const helper = new Helper()

        // Update largest UID before getting stats (if IMAP is ready)
        if (imapService) {
            const largestUid = await helper.getLargestUid(imapService)
            statisticsStore.updateLargestUid(largestUid)
        }

        // Analyze all existing emails for historical data
        if (mailProcessingService) {
            const allMails = mailProcessingService.getAllMailSummaries()
            statisticsStore.analyzeHistoricalData(allMails)
            statisticsStore.calculateEnhancedStatistics(allMails)
        }

        const stats = statisticsStore.getEnhancedStats()
        const purgeTime = helper.purgeTimeElemetBuilder()
        const branding = config.http.features.branding || ['48hr.email', 'Service', 'https://example.com']

        debug(`Stats page requested: ${stats.currentCount} current, ${stats.allTimeTotal} all-time total, ${stats.historical.length} historical points`)

        res.render('stats', {
            title: `Statistics | ${branding[0]}`,
            branding: branding,
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
        const imapService = req.app.get('imapService')
        const Helper = require('../../../application/helper')
        const helper = new Helper()

        // Update largest UID before getting stats (if IMAP is ready)
        if (imapService) {
            const largestUid = await helper.getLargestUid(imapService)
            statisticsStore.updateLargestUid(largestUid)
        }

        // Use lightweight stats - no historical analysis on API calls
        const stats = statisticsStore.getLightweightStats()

        res.json(stats)
    } catch (error) {
        debug(`Error fetching stats API: ${error.message}`)
        res.status(500).json({ error: 'Failed to fetch statistics' })
    }
})

module.exports = router
