const bcrypt = require('bcrypt')
const debug = require('debug')('48hr-email:inbox-lock')

/**
 * InboxLock - Manages inbox locking for registered users
 * Uses user_locked_inboxes table from the users database
 */
class InboxLock {
    constructor(userRepository) {
        this.userRepository = userRepository
        this.db = userRepository.db
        debug('InboxLock initialized with user database')
    }

    /**
     * Lock an inbox for a user (no separate password needed - uses account ownership)
     * @param {number} userId - User ID
     * @param {string} address - Inbox address to lock
     * @returns {Promise<boolean>} - Success status
     */
    async lock(userId, address) {
        try {
            // Check if user can lock more inboxes (5 max)
            if (!this.canLockMore(userId)) {
                throw new Error('You have reached the maximum of 5 locked inboxes')
            }

            // Check if inbox is already locked
            if (this.isLocked(address)) {
                throw new Error('This inbox is already locked')
            }

            const now = Date.now()

            const stmt = this.db.prepare(`
                INSERT INTO user_locked_inboxes (user_id, inbox_address, password_hash, locked_at, last_accessed)
                VALUES (?, ?, ?, ?, ?)
            `)

            // Use empty password hash since we rely on user authentication
            stmt.run(userId, address.toLowerCase(), '', now, now)
            debug(`Inbox ${address} locked by user ${userId}`)
            return true
        } catch (error) {
            debug(`Failed to lock inbox ${address}:`, error.message)
            throw error
        }
    }

    /**
     * Unlock an inbox (verify user owns the lock)
     * @param {number} userId - User ID attempting to unlock
     * @param {string} address - Inbox address to unlock
     * @returns {Promise<Object|null>} - Lock info if successful, null if failed
     */
    async unlock(userId, address) {
        try {
            const stmt = this.db.prepare(`
                SELECT * FROM user_locked_inboxes 
                WHERE user_id = ? AND inbox_address = ?
            `)
            const lock = stmt.get(userId, address.toLowerCase())

            if (!lock) {
                debug(`No lock found for user ${userId} on inbox ${address}`)
                return null
            }

            // Update last access
            this.updateAccess(userId, address)
            debug(`Inbox ${address} unlocked by user ${userId}`)
            return lock
        } catch (error) {
            debug(`Error unlocking inbox ${address}:`, error.message)
            return null
        }
    }

    /**
     * Check if an inbox is locked by any user
     * @param {string} address - Inbox address
     * @returns {boolean} - True if locked
     */
    isLocked(address) {
        const stmt = this.db.prepare(`
            SELECT inbox_address FROM user_locked_inboxes 
            WHERE inbox_address = ?
        `)
        const result = stmt.get(address.toLowerCase())
        return result !== undefined
    }

    /**
     * Check if an inbox is locked by a specific user
     * @param {string} address - Inbox address
     * @param {number} userId - User ID
     * @returns {boolean} - True if locked by this user
     */
    isLockedByUser(address, userId) {
        const stmt = this.db.prepare(`
            SELECT inbox_address FROM user_locked_inboxes 
            WHERE inbox_address = ? AND user_id = ?
        `)
        const result = stmt.get(address.toLowerCase(), userId)
        return result !== undefined
    }

    /**
     * Update last access timestamp for a locked inbox
     * @param {number} userId - User ID
     * @param {string} address - Inbox address
     */
    updateAccess(userId, address) {
        const stmt = this.db.prepare(`
            UPDATE user_locked_inboxes 
            SET last_accessed = ? 
            WHERE user_id = ? AND inbox_address = ?
        `)
        stmt.run(Date.now(), userId, address.toLowerCase())
        debug(`Updated last access for inbox ${address} by user ${userId}`)
    }

    /**
     * Get inactive locked inboxes (user hasn't logged in for X hours)
     * @param {number} hoursThreshold - Hours of user inactivity (no login)
     * @returns {Array<Object>} - Array of {userId, address} for inactive locks
     */
    getInactive(hoursThreshold) {
        const cutoff = Date.now() - (hoursThreshold * 60 * 60 * 1000)
        const stmt = this.db.prepare(`
            SELECT ul.user_id, ul.inbox_address, u.last_login
            FROM user_locked_inboxes ul
            JOIN users u ON ul.user_id = u.id
            WHERE u.last_login IS NULL OR u.last_login < ?
        `)
        return stmt.all(cutoff).map(row => ({
            userId: row.user_id,
            address: row.inbox_address
        }))
    }

    /**
     * Release (unlock) an inbox
     * @param {number} userId - User ID
     * @param {string} address - Inbox address to release
     */
    release(userId, address) {
        const stmt = this.db.prepare(`
            DELETE FROM user_locked_inboxes 
            WHERE user_id = ? AND inbox_address = ?
        `)
        stmt.run(userId, address.toLowerCase())
        debug(`Released lock on inbox ${address} by user ${userId}`)
    }

    /**
     * Get all locked inboxes (for admin/debugging)
     * @returns {Array<string>} - Array of all locked inbox addresses
     */
    getAllLocked() {
        const stmt = this.db.prepare('SELECT inbox_address FROM user_locked_inboxes')
        return stmt.all().map(row => row.inbox_address)
    }

    /**
     * Get all locked inboxes for a specific user
     * @param {number} userId - User ID
     * @returns {Array<Object>} - Array of locked inbox objects with metadata
     */
    getUserLockedInboxes(userId) {
        const stmt = this.db.prepare(`
            SELECT inbox_address, locked_at, last_accessed 
            FROM user_locked_inboxes 
            WHERE user_id = ?
            ORDER BY locked_at DESC
        `)
        const inboxes = stmt.all(userId)

        return inboxes.map(inbox => ({
            address: inbox.inbox_address,
            lockedAt: inbox.locked_at,
            lastAccess: inbox.last_accessed,
            lastAccessedAgo: this._formatTimeAgo(inbox.last_accessed)
        }))
    }

    /**
     * Check if user can lock more inboxes (5 max)
     * @param {number} userId - User ID
     * @returns {boolean} - True if user can lock more
     */
    canLockMore(userId) {
        const stmt = this.db.prepare(`
            SELECT COUNT(*) as count 
            FROM user_locked_inboxes 
            WHERE user_id = ?
        `)
        const result = stmt.get(userId)
        return result.count < 5
    }

    /**
     * Get count of locked inboxes for a user
     * @param {number} userId - User ID
     * @returns {number} - Number of locked inboxes
     */
    getUserLockedCount(userId) {
        const stmt = this.db.prepare(`
            SELECT COUNT(*) as count 
            FROM user_locked_inboxes 
            WHERE user_id = ?
        `)
        const result = stmt.get(userId)
        return result.count
    }

    _formatTimeAgo(timestamp) {
        const seconds = Math.floor((Date.now() - timestamp) / 1000)

        if (seconds < 60) return 'just now'
        if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`
        if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`
        return `${Math.floor(seconds / 86400)} days ago`
    }
}

module.exports = InboxLock
