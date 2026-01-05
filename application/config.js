// config.js
require("dotenv").config({ quiet: true });
const debug = require('debug')('48hr-email:config')

// Migration helper: warn about deprecated env vars
if (process.env.USER_SESSION_SECRET && !process.env.HTTP_SESSION_SECRET) {
    console.warn('\nDEPRECATION WARNING: USER_SESSION_SECRET is deprecated.')
    console.warn('   Please rename it to HTTP_SESSION_SECRET in your .env file.')
    console.warn('   The old name still works but will be removed in a future version.\n')
}

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
        domains: parseValue(process.env.EMAIL_DOMAINS) || [],
        purgeTime: {
            time: Number(process.env.EMAIL_PURGE_TIME),
            unit: parseValue(process.env.EMAIL_PURGE_UNIT),
            convert: parseBool(process.env.EMAIL_PURGE_CONVERT)
        },
        examples: {
            account: parseValue(process.env.EMAIL_EXAMPLE_ACCOUNT),
            uids: parseValue(process.env.EMAIL_EXAMPLE_UIDS)
        },
        blacklistedSenders: parseValue(process.env.EMAIL_BLACKLISTED_SENDERS) || [],
        features: {
            smtp: parseBool(process.env.SMTP_ENABLED) || false
        }
    },

    imap: {
        user: parseValue(process.env.IMAP_USER),
        password: parseValue(process.env.IMAP_PASSWORD),
        host: parseValue(process.env.IMAP_SERVER),
        port: Number(process.env.IMAP_PORT),
        secure: parseBool(process.env.IMAP_SECURE),
        authTimeout: Number(process.env.IMAP_AUTH_TIMEOUT),
        refreshIntervalSeconds: Number(process.env.IMAP_REFRESH_INTERVAL_SECONDS),
        fetchChunkSize: Number(process.env.IMAP_FETCH_CHUNK) || 100,
        fetchConcurrency: Number(process.env.IMAP_CONCURRENCY) || 6
    },

    smtp: {
        enabled: parseBool(process.env.SMTP_ENABLED) || false,
        user: parseValue(process.env.SMTP_USER),
        password: parseValue(process.env.SMTP_PASSWORD),
        server: parseValue(process.env.SMTP_SERVER),
        port: Number(process.env.SMTP_PORT) || 465,
        secure: parseBool(process.env.SMTP_SECURE) || true
    },

    http: {
        // Server settings
        port: Number(process.env.HTTP_PORT),
        baseUrl: parseValue(process.env.HTTP_BASE_URL) || 'http://localhost:3000',
        sessionSecret: parseValue(process.env.HTTP_SESSION_SECRET) || parseValue(process.env.USER_SESSION_SECRET) || 'change-me-in-production',

        // UI Features & Display
        features: {
            branding: parseValue(process.env.HTTP_BRANDING),
            displaySort: Number(process.env.HTTP_DISPLAY_SORT) || 0,
            hideOther: parseBool(process.env.HTTP_HIDE_OTHER),
            statistics: parseBool(process.env.HTTP_STATISTICS_ENABLED) || false,
            infoSection: parseBool(process.env.HTTP_SHOW_INFO_SECTION) !== false // default true
        }
    },

    user: {
        // Authentication System
        authEnabled: parseBool(process.env.USER_AUTH_ENABLED) || false,

        // Database
        databasePath: parseValue(process.env.USER_DATABASE_PATH) || './db/data.db',

        // Feature Limits
        maxForwardEmails: Number(process.env.USER_MAX_FORWARD_EMAILS) || 5,
        maxLockedInboxes: Number(process.env.USER_MAX_LOCKED_INBOXES) || 5,
        lockReleaseHours: Number(process.env.LOCK_RELEASE_HOURS) || 168 // 7 days default
    }
};

// validation
debug('Validating configuration...')
if (!config.imap.user || !config.imap.password || !config.imap.host) {
    debug('IMAP configuration validation failed: missing user, password, or host')
    throw new Error("IMAP is not configured. Check IMAP_* env vars.");
}

if (!config.email.domains.length) {
    debug('Email domains validation failed: no domains configured')
    throw new Error("No EMAIL_DOMAINS configured.");
}

debug(`Configuration validated successfully: ${config.email.domains.length} domains, IMAP host: ${config.imap.host}`)

module.exports = config;
