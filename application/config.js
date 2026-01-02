// config.js
require("dotenv").config({ quiet: true });
const debug = require('debug')('48hr-email:config')

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
        },
        blacklistedSenders: parseValue(process.env.EMAIL_BLACKLISTED_SENDERS) || []
    },

    imap: {
        user: parseValue(process.env.IMAP_USER),
        password: parseValue(process.env.IMAP_PASSWORD),
        host: parseValue(process.env.IMAP_SERVER),
        port: Number(process.env.IMAP_PORT),
        tls: parseBool(process.env.IMAP_TLS),
        authTimeout: Number(process.env.IMAP_AUTH_TIMEOUT),
        refreshIntervalSeconds: Number(process.env.IMAP_REFRESH_INTERVAL_SECONDS),
        fetchChunkSize: Number(process.env.IMAP_FETCH_CHUNK) || 100,
        fetchConcurrency: Number(process.env.IMAP_CONCURRENCY) || 6
    },

    smtp: {
        enabled: parseBool(process.env.SMTP_ENABLED) || false,
        host: parseValue(process.env.SMTP_HOST),
        port: Number(process.env.SMTP_PORT) || 465,
        secure: parseBool(process.env.SMTP_SECURE) || true,
        user: parseValue(process.env.SMTP_USER),
        password: parseValue(process.env.SMTP_PASSWORD)
    },

    http: {
        port: Number(process.env.HTTP_PORT),
        baseUrl: parseValue(process.env.HTTP_BASE_URL) || 'http://localhost:3000',
        branding: parseValue(process.env.HTTP_BRANDING),
        displaySort: Number(process.env.HTTP_DISPLAY_SORT),
        hideOther: parseBool(process.env.HTTP_HIDE_OTHER)
    },

    user: {
        // Authentication System
        authEnabled: parseBool(process.env.USER_AUTH_ENABLED) || false,

        // Database
        databasePath: parseValue(process.env.USER_DATABASE_PATH) || './db/data.db',

        // Session & Auth
        sessionSecret: parseValue(process.env.USER_SESSION_SECRET) || 'change-me-in-production',

        // Feature Limits
        maxForwardEmails: Number(process.env.USER_MAX_FORWARD_EMAILS) || 5,
        maxLockedInboxes: Number(process.env.USER_MAX_LOCKED_INBOXES) || 5,
        lockReleaseHours: Number(process.env.LOCK_RELEASE_HOURS) || 720 // 30 days default
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
