const config = {
	email: {
		domains: process.env.EMAIL_DOMAINS, // List object of domains
		purgeTime: process.env.EMAIL_PURGE_TIME || {
			time: 48, // Time value to purge
			unit: 'hours', // minutes, hours, days
			convert: true, // Convert to highest sensible unit
		}
	},
	imap: {
		user: process.env.IMAP_USER, // imap user
		password: process.env.IMAP_PASSWORD, // imap password
		host: process.env.IMAP_SERVER, // imap server
		port: process.env.IMAP_PORT || 993, // imap port
		tls: process.env.IMAP_TLS || true, // use secure connection?
		authTimeout: process.env.IMAP_AUTHTIMEOUT || 3000, // timeout for auth
		refreshIntervalSeconds: process.env.IMAP_REFRESH_INTERVAL_SECONDS || 60 // refresh interval
	},
	http: {
		port: normalizePort(process.env.HTTP_PORT || 3000), // http port
		branding: process.env.HTTP_BRANDING || ["48hr.email", "CrazyCo", "https://crazyco.xyz"], // branding
		examples: process.env.HTTP_EXAMPLES || { 
			email: "example@48hr.email", // example email
			ids: [1, 2, 3] // example ids
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
