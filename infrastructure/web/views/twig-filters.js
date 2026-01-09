const sanitizeHtml = require('sanitize-html')
const config = require('../../../application/config-service')

/**
 * Transformes <a> tags to always use "noreferrer noopener" and open in a new window.
 * @param {Object} value  the dom before transformation
 * @returns  {*} dom after transformation
 */
exports.sanitizeHtmlTwigFilter = function(value) {
    return sanitizeHtml(value, {
        allowedAttributes: {
            a: ['href', 'target', 'rel']
        },

        transformTags: {
            a(tagName, attribs) {
                return {
                    tagName,
                    attribs: {
                        rel: 'noreferrer noopener',
                        href: attribs.href,
                        target: '_blank'
                    }
                }
            }
        }
    })
}

/**
 * Convert time to highest possible unit (minutes → hours → days),
 * rounding if necessary and prefixing "~" when rounded.
 * Mirrors the logic from Helper.convertAndRound()
 *
 * @param {number} time
 * @param {string} unit  "minutes" | "hours" | "days"
 * @returns {string}
 */
function convertAndRound(time, unit) {
    let value = time
    let u = unit

    // upgrade units
    const units = [
        ["minutes", 60, "hours"],
        ["hours", 24, "days"]
    ]

    for (const [from, factor, to] of units) {
        if (u === from && value > factor) {
            value = value / factor
            u = to
        }
    }

    // determine if rounding is needed
    const rounded = !Number.isSafeInteger(value)
    if (rounded) value = Math.round(value)

    // Handle singular/plural
    const displayValue = value === 1 ? value : value
    const displayUnit = value === 1 ? u.replace(/s$/, '') : u

    return `${rounded ? "~" : ""}${displayValue} ${displayUnit}`
}

/**
 * Convert purgeTime config to readable format, respecting the convert flag
 * @param {Object} purgeTime - Object with time, unit, and convert properties
 * @returns {String} Readable time string
 */
exports.readablePurgeTime = function(purgeTime) {
    if (!purgeTime || !purgeTime.time || !purgeTime.unit) {
        purgeTime = config.email.purgeTime
    }

    let result = `${purgeTime.time} ${purgeTime.unit}`

    // Only convert if the convert flag is true
    if (purgeTime.convert) {
        result = convertAndRound(purgeTime.time, purgeTime.unit)
    }

    return result
}
