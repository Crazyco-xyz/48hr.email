const debug = require('debug')('48hr-email:stats-store')

/**
 * Statistics Store - Tracks email metrics and historical data
 * Stores 24-hour rolling statistics for receives, deletes, and forwards
 */
class StatisticsStore {
    constructor() {
        // Current totals
        this.currentCount = 0
        this.historicalTotal = 0
        
        // 24-hour rolling data (one entry per minute = 1440 entries)
        this.hourlyData = []
        this.maxDataPoints = 24 * 60 // 24 hours * 60 minutes
        
        // Track last cleanup to avoid too frequent operations
        this.lastCleanup = Date.now()
        
        debug('Statistics store initialized')
    }

    /**
     * Initialize with current email count
     * @param {number} count - Current email count
     */
    initialize(count) {
        this.currentCount = count
        this.historicalTotal = count
        debug(`Initialized with ${count} emails`)
    }

    /**
     * Record an email received event
     */
    recordReceive() {
        this.currentCount++
        this.historicalTotal++
        this._addDataPoint('receive')
        debug(`Email received. Current: ${this.currentCount}, Historical: ${this.historicalTotal}`)
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
            historicalTotal: this.historicalTotal,
            last24Hours: {
                receives: last24h.receives,
                deletes: last24h.deletes,
                forwards: last24h.forwards,
                timeline: this._getTimeline()
            }
        }
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
    }

    /**
     * Clean up old data points (older than 24 hours)
     * @private
     */
    _cleanup() {
        const now = Date.now()
        
        // Only cleanup every 5 minutes to avoid constant filtering
        if (now - this.lastCleanup < 5 * 60 * 1000) {
            return
        }
        
        const cutoff = now - (24 * 60 * 60 * 1000)
        const beforeCount = this.hourlyData.length
        this.hourlyData = this.hourlyData.filter(entry => entry.timestamp >= cutoff)
        
        if (beforeCount !== this.hourlyData.length) {
            debug(`Cleaned up ${beforeCount - this.hourlyData.length} old data points`)
        }
        
        this.lastCleanup = now
    }

    /**
     * Get aggregated stats for last 24 hours
     * @returns {Object} Aggregated counts
     * @private
     */
    _getLast24Hours() {
        const cutoff = Date.now() - (24 * 60 * 60 * 1000)
        const recent = this.hourlyData.filter(e => e.timestamp >= cutoff)
        
        return {
            receives: recent.reduce((sum, e) => sum + e.receives, 0),
            deletes: recent.reduce((sum, e) => sum + e.deletes, 0),
            forwards: recent.reduce((sum, e) => sum + e.forwards, 0)
        }
    }

    /**
     * Get timeline data for graphing (hourly aggregates)
     * @returns {Array} Array of hourly data points
     * @private
     */
    _getTimeline() {
        const now = Date.now()
        const cutoff = now - (24 * 60 * 60 * 1000)
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
