/**
 * Mock User Repository for UX Debug Mode
 * Provides dummy user data without database
 */

const debug = require('debug')('48hr-email:mock-user-repo')

class MockUserRepository {
    constructor(config) {
        this.config = config

        // Generate a random forwarding email (fixed for this server instance)
        const randomGmailName = Math.random().toString(36).substring(2, 10)
        this.mockForwardEmail = `${randomGmailName}@gmail.com`

        // Generate a random locked inbox (fixed for this server instance)
        const randomWords = ['alpha', 'beta', 'gamma', 'delta', 'omega', 'sigma', 'theta']
        const word1 = randomWords[Math.floor(Math.random() * randomWords.length)]
        const word2 = randomWords[Math.floor(Math.random() * randomWords.length)]
        const num = Math.floor(Math.random() * 999)
        this.mockLockedInbox = `${word1}${word2}${num}@${config.email.domains[0]}`

        // Store the initial values to reset to
        this.initialForwardEmail = this.mockForwardEmail
        this.initialLockedInbox = this.mockLockedInbox

        // In-memory storage that can be modified during a session
        this.forwardEmails = new Set([this.mockForwardEmail])
        this.lockedInboxes = new Set([this.mockLockedInbox])

        debug(`Mock forward email: ${this.mockForwardEmail}`)
        debug(`Mock locked inbox: ${this.mockLockedInbox}`)
    }

    // Reset to initial state (called on new page loads)
    reset() {
        this.forwardEmails = new Set([this.initialForwardEmail])
        this.lockedInboxes = new Set([this.initialLockedInbox])
        debug('Mock data reset to initial state')
    }

    // User methods
    getUserById(userId) {
        if (userId === 1) {
            return {
                id: 1,
                username: 'demo',
                password_hash: 'mock',
                created_at: Date.now() - 86400000,
                last_login: Date.now()
            }
        }
        return null
    }

    getUserByUsername(username) {
        return this.getUserById(1)
    }

    updateLastLogin(userId) {
        // No-op in mock
        return true
    }

    // Forward email methods
    getForwardEmails(userId) {
        if (userId === 1) {
            const emails = []
            let id = 1
            for (const email of this.forwardEmails) {
                emails.push({
                    id: id++,
                    user_id: 1,
                    email: email,
                    verified: true,
                    verification_token: null,
                    created_at: Date.now() - 3600000
                })
            }
            return emails
        }
        return []
    }

    addForwardEmail(userId, email, token) {
        this.forwardEmails.add(email)
        return {
            id: this.forwardEmails.size,
            user_id: userId,
            email: email,
            verified: false,
            verification_token: token,
            created_at: Date.now()
        }
    }

    verifyForwardEmail(token) {
        // In mock mode, just return success
        return true
    }

    removeForwardEmail(userId, email) {
        const deleted = this.forwardEmails.delete(email)
        debug(`Removed forward email: ${email} (success: ${deleted})`)
        return deleted
    }

    deleteForwardEmail(userId, email) {
        // Alias for removeForwardEmail
        return this.removeForwardEmail(userId, email)
    }

    // User stats
    getUserStats(userId, config) {
        return {
            lockedInboxesCount: this.lockedInboxes.size,
            forwardEmailsCount: this.forwardEmails.size,
            accountAge: Math.floor((Date.now() - (Date.now() - 86400000)) / 86400000),
            maxLockedInboxes: config.maxLockedInboxes || 5,
            maxForwardEmails: config.maxForwardEmails || 5,
            lockReleaseHours: config.lockReleaseHours || 720
        }
    }

    // Cleanup - no-op
    close() {
        debug('Mock user repository closed')
    }
}

module.exports = MockUserRepository
