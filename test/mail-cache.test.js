/* eslint-disable import-x/order -- Configure fixture environment before loading application modules. */
/* eslint-disable no-await-in-loop -- Exercise serial cache pressure and invalidation ordering. */
const process = require('node:process')

const test = process.getBuiltinModule('node:test')
const assert = process.getBuiltinModule('node:assert/strict')
const {spawnSync} = process.getBuiltinModule('node:child_process')
const path = process.getBuiltinModule('node:path')
const {Buffer} = process.getBuiltinModule('node:buffer')
process.env.UX_DEBUG_MODE = 'true'
process.env.EMAIL_DOMAINS = '["fixture.example"]'
const Service = require('../application/mail-processing-service')

function fixture(fetch = async (address, uid, raw) => ({address, uid, raw})) {
	const calls = []
	const service = Object.create(Service.prototype)
	service.imapService = {
		async fetchOneFullMail(...args) {
			calls.push(args)
			return fetch(...args)
		},
	}
	service._initCache()
	return {
		service,
		calls,
		get: (...args) => service.cachedFetchFullMail(...args),
	}
}

test('cached raw and parsed messages remain isolated by recipient, UID and representation', async () => {
	const f = fixture()
	const first = await f.get('one@example.invalid', 1, false)
	assert.equal(await f.get('one@example.invalid', 1, false), first)
	for (const args of [
		['two@example.invalid', 1, false],
		['one@example.invalid', 2, false],
		['one@example.invalid', 1, true],
	]) {
		assert.notEqual(await f.get(...args), first)
	}

	assert.equal(f.calls.length, 4)
})

test('a request for a different message evicts expired bodies, and access does not extend the TTL', async (t) => {
	let now = 1000
	t.mock.method(Date, 'now', () => now)
	const f = fixture()
	await f.get('one@example.invalid', 1, false)
	now += 599_999
	await f.get('one@example.invalid', 1, false)
	assert.equal(f.calls.length, 1)
	now += 1
	await f.get('two@example.invalid', 2, false)
	assert.equal(f.service.cacheStorage.size, 1)
	await f.get('one@example.invalid', 1, false)
	assert.equal(f.calls.length, 3)
})

test('recently used entries survive capacity pressure while the oldest is fetched again', async () => {
	const f = fixture()
	for (let uid = 1; uid <= 64; uid++) {
		await f.get('one@example.invalid', uid, false)
	}

	await f.get('one@example.invalid', 1, false)
	await f.get('one@example.invalid', 65, false)
	await f.get('one@example.invalid', 1, false)
	assert.equal(f.calls.length, 65)
	await f.get('one@example.invalid', 2, false)
	assert.equal(f.calls.length, 66)
})

test('MIME text, attachment buffers and header Maps share a retained byte budget', async () => {
	const f = fixture(async (_address, uid) => ({
		text: `${uid}:` + 'body'.repeat(131_072),
		attachments: [{content: Buffer.alloc(1024 * 1024, uid)}],
		headers: new Map([['x-fixture', ['value']]]),
	}))
	for (let uid = 1; uid <= 20; uid++) {
		await f.get('one@example.invalid', uid, false)
	}

	assert(f.service.cacheStorage.size < 10)
	assert(f.service.cacheSizeBytes <= 16_777_216)
	const calls = f.calls.length
	await f.get('one@example.invalid', 20, false)
	assert.equal(f.calls.length, calls)
	await f.get('one@example.invalid', 1, false)
	assert.equal(f.calls.length, calls + 1)
})

test('oversized bodies are returned intact but never retained, including small views over large buffers', async () => {
	const result = {
		attachments: [{content: Buffer.alloc(17_825_792).subarray(0, 1)}],
	}
	const f = fixture(async () => result)
	assert.equal(await f.get('one@example.invalid', 1, false), result)
	assert.equal(await f.get('one@example.invalid', 1, false), result)
	assert.equal(f.calls.length, 2)
	assert.equal(f.service.cacheStorage.size, 0)
})

test('cycles are safe and accessor or overly complex results bypass retention without running getters', async () => {
	const cyclic = {text: 'message'}
	cyclic.self = cyclic
	const f = fixture(async () => cyclic)
	await f.get('one@example.invalid', 1, false)
	await f.get('one@example.invalid', 1, false)
	assert.equal(f.calls.length, 1)
	const accessor = {
		get text() {
			throw new Error('getter must not run')
		},
	}
	const g = fixture(async () => accessor)
	assert.equal(await g.get('one@example.invalid', 1, false), accessor)
	assert.equal(g.service.cacheStorage.size, 0)
	const h = fixture(async () => Array.from({length: 5000}, () => 'x'))
	await h.get('one@example.invalid', 1, false)
	assert.equal(h.service.cacheStorage.size, 0)
})

test('UID deletion and full resets invalidate pending cache writes and release retained storage', async () => {
	for (const reset of [(s) => s._clearCacheForUid(1), (s) => s._clearCache()]) {
		const {promise, resolve: finish} = Promise.withResolvers()
		const f = fixture(() => promise)
		const pending = f.get('one@example.invalid', 1, false)
		reset(f.service)
		finish('original result')
		assert.equal(await pending, 'original result')
		assert.equal(f.service.cacheStorage.size, 0)
		assert.equal(f.service.cacheSizeBytes, 0)
	}

	const f = fixture()
	await f.get('one@example.invalid', 1, false)
	await f.get('two@example.invalid', 1, true)
	await f.get('one@example.invalid', 2, false)
	f.service._clearCacheForUid('1')
	assert.equal(f.service.cacheStorage.size, 1)
	f.service._clearCache()
	assert.equal(f.service.cacheSizeBytes, 0)
})

test('failed fetches are not cached and a later fetch can recover', async () => {
	let isFails = true
	const f = fixture(async () => {
		if (isFails) {
			throw new Error('fixture offline')
		}

		return 'recovered'
	})
	await assert.rejects(
		f.get('one@example.invalid', 1, false),
		/fixture offline/v,
	)
	isFails = false
	assert.equal(await f.get('one@example.invalid', 1, false), 'recovered')
	assert.equal(await f.get('one@example.invalid', 1, false), 'recovered')
	assert.equal(f.calls.length, 2)
})

test('1500 distinct full-message reads complete under a 64 MB heap', () => {
	const result = spawnSync(
		process.execPath,
		[
			'--expose-gc',
			'--max-old-space-size=64',
			path.join(__dirname, 'fixtures/mail-cache-memory.cjs'),
		],
		{
			cwd: path.resolve(__dirname, '..'),
			encoding: 'utf8',
			timeout: 30_000,
		},
	)
	assert.equal(result.status, 0, result.stderr)
	assert(JSON.parse(result.stdout).heapUsed < 50_331_648)
})
