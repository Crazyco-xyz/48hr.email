const debug = require('debug')('48hr-email:verification-store')

/**
 * In-memory store for email verification tokens
 * Manages pending verifications with expiration and rate limiting
 */
class VerificationStore {
    constructor() {
        // Map of token -> verification data
        this.verifications = new Map()
            // Map of destinationEmail -> last verification request timestamp
        this.lastVerificationRequests = new Map()

        // Cleanup expired tokens every 5 minutes
        this.cleanupInterval = setInterval(() => {
            this.cleanup()
        }, 5 * 60 * 1000)

        debug('VerificationStore initialized')
    }

    /**
     * Create a new verification entry
     * @param {string} token - Unique verification token
     * @param {string} destinationEmail - Email address being verified
     * @param {Object} metadata - Additional data (sourceAddress, uids, etc.)
     * @returns {Object} - Verification entry
     */
    createVerification(token, destinationEmail, metadata = {}) {
        const now = Date.now()
        const expiresAt = now + (15 * 60 * 1000) // 15 minutes

        const verification = {
            token,
            destinationEmail: destinationEmail.toLowerCase(),
            createdAt: now,
            expiresAt,
            metadata
        }

        this.verifications.set(token, verification)
        this.lastVerificationRequests.set(destinationEmail.toLowerCase(), now)

        debug(`Created verification for ${destinationEmail}, token expires in 15 minutes`)
        return verification
    }

    /**
     * Verify a token and return the verification data if valid
     * @param {string} token - Token to verify
     * @returns {Object|null} - Verification data or null if invalid/expired
     */
    verifyToken(token) {
        const verification = this.verifications.get(token)

        if (!verification) {
            debug(`Token not found: ${token}`)
            return null
        }

        const now = Date.now()
        if (now > verification.expiresAt) {
            debug(`Token expired: ${token}`)
            this.verifications.delete(token)
            return null
        }

        debug(`Token verified successfully for ${verification.destinationEmail}`)
            // Remove token after successful verification (one-time use)
        this.verifications.delete(token)
        return verification
    }

    /**
     * Get the last verification request time for an email
     * @param {string} destinationEmail - Email address to check
     * @returns {number|null} - Timestamp of last request or null
     */
    getLastVerificationTime(destinationEmail) {
        return this.lastVerificationRequests.get(destinationEmail.toLowerCase()) || null
    }

    /**
     * Check if enough time has passed since last verification request
     * @param {string} destinationEmail - Email address to check
     * @param {number} cooldownMs - Cooldown period in milliseconds (default: 5 minutes)
     * @returns {boolean} - True if can request verification, false if still in cooldown
     */
    canRequestVerification(destinationEmail, cooldownMs = 5 * 60 * 1000) {
        const lastRequest = this.getLastVerificationTime(destinationEmail)

        if (!lastRequest) {
            return true
        }

        const now = Date.now()
        const timeSinceLastRequest = now - lastRequest
        const canRequest = timeSinceLastRequest >= cooldownMs

        if (!canRequest) {
            const remainingSeconds = Math.ceil((cooldownMs - timeSinceLastRequest) / 1000)
            debug(`Verification cooldown active for ${destinationEmail}, ${remainingSeconds}s remaining`)
        }

        return canRequest
    }

    /**
     * Clean up expired tokens and old rate limit entries
     */
    cleanup() {
        const now = Date.now()
        let expiredCount = 0
        let rateLimitCleanupCount = 0

        // Clean expired tokens
        for (const [token, verification] of this.verifications.entries()) {
            if (now > verification.expiresAt) {
                this.verifications.delete(token)
                expiredCount++
            }
        }

        // Clean old rate limit entries (older than 1 hour)
        for (const [email, timestamp] of this.lastVerificationRequests.entries()) {
            if (now - timestamp > 60 * 60 * 1000) {
                this.lastVerificationRequests.delete(email)
                rateLimitCleanupCount++
            }
        }

        if (expiredCount > 0 || rateLimitCleanupCount > 0) {
            debug(`Cleanup: removed ${expiredCount} expired tokens, ${rateLimitCleanupCount} old rate limit entries`)
        }
    }

    /**
     * Get statistics about the store
     * @returns {Object} - Store statistics
     */
    getStats() {
        return {
            pendingVerifications: this.verifications.size,
            rateLimitEntries: this.lastVerificationRequests.size
        }
    }

    /**
     * Destroy the store and cleanup interval
     */
    destroy() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval)
        }
        this.verifications.clear()
        this.lastVerificationRequests.clear()
        debug('VerificationStore destroyed')
    }
}

module.exports = VerificationStore
