const debug = require('debug')('48hr-email:stats-store');
const config = require('../application/config-service');
const crypto = require('crypto');

/**
 * Statistics Store - Tracks email metrics and historical data
 * Stores rolling statistics for receives, deletes, and forwards over the configured purge window
 * Persists data to database for survival across restarts
 */
class StatisticsStore {
    constructor(db = null) {
        this.db = db;
        this.currentCount = 0;
        this.largestUid = 0;
        this.hourlyData = [];
        this.maxDataPoints = 1440; // Default: 1440 minutes (24 hours), but actual retention is purge window
        this.lastCleanup = Date.now();
        this.historicalData = null;
        this.lastAnalysisTime = 0;
        this.analysisCacheDuration = 5 * 60 * 1000; // Cache for 5 minutes
        this.enhancedStats = null;
        this.lastEnhancedStatsTime = 0;
        this.enhancedStatsCacheDuration = 5 * 60 * 1000; // Cache for 5 minutes

        // Compute IMAP hash (user/server/port)
        this.imapHash = this._computeImapHash();

        if (this.db) {
            this._autoMigrateRemoveIdCheck();
            this._autoMigrateInstanceId();
            this._autoMigrateImapHash();
            this._loadFromDatabase();
        }
        debug('Statistics store initialized');
    }

    _autoMigrateRemoveIdCheck() {
        debug('Starting CHECK(id = 1) migration check...');
        // Remove CHECK(id = 1) constraint from statistics table if present
        try {
            const pragma = this.db.prepare("PRAGMA table_info(statistics)").all();
            // Check if id column exists and if table has only one row (singleton)
            const hasId = pragma.some(col => col.name === 'id');
            if (hasId) {
                // Check for CHECK constraint by inspecting sqlite_master
                const tableSql = this.db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='statistics'").get();
                debug('Table SQL:', tableSql && tableSql.sql);
                if (tableSql && tableSql.sql && tableSql.sql.includes('CHECK(id = 1)')) {
                    debug('Detected CHECK(id = 1) constraint on statistics table, migrating...');
                    // Backup data
                    const rows = this.db.prepare('SELECT * FROM statistics').all();
                    // Drop and recreate table without CHECK constraint
                    this.db.prepare('DROP TABLE IF EXISTS statistics').run();
                    this.db.prepare(`CREATE TABLE IF NOT EXISTS statistics (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        instance_id TEXT NOT NULL,
                        largest_uid INTEGER NOT NULL DEFAULT 0,
                        hourly_data TEXT,
                        last_updated INTEGER NOT NULL,
                        imap_hash TEXT NULL
                    )`).run();
                    // Restore data
                    const insert = this.db.prepare('INSERT INTO statistics (id, instance_id, largest_uid, hourly_data, last_updated, imap_hash) VALUES (?, ?, ?, ?, ?, ?)');
                    rows.forEach(row => {
                        insert.run(row.id, row.instance_id, row.largest_uid, row.hourly_data, row.last_updated, row.imap_hash);
                    });
                    debug('Migration complete: CHECK(id = 1) removed from statistics table.');
                } else {
                    debug('No CHECK(id = 1) constraint found in statistics table.');
                }
            } else {
                debug('No id column found in statistics table.');
            }
        } catch (e) {
            debug('Auto-migration for CHECK(id = 1) failed:', e.message);
        }
    }

    _autoMigrateInstanceId() {
        // Add and backfill instance_id for statistics table
        try {
            const pragma = this.db.prepare("PRAGMA table_info(statistics)").all();
            const hasInstanceId = pragma.some(col => col.name === 'instance_id');
            if (!hasInstanceId) {
                this.db.prepare('ALTER TABLE statistics ADD COLUMN instance_id TEXT').run();
            }
            // Backfill all rows
            this.db.prepare('UPDATE statistics SET instance_id = ? WHERE instance_id IS NULL OR instance_id = ""').run(this.imapHash);
            debug('Auto-migrated: instance_id column added and backfilled');
        } catch (e) {
            debug('Auto-migration for instance_id failed:', e.message);
        }
    }

    _autoMigrateImapHash() {
        // Check if imap_hash column exists, add and backfill if missing
        try {
            const pragma = this.db.prepare("PRAGMA table_info(statistics)").all();
            const hasImapHash = pragma.some(col => col.name === 'imap_hash');
            if (!hasImapHash) {
                this.db.prepare('ALTER TABLE statistics ADD COLUMN imap_hash TEXT NULL').run();
                this.db.prepare('UPDATE statistics SET imap_hash = ?').run(this.imapHash);
                debug('Auto-migrated: imap_hash column added and backfilled');
            }
        } catch (e) {
            debug('Auto-migration for imap_hash failed:', e.message);
        }
    }

    _computeImapHash() {
        const user = config.imap.user || '';
        const server = config.imap.server || '';
        const port = config.imap.port || '';
        const hash = crypto.createHash('sha256').update(`${user}:${server}:${port}`).digest('hex');
        return hash;
    }

    _getPurgeCutoffMs() {
        const time = config.email.purgeTime.time;
        const unit = config.email.purgeTime.unit;
        let cutoffMs = 0;
        switch (unit) {
            case 'minutes':
                cutoffMs = time * 60 * 1000;
                break;
            case 'hours':
                cutoffMs = time * 60 * 60 * 1000;
                break;
            case 'days':
                cutoffMs = time * 24 * 60 * 60 * 1000;
                break;
            default:
                cutoffMs = 48 * 60 * 60 * 1000; // Fallback to 48 hours
        }
        return cutoffMs;
    }

    _loadFromDatabase() {
        try {
            // Try to load row for current imap_hash
            const stmt = this.db.prepare('SELECT largest_uid, hourly_data, last_updated FROM statistics WHERE imap_hash = ?');
            const row = stmt.get(this.imapHash);
            if (row) {
                this.largestUid = row.largest_uid || 0;
                if (row.hourly_data) {
                    try {
                        const parsed = JSON.parse(row.hourly_data);
                        const cutoff = Date.now() - this._getPurgeCutoffMs();
                        this.hourlyData = parsed.filter(entry => entry.timestamp >= cutoff);
                        debug(`Loaded ${this.hourlyData.length} hourly data points from database (cutoff: ${new Date(cutoff).toISOString()})`);
                    } catch (e) {
                        debug('Failed to parse hourly data:', e.message);
                        this.hourlyData = [];
                    }
                }
                debug(`Loaded from database: largestUid=${this.largestUid}, hourlyData=${this.hourlyData.length} entries`);
            } else {
                // No row for this hash, insert new row
                const instanceId = config.instanceId || this.imapHash;
                const insert = this.db.prepare('INSERT OR REPLACE INTO statistics (instance_id, imap_hash, largest_uid, hourly_data, last_updated) VALUES (?, ?, ?, ?, ?)');
                insert.run(instanceId, this.imapHash, 0, JSON.stringify([]), Date.now());
                this.largestUid = 0;
                this.hourlyData = [];
                debug('Created new statistics row for imap_hash');
            }
        } catch (error) {
            debug('Failed to load statistics from database:', error.message);
        }
    }

    _saveToDatabase() {
        if (!this.db) return;
        try {
            const instanceId = config.instanceId || this.imapHash;
            const stmt = this.db.prepare(`
                UPDATE statistics 
                SET largest_uid = ?, hourly_data = ?, last_updated = ?
                WHERE instance_id = ? AND imap_hash = ?
            `);
            const result = stmt.run(this.largestUid, JSON.stringify(this.hourlyData), Date.now(), instanceId, this.imapHash);
            // If no row was updated, insert new row
            if (result.changes === 0) {
                const insert = this.db.prepare('INSERT INTO statistics (instance_id, imap_hash, largest_uid, hourly_data, last_updated) VALUES (?, ?, ?, ?, ?)');
                insert.run(instanceId, this.imapHash, this.largestUid, JSON.stringify(this.hourlyData), Date.now());
                debug('Inserted new statistics row for instance_id and imap_hash');
            } else {
                debug('Statistics saved to database');
            }
        } catch (error) {
            debug('Failed to save statistics to database:', error.message);
        }
    }

    initialize(count) {
        this.currentCount = count;
        debug(`Initialized with ${count} emails`);
    }

    updateLargestUid(uid) {
        if (uid >= 0 && uid > this.largestUid) {
            this.largestUid = uid;
            this._saveToDatabase();
            debug(`Largest UID updated to ${uid}`);
        }
    }

    recordReceive() {
        this.currentCount++;
        this._addDataPoint('receive');
        debug(`Email received. Current: ${this.currentCount}`);
    }

    recordDelete() {
        this.currentCount = Math.max(0, this.currentCount - 1);
        this._addDataPoint('delete');
        debug(`Email deleted. Current: ${this.currentCount}`);
    }

    recordForward() {
        this._addDataPoint('forward');
        debug(`Email forwarded`);
    }

    updateCurrentCount(count) {
        const diff = count - this.currentCount;
        if (diff < 0) {
            for (let i = 0; i < Math.abs(diff); i++) {
                this._addDataPoint('delete');
            }
        }
        this.currentCount = count;
        debug(`Current count updated to ${count}`);
    }

    getStats() {
        this._cleanup();
        const purgeWindowStats = this._getPurgeWindowStats();
        return {
            currentCount: this.currentCount,
            allTimeTotal: this.largestUid,
            purgeWindow: {
                receives: purgeWindowStats.receives,
                deletes: purgeWindowStats.deletes,
                forwards: purgeWindowStats.forwards,
                timeline: this._getTimeline()
            }
        };
    }

    calculateEnhancedStatistics(allMails) {
        if (!allMails || allMails.length === 0) {
            this.enhancedStats = null;
            return;
        }
        const now = Date.now();
        if (this.enhancedStats && (now - this.lastEnhancedStatsTime) < this.enhancedStatsCacheDuration) {
            debug(`Using cached enhanced stats (age: ${Math.round((now - this.lastEnhancedStatsTime) / 1000)}s)`);
            return;
        }
        debug(`Calculating enhanced statistics from ${allMails.length} emails`);
        const senderDomains = new Map();
        const recipientDomains = new Map();
        const hourlyActivity = Array(24).fill(0);
        let totalSubjectLength = 0;
        let subjectCount = 0;
        let dayTimeEmails = 0;
        let nightTimeEmails = 0;
        allMails.forEach(mail => {
            try {
                if (mail.from && mail.from[0] && mail.from[0].address) {
                    const parts = mail.from[0].address.split('@');
                    const domain = parts[1] ? parts[1].toLowerCase() : null;
                    if (domain) senderDomains.set(domain, (senderDomains.get(domain) || 0) + 1);
                }
                if (mail.to && mail.to[0]) {
                    const parts = mail.to[0].split('@');
                    const domain = parts[1] ? parts[1].toLowerCase() : null;
                    if (domain) recipientDomains.set(domain, (recipientDomains.get(domain) || 0) + 1);
                }
                if (mail.date) {
                    const date = new Date(mail.date);
                    if (!isNaN(date.getTime())) {
                        const hour = date.getHours();
                        hourlyActivity[hour]++;
                        if (hour >= 6 && hour < 18) dayTimeEmails++;
                        else nightTimeEmails++;
                    }
                }
                if (mail.subject) {
                    totalSubjectLength += mail.subject.length;
                    subjectCount++;
                }
            } catch (e) {}
        });
        const topSenderDomains = Array.from(senderDomains.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([domain, count]) => ({ domain, count }));
        const topRecipientDomains = Array.from(recipientDomains.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([domain, count]) => ({ domain, count }));
        const busiestHours = hourlyActivity.map((count, hour) => ({ hour, count })).filter(h => h.count > 0).sort((a, b) => b.count - a.count).slice(0, 5);
        const peakHourCount = busiestHours.length > 0 ? busiestHours[0].count : 0;
        const peakHourPercentage = allMails.length > 0 ? Math.round((peakHourCount / allMails.length) * 100) : 0;
        const activeHours = hourlyActivity.filter(count => count > 0).length;
        const emailsPerHour = activeHours > 0 ? Math.round(allMails.length / activeHours) : 0;
        const totalDayNight = dayTimeEmails + nightTimeEmails;
        const dayPercentage = totalDayNight > 0 ? Math.round((dayTimeEmails / totalDayNight) * 100) : 50;
        this.enhancedStats = {
            topSenderDomains,
            topRecipientDomains,
            busiestHours,
            averageSubjectLength: subjectCount > 0 ? Math.round(totalSubjectLength / subjectCount) : 0,
            totalEmails: allMails.length,
            uniqueSenderDomains: senderDomains.size,
            uniqueRecipientDomains: recipientDomains.size,
            peakHourPercentage,
            emailsPerHour,
            dayPercentage
        };
        this.lastEnhancedStatsTime = now;
        debug(`Enhanced stats calculated: ${this.enhancedStats.uniqueSenderDomains} unique sender domains, ${this.enhancedStats.busiestHours.length} busy hours`);
    }

    analyzeHistoricalData(allMails) {
        if (!allMails || allMails.length === 0) {
            debug('No historical data to analyze');
            return;
        }
        const now = Date.now();
        if (this.historicalData && (now - this.lastAnalysisTime) < this.analysisCacheDuration) {
            debug(`Using cached historical data (${this.historicalData.length} points, age: ${Math.round((now - this.lastAnalysisTime) / 1000)}s)`);
            return;
        }
        debug(`Analyzing ${allMails.length} emails for historical statistics`);
        const startTime = Date.now();
        const histogram = new Map();
        allMails.forEach(mail => {
            try {
                const date = new Date(mail.date);
                if (isNaN(date.getTime())) return;
                const minute = Math.floor(date.getTime() / 60000) * 60000;
                if (!histogram.has(minute)) histogram.set(minute, 0);
                histogram.set(minute, histogram.get(minute) + 1);
            } catch (e) {}
        });
        this.historicalData = Array.from(histogram.entries()).map(([timestamp, count]) => ({ timestamp, receives: count })).sort((a, b) => a.timestamp - b.timestamp);
        this.lastAnalysisTime = now;
        const elapsed = Date.now() - startTime;
        debug(`Built historical data: ${this.historicalData.length} time buckets in ${elapsed}ms`);
    }

    getEnhancedStats() {
        this._cleanup();
        const purgeWindowStats = this._getPurgeWindowStats();
        const timeline = this._getTimeline();
        const historicalTimeline = this._getHistoricalTimeline();
        const prediction = this._generatePrediction();
        const cutoff = Date.now() - this._getPurgeCutoffMs();
        const historicalReceives = historicalTimeline.filter(point => point.timestamp >= cutoff).reduce((sum, point) => sum + point.receives, 0);
        return {
            currentCount: this.currentCount,
            allTimeTotal: this.largestUid,
            purgeWindow: {
                receives: purgeWindowStats.receives + historicalReceives,
                deletes: purgeWindowStats.deletes,
                forwards: purgeWindowStats.forwards,
                timeline: timeline
            },
            historical: historicalTimeline,
            prediction: prediction,
            enhanced: this.enhancedStats
        };
    }

    getLightweightStats() {
        this._cleanup();
        const purgeWindowStats = this._getPurgeWindowStats();
        const timeline = this._getTimeline();
        return {
            currentCount: this.currentCount,
            allTimeTotal: this.largestUid,
            purgeWindow: {
                receives: purgeWindowStats.receives,
                deletes: purgeWindowStats.deletes,
                forwards: purgeWindowStats.forwards,
                timeline: timeline
            }
        };
    }

    _getPurgeWindowStats() {
        const cutoff = Date.now() - this._getPurgeCutoffMs();
        const recent = this.hourlyData.filter(e => e.timestamp >= cutoff);
        return {
            receives: recent.reduce((sum, e) => sum + e.receives, 0),
            deletes: recent.reduce((sum, e) => sum + e.deletes, 0),
            forwards: recent.reduce((sum, e) => sum + e.forwards, 0)
        };
    }

    _getTimeline() {
        const now = Date.now();
        const cutoff = now - this._getPurgeCutoffMs();
        const buckets = {};
        this.hourlyData.filter(e => e.timestamp >= cutoff).forEach(entry => {
            const interval = Math.floor(entry.timestamp / 900000) * 900000; // 15 minutes
            if (!buckets[interval]) {
                buckets[interval] = { timestamp: interval, receives: 0, deletes: 0, forwards: 0 };
            }
            buckets[interval].receives += entry.receives;
            buckets[interval].deletes += entry.deletes;
            buckets[interval].forwards += entry.forwards;
        });
        return Object.values(buckets).sort((a, b) => a.timestamp - b.timestamp);
    }

    _getHistoricalTimeline() {
        if (!this.historicalData || this.historicalData.length === 0) {
            return [];
        }
        const cutoff = Date.now() - this._getPurgeCutoffMs();
        const relevantHistory = this.historicalData.filter(point => point.timestamp >= cutoff);
        const intervalBuckets = new Map();
        relevantHistory.forEach(point => {
            const interval = Math.floor(point.timestamp / 900000) * 900000; // 15 minutes
            if (!intervalBuckets.has(interval)) {
                intervalBuckets.set(interval, 0);
            }
            intervalBuckets.set(interval, intervalBuckets.get(interval) + point.receives);
        });
        const intervalData = Array.from(intervalBuckets.entries()).map(([timestamp, receives]) => ({ timestamp, receives })).sort((a, b) => a.timestamp - b.timestamp);
        debug(`Historical timeline: ${intervalData.length} 15-min interval points within ${config.email.purgeTime.time} ${config.email.purgeTime.unit} window`);
        return intervalData;
    }

    _generatePrediction() {
        if (!this.historicalData || this.historicalData.length < 100) {
            return [];
        }
        const now = Date.now();
        const predictions = [];
        const hourlyPatterns = new Map();
        this.historicalData.forEach(point => {
            const date = new Date(point.timestamp);
            const hour = date.getHours();
            if (!hourlyPatterns.has(hour)) {
                hourlyPatterns.set(hour, []);
            }
            hourlyPatterns.get(hour).push(point.receives);
        });
        const hourlyAverages = new Map();
        hourlyPatterns.forEach((values, hour) => {
            const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
            hourlyAverages.set(hour, avg);
        });
        debug(`Built hourly patterns for ${hourlyAverages.size} hours from ${this.historicalData.length} data points`);
        const purgeMs = this._getPurgeCutoffMs();
        const purgeDurationHours = Math.ceil(purgeMs / (60 * 60 * 1000));
        const predictionHours = Math.min(12, Math.ceil(purgeDurationHours * 0.2));
        const predictionIntervals = predictionHours * 4;
        for (let i = 1; i <= predictionIntervals; i++) {
            const timestamp = now + (i * 15 * 60 * 1000);
            const futureDate = new Date(timestamp);
            const futureHour = futureDate.getHours();
            let baseCount = hourlyAverages.get(futureHour);
            if (baseCount === undefined) {
                const allValues = Array.from(hourlyAverages.values());
                baseCount = allValues.reduce((sum, v) => sum + v, 0) / allValues.length;
            }
            const scaledCount = baseCount * 15;
            const randomFactor = 0.8 + (Math.random() * 0.4);
            const predictedCount = Math.round(scaledCount * randomFactor);
            predictions.push({
                timestamp,
                receives: Math.max(0, predictedCount)
            });
        }
        debug(`Generated ${predictions.length} prediction points based on hourly patterns`);
        return predictions;
    }

    _addDataPoint(type) {
        const now = Date.now();
        const minute = Math.floor(now / 60000) * 60000;
        let entry = this.hourlyData.find(e => e.timestamp === minute);
        if (!entry) {
            entry = { timestamp: minute, receives: 0, deletes: 0, forwards: 0 };
            this.hourlyData.push(entry);
        }
        entry[type + 's']++;
        this._cleanup();
        if (Math.random() < 0.1) {
            this._saveToDatabase();
        }
    }

    _cleanup() {
        const now = Date.now();
        if (now - this.lastCleanup < 5 * 60 * 1000) {
            return;
        }
        const cutoff = now - this._getPurgeCutoffMs();
        const beforeCount = this.hourlyData.length;
        this.hourlyData = this.hourlyData.filter(entry => entry.timestamp >= cutoff);
        if (beforeCount !== this.hourlyData.length) {
            this._saveToDatabase();
            debug(`Cleaned up ${beforeCount - this.hourlyData.length} old data points (keeping data for ${config.email.purgeTime.time} ${config.email.purgeTime.unit})`);
        }
        this.lastCleanup = now;
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
        debug(`Email forwarded. Current: ${this.currentCount}`)
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
        debug(`
    `)
    }

    /**
     * Get current statistics
     * @returns {Object} Current stats
     */
    getStats() {
        this._cleanup()

        const purgeWindowStats = this._getPurgeWindowStats()

        return {
            currentCount: this.currentCount,
            allTimeTotal: this.largestUid,
            purgeWindow: {
                receives: purgeWindowStats.receives,
                deletes: purgeWindowStats.deletes,
                forwards: purgeWindowStats.forwards,
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
            debug(`Using cached enhanced stats(age: ${Math.round((now - this.lastEnhancedStatsTime) / 1000)}s)`)
            return
        }

        debug(`Calculating enhanced statistics from ${allMails.length} emails `)
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
        debug(`Enhanced stats calculated: ${this.enhancedStats.uniqueSenderDomains} unique sender domains, ${this.enhancedStats.busiestHours.length} busy hours `)
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
            debug(`Using cached historical data(${this.historicalData.length} points, age: ${Math.round((now - this.lastAnalysisTime) / 1000)}s)`)
            return
        }

        debug(`Analyzing ${allMails.length} emails for historical statistics `)
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
        debug(`Built historical data: ${this.historicalData.length} time buckets in ${elapsed} ms `)
    }

    /**
     * Get enhanced statistics with historical data and predictions
     * @returns {Object} Enhanced stats with historical timeline and predictions
     */
    getEnhancedStats() {
        this._cleanup()

        const purgeWindowStats = this._getPurgeWindowStats()
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
            purgeWindow: {
                receives: purgeWindowStats.receives + historicalReceives,
                deletes: purgeWindowStats.deletes,
                forwards: purgeWindowStats.forwards,
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

        const purgeWindowStats = this._getPurgeWindowStats()
        const timeline = this._getTimeline()

        return {
            currentCount: this.currentCount,
            allTimeTotal: this.largestUid,
            purgeWindow: {
                receives: purgeWindowStats.receives,
                deletes: purgeWindowStats.deletes,
                forwards: purgeWindowStats.forwards,
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

        // Aggregate by 15-minute intervals for better granularity
        const intervalBuckets = new Map()
        relevantHistory.forEach(point => {
            const interval = Math.floor(point.timestamp / 900000) * 900000 // 15 minutes
            if (!intervalBuckets.has(interval)) {
                intervalBuckets.set(interval, 0)
            }
            intervalBuckets.set(interval, intervalBuckets.get(interval) + point.receives)
        })

        // Convert to array and sort
        const intervalData = Array.from(intervalBuckets.entries())
            .map(([timestamp, receives]) => ({ timestamp, receives }))
            .sort((a, b) => a.timestamp - b.timestamp)

        debug(`Historical timeline: ${intervalData.length} 15 - min interval points within ${config.email.purgeTime.time} ${config.email.purgeTime.unit} window `)
        return intervalData
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

        debug(`Built hourly patterns for ${hourlyAverages.size} hours from ${this.historicalData.length} data points `)

        // Generate predictions for a reasonable future window
        // Limit to 20% of purge duration or 12 hours max to maintain chart balance
        // Use 15-minute intervals for better granularity
        const purgeMs = this._getPurgeCutoffMs()
        const purgeDurationHours = Math.ceil(purgeMs / (60 * 60 * 1000))
        const predictionHours = Math.min(12, Math.ceil(purgeDurationHours * 0.2))
        const predictionIntervals = predictionHours * 4 // Convert hours to 15-min intervals

        for (let i = 1; i <= predictionIntervals; i++) {
            const timestamp = now + (i * 15 * 60 * 1000) // 15 minute intervalsals
            const futureDate = new Date(timestamp)
            const futureHour = futureDate.getHours()

            // Get average for this hour, or fallback to overall average
            let baseCount = hourlyAverages.get(futureHour)
            if (baseCount === undefined) {
                // Fallback to overall average if no data for this hour
                const allValues = Array.from(hourlyAverages.values())
                baseCount = allValues.reduce((sum, v) => sum + v, 0) / allValues.length
            }

            // baseCount is already per-minute average, scale to 15 minutes
            const scaledCount = baseCount * 15

            // Add randomization (±20%)
            const randomFactor = 0.8 + (Math.random() * 0.4) // 0.8 to 1.2
            const predictedCount = Math.round(scaledCount * randomFactor)

            predictions.push({
                timestamp,
                receives: Math.max(0, predictedCount)
            })
        }

        debug(`Generated ${predictions.length} prediction points based on hourly patterns `)
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
            debug(`Cleaned up ${beforeCount - this.hourlyData.length} old data points(keeping data for ${config.email.purgeTime.time} ${config.email.purgeTime.unit})`)
        }

        this.lastCleanup = now
    }

    /**
     * Get aggregated stats for the purge time window
     * @returns {Object} Aggregated counts
     * @private
     */


    /**
     * Get timeline data for graphing (hourly aggregates)
     * Uses purge time for consistent timeline length
     * @returns {Array} Array of hourly data points
     * @private
     */
    _getTimeline() {
        const now = Date.now()
        const cutoff = now - this._getPurgeCutoffMs()
        const buckets = {}

        // Aggregate by 15-minute intervals for better granularity
        this.hourlyData
            .filter(e => e.timestamp >= cutoff)
            .forEach(entry => {
                const interval = Math.floor(entry.timestamp / 900000) * 900000 // 15 minutes
                if (!buckets[interval]) {
                    buckets[interval] = { timestamp: interval, receives: 0, deletes: 0, forwards: 0 }
                }
                buckets[interval].receives += entry.receives
                buckets[interval].deletes += entry.deletes
                buckets[interval].forwards += entry.forwards
            })

        // Convert to sorted array
        return Object.values(buckets).sort((a, b) => a.timestamp - b.timestamp)
    }
}

module.exports = StatisticsStore
