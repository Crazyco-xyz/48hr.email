const bcrypt = require('bcrypt')
const debug = require('debug')('48hr-email:auth-service')

/**
 * Authentication Service - Business logic for user authentication
 * Handles registration, login, validation, and password management
 */
class AuthService {
    constructor(userRepository, config) {
        this.userRepository = userRepository
        this.config = config
        this.BCRYPT_ROUNDS = 12
    }

    /**
     * Register a new user
     * @param {string} username - Username (3-20 alphanumeric + underscore)
     * @param {string} password - Password (min 8 chars, complexity requirements)
     * @returns {Promise<{success: boolean, user?: Object, error?: string}>}
     */
    async register(username, password) {
        // Validate username
        const usernameValidation = this.validateUsername(username)
        if (!usernameValidation.valid) {
            debug(`Registration failed: ${usernameValidation.error}`)
            return { success: false, error: usernameValidation.error }
        }

        // Validate password
        const passwordValidation = this.validatePassword(password)
        if (!passwordValidation.valid) {
            debug(`Registration failed: ${passwordValidation.error}`)
            return { success: false, error: passwordValidation.error }
        }

        try {
            // Hash password
            const passwordHash = await this.hashPassword(password)

            // Create user
            const user = this.userRepository.createUser(username, passwordHash)

            debug(`User registered successfully: ${username} (ID: ${user.id})`)

            return {
                success: true,
                user: {
                    id: user.id,
                    username: user.username,
                    created_at: user.created_at
                }
            }
        } catch (error) {
            if (error.message === 'Username already exists') {
                debug(`Registration failed: Username already exists: ${username}`)
                return { success: false, error: 'Username already exists' }
            }

            debug(`Registration error: ${error.message}`)
            return { success: false, error: 'Registration failed. Please try again.' }
        }
    }

    /**
     * Login user with username and password
     * @param {string} username
     * @param {string} password
     * @returns {Promise<{success: boolean, user?: Object, error?: string}>}
     */
    async login(username, password) {
        if (!username || !password) {
            debug('Login failed: Missing username or password')
            return { success: false, error: 'Username and password are required' }
        }

        try {
            // Get user from database
            const user = this.userRepository.getUserByUsername(username)

            if (!user) {
                debug(`Login failed: User not found: ${username}`)
                    // Use generic error to prevent username enumeration
                return { success: false, error: 'Invalid username or password' }
            }

            // Verify password
            const isValid = await this.verifyPassword(password, user.password_hash)

            if (!isValid) {
                debug(`Login failed: Invalid password for user: ${username}`)
                return { success: false, error: 'Invalid username or password' }
            }

            // Update last login
            this.userRepository.updateLastLogin(user.id)

            debug(`User logged in successfully: ${username} (ID: ${user.id})`)

            return {
                success: true,
                user: {
                    id: user.id,
                    username: user.username,
                    created_at: user.created_at,
                    last_login: Date.now()
                }
            }
        } catch (error) {
            debug(`Login error: ${error.message}`)
            return { success: false, error: 'Login failed. Please try again.' }
        }
    }

    /**
     * Validate username format
     * @param {string} username
     * @returns {{valid: boolean, error?: string}}
     */
    validateUsername(username) {
        if (!username) {
            return { valid: false, error: 'Username is required' }
        }

        if (typeof username !== 'string') {
            return { valid: false, error: 'Username must be a string' }
        }

        const trimmed = username.trim()

        if (trimmed.length < 3) {
            return { valid: false, error: 'Username must be at least 3 characters' }
        }

        if (trimmed.length > 20) {
            return { valid: false, error: 'Username must be at most 20 characters' }
        }

        // Only allow alphanumeric and underscore
        const usernameRegex = /^[a-zA-Z0-9_]+$/
        if (!usernameRegex.test(trimmed)) {
            return { valid: false, error: 'Username can only contain letters, numbers, and underscores' }
        }

        return { valid: true }
    }

    /**
     * Validate password strength
     * @param {string} password
     * @returns {{valid: boolean, error?: string}}
     */
    validatePassword(password) {
        if (!password) {
            return { valid: false, error: 'Password is required' }
        }

        if (typeof password !== 'string') {
            return { valid: false, error: 'Password must be a string' }
        }

        if (password.length < 8) {
            return { valid: false, error: 'Password must be at least 8 characters' }
        }

        if (password.length > 72) {
            // Bcrypt max length
            return { valid: false, error: 'Password must be at most 72 characters' }
        }

        // Check for at least one uppercase letter
        if (!/[A-Z]/.test(password)) {
            return { valid: false, error: 'Password must contain at least one uppercase letter' }
        }

        // Check for at least one lowercase letter
        if (!/[a-z]/.test(password)) {
            return { valid: false, error: 'Password must contain at least one lowercase letter' }
        }

        // Check for at least one number
        if (!/[0-9]/.test(password)) {
            return { valid: false, error: 'Password must contain at least one number' }
        }

        return { valid: true }
    }

    /**
     * Hash password using bcrypt
     * @param {string} password
     * @returns {Promise<string>} - Password hash
     */
    async hashPassword(password) {
        try {
            const hash = await bcrypt.hash(password, this.BCRYPT_ROUNDS)
            debug('Password hashed successfully')
            return hash
        } catch (error) {
            debug(`Error hashing password: ${error.message}`)
            throw new Error('Failed to hash password')
        }
    }

    /**
     * Verify password against hash
     * @param {string} password
     * @param {string} hash
     * @returns {Promise<boolean>}
     */
    async verifyPassword(password, hash) {
        try {
            const isValid = await bcrypt.compare(password, hash)
            debug(`Password verification: ${isValid ? 'success' : 'failed'}`)
            return isValid
        } catch (error) {
            debug(`Error verifying password: ${error.message}`)
            return false
        }
    }

    /**
     * Get user for session (without sensitive data)
     * @param {number} userId
     * @returns {Object|null} - User session data
     */
    getUserForSession(userId) {
        try {
            const user = this.userRepository.getUserById(userId)
            if (!user) {
                return null
            }

            return {
                id: user.id,
                username: user.username,
                created_at: user.created_at,
                last_login: user.last_login
            }
        } catch (error) {
            debug(`Error getting user for session: ${error.message}`)
            return null
        }
    }
}

module.exports = AuthService
