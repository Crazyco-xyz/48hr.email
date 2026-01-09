const Helper = require('../application/helper-service')
const helper = new Helper()

class ApiTokenRepository {
    constructor(db) {
        if (!db) {
            throw new Error('ApiTokenRepository requires a database connection')
        }
        this.db = db
    }

    /**
     * Generate and store a new API token for a user
     * If user already has a token, it will be replaced
     * @param {number} userId 
     * @returns {string} The generated token
     */
    create(userId) {
        const token = helper.generateVerificationToken() // 64 chars hex
        const now = Date.now()

        // Delete existing token if any (one token per user)
        this.db.prepare('DELETE FROM api_tokens WHERE user_id = ?').run(userId)

        // Insert new token
        this.db.prepare(`
            INSERT INTO api_tokens (user_id, token, created_at)
            VALUES (?, ?, ?)
        `).run(userId, token, now)

        return token
    }

    /**
     * Get token information by token string
     * @param {string} token 
     * @returns {object|null} Token info with user data
     */
    getByToken(token) {
        return this.db.prepare(`
            SELECT 
                t.id, 
                t.user_id, 
                t.token, 
                t.created_at, 
                t.last_used,
                u.username
            FROM api_tokens t
            JOIN users u ON t.user_id = u.id
            WHERE t.token = ?
        `).get(token)
    }

    /**
     * Get token information by user ID
     * @param {number} userId 
     * @returns {object|null} Token info (without sensitive data in some contexts)
     */
    getByUserId(userId) {
        return this.db.prepare(`
            SELECT id, user_id, token, created_at, last_used
            FROM api_tokens
            WHERE user_id = ?
        `).get(userId)
    }

    /**
     * Check if user has an API token
     * @param {number} userId 
     * @returns {boolean}
     */
    hasToken(userId) {
        const result = this.db.prepare(`
            SELECT COUNT(*) as count
            FROM api_tokens
            WHERE user_id = ?
        `).get(userId)
        return result.count > 0
    }

    /**
     * Revoke (delete) user's API token
     * @param {number} userId 
     * @returns {boolean} True if token was deleted
     */
    revoke(userId) {
        const result = this.db.prepare(`
            DELETE FROM api_tokens
            WHERE user_id = ?
        `).run(userId)
        return result.changes > 0
    }

    /**
     * Update the last_used timestamp for a token
     * @param {string} token 
     */
    updateLastUsed(token) {
        const now = Date.now()
        this.db.prepare(`
            UPDATE api_tokens
            SET last_used = ?
            WHERE token = ?
        `).run(now, token)
    }
}

module.exports = ApiTokenRepository
