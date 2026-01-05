/**
 * API Authentication Middleware
 * Supports both session-based auth and Bearer token auth
 */

function createAuthenticator(apiTokenRepository) {
    /**
     * Require authentication - returns 401 if not authenticated
     */
    function requireAuth(req, res, next) {
        // Check session first (existing web auth)
        if (req.session && req.session.isAuthenticated && req.session.userId) {
            req.user = {
                id: req.session.userId,
                username: req.session.username
            }
            req.authMethod = 'session'
            return next()
        }

        // Check Bearer token
        const authHeader = req.headers.authorization
        if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.substring(7) // Remove 'Bearer ' prefix

            const tokenData = apiTokenRepository.getByToken(token)
            if (tokenData) {
                req.user = {
                    id: tokenData.user_id,
                    username: tokenData.username
                }
                req.authMethod = 'token'

                // Update last_used timestamp asynchronously
                setImmediate(() => {
                    try {
                        apiTokenRepository.updateLastUsed(token)
                    } catch (err) {
                        // Log but don't fail the request
                        console.error('Failed to update token last_used:', err)
                    }
                })

                return next()
            }
        }

        // No valid authentication found
        return res.apiError('Authentication required', 'UNAUTHORIZED', 401)
    }

    /**
     * Optional authentication - sets req.user if authenticated, but doesn't require it
     */
    function optionalAuth(req, res, next) {
        // Check session first
        if (req.session && req.session.isAuthenticated && req.session.userId) {
            req.user = {
                id: req.session.userId,
                username: req.session.username
            }
            req.authMethod = 'session'
            return next()
        }

        // Check Bearer token
        const authHeader = req.headers.authorization
        if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.substring(7)

            const tokenData = apiTokenRepository.getByToken(token)
            if (tokenData) {
                req.user = {
                    id: tokenData.user_id,
                    username: tokenData.username
                }
                req.authMethod = 'token'

                // Update last_used timestamp asynchronously
                setImmediate(() => {
                    try {
                        apiTokenRepository.updateLastUsed(token)
                    } catch (err) {
                        console.error('Failed to update token last_used:', err)
                    }
                })
            }
        }

        // Continue regardless of auth status
        next()
    }

    return { requireAuth, optionalAuth }
}

module.exports = createAuthenticator
