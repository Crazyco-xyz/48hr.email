const Database = require('better-sqlite3')
const debug = require('debug')('48hr-email:user-repository')
const fs = require('fs')
const path = require('path')

/**
 * User Repository - Data access layer for user accounts
 * Manages users, their verified forwarding emails, and locked inboxes
 */
class UserRepository {
    constructor(dbPath) {
        this.dbPath = dbPath
        this.db = null
        this._initialize()
    }

    /**
     * Initialize database connection and create schema
     * @private
     */
    _initialize() {
        try {
            // Ensure directory exists
            const dbDir = path.dirname(this.dbPath)
            if (!fs.existsSync(dbDir)) {
                fs.mkdirSync(dbDir, { recursive: true })
                debug(`Created database directory: ${dbDir}`)
            }

            // Open database connection
            this.db = new Database(this.dbPath)
            this.db.pragma('journal_mode = WAL')
            debug(`Connected to user database: ${this.dbPath}`)

            // Load and execute schema
            const schemaPath = path.join(__dirname, '../schema.sql')
            const schema = fs.readFileSync(schemaPath, 'utf8')
            this.db.exec(schema)
            debug('Database schema initialized')
        } catch (error) {
            console.error('Failed to initialize user database:', error)
            throw error
        }
    }

    /**
     * Create a new user
     * @param {string} username - Unique username (3-20 chars)
     * @param {string} passwordHash - Bcrypt password hash
     * @returns {Object} - Created user object {id, username, created_at}
     */
    createUser(username, passwordHash) {
        try {
            const now = Date.now()
            const stmt = this.db.prepare(`
                INSERT INTO users (username, password_hash, created_at)
                VALUES (?, ?, ?)
            `)
            const result = stmt.run(username.toLowerCase(), passwordHash, now)

            debug(`User created: ${username} (ID: ${result.lastInsertRowid})`)

            return {
                id: result.lastInsertRowid,
                username: username.toLowerCase(),
                created_at: now
            }
        } catch (error) {
            if (error.message.includes('UNIQUE constraint failed')) {
                debug(`Username already exists: ${username}`)
                throw new Error('Username already exists')
            }
            debug(`Error creating user: ${error.message}`)
            throw error
        }
    }

    /**
     * Get user by username
     * @param {string} username
     * @returns {Object|null} - User object or null if not found
     */
    getUserByUsername(username) {
        try {
            const stmt = this.db.prepare(`
                SELECT id, username, password_hash, created_at, last_login
                FROM users
                WHERE username = ?
            `)
            const user = stmt.get(username.toLowerCase())

            if (user) {
                debug(`User found: ${username} (ID: ${user.id})`)
            } else {
                debug(`User not found: ${username}`)
            }

            return user || null
        } catch (error) {
            debug(`Error getting user by username: ${error.message}`)
            throw error
        }
    }

    /**
     * Get user by ID
     * @param {number} userId
     * @returns {Object|null} - User object or null if not found
     */
    getUserById(userId) {
        try {
            const stmt = this.db.prepare(`
                SELECT id, username, password_hash, created_at, last_login
                FROM users
                WHERE id = ?
            `)
            const user = stmt.get(userId)

            if (user) {
                debug(`User found by ID: ${userId}`)
            } else {
                debug(`User not found by ID: ${userId}`)
            }

            return user || null
        } catch (error) {
            debug(`Error getting user by ID: ${error.message}`)
            throw error
        }
    }

    /**
     * Update user's last login timestamp
     * @param {number} userId
     */
    updateLastLogin(userId) {
        try {
            const now = Date.now()
            const stmt = this.db.prepare(`
                UPDATE users
                SET last_login = ?
                WHERE id = ?
            `)
            stmt.run(now, userId)
            debug(`Updated last login for user ID: ${userId}`)
        } catch (error) {
            debug(`Error updating last login: ${error.message}`)
            throw error
        }
    }

    /**
     * Add a verified forwarding email for a user
     * @param {number} userId
     * @param {string} email - Verified email address
     * @returns {Object} - Created forward email entry
     */
    addForwardEmail(userId, email) {
        try {
            const now = Date.now()
            const stmt = this.db.prepare(`
                INSERT INTO user_forward_emails (user_id, email, verified_at, created_at)
                VALUES (?, ?, ?, ?)
            `)
            const result = stmt.run(userId, email.toLowerCase(), now, now)

            debug(`Forward email added for user ${userId}: ${email}`)

            return {
                id: result.lastInsertRowid,
                user_id: userId,
                email: email.toLowerCase(),
                verified_at: now,
                created_at: now
            }
        } catch (error) {
            if (error.message.includes('UNIQUE constraint failed')) {
                debug(`Forward email already exists for user ${userId}: ${email}`)
                throw new Error('Email already added to your account')
            }
            debug(`Error adding forward email: ${error.message}`)
            throw error
        }
    }

    /**
     * Get all verified forwarding emails for a user
     * @param {number} userId
     * @returns {Array} - Array of email objects with formatted timestamps
     */
    getForwardEmails(userId) {
        try {
            const stmt = this.db.prepare(`
                SELECT id, email, verified_at, created_at
                FROM user_forward_emails
                WHERE user_id = ?
                ORDER BY created_at DESC
            `)
            const emails = stmt.all(userId)

            // Add formatted timestamp
            const formatted = emails.map(email => ({
                ...email,
                verifiedAgo: this._formatTimeAgo(email.verified_at)
            }))

            debug(`Found ${emails.length} forward emails for user ${userId}`)
            return formatted
        } catch (error) {
            debug(`Error getting forward emails: ${error.message}`)
            throw error
        }
    }

    /**
     * Format timestamp to relative time
     * @param {number} timestamp - Unix timestamp in milliseconds
     * @returns {string} - Formatted time ago string
     * @private
     */
    _formatTimeAgo(timestamp) {
        const seconds = Math.floor((Date.now() - timestamp) / 1000)

        if (seconds < 60) return 'just now'
        if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`
        if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`
        if (seconds < 2592000) return `${Math.floor(seconds / 86400)} days ago`
        return `${Math.floor(seconds / 2592000)} months ago`
    }

    /**
     * Check if user has a specific forwarding email
     * @param {number} userId
     * @param {string} email
     * @returns {boolean}
     */
    hasForwardEmail(userId, email) {
        try {
            const stmt = this.db.prepare(`
                SELECT COUNT(*) as count
                FROM user_forward_emails
                WHERE user_id = ? AND email = ?
            `)
            const result = stmt.get(userId, email.toLowerCase())
            return result.count > 0
        } catch (error) {
            debug(`Error checking forward email: ${error.message}`)
            throw error
        }
    }

    /**
     * Remove a forwarding email from user's account
     * @param {number} userId
     * @param {string} email
     * @returns {boolean} - True if deleted, false if not found
     */
    removeForwardEmail(userId, email) {
        try {
            const stmt = this.db.prepare(`
                DELETE FROM user_forward_emails
                WHERE user_id = ? AND email = ?
            `)
            const result = stmt.run(userId, email.toLowerCase())

            if (result.changes > 0) {
                debug(`Forward email removed for user ${userId}: ${email}`)
                return true
            } else {
                debug(`Forward email not found for user ${userId}: ${email}`)
                return false
            }
        } catch (error) {
            debug(`Error removing forward email: ${error.message}`)
            throw error
        }
    }

    /**
     * Get count of user's forwarding emails
     * @param {number} userId
     * @returns {number}
     */
    getForwardEmailCount(userId) {
        try {
            const stmt = this.db.prepare(`
                SELECT COUNT(*) as count
                FROM user_forward_emails
                WHERE user_id = ?
            `)
            const result = stmt.get(userId)
            return result.count
        } catch (error) {
            debug(`Error getting forward email count: ${error.message}`)
            throw error
        }
    }

    /**
     * Get user statistics
     * @param {number} userId
     * @param {Object} config - Application configuration
     * @returns {Object} - {lockedInboxesCount, forwardEmailsCount, accountAge, maxLockedInboxes, maxForwardEmails, lockReleaseHours}
     */
    getUserStats(userId, config = {}) {
        try {
            const user = this.getUserById(userId)
            if (!user) {
                return null
            }

            const lockedInboxesStmt = this.db.prepare(`
                SELECT COUNT(*) as count FROM user_locked_inboxes WHERE user_id = ?
            `)
            const forwardEmailsStmt = this.db.prepare(`
                SELECT COUNT(*) as count FROM user_forward_emails WHERE user_id = ?
            `)

            const lockedInboxesCount = lockedInboxesStmt.get(userId).count
            const forwardEmailsCount = forwardEmailsStmt.get(userId).count
            const accountAgeMs = Date.now() - user.created_at
            const accountAge = this._formatAccountAge(accountAgeMs)

            debug(`Stats for user ${userId}: ${lockedInboxesCount} locked inboxes, ${forwardEmailsCount} forward emails`)

            return {
                lockedInboxesCount,
                forwardEmailsCount,
                accountAge,
                createdAt: user.created_at,
                lastLogin: user.last_login,
                maxLockedInboxes: config.maxLockedInboxes || 5,
                maxForwardEmails: config.maxForwardEmails || 5,
                lockReleaseHours: config.lockReleaseHours || 720
            }
        } catch (error) {
            debug(`Error getting user stats: ${error.message}`)
            throw error
        }
    }

    /**
     * Format account age in human-readable format
     * @param {number} ms - Milliseconds since account creation
     * @returns {string} - Formatted age
     * @private
     */
    _formatAccountAge(ms) {
        const days = Math.floor(ms / (1000 * 60 * 60 * 24))
        if (days === 0) return 'Today'
        if (days === 1) return '1 day'
        if (days < 30) return `${days} days`
        if (days < 365) return `${Math.floor(days / 30)} months`
        return `${Math.floor(days / 365)} years`
    }

    /**
     * Verify user password
     * @param {number} userId - User ID
     * @param {string} password - Plain text password to verify
     * @returns {Promise<boolean>} - True if password matches
     */
    async verifyPassword(userId, password) {
        try {
            const bcrypt = require('bcrypt')
            const stmt = this.db.prepare('SELECT password_hash FROM users WHERE id = ?')
            const user = stmt.get(userId)

            if (!user) {
                debug(`User not found for password verification: ${userId}`)
                return false
            }

            const isValid = await bcrypt.compare(password, user.password_hash)
            debug(`Password verification for user ${userId}: ${isValid ? 'success' : 'failed'}`)
            return isValid
        } catch (error) {
            debug(`Error verifying password: ${error.message}`)
            return false
        }
    }

    /**
     * Update user password
     * @param {number} userId - User ID
     * @param {string} newPassword - New plain text password
     * @returns {Promise<boolean>} - True if successful
     */
    async updatePassword(userId, newPassword) {
        try {
            const bcrypt = require('bcrypt')
            const saltRounds = 10
            const passwordHash = await bcrypt.hash(newPassword, saltRounds)

            const stmt = this.db.prepare(`
                UPDATE users
                SET password_hash = ?
                WHERE id = ?
            `)
            const result = stmt.run(passwordHash, userId)

            if (result.changes > 0) {
                debug(`Password updated for user ${userId}`)
                return true
            } else {
                debug(`User not found for password update: ${userId}`)
                return false
            }
        } catch (error) {
            debug(`Error updating password: ${error.message}`)
            throw error
        }
    }

    /**
     * Delete user account and all associated data
     * @param {number} userId - User ID
     * @returns {boolean} - True if successful
     */
    deleteUser(userId) {
        try {
            // Delete in order due to foreign key constraints:
            // 1. forward_emails (references users.id)
            // 2. users

            const deleteForwardEmails = this.db.prepare('DELETE FROM forward_emails WHERE user_id = ?')
            const deleteUser = this.db.prepare('DELETE FROM users WHERE id = ?')

            // Use transaction for atomicity
            const deleteTransaction = this.db.transaction((uid) => {
                deleteForwardEmails.run(uid)
                const result = deleteUser.run(uid)
                return result.changes > 0
            })

            const success = deleteTransaction(userId)

            if (success) {
                debug(`User ${userId} and all associated data deleted`)
            } else {
                debug(`User ${userId} not found for deletion`)
            }

            return success
        } catch (error) {
            debug(`Error deleting user: ${error.message}`)
            throw error
        }
    }

    /**
     * Close database connection
     */
    close() {
        if (this.db) {
            this.db.close()
            debug('Database connection closed')
        }
    }
}

module.exports = UserRepository
