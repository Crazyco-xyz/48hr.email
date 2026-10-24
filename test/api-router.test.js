/* eslint-disable import-x/order -- Configure synthetic dependencies before loading application modules. */
/* eslint-disable no-await-in-loop -- Start and probe each isolated HTTP instance in a known order. */
const process = require('node:process')

const test = process.getBuiltinModule('node:test')
const assert = process.getBuiltinModule('node:assert/strict')
const {once} = process.getBuiltinModule('node:events')
const {spawnSync} = process.getBuiltinModule('node:child_process')
const path = process.getBuiltinModule('node:path')
process.env.UX_DEBUG_MODE = 'true'
process.env.EMAIL_DOMAINS = '["fixture.example"]'
const express = require('express')
// Own the imported limiter's periodic cleanup so it cannot hold this test open.
const cleanupTimers = []
const originalSetInterval = setInterval
const intervalMock = test.mock.method(globalThis, 'setInterval', (...args) => {
	const timer = originalSetInterval(...args)
	cleanupTimers.push(timer)
	return timer
})
const createApiRouter = require('../infrastructure/web/api/router')

intervalMock.mock.restore()
test.after(() => {
	for (const timer of cleanupTimers) {
		clearInterval(timer)
	}
})

function dependencies(id, enabled) {
	return {
		config: {
			apiEnabled: true,
			uxDebugMode: true,
			user: {authEnabled: enabled},
			http: {features: {statistics: enabled}},
			email: {domains: [`${id}.example.invalid`]},
		},
		authService: enabled ? {} : null,
		mailProcessingService: {getMailSummaries: () => [{uid: id}]},
		statisticsStore: {getLightweightStats: () => ({currentCount: id})},
	}
}

test('separate API instances use their own mail and enabled-feature dependencies', async () => {
	const servers = []
	try {
		for (const deps of [dependencies(1, false), dependencies(2, true)]) {
			const app = express()
			app.set('config', deps.config)
			app.use('/api/v1', createApiRouter(deps))
			const server = app.listen(0, '127.0.0.1')
			servers.push(server)
			await once(server, 'listening')
		}

		const bases = servers.map(
			(server) => `http://127.0.0.1:${server.address().port}/api/v1`,
		)
		for (const [i, base] of bases.entries()) {
			const response = await fetch(`${base}/inbox/fixture@example.invalid`)
			assert.equal(response.status, 200)
			const body = await response.json()
			assert.deepEqual(body.data, [{uid: i + 1}])
		}

		const disabled = await fetch(`${bases[0]}/auth/session`)
		assert.equal(disabled.status, 503)
		const enabled = await fetch(`${bases[1]}/auth/session`)
		assert.equal(enabled.status, 200)
		const session = await enabled.json()
		assert.equal(session.data.authenticated, false)
		const stats = await fetch(`${bases[1]}/stats`)
		assert.equal(stats.status, 200)
		const statistics = await stats.json()
		assert.equal(statistics.data.currentCount, 2)
	} finally {
		await Promise.all(
			servers.map(
				(server) =>
					new Promise((resolve) => {
						server.close(resolve)
					}),
			),
		)
	}
})

test('3000 actual API health requests retain bounded memory under a 64 MB heap', () => {
	const result = spawnSync(
		process.execPath,
		[
			'--expose-gc',
			'--max-old-space-size=64',
			path.join(__dirname, 'fixtures/api-router-memory.cjs'),
		],
		{cwd: path.resolve(__dirname, '..'), encoding: 'utf8', timeout: 30_000},
	)
	assert.equal(result.status, 0, result.stderr)
	const row = JSON.parse(result.stdout)
	assert.equal(row.requests, 3000)
	assert.equal(row.successful, 100)
	assert.equal(row.limited, 2900)
	assert(row.retainedHeapGrowth < 8 * 1024 * 1024)
})

test('HTTP responses use cached counts when IMAP never answers', () => {
	const result = spawnSync(
		process.execPath,
		[path.join(__dirname, 'fixtures/http-mail-count.cjs')],
		{cwd: path.resolve(__dirname, '..'), encoding: 'utf8', timeout: 10_000},
	)
	assert.equal(result.status, 0, result.stderr)
	const row = JSON.parse(result.stdout)
	assert.equal(row.requests, 4)
	assert.equal(row.imapLookups, 0)
	assert.equal(row.cachedTooltip, true)
	assert.equal(row.noStatisticsFallback, true)
})
