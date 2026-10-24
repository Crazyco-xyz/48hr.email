/* eslint-disable import-x/order -- Configure synthetic dependencies before loading the application. */
/* eslint-disable no-await-in-loop -- Probe the same HTTP instance in a known order. */
/* eslint-disable unicorn/no-process-exit -- The CLI fixture closes HTTP and exits past housekeeping timers. */
const process = require('node:process')

const assert = process.getBuiltinModule('node:assert/strict')
const fs = process.getBuiltinModule('node:fs')
const http = process.getBuiltinModule('node:http')
const {once} = process.getBuiltinModule('node:events')
assert(
	!fs.existsSync('.env'),
	'fixture must not load an operational environment',
)
Object.assign(
	process.env,
	require('dotenv').parse(fs.readFileSync('.env.example')),
	{
		UX_DEBUG_MODE: 'true',
		HTTP_PORT: '0',
		HTTP_API_ENABLED: 'true',
		USER_AUTH_ENABLED: 'true',
	},
)
const {app, server, io} = require('../../infrastructure/web/web')

let imapLookups = 0
app.set('authService', {})
app.set('inboxLock', {})
app.set('apiTokenRepository', {})
app.set('userRepository', {})
app.set('mailProcessingService', {getCount: () => 3})
app.set('statisticsStore', {largestUid: 42})
app.set('imapService', {
	getLargestUid() {
		imapLookups++
		return new Promise(() => {})
	},
})
app.set('isImapReady', true)
function request(path) {
	return new Promise((resolve, reject) => {
		const outgoing = http.get(
			{hostname: '127.0.0.1', port: server.address().port, path, agent: false},
			(response) => {
				let body = ''
				response.setEncoding('utf8')
				response.on('data', (chunk) => {
					body += chunk
				})
				response.on('end', () => resolve({status: response.statusCode, body}))
				response.on('error', reject)
			},
		)
		outgoing.setTimeout(1000, () =>
			outgoing.destroy(new Error('HTTP waited for unavailable IMAP')),
		)
		outgoing.on('error', reject)
	})
}

async function main() {
	if (!server.listening) {
		await once(server, 'listening')
	}

	for (const path of ['/api/v1/health', '/api/v1/config/features', '/']) {
		const response = await request(path)
		assert.equal(response.status, 200, path)
		if (path.startsWith('/api/')) {
			assert.equal(JSON.parse(response.body).success, true)
		} else {
			assert.match(response.body, /3 mails/v)
			assert.match(response.body, /All-time total: 42 emails/v)
		}
	}

	app.set('statisticsStore', null)
	const withoutStatistics = await request('/')
	assert.equal(withoutStatistics.status, 200)
	assert.match(withoutStatistics.body, /3 mails/v)
	assert.doesNotMatch(withoutStatistics.body, /All-time total:/v)
	assert.equal(imapLookups, 0)
	await new Promise((resolve) => {
		io.close(resolve)
	})
	console.log(
		JSON.stringify({
			requests: 4,
			imapLookups,
			cachedTooltip: true,
			noStatisticsFallback: true,
		}),
	)
	process.exit(0)
}

main().catch((error) => {
	console.error(error)
	process.exit(1)
})
