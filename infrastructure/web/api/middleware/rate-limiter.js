/**
 * API Rate Limiter
 * Limits requests per token (if authenticated) or IP address (if not)
 */

class RateLimiter {
    constructor() {
        this.requests = new Map() // key -> {count, resetTime}

        // Cleanup old entries every 5 minutes
        setInterval(() => this.cleanup(), 5 * 60 * 1000)
    }

    cleanup() {
        const now = Date.now()
        for (const [key, data] of this.requests.entries()) {
            if (data.resetTime < now) {
                this.requests.delete(key)
            }
        }
    }

    /**
     * Check and increment rate limit
     * @param {string} key - Identifier (token or IP)
     * @param {number} maxRequests - Max requests allowed
     * @param {number} windowMs - Time window in milliseconds
     * @returns {object} {allowed: boolean, remaining: number, resetTime: number}
     */
    checkLimit(key, maxRequests, windowMs) {
        const now = Date.now()
        const data = this.requests.get(key)

        // No previous requests or window expired
        if (!data || data.resetTime < now) {
            this.requests.set(key, {
                count: 1,
                resetTime: now + windowMs
            })
            return {
                allowed: true,
                remaining: maxRequests - 1,
                resetTime: now + windowMs
            }
        }

        // Within window - check if limit exceeded
        if (data.count >= maxRequests) {
            return {
                allowed: false,
                remaining: 0,
                resetTime: data.resetTime
            }
        }

        // Increment count
        data.count++
            return {
                allowed: true,
                remaining: maxRequests - data.count,
                resetTime: data.resetTime
            }
    }
}

// Global rate limiter instance
const rateLimiter = new RateLimiter()

/**
 * Create rate limiting middleware
 * @param {number} maxRequests - Maximum requests allowed (default: 100)
 * @param {number} windowMs - Time window in milliseconds (default: 60000 = 1 minute)
 */
function createRateLimiter(maxRequests = 100, windowMs = 60000) {
    return function(req, res, next) {
        // Determine key: use token if authenticated via Bearer, otherwise IP
        let key
        if (req.authMethod === 'token' && req.user) {
            key = `token:${req.user.id}`
        } else {
            // Get IP address (consider proxy headers)
            key = `ip:${req.ip || req.connection.remoteAddress}`
        }

        const result = rateLimiter.checkLimit(key, maxRequests, windowMs)

        // Set rate limit headers
        res.setHeader('X-RateLimit-Limit', maxRequests)
        res.setHeader('X-RateLimit-Remaining', result.remaining)
        res.setHeader('X-RateLimit-Reset', Math.ceil(result.resetTime / 1000))

        if (!result.allowed) {
            const retryAfter = Math.ceil((result.resetTime - Date.now()) / 1000)
            res.setHeader('Retry-After', retryAfter)
            return res.apiError(
                'Rate limit exceeded. Please try again later.',
                'RATE_LIMIT_EXCEEDED',
                429
            )
        }

        next()
    }
}

module.exports = createRateLimiter
