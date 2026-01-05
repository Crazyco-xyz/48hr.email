const express = require('express')
const router = new express.Router()
const debug = require('debug')('48hr-email:stats-routes')
const templateContext = require('../template-context')

// GET /stats - Statistics page with lazy loading
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

        const branding = config.http.features.branding || ['48hr.email', 'Service', 'https://example.com']

        // Return page with placeholder data immediately - real data loads via JS
        const placeholderStats = {
            currentCount: '...',
            allTimeTotal: '...',
            last24Hours: {
                receives: '...',
                deletes: '...',
                forwards: '...',
                timeline: []
            },
            enhanced: {
                topSenderDomains: [],
                topRecipientDomains: [],
                busiestHours: [],
                uniqueSenderDomains: '...',
                uniqueRecipientDomains: '...',
                averageSubjectLength: '...',
                peakHourPercentage: '...',
                emailsPerHour: '...',
                dayPercentage: '...'
            },
            historical: [],
            prediction: []
        }

        debug(`Stats page requested - returning with lazy loading`)

        res.render('stats', templateContext.build(req, {
            title: `Statistics | ${branding[0]}`,
            stats: placeholderStats,
            lazyLoad: true
        }))
    } catch (error) {
        debug(`Error loading stats page: ${error.message}`)
        console.error('Error while loading stats page', error)
        res.status(500).send('Error loading statistics')
    }
})

// GET /stats/api - JSON API for lazy-loaded stats (full calculation)
router.get('/api', async(req, res) => {
    try {
        const config = req.app.get('config')

        // Check if statistics are enabled
        if (!config.http.features.statistics) {
            return res.status(403).json({ error: 'Statistics are disabled' })
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

        debug(`Stats API returned: ${stats.currentCount} current, ${stats.allTimeTotal} all-time total`)

        res.json(stats)
    } catch (error) {
        debug(`Error fetching stats API: ${error.message}`)
        console.error('Stats API error:', error)
        res.status(500).json({ error: 'Failed to fetch statistics' })
    }
})

module.exports = router
