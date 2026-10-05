const { BlockList, isIP } = require('node:net')

const privateAddresses = new BlockList()
for (const [address, prefix] of [
	['10.0.0.0', 8],
	['172.16.0.0', 12],
	['192.168.0.0', 16],
	['127.0.0.0', 8],
]) {
	privateAddresses.addSubnet(address, prefix, 'ipv4')
}
privateAddresses.addAddress('::1', 'ipv6')
privateAddresses.addSubnet('fc00::', 7, 'ipv6')
privateAddresses.addSubnet('fe80::', 10, 'ipv6')

const automationAgent =
	/(?:HeadlessChrome|PhantomJS|Puppeteer|Playwright|Selenium|python-requests|python-urllib|curl\/|wget\/|Go-http-client|libwww-perl|scrapy|axios\/|okhttp\/)/i
const crawlerAgent =
	/(?:Googlebot|bingbot|YandexBot|DuckDuckBot|Baiduspider|AhrefsBot|SemrushBot|MJ12bot|Discordbot|TelegramBot|Slackbot|facebookexternalhit|Twitterbot)/i
const scanPaths = new Set([
	'/wp-login.php',
	'/xmlrpc.php',
	'/.env',
	'/.git/config',
])
const staticPath =
	/\.(?:css|js|map|png|jpe?g|gif|svg|ico|webp|woff2?|ttf|eot)$/i

function isPrivateAddress(ip) {
	const family = isIP(ip || '')
	return (
		family !== 0 && privateAddresses.check(ip, family === 4 ? 'ipv4' : 'ipv6')
	)
}

function createBotDetector({
	now = Date.now,
	windowMs = 10000,
	maxRequests = 60,
	maxTrackedIps = 5000,
} = {}) {
	// Bounded, expiring navigation counters. Assets and API requests never enter this map.
	const rates = new Map()
	function isRapidRequester(ip) {
		if (!isIP(ip || '') || isPrivateAddress(ip)) return false
		const time = now()
		// Map insertion order follows last activity so expired/old entries are first.
		for (const [key, entry] of rates) {
			if (time - entry.lastSeen < windowMs) break
			rates.delete(key)
		}
		let entry = rates.get(ip)
		if (!entry || time - entry.start >= windowMs)
			entry = { start: time, hits: 0 }
		entry.hits++
		entry.lastSeen = time
		rates.delete(ip)
		rates.set(ip, entry)
		while (rates.size > maxTrackedIps) rates.delete(rates.keys().next().value)
		return entry.hits > maxRequests
	}

	return function botDetect(req, res, next) {
		res.locals.suspectedBot = false
		res.locals.botDetectionReasons = []
		const requestPath = req.path || '/'
		if (
			requestPath === '/api' ||
			requestPath.startsWith('/api/') ||
			staticPath.test(requestPath) ||
			requestPath === '/robots.txt'
		)
			return next()

		const reasons = []
		let score = 0
		const ua = req.get('User-Agent') || ''
		const optedOut = req.cookies?.bot_check_passed === 'true'
		if (!optedOut && automationAgent.test(ua)) {
			score += 3
			reasons.push('Automation User-Agent')
		} else if (!optedOut && crawlerAgent.test(ua)) {
			score += 3
			reasons.push('Crawler User-Agent')
		} else if (!ua) {
			score += 1
			reasons.push('Missing User-Agent')
		}
		if (scanPaths.has(requestPath)) {
			score += 3
			reasons.push('Vulnerability scanning path')
		}
		// req.ip is resolved by Express using the configured proxy allowlist.
		// Never use untrusted X-Forwarded-For or other client-supplied IP headers here.
		if (isRapidRequester(req.ip || req.socket?.remoteAddress)) {
			score += 3
			reasons.push('Excessive page request rate')
		}
		// Cookies, Referer, language and accessibility tools are not automation evidence.
		res.locals.suspectedBot = score >= 3
		res.locals.botDetectionReasons = reasons
		next()
	}
}

module.exports = createBotDetector()
module.exports.createBotDetector = createBotDetector
