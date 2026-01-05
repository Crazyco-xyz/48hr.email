/**
 * Mock Auth Service for UX Debug Mode
 * Provides dummy authentication without database
 */

const crypto = require('crypto')

class MockAuthService {
    constructor() {
        // Mock user data
        this.mockUser = {
            id: 1,
            username: 'demo',
            password_hash: 'mock', // Any password works
            created_at: Date.now() - 86400000, // 1 day ago
            last_login: Date.now()
        }
    }

    async login(username, password) {
        // Accept any username/password in debug mode
        return {
            success: true,
            user: this.mockUser
        }
    }

    async register(username, password) {
        // Accept any registration
        return {
            success: true,
            user: this.mockUser
        }
    }
}

module.exports = MockAuthService
