const config = require('./config')
const debug = require('debug')('48hr-email:helper')
const crypto = require('crypto')

class Helper {

    /**
     * Normalize our config into a proper timestamp, so we know what emails to purge
     * @returns {Date}
     */
    purgeTimeStamp() {
        // Calculate cutoff time using native Date
        const now = new Date()
        let cutoffMs = now.getTime()

        // Subtract the purge time based on unit
        const time = config.email.purgeTime.time
        const unit = config.email.purgeTime.unit

        switch (unit) {
            case 'minutes':
                cutoffMs -= time * 60 * 1000
                break
            case 'hours':
                cutoffMs -= time * 60 * 60 * 1000
                break
            case 'days':
                cutoffMs -= time * 24 * 60 * 60 * 1000
                break
            default:
                throw new Error(`Unknown time unit: ${unit}`)
        }

        const cutoff = new Date(cutoffMs)
        debug(`Purge cutoff calculated: ${cutoff} (${time} ${unit} ago)`)
        return cutoff
    }

    /**
     * Check if time difference between now and purgeTimeStamp is more than one day
     * @param {number|Date} now
     * @param {Date} past
     * @returns {Boolean}
     */
    moreThanOneDay(now, past) {
        const DAY_IN_MS = 24 * 60 * 60 * 1000;

        const nowMs = now instanceof Date ? now.getTime() : now;
        const pastMs = past instanceof Date ? past.getTime() : new Date(past).getTime();

        const diffMs = nowMs - pastMs;
        const result = diffMs >= DAY_IN_MS;
        debug(`Time difference check: ${diffMs}ms >= ${DAY_IN_MS}ms = ${result}`)
        return result;
    }

    /**
     * Convert time to highest possible unit (minutes → hours → days),
     * rounding if necessary and prefixing "~" when rounded.
     *
     * @param {number} time
     * @param {string} unit  "minutes" | "hours" | "days"
     * @returns {string}
     */
    convertAndRound(time, unit) {
        let value = time;
        let u = unit;

        // upgrade units
        const units = [
            ["minutes", 60, "hours"],
            ["hours", 24, "days"]
        ];

        for (const [from, factor, to] of units) {
            if (u === from && value > factor) {
                value = value / factor;
                u = to;
            }
        }

        // determine if rounding is needed
        const rounded = !Number.isSafeInteger(value);
        if (rounded) value = Math.round(value);

        return `${rounded ? "~" : ""}${value} ${u}`;
    }

    /**
     * Build a purgeTime html element for the page to keep the clutter outside of the twig template
     * @returns {String}
     */
    purgeTimeElemetBuilder() {
        let time = `${config.email.purgeTime.time} ${config.email.purgeTime.unit}`
        let Tooltip = ''
        if (config.email.purgeTime.convert) {
            time = this.convertAndRound(config.email.purgeTime.time, config.email.purgeTime.unit)
            if (time !== `${config.email.purgeTime.time} ${config.email.purgeTime.unit}`) {
                Tooltip = `Config: ${config.email.purgeTime.time} ${config.email.purgeTime.unit}`
            }
        }

        const footer = `<label title="${Tooltip}">
		<h4 style="display: inline;"><u><i>${time}</i></u></h4>
		</Label>`
        return footer
    }

    /**
     * Build a mail count html element with tooltip for the footer
     * @param {number} count - Current mail count
     * @returns {String}
     */
    mailCountBuilder(count) {
        const imapService = require('./imap-service')
        const largestUid = imapService.getLargestUid ? imapService.getLargestUid() : null
        let tooltip = ''

        if (largestUid && largestUid > 0) {
            tooltip = `All-time total: ${largestUid} emails`
        }

        return `<label title="${tooltip}">
		<h4 style="display: inline;"><u><i>${count} mails</i></u></h4>
		</label>`
    }

    /**
     * Shuffle an array using the Durstenfeld shuffle algorithm
     * @param {Array} array
     * @returns {Array}
     */
    shuffleArray(array) {
        for (let i = array.length - 1; i >= 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array
    }

    /**
     * Shuffle first item of array, keeping original order afterwards
     * @param {Array} array
     * @returns {Array}
     */
    shuffleFirstItem(array) {
        let first = array[Math.floor(Math.random() * array.length)]
        array = array.filter((value) => value != first);
        array = [first].concat(array)
        return array
    }

    /**
     * Hide other emails in the list and only show first (true) or show all (false)
     * @param {Array} array
     * @returns {Array}
     */
    hideOther(array) {
        if (config.http.hideOther) {
            return array[0]
        } else {
            return array
        }
    }

    /**
     * Get a domain list from config for use
     * @returns {Array}
     */
    getDomains() {
        debug(`Getting domains with displaySort: ${config.http.displaySort}`)
        let result;
        switch (config.http.displaySort) {
            case 0:
                result = this.hideOther(config.email.domains) // No modification
                debug(`Domain sort 0: no modification, ${result.length} domains`)
                return result
            case 1:
                result = this.hideOther(config.email.domains.sort()) // Sort alphabetically
                debug(`Domain sort 1: alphabetical sort, ${result.length} domains`)
                return result
            case 2:
                result = this.hideOther(this.shuffleFirstItem(config.email.domains.sort())) // Sort alphabetically and shuffle first item
                debug(`Domain sort 2: alphabetical + shuffle first, ${result.length} domains`)
                return result
            case 3:
                result = this.hideOther(this.shuffleArray(config.email.domains)) // Shuffle all
                debug(`Domain sort 3: shuffle all, ${result.length} domains`)
                return result
        }
    }

    async getLargestUid(imapService) {
        const uid = await imapService.getLargestUid();
        return uid || 0;
    }

    /**
     * Generate a cryptographically secure random verification token
     * @returns {string} - 32-byte hex token (64 characters)
     */
    generateVerificationToken() {
        const token = crypto.randomBytes(32).toString('hex')
        debug('Generated verification token')
        return token
    }

    /**
     * Sign an email address for use in a cookie
     * Uses HMAC-SHA256 with the session secret
     * @param {string} email - Email address to sign
     * @returns {string} - HMAC signature (hex)
     */
    signCookie(email) {
        const secret = config.user.sessionSecret
        const hmac = crypto.createHmac('sha256', secret)
        hmac.update(email.toLowerCase())
        const signature = hmac.digest('hex')
        debug(`Signed cookie for email: ${email}`)
        return signature
    }

    /**
     * Verify a cookie signature for an email address
     * @param {string} email - Email address to verify
     * @param {string} signature - HMAC signature to verify
     * @returns {boolean} - True if signature is valid
     */
    verifyCookieSignature(email, signature) {
        if (!email || !signature) {
            return false
        }

        const expectedSignature = this.signCookie(email)

        // Use timing-safe comparison to prevent timing attacks
        try {
            return crypto.timingSafeEqual(
                Buffer.from(signature, 'hex'),
                Buffer.from(expectedSignature, 'hex')
            )
        } catch (error) {
            // timingSafeEqual throws if buffers are different lengths
            debug(`Cookie signature verification failed: ${error.message}`)
            return false
        }
    }

    /**
     * Migrate legacy database files for backwards compatibility
     * - Renames users.db to data.db if it exists
     * - Logs if locked-inboxes.db exists (no longer needed)
     * @param {string} dbPath - Path to the current database (data.db)
     */
    static migrateDatabase(dbPath) {
        const fs = require('fs')
        const path = require('path')

        const dbDir = path.dirname(dbPath)
        const legacyUsersDb = path.join(dbDir, 'users.db')
        const legacyLockedInboxesDb = path.join(dbDir, 'locked-inboxes.db')

        // Migrate users.db to data.db
        if (fs.existsSync(legacyUsersDb) && !fs.existsSync(dbPath)) {
            console.log(`Migrating ${legacyUsersDb} → ${dbPath}`)
            fs.renameSync(legacyUsersDb, dbPath)
            debug(`Database migrated: users.db → data.db`)
        }

        // Warn about old locked-inboxes.db
        if (fs.existsSync(legacyLockedInboxesDb)) {
            console.log(`WARNING: Found legacy ${legacyLockedInboxesDb}`)
            console.log(`   This database is no longer used. Locks are now stored in ${path.basename(dbPath)}.`)
            console.log(`   You can safely delete ${legacyLockedInboxesDb} after verifying your locks are working.`)
            debug('Legacy locked-inboxes.db detected but not migrated (data already in user_locked_inboxes table)')
        }
    }
}

module.exports = Helper
