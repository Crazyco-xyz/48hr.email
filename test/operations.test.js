const test = require('node:test')
const assert = require('node:assert/strict')
const { once } = require('node:events')
const http = require('node:http')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { EventEmitter } = require('node:events')

// Direct module tests use fixture configuration and never need live mail credentials.
process.env.UX_DEBUG_MODE = 'true'
process.env.EMAIL_DOMAINS = '["fixture.example"]'

const browserHeaders = {
	'user-agent': 'Mozilla/5.0 Firefox/140.0',
	accept: 'text/html',
	'accept-language': 'en-US',
}

test('private proxy addresses do not accumulate bot scores; public rates and bot agents still do', () => {
	const botDetect = require('../infrastructure/web/middleware/bot-detect')
	function check(ip, headers = browserHeaders) {
		const req = {
			ip,
			headers,
			method: 'GET',
			path: '/',
			get: (key) => headers[key.toLowerCase()],
		}
		const res = { locals: {} }
		botDetect(req, res, () => {})
		return res.locals.suspectedBot
	}
	for (const ip of [
		'10.1.2.3',
		'172.16.0.1',
		'172.31.255.254',
		'192.168.1.1',
		'::ffff:192.168.1.1',
		'::ffff:c0a8:101',
		'127.0.0.1',
		'::1',
		'fd00::1',
		'fe80::1',
	]) {
		for (let i = 0; i < 40; i++) assert.equal(check(ip), false, ip)
		assert.equal(
			check(ip, { ...browserHeaders, 'user-agent': 'curl/8.0.0' }),
			true,
			ip,
		)
	}
	for (const ip of ['8.8.4.4', '172.32.0.1']) {
		assert.equal(check(ip), false)
		for (let i = 0; i < 80; i++) check(ip)
		assert.equal(check(ip), true)
	}
})

test('bot signals tolerate privacy and accessibility while limiting abuse, spoofing and counter growth', () => {
	const {
		createBotDetector,
	} = require('../infrastructure/web/middleware/bot-detect')
	let time = 1000
	const detect = createBotDetector({
		now: () => time,
		maxRequests: 5,
		maxTrackedIps: 2,
	})
	function check({
		ip = '8.8.8.8',
		ua = browserHeaders['user-agent'],
		route = '/',
		cookie,
		headers = {},
	} = {}) {
		const allHeaders = { 'user-agent': ua, ...headers }
		const req = {
			ip,
			path: route,
			cookies: { bot_check_passed: cookie },
			get: (key) => allHeaders[key.toLowerCase()],
		}
		const res = { locals: {} }
		detect(req, res, () => {})
		return res.locals
	}
	assert.equal(
		check({ ua: 'Mozilla/5.0 Firefox/140.0 NVDA' }).suspectedBot,
		false,
	)
	assert.equal(check({ ua: '' }).suspectedBot, false)
	assert.equal(
		check({ ua: 'HeadlessChrome/140.0', ip: '10.0.0.1' }).suspectedBot,
		true,
	)
	assert.equal(
		check({ ua: 'HeadlessChrome/140.0', ip: '10.0.0.1', cookie: 'false' })
			.suspectedBot,
		true,
	)
	assert.equal(
		check({ ua: 'HeadlessChrome/140.0', ip: '10.0.0.1', cookie: 'true' })
			.suspectedBot,
		false,
	)
	assert.equal(check({ route: '/.env', cookie: 'true' }).suspectedBot, true)
	for (let i = 0; i < 20; i++) {
		assert.equal(
			check({ ua: 'curl/8.0', route: '/stylesheets/custom.css' }).suspectedBot,
			false,
		)
		assert.equal(
			check({ ua: 'curl/8.0', route: '/api/v1/inbox/fixture' }).suspectedBot,
			false,
		)
	}
	time += 10001
	assert.equal(check().suspectedBot, false)
	for (let i = 0; i < 6; i++)
		check({ cookie: 'true', headers: { 'x-forwarded-for': `1.1.1.${i}` } })
	assert.equal(check({ cookie: 'true' }).suspectedBot, true)
	check({ ip: '1.1.1.1' })
	check({ ip: '9.9.9.9' })
	assert.equal(
		check().suspectedBot,
		false,
		'old counters are evicted when the bounded map fills',
	)
	for (let i = 0; i < 6; i++) check()
	assert.equal(check().suspectedBot, true)
	time += 10001
	assert.equal(
		check().suspectedBot,
		false,
		'an expired navigation window is reset',
	)
})

test('proxy allowlist trusts forwarded addresses only from the selected proxy', async () => {
	const express = require('express')
	const app = express()
	app.set('trust proxy', [])
	app.get('/', (req, res) => res.json({ ip: req.ip }))
	const server = app.listen(0, '127.0.0.1')
	await once(server, 'listening')
	const url = `http://127.0.0.1:${server.address().port}/`
	try {
		const request = () =>
			fetch(url, { headers: { 'x-forwarded-for': '8.8.8.8' } }).then(
				(response) => response.json(),
			)
		assert.equal((await request()).ip, '127.0.0.1')
		app.set('trust proxy', ['127.0.0.1/32'])
		assert.equal((await request()).ip, '8.8.8.8')
		app.set('trust proxy', ['10.0.0.2/32'])
		assert.equal((await request()).ip, '127.0.0.1')
	} finally {
		server.closeAllConnections()
		server.close()
		await once(server, 'close')
	}
})

test('proxy configuration rejects unrestricted Boolean trust and malformed addresses', () => {
	const probe =
		'console.log(JSON.stringify(require("./application/config-service").http.trustedProxies))'
	const run = (value) =>
		spawnSync(process.execPath, ['-e', probe], {
			cwd: path.resolve(__dirname, '..'),
			encoding: 'utf8',
			windowsHide: true,
			env: { ...process.env, HTTP_TRUST_PROXY: value },
		})
	for (const value of [
		'true',
		'["not-an-address"]',
		'["10.0.0.1/33"]',
		'["::1/129"]',
	]) {
		const result = run(value)
		assert.notEqual(result.status, 0)
		assert.match(result.stderr, /HTTP_TRUST_PROXY must be a JSON array/)
	}
	const result = run('["127.0.0.1","10.0.0.2/32","::1/128"]')
	assert.equal(result.status, 0, result.stderr)
	assert.deepEqual(JSON.parse(result.stdout), [
		'127.0.0.1',
		'10.0.0.2/32',
		'::1/128',
	])
})

test('IMAP recovery retains connection options across failed retries and releases failed-load locks', async () => {
	const imaps = require('imap-simple')
	const ImapService = require('../application/imap-service')
	const originalConnect = imaps.connect
	const config = {
		imap: {
			host: 'fixture.invalid',
			user: 'fixture',
			password: 'fixture',
			port: 993,
			secure: true,
			authTimeout: 3000,
			refreshIntervalSeconds: 0,
			fetchChunkSize: 100,
			fetchConcurrency: 1,
			reconnectBaseDelayMs: 1,
			reconnectMaxDelayMs: 2,
		},
		email: { examples: { uids: [] } },
	}
	function connection() {
		const result = new EventEmitter()
		result.openBox = async (box) => assert.equal(box, 'INBOX')
		result.end = () => result.emit('end')
		return result
	}
	const first = connection(),
		recovered = connection()
	const options = []
	imaps.connect = async (value) => {
		options.push(value)
		if (options.length === 2) throw new Error('transient failure')
		return options.length === 1 ? first : recovered
	}
	const service = new ImapService(config)
	service._sleep = async () => {}
	service._loadMailSummariesAndEmitAsEvents = async () => {}
	try {
		await service.connectAndLoadMessages()
		first.emit('close')
		await service._reconnectPromise
		assert.equal(service.connection, recovered)
		assert.equal(options.length, 3)
		assert.ok(options.every((value) => value === options[0]))
		assert.equal(options[0].imap.host, 'fixture.invalid')
		first.emit('close')
		assert.equal(service.connection, recovered)
		service.close()
		assert.equal(service._reconnectPromise, null)
		const loader = new ImapService(config)
		loader.connection = recovered
		loader._getAllUids = async () => {
			throw new Error('dropped during load')
		}
		await assert.rejects(
			loader._loadMailSummariesAndEmitAsEvents(),
			/dropped during load/,
		)
		assert.equal(loader.loadingInProgress, false)
		loader._getAllUids = async () => []
		await loader._loadMailSummariesAndEmitAsEvents()
		assert.equal(loader.initialLoadDone, true)
	} finally {
		service.close()
		imaps.connect = originalConnect
	}
})

test('container health requires ready JSON and rejects startup HTML, malformed status and HTTP failure', async () => {
	const config = require('../application/config-service')
	const healthcheck = require('../scripts/healthcheck')
	let status = 200
	let body = '<html>Loading...</html>'
	const server = http.createServer((req, res) => {
		assert.equal(req.url, '/api/v1/health')
		res.writeHead(status)
		res.end(body)
	})
	server.listen(0, '127.0.0.1')
	await once(server, 'listening')
	const oldPort = config.http.port
	config.http.port = server.address().port
	try {
		await assert.rejects(healthcheck())
		body = JSON.stringify({ success: true, data: { status: 'starting' } })
		await assert.rejects(healthcheck(), /not ready/)
		status = 503
		await assert.rejects(healthcheck(), /unavailable/)
		status = 200
		body = JSON.stringify({ success: true, data: { status: 'ok' } })
		await healthcheck()
	} finally {
		config.http.port = oldPort
		server.closeAllConnections()
		server.close()
		await once(server, 'close')
	}
})
