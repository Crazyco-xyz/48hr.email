/* eslint-disable import-x/order -- Load only the synthetic fixture environment before the web application. */
/* eslint-disable no-await-in-loop -- Apply sustained serial pressure to the actual HTTP middleware. */
/* eslint-disable unicorn/no-process-exit -- This standalone CLI fixture closes HTTP and exits despite application housekeeping timers. */
const process = require('node:process')

const assert = process.getBuiltinModule('node:assert/strict')
const fs = process.getBuiltinModule('node:fs')
const {once} = process.getBuiltinModule('node:events')
const http = process.getBuiltinModule('node:http')
assert(
	!fs.existsSync('.env'),
	'fixture must not load an operational environment',
)
const example = require('dotenv').parse(fs.readFileSync('.env.example'))

Object.assign(process.env, example, {
	UX_DEBUG_MODE: 'true',
	HTTP_PORT: '0',
	HTTP_API_ENABLED: 'true',
	USER_AUTH_ENABLED: 'true',
})
const {app, server, io} = require('../../infrastructure/web/web')

app.set('authService', {})
app.set('inboxLock', {})
app.set('apiTokenRepository', {})
app.set('userRepository', {})
app.set('mailProcessingService', {getCount: () => 0})
app.set('statisticsStore', {})
app.set('imapService', {getLargestUid: async () => null})
app.set('isImapReady', true)

function request() {
	return new Promise((resolve, reject) => {
		const outgoing = http.get(
			{
				hostname: '127.0.0.1',
				port: server.address().port,
				path: '/api/v1/health',
				agent: false,
			},
			(response) => {
				let body = ''
				response.on('data', (chunk) => {
					body += chunk
				})
				response.on('error', reject)
				response.on('end', () => {
					try {
						resolve({status: response.statusCode, body: JSON.parse(body)})
					} catch (error) {
						reject(error)
					}
				})
			},
		)
		outgoing.on('error', reject)
	})
}

async function main() {
	if (!server.listening) {
		await once(server, 'listening')
	}

	globalThis.gc()
	const before = process.memoryUsage().heapUsed
	let successful = 0
	let limited = 0
	for (let index = 0; index < 3000; index++) {
		const response = await request()
		if (response.status === 200) {
			assert.equal(response.body.success, true)
			assert.equal(response.body.data.status, 'ok')
			successful++
		} else {
			assert.equal(response.status, 429)
			assert.equal(response.body.code, 'RATE_LIMIT_EXCEEDED')
			limited++
		}
	}

	globalThis.gc()
	const retainedHeapGrowth = process.memoryUsage().heapUsed - before
	assert(retainedHeapGrowth < 8 * 1024 * 1024)
	await new Promise((resolve) => {
		io.close(resolve)
	})
	console.log(
		JSON.stringify({requests: 3000, successful, limited, retainedHeapGrowth}),
	)
	// The imported application's periodic limiter cleanup is intentionally active.
	process.exit(0)
}

main().catch((error) => {
	console.error(error)
	process.exit(1)
})
