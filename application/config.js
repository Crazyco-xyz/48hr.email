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

    http: {
        port: Number(process.env.HTTP_PORT),
        branding: parseValue(process.env.HTTP_BRANDING),
        displaySort: Number(process.env.HTTP_DISPLAY_SORT),
        hideOther: parseBool(process.env.HTTP_HIDE_OTHER)
    },

    lock: {
        enabled: parseBool(process.env.LOCK_ENABLED) || false,
        sessionSecret: parseValue(process.env.LOCK_SESSION_SECRET) || 'change-me-in-production',
        dbPath: parseValue(process.env.LOCK_DATABASE_PATH) || './db/locked-inboxes.db',
        releaseHours: Number(process.env.LOCK_RELEASE_HOURS) || 720 // 30 days default
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
