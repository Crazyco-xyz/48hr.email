const debug = require('debug')('48hr-email:stats-store')
const config = require('../application/config')

/**
 * Statistics Store - Tracks email metrics and historical data
 * Stores 24-hour rolling statistics for receives, deletes, and forwards
 * Persists data to database for survival across restarts
 */
class StatisticsStore {
    constructor(db = null) {
        this.db = db

        // Current totals
        this.currentCount = 0
        this.largestUid = 0

        // 24-hour rolling data (one entry per minute = 1440 entries)
        this.hourlyData = []
        this.maxDataPoints = 24 * 60 // 24 hours * 60 minutes

        // Track last cleanup to avoid too frequent operations
        this.lastCleanup = Date.now()

        // Historical data caching to prevent repeated analysis
        this.historicalData = null
        this.lastAnalysisTime = 0
        this.analysisCacheDuration = 5 * 60 * 1000 // Cache for 5 minutes

        // Enhanced statistics (calculated from current emails)
        this.enhancedStats = null
        this.lastEnhancedStatsTime = 0
        this.enhancedStatsCacheDuration = 5 * 60 * 1000 // Cache for 5 minutes

        // Load persisted data if database is available
        if (this.db) {
            this._loadFromDatabase()
        }

        debug('Statistics store initialized')
    }

    /**
     * Get cutoff time based on email purge configuration
     * @returns {number} Timestamp in milliseconds
     * @private
     */
    _getPurgeCutoffMs() {
        const time = config.email.purgeTime.time
        const unit = config.email.purgeTime.unit

        let cutoffMs = 0
        switch (unit) {
            case 'minutes':
                cutoffMs = time * 60 * 1000
                break
            case 'hours':
                cutoffMs = time * 60 * 60 * 1000
                break
            case 'days':
                cutoffMs = time * 24 * 60 * 60 * 1000
                break
            default:
                cutoffMs = 48 * 60 * 60 * 1000 // Fallback to 48 hours
        }

        return cutoffMs
    }

    /**
     * Load statistics from database
     * @private
     */
    _loadFromDatabase() {
        try {
            const stmt = this.db.prepare('SELECT largest_uid, hourly_data, last_updated FROM statistics WHERE id = 1')
            const row = stmt.get()

            if (row) {
                this.largestUid = row.largest_uid || 0

                // Parse hourly data
                if (row.hourly_data) {
                    try {
                        const parsed = JSON.parse(row.hourly_data)
                            // Filter out stale data based on config purge time
                        const cutoff = Date.now() - this._getPurgeCutoffMs()
                        this.hourlyData = parsed.filter(entry => entry.timestamp >= cutoff)
                        debug(`Loaded ${this.hourlyData.length} hourly data points from database (cutoff: ${new Date(cutoff).toISOString()})`)
                    } catch (e) {
                        debug('Failed to parse hourly data:', e.message)
                        this.hourlyData = []
                    }
                }

                debug(`Loaded from database: largestUid=${this.largestUid}, hourlyData=${this.hourlyData.length} entries`)
            }
        } catch (error) {
            debug('Failed to load statistics from database:', error.message)
        }
    }

    /**
     * Save statistics to database
     * @private
     */
    _saveToDatabase() {
        if (!this.db) return

        try {
            const stmt = this.db.prepare(`
                UPDATE statistics 
                SET largest_uid = ?, hourly_data = ?, last_updated = ?
                WHERE id = 1
            `)
            stmt.run(this.largestUid, JSON.stringify(this.hourlyData), Date.now())
            debug('Statistics saved to database')
        } catch (error) {
            debug('Failed to save statistics to database:', error.message)
        }
    }

    /**
     * Initialize with current email count
     * @param {number} count - Current email count
     */
    initialize(count) {
        this.currentCount = count
        debug(`Initialized with ${count} emails`)
    }

    /**
     * Update largest UID (all-time total emails processed)
     * @param {number} uid - Largest UID from mailbox (0 if no emails)
     */
    updateLargestUid(uid) {
        if (uid >= 0 && uid > this.largestUid) {
            this.largestUid = uid
            this._saveToDatabase()
            debug(`Largest UID updated to ${uid}`)
        }
    }

    /**
     * Record an email received event
     */
    recordReceive() {
        this.currentCount++
            this._addDataPoint('receive')
        debug(`Email received. Current: ${this.currentCount}`)
    }

    /**
     * Record an email deleted event
     */
    recordDelete() {
        this.currentCount = Math.max(0, this.currentCount - 1)
        this._addDataPoint('delete')
        debug(`Email deleted. Current: ${this.currentCount}`)
    }

    /**
     * Record an email forwarded event
     */
    recordForward() {
        this._addDataPoint('forward')
        debug(`Email forwarded`)
    }

    /**
     * Update current count (for bulk operations like purge)
     * @param {number} count - New current count
     */
    updateCurrentCount(count) {
        const diff = count - this.currentCount
        if (diff < 0) {
            // Bulk delete occurred
            for (let i = 0; i < Math.abs(diff); i++) {
                this._addDataPoint('delete')
            }
        }
        this.currentCount = count
        debug(`Current count updated to ${count}`)
    }

    /**
     * Get current statistics
     * @returns {Object} Current stats
     */
    getStats() {
        this._cleanup()

        const last24h = this._getLast24Hours()

        return {
            currentCount: this.currentCount,
            allTimeTotal: this.largestUid,
            last24Hours: {
                receives: last24h.receives,
                deletes: last24h.deletes,
                forwards: last24h.forwards,
                timeline: this._getTimeline()
            }
        }
    }

    /**
     * Calculate enhanced statistics from current emails
     * Privacy-friendly: uses domain analysis, time patterns, and aggregates
     * @param {Array} allMails - Array of all mail summaries
     */
    calculateEnhancedStatistics(allMails) {
        if (!allMails || allMails.length === 0) {
            this.enhancedStats = null
            return
        }

        const now = Date.now()
        if (this.enhancedStats && (now - this.lastEnhancedStatsTime) < this.enhancedStatsCacheDuration) {
            debug(`Using cached enhanced stats (age: ${Math.round((now - this.lastEnhancedStatsTime) / 1000)}s)`)
            return
        }

        debug(`Calculating enhanced statistics from ${allMails.length} emails`)

        // Track sender domains (privacy-friendly: domain only, not full address)
        const senderDomains = new Map()
        const recipientDomains = new Map()
        const hourlyActivity = Array(24).fill(0)
        let totalSubjectLength = 0
        let subjectCount = 0
        let withAttachments = 0
        let dayTimeEmails = 0 // 6am-6pm
        let nightTimeEmails = 0 // 6pm-6am

        allMails.forEach(mail => {
            try {
                // Sender domain analysis
                if (mail.from && mail.from[0] && mail.from[0].address) {
                    const parts = mail.from[0].address.split('@')
                    const domain = parts[1] ? parts[1].toLowerCase() : null
                    if (domain) {
                        senderDomains.set(domain, (senderDomains.get(domain) || 0) + 1)
                    }
                }

                // Recipient domain analysis
                if (mail.to && mail.to[0]) {
                    const parts = mail.to[0].split('@')
                    const domain = parts[1] ? parts[1].toLowerCase() : null
                    if (domain) {
                        recipientDomains.set(domain, (recipientDomains.get(domain) || 0) + 1)
                    }
                }

                // Hourly activity pattern
                if (mail.date) {
                    const date = new Date(mail.date)
                    if (!isNaN(date.getTime())) {
                        const hour = date.getHours()
                        hourlyActivity[hour]++

                            // Day vs night distribution (6am-6pm = day, 6pm-6am = night)
                            if (hour >= 6 && hour < 18) {
                                dayTimeEmails++
                            } else {
                                nightTimeEmails++
                            }
                    }
                }

                // Subject length analysis (privacy-friendly: only length, not content)
                if (mail.subject) {
                    totalSubjectLength += mail.subject.length
                    subjectCount++
                }

                // Check if email likely has attachments (would need full fetch to confirm)
                // For now, we'll track this separately when we fetch full emails
            } catch (e) {
                // Skip invalid entries
            }
        })

        // Get top sender domains (limit to top 10)
        const topSenderDomains = Array.from(senderDomains.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([domain, count]) => ({ domain, count }))

        // Get top recipient domains
        const topRecipientDomains = Array.from(recipientDomains.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([domain, count]) => ({ domain, count }))

        // Find busiest hours (top 5)
        const busiestHours = hourlyActivity
            .map((count, hour) => ({ hour, count }))
            .filter(h => h.count > 0)
            .sort((a, b) => b.count - a.count)
            .slice(0, 5)

        // Calculate peak hour concentration (% of emails in busiest hour)
        const peakHourCount = busiestHours.length > 0 ? busiestHours[0].count : 0
        const peakHourPercentage = allMails.length > 0 ?
            Math.round((peakHourCount / allMails.length) * 100) :
            0

        // Calculate emails per hour rate (average across all active hours)
        const activeHours = hourlyActivity.filter(count => count > 0).length
        const emailsPerHour = activeHours > 0 ?
            Math.round(allMails.length / activeHours) :
            0

        // Calculate day/night percentage
        const totalDayNight = dayTimeEmails + nightTimeEmails
        const dayPercentage = totalDayNight > 0 ?
            Math.round((dayTimeEmails / totalDayNight) * 100) :
            50

        this.enhancedStats = {
            topSenderDomains,
            topRecipientDomains,
            busiestHours,
            averageSubjectLength: subjectCount > 0 ? Math.round(totalSubjectLength / subjectCount) : 0,
            totalEmails: allMails.length,
            uniqueSenderDomains: senderDomains.size,
            uniqueRecipientDomains: recipientDomains.size,
            peakHourPercentage,
            emailsPerHour: emailsPerHour,
            dayPercentage
        }

        this.lastEnhancedStatsTime = now
        debug(`Enhanced stats calculated: ${this.enhancedStats.uniqueSenderDomains} unique sender domains, ${this.enhancedStats.busiestHours.length} busy hours`)
    }

    /**
     * Analyze all existing emails to build historical statistics
     * @param {Array} allMails - Array of all mail summaries with date property
     */
    analyzeHistoricalData(allMails) {
        if (!allMails || allMails.length === 0) {
            debug('No historical data to analyze')
            return
        }

        // Check cache - if analysis was done recently, skip it
        const now = Date.now()
        if (this.historicalData && (now - this.lastAnalysisTime) < this.analysisCacheDuration) {
            debug(`Using cached historical data (${this.historicalData.length} points, age: ${Math.round((now - this.lastAnalysisTime) / 1000)}s)`)
            return
        }

        debug(`Analyzing ${allMails.length} emails for historical statistics`)
        const startTime = Date.now()

        // Group emails by minute
        const histogram = new Map()

        allMails.forEach(mail => {
            try {
                const date = new Date(mail.date)
                if (isNaN(date.getTime())) return

                const minute = Math.floor(date.getTime() / 60000) * 60000

                if (!histogram.has(minute)) {
                    histogram.set(minute, 0)
                }
                histogram.set(minute, histogram.get(minute) + 1)
            } catch (e) {
                // Skip invalid dates
            }
        })

        // Convert to array and sort by timestamp
        this.historicalData = Array.from(histogram.entries())
            .map(([timestamp, count]) => ({ timestamp, receives: count }))
            .sort((a, b) => a.timestamp - b.timestamp)

        this.lastAnalysisTime = now

        const elapsed = Date.now() - startTime
        debug(`Built historical data: ${this.historicalData.length} time buckets in ${elapsed}ms`)
    }

    /**
     * Get enhanced statistics with historical data and predictions
     * @returns {Object} Enhanced stats with historical timeline and predictions
     */
    getEnhancedStats() {
        this._cleanup()

        const last24h = this._getLast24Hours()
        const timeline = this._getTimeline()
        const historicalTimeline = this._getHistoricalTimeline()
        const prediction = this._generatePrediction()

        // Calculate historical receives from purge time window
        const cutoff = Date.now() - this._getPurgeCutoffMs()
        const historicalReceives = historicalTimeline
            .filter(point => point.timestamp >= cutoff)
            .reduce((sum, point) => sum + point.receives, 0)

        return {
            currentCount: this.currentCount,
            allTimeTotal: this.largestUid,
            last24Hours: {
                receives: last24h.receives + historicalReceives,
                deletes: last24h.deletes,
                forwards: last24h.forwards,
                timeline: timeline
            },
            historical: historicalTimeline,
            prediction: prediction,
            enhanced: this.enhancedStats
        }
    }

    /**
     * Get lightweight statistics without historical analysis (for API updates)
     * @returns {Object} Stats with only realtime data
     */
    getLightweightStats() {
        this._cleanup()

        const last24h = this._getLast24Hours()
        const timeline = this._getTimeline()

        return {
            currentCount: this.currentCount,
            allTimeTotal: this.largestUid,
            last24Hours: {
                receives: last24h.receives,
                deletes: last24h.deletes,
                forwards: last24h.forwards,
                timeline: timeline
            }
        }
    }

    /**
     * Get historical timeline for visualization
     * Shows data for the configured purge duration, aggregated by hour
     * @returns {Array} Historical data points
     * @private
     */
    _getHistoricalTimeline() {
        if (!this.historicalData || this.historicalData.length === 0) {
            return []
        }

        // Show historical data up to the purge time window
        const cutoff = Date.now() - this._getPurgeCutoffMs()
        const relevantHistory = this.historicalData.filter(point => point.timestamp >= cutoff)

        // Aggregate by hour
        const hourlyBuckets = new Map()
        relevantHistory.forEach(point => {
            const hour = Math.floor(point.timestamp / 3600000) * 3600000
            if (!hourlyBuckets.has(hour)) {
                hourlyBuckets.set(hour, 0)
            }
            hourlyBuckets.set(hour, hourlyBuckets.get(hour) + point.receives)
        })

        // Convert to array and sort
        const hourlyData = Array.from(hourlyBuckets.entries())
            .map(([timestamp, receives]) => ({ timestamp, receives }))
            .sort((a, b) => a.timestamp - b.timestamp)

        debug(`Historical timeline: ${hourlyData.length} hourly points within ${config.email.purgeTime.time} ${config.email.purgeTime.unit} window`)
        return hourlyData
    }

    /**
     * Generate prediction for next period based on historical patterns
     * Uses config purge time to determine prediction window
     * Predicts based on time-of-day patterns with randomization
     * @returns {Array} Predicted data points
     * @private
     */
    _generatePrediction() {
        if (!this.historicalData || this.historicalData.length < 100) {
            return [] // Not enough data to predict
        }

        const now = Date.now()
        const predictions = []

        // Build hourly patterns from historical data
        // Map hour-of-day to average receives count
        const hourlyPatterns = new Map()

        this.historicalData.forEach(point => {
            const date = new Date(point.timestamp)
            const hour = date.getHours()

            if (!hourlyPatterns.has(hour)) {
                hourlyPatterns.set(hour, [])
            }
            hourlyPatterns.get(hour).push(point.receives)
        })

        // Calculate average for each hour
        const hourlyAverages = new Map()
        hourlyPatterns.forEach((values, hour) => {
            const avg = values.reduce((sum, v) => sum + v, 0) / values.length
            hourlyAverages.set(hour, avg)
        })

        debug(`Built hourly patterns for ${hourlyAverages.size} hours from ${this.historicalData.length} data points`)

        // Generate predictions for purge duration (in 1-hour intervals)
        const purgeMs = this._getPurgeCutoffMs()
        const predictionHours = Math.ceil(purgeMs / (60 * 60 * 1000))

        for (let i = 1; i <= predictionHours; i++) {
            const timestamp = now + (i * 60 * 60 * 1000) // 1 hour intervals
            const futureDate = new Date(timestamp)
            const futureHour = futureDate.getHours()

            // Get average for this hour, or fallback to overall average
            let baseCount = hourlyAverages.get(futureHour)
            if (baseCount === undefined) {
                // Fallback to overall average if no data for this hour
                const allValues = Array.from(hourlyAverages.values())
                baseCount = allValues.reduce((sum, v) => sum + v, 0) / allValues.length
            }

            // baseCount is already per-minute average, scale to full hour
            const scaledCount = baseCount * 60

            // Add randomization (±20%)
            const randomFactor = 0.8 + (Math.random() * 0.4) // 0.8 to 1.2
            const predictedCount = Math.round(scaledCount * randomFactor)

            predictions.push({
                timestamp,
                receives: Math.max(0, predictedCount)
            })
        }

        debug(`Generated ${predictions.length} prediction points based on hourly patterns`)
        return predictions
    }

    /**
     * Add a data point to the rolling history
     * @param {string} type - Type of event (receive, delete, forward)
     * @private
     */
    _addDataPoint(type) {
        const now = Date.now()
        const minute = Math.floor(now / 60000) * 60000 // Round to minute

        // Find or create entry for this minute
        let entry = this.hourlyData.find(e => e.timestamp === minute)
        if (!entry) {
            entry = {
                timestamp: minute,
                receives: 0,
                deletes: 0,
                forwards: 0
            }
            this.hourlyData.push(entry)
        }

        entry[type + 's']++

            this._cleanup()

        // Save to database periodically (every 10 data points to reduce I/O)
        if (Math.random() < 0.1) { // ~10% chance = every ~10 events
            this._saveToDatabase()
        }
    }

    /**
     * Clean up old data points (older than email purge time)
     * @private
     */
    _cleanup() {
        const now = Date.now()

        // Only cleanup every 5 minutes to avoid constant filtering
        if (now - this.lastCleanup < 5 * 60 * 1000) {
            return
        }

        const cutoff = now - this._getPurgeCutoffMs()
        const beforeCount = this.hourlyData.length
        this.hourlyData = this.hourlyData.filter(entry => entry.timestamp >= cutoff)

        if (beforeCount !== this.hourlyData.length) {
            this._saveToDatabase() // Save after cleanup
            debug(`Cleaned up ${beforeCount - this.hourlyData.length} old data points (keeping data for ${config.email.purgeTime.time} ${config.email.purgeTime.unit})`)
        }

        this.lastCleanup = now
    }

    /**
     * Get aggregated stats for the purge time window
     * @returns {Object} Aggregated counts
     * @private
     */
    _getLast24Hours() {
        const cutoff = Date.now() - this._getPurgeCutoffMs()
        const recent = this.hourlyData.filter(e => e.timestamp >= cutoff)

        return {
            receives: recent.reduce((sum, e) => sum + e.receives, 0),
            deletes: recent.reduce((sum, e) => sum + e.deletes, 0),
            forwards: recent.reduce((sum, e) => sum + e.forwards, 0)
        }
    }

    /**
     * Get timeline data for graphing (hourly aggregates)
     * Uses purge time for consistent timeline length
     * @returns {Array} Array of hourly data points
     * @private
     */
    _getTimeline() {
        const now = Date.now()
        const cutoff = now - this._getPurgeCutoffMs()
        const hourly = {}

        // Aggregate by hour
        this.hourlyData
            .filter(e => e.timestamp >= cutoff)
            .forEach(entry => {
                const hour = Math.floor(entry.timestamp / 3600000) * 3600000
                if (!hourly[hour]) {
                    hourly[hour] = { timestamp: hour, receives: 0, deletes: 0, forwards: 0 }
                }
                hourly[hour].receives += entry.receives
                hourly[hour].deletes += entry.deletes
                hourly[hour].forwards += entry.forwards
            })

        // Convert to sorted array
        return Object.values(hourly).sort((a, b) => a.timestamp - b.timestamp)
    }
}

module.exports = StatisticsStore
