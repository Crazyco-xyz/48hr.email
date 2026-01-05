/**
 * Global error handler for API routes
 * Catches all errors and formats them as consistent JSON responses
 */
function errorHandler(err, req, res, next) {
    // Don't handle if response already sent
    if (res.headersSent) {
        return next(err)
    }

    // Log error for debugging
    console.error('API Error:', err)

    // Default error response
    let statusCode = 500
    let message = 'Internal server error'
    let code = 'INTERNAL_ERROR'

    // Handle specific error types
    if (err.statusCode) {
        statusCode = err.statusCode
    }

    if (err.message) {
        message = err.message
    }

    if (err.code) {
        code = err.code
    }

    // Common HTTP error codes
    if (statusCode === 400) {
        code = code || 'BAD_REQUEST'
    } else if (statusCode === 401) {
        code = code || 'UNAUTHORIZED'
    } else if (statusCode === 403) {
        code = code || 'FORBIDDEN'
    } else if (statusCode === 404) {
        code = code || 'NOT_FOUND'
    } else if (statusCode === 429) {
        code = code || 'RATE_LIMIT_EXCEEDED'
    } else if (statusCode === 500) {
        code = code || 'INTERNAL_ERROR'
            // Don't expose internal error details in production
        if (process.env.NODE_ENV === 'production') {
            message = 'Internal server error'
        }
    }

    // Send error response
    res.status(statusCode).json({
        success: false,
        error: message,
        code: code
    })
}

/**
 * Helper to create an API error
 */
class ApiError extends Error {
    constructor(message, code = 'ERROR', statusCode = 400) {
        super(message)
        this.name = 'ApiError'
        this.code = code
        this.statusCode = statusCode
    }
}

module.exports = {
    errorHandler,
    ApiError
}
