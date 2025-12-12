// config.js
require("dotenv").config({ quiet: true });

/**
 * Safely parse a value from env.
 * Returns `undefined` if the value is missing or invalid.
 */
function parseValue(v) {
    if (!v) return undefined;

    // remove surrounding quotes
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);

    // try JSON.parse, fallback to string
    try {
        return JSON.parse(v);
    } catch {
        return v;
    }
}


/**
 * Parse boolean or fallback to undefined
 */
function parseBool(v) {
    if (v === undefined) return undefined;
    return v === true || v === "true";
}

const config = {
    email: {
        domains: parseValue(process.env.EMAIL_DOMAINS),
        purgeTime: {
            time: Number(process.env.EMAIL_PURGE_TIME),
            unit: parseValue(process.env.EMAIL_PURGE_UNIT),
            convert: parseBool(process.env.EMAIL_PURGE_CONVERT)
        },
        examples: {
            account: parseValue(process.env.EMAIL_EXAMPLE_ACCOUNT),
            uids: parseValue(process.env.EMAIL_EXAMPLE_UIDS)
        }
    },

    imap: {
        user: parseValue(process.env.IMAP_USER),
        password: parseValue(process.env.IMAP_PASSWORD),
        host: parseValue(process.env.IMAP_SERVER),
        port: Number(process.env.IMAP_PORT),
        tls: parseBool(process.env.IMAP_TLS),
        authTimeout: Number(process.env.IMAP_AUTH_TIMEOUT),
        refreshIntervalSeconds: Number(process.env.IMAP_REFRESH_INTERVAL_SECONDS)
    },

    http: {
        port: Number(process.env.HTTP_PORT),
        branding: parseValue(process.env.HTTP_BRANDING),
        displaySort: Number(process.env.HTTP_DISPLAY_SORT),
        hideOther: parseBool(process.env.HTTP_HIDE_OTHER)
    }
};

// validation
if (!config.imap.user || !config.imap.password || !config.imap.host) {
    throw new Error("IMAP is not configured. Check IMAP_* env vars.");
}

if (!config.email.domains.length) {
    throw new Error("No EMAIL_DOMAINS configured.");
}

module.exports = config;