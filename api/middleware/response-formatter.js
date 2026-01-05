/**
 * Middleware to add consistent API response helpers to the response object
 */
function responseFormatter(req, res, next) {
    /**
     * Send a successful API response
     * @param {*} data - Data to return
     * @param {number} statusCode - HTTP status code (default: 200)
     */
    res.apiSuccess = function(data = null, statusCode = 200, templateContext = null) {
        const response = {
            success: true,
            data: data
        };
        if (templateContext) response.templateContext = templateContext;
        res.status(statusCode).json(response);
    }

    /**
     * Send an error API response
     * @param {string} message - Error message
     * @param {string} code - Error code for programmatic handling
     * @param {number} statusCode - HTTP status code (default: 400)
     */
    res.apiError = function(message, code = 'ERROR', statusCode = 400, templateContext = null) {
        const response = {
            success: false,
            error: message,
            code: code
        };
        if (templateContext) response.templateContext = templateContext;
        res.status(statusCode).json(response);
    }

    /**
     * Send a list API response with pagination info
     * @param {array} items - Array of items
     * @param {number} total - Total count (optional, defaults to items.length)
     * @param {number} statusCode - HTTP status code (default: 200)
     */
    res.apiList = function(items, total = null, statusCode = 200, templateContext = null) {
        if (!Array.isArray(items)) {
            items = [];
        }
        const response = {
            success: true,
            data: items,
            count: items.length,
            total: total !== null ? total : items.length
        };
        if (templateContext) response.templateContext = templateContext;
        res.status(statusCode).json(response);
    }

    next()
}

module.exports = responseFormatter