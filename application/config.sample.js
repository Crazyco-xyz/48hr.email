const config = {
	email: {
		domains: process.env.EMAIL_DOMAINS,
		deleteMailsOlderThanDays: process.env.EMAIL_DELETE_MAILS_OLDER_THAN_DAYS || 2
	},
	imap: {
		user: process.env.IMAP_USER,
		password: process.env.IMAP_PASSWORD,
		host: process.env.IMAP_SERVER,
		port: process.env.IMAP_PORT || 993,
		tls: process.env.IMAP_TLS || true,
		authTimeout: process.env.IMAP_AUTHTIMEOUT || 3000,
		refreshIntervalSeconds: process.env.IMAP_REFRESH_INTERVAL_SECONDS || 60
	},
	http: {
		port: normalizePort(process.env.HTTP_PORT || 3000),
		branding: process.env.HTTP_BRANDING || ["48hr.email", "CrazyCo", "https://crazyco.xyz"],
		examples: process.env.HTTP_EXAMPLES || {
			email: "example@48hr.email",
			ids: [1, 2, 3]
		}
	},
}

if (!config.imap.user || !config.imap.password || !config.imap.host) {
	throw new Error('IMAP is not configured. Use IMAP_* ENV vars.')
}

if (!config.email.domains) {
	throw new Error('DOMAINS is not configured. Use ENV vars.')
}

/**
 * Normalize a port into a number, string, or false.
 */

function normalizePort(val) {
	const port = parseInt(val, 10)

	if (isNaN(port)) {
		// Named pipe
		return val
	}

	if (port >= 0) {
		// Port number
		return port
	}

	return false
}

module.exports = config;
