const express = require('express')
const router = express.Router()

/**
 * Statistics API Routes
 * GET / - Get lightweight statistics
 * GET /enhanced - Get full statistics with historical data
 */

function createStatsRouter(dependencies) {
    // Ensure router is declared before any usage
    const { statisticsStore, mailProcessingService, imapService, config } = dependencies

    if (!config.http.statisticsEnabled) {
        router.all('*', (req, res) => {
            res.apiError('Statistics are disabled', 'FEATURE_DISABLED', 503)
        })
        return router
    }

    /**
     * GET / - Get lightweight statistics (no historical analysis)
     */
    router.get('/', async(req, res, next) => {
        try {
            const stats = statisticsStore.getLightweightStats()

            res.apiSuccess(stats)
        } catch (error) {
            next(error)
        }
    })

    /**
     * GET /enhanced - Get full statistics with historical data
     */
    router.get('/enhanced', async(req, res, next) => {
        try {
            // Analyze all existing emails for historical data
            if (mailProcessingService) {
                const allMails = mailProcessingService.getAllMailSummaries()
                statisticsStore.analyzeHistoricalData(allMails)
            }

            const stats = statisticsStore.getEnhancedStats()

            res.apiSuccess(stats)
        } catch (error) {
            next(error)
        }
    })

    return router
}

module.exports = createStatsRouter