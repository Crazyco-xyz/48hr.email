// Simple recursive sanitizer middleware for API input
// Strips HTML tags from all string fields in req.body, req.query, req.params

function stripHtml(str) {
    if (typeof str !== 'string') return str;
    // Remove all HTML tags
    return str.replace(/<[^>]*>/g, '');
}

function sanitizeObject(obj, sanitized = {}, path = '') {
    let changed = false;
    for (const key in obj) {
        if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
        const value = obj[key];
        if (typeof value === 'string') {
            const clean = stripHtml(value);
            if (clean !== value) {
                changed = true;
                sanitized[path + key] = clean;
                obj[key] = clean;
            }
        } else if (typeof value === 'object' && value !== null) {
            // Recurse into objects/arrays
            const subSanitized = {};
            if (sanitizeObject(value, subSanitized, path + key + '.')) {
                changed = true;
                Object.assign(sanitized, subSanitized);
            }
        }
    }
    return changed;
}

function sanitizeMiddleware(req, res, next) {
    const sanitized = {};
    let changed = false;
    if (req.body && typeof req.body === 'object') {
        if (sanitizeObject(req.body, sanitized, 'body.')) changed = true;
    }
    if (req.query && typeof req.query === 'object') {
        if (sanitizeObject(req.query, sanitized, 'query.')) changed = true;
    }
    if (req.params && typeof req.params === 'object') {
        if (sanitizeObject(req.params, sanitized, 'params.')) changed = true;
    }
    // Attach sanitized info to request for later use in response
    if (changed) req.sanitizedInput = sanitized;
    next();
}

module.exports = sanitizeMiddleware;