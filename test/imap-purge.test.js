/* eslint-disable import-x/order -- Initialize fixture environment before requiring application modules. */
const process = require('node:process')

const test = process.getBuiltinModule('node:test')
const assert = process.getBuiltinModule('node:assert/strict')
const {spawnSync} = process.getBuiltinModule('node:child_process')
const path = process.getBuiltinModule('node:path')
process.env.UX_DEBUG_MODE = 'true'
process.env.EMAIL_DOMAINS = '["fixture.example"]'
const config = require('../application/config-service')
const ImapService = require('../application/imap-service')

config.email.purgeTime = {time: 48, unit: 'hours'}

const flush = () =>
	new Promise((resolve) => {
		setImmediate(resolve)
	})
function mail(uid, to, hours = 72) {
	const ageMilliseconds = hours * 3_600_000
	return {
		attributes: {uid, date: new Date(Date.now() - ageMilliseconds)},
		parts: [{body: {to}}],
	}
}

function fixture(
	messages = [mail(1, ['unlocked@fixture.example'])],
	locks = [],
) {
	const deleted = []
	const events = []
	const stats = {searches: 0, fetches: 0}
	const connection = {
		imap: {
			search(criteria, callback) {
				stats.searches++
				queueMicrotask(() =>
					callback(
						null,
						messages.map((message) => message.attributes.uid),
					),
				)
			},
		},
		async search(criteria, _options) {
			stats.fetches++
			const selected = new Set(criteria[0].slice(1))
			return messages.filter((message) => selected.has(message.attributes.uid))
		},
		async deleteMessage(uids) {
			deleted.push(...uids)
		},
	}
	const service = new ImapService(
		{
			imap: {fetchChunkSize: 2, fetchConcurrency: 2},
			email: {examples: {uids: [4]}},
		},
		{getAllLocked: () => locks},
	)
	service.connection = connection
	service.on(ImapService.EVENT_DELETED_MAIL, (uid) => {
		events.push(uid)
	})
	return {service, connection, stats, deleted, events}
}

test('purge preserves examples, recent/invalid dates and locked formatted or grouped recipients', async () => {
	const messages = [
		mail(1, ['unlocked@fixture.example']),
		mail(2, ['Locked Person <LOCKED@fixture.example>']),
		mail(3, ['unlocked@fixture.example'], 24),
		mail(4, ['unlocked@fixture.example']),
		mail(5, ['locked@fixture.example']),
		mail(6, ['Team: other@fixture.example, locked@fixture.example;']),
		mail(7, undefined),
		{
			...mail(8, ['unlocked@fixture.example']),
			attributes: {uid: 8, date: new Date(NaN)},
		},
	]
	const f = fixture(messages, ['locked@fixture.example'])
	await f.service.deleteOldMails()
	assert.deepEqual(
		f.deleted.toSorted((a, b) => a - b),
		[1, 7],
	)
	assert.deepEqual(
		f.events.toSorted((a, b) => a - b),
		[1, 7],
	)
})

test('concurrent purge ticks share one search and a completed purge can run again', async () => {
	const f = fixture([])
	let complete
	f.connection.imap.search = (_, callback) => {
		f.stats.searches++
		complete = callback
	}

	const first = f.service.deleteOldMails()
	await f.service.deleteOldMails()
	assert.equal(f.stats.searches, 1)
	complete(null, [])
	await first
	f.connection.imap.search = (_, callback) => {
		f.stats.searches++
		callback(null, [])
	}

	await f.service.deleteOldMails()
	assert.equal(f.stats.searches, 2)
})

test('a timed-out fetch blocks new work on that connection until the raw request settles', async (t) => {
	t.mock.timers.enable({apis: ['setTimeout']})
	const f = fixture()
	const response = Promise.withResolvers()
	const complete = response.resolve
	f.connection.search = () => {
		f.stats.fetches++
		return response.promise
	}

	const first = f.service.deleteOldMails()
	await flush()
	t.mock.timers.tick(30_000)
	await first
	await f.service.deleteOldMails()
	assert.equal(f.stats.searches, 1)
	assert.equal(f.stats.fetches, 1)
	assert.deepEqual(f.deleted, [])
	complete([])
	await flush()
	f.connection.search = async () => []
	await f.service.deleteOldMails()
	assert.equal(f.stats.searches, 2)
})

test('reconnect permits a new purge and a late old completion cannot unlock it', async () => {
	const a = fixture([])
	const b = fixture([])
	let completeA
	let completeB
	a.connection.imap.search = (_, callback) => {
		a.stats.searches++
		completeA = callback
	}

	b.connection.imap.search = (_, callback) => {
		b.stats.searches++
		completeB = callback
	}

	const old = a.service.deleteOldMails()
	a.service.connection = b.connection
	const current = a.service.deleteOldMails()
	completeA(null, [])
	await old
	await a.service.deleteOldMails()
	assert.equal(b.stats.searches, 1)
	completeB(null, [])
	await current
	b.connection.imap.search = (_, callback) => {
		b.stats.searches++
		callback(null, [])
	}

	await a.service.deleteOldMails()
	assert.equal(b.stats.searches, 2)
})

test('a header reply from a replaced connection cannot delete mail', async () => {
	const f = fixture()
	const replacement = fixture([])
	const response = Promise.withResolvers()
	const complete = response.resolve
	f.connection.search = () => response.promise
	const pending = f.service.deleteOldMails()
	await flush()
	f.service.connection = replacement.connection
	complete([mail(1, ['unlocked@fixture.example'])])
	await pending
	assert.deepEqual(f.deleted, [])
	await f.service.deleteOldMails()
	assert.equal(replacement.stats.searches, 1)
})

test('an inbox locked while headers are being fetched is preserved', async () => {
	const f = fixture()
	const locks = []
	f.service.inboxLock.getAllLocked = () => locks
	const response = Promise.withResolvers()
	const complete = response.resolve
	f.connection.search = () => response.promise
	const pending = f.service.deleteOldMails()
	await flush()
	locks.push('unlocked@fixture.example')
	complete([mail(1, ['unlocked@fixture.example'])])
	await pending
	assert.deepEqual(f.deleted, [])
})

test('failed lock lookups preserve the batch and a later healthy purge recovers', async () => {
	const f = fixture()
	f.service.inboxLock.getAllLocked = () => {
		throw new Error('fixture lock store unavailable')
	}

	await f.service.deleteOldMails()
	assert.deepEqual(f.deleted, [])
	f.service.inboxLock.getAllLocked = () => []
	await f.service.deleteOldMails()
	assert.deepEqual(f.deleted, [1])
})

test('a failed search releases the guard for the next normal tick', async () => {
	const f = fixture()
	const {search} = f.connection.imap
	f.connection.imap.search = (_, callback) =>
		callback(new Error('fixture search unavailable'))
	await assert.rejects(f.service.deleteOldMails(), /search unavailable/v)
	f.connection.imap.search = search
	await f.service.deleteOldMails()
	assert.deepEqual(f.deleted, [1])
})

test('real IMAP parsing stays within a 64 MB heap across repeated 5,000-message purges', () => {
	const child = spawnSync(
		process.execPath,
		[
			'--expose-gc',
			'--max-old-space-size=64',
			path.join(__dirname, 'fixtures/imap-purge-memory.cjs'),
		],
		{
			cwd: path.resolve(__dirname, '..'),
			encoding: 'utf8',
			timeout: 45_000,
			maxBuffer: 2 * 1024 * 1024,
		},
	)
	assert.ifError(child.error)
	assert.equal(child.status, 0, child.stderr)
	const report = JSON.parse(child.stdout)
	assert.equal(report.state, 'completed')
	assert.equal(report.cycles, 20)
	assert.equal(report.emitted, 5000)
	assert.equal(report.fetchCount, 210)
	assert(
		report.samples.every(
			(sample) => sample.loaded === 5000 && sample.queue === 0,
		),
	)
	assert(
		Math.max(...report.samples.map((sample) => sample.heap)) < 48 * 1024 * 1024,
	)
})
