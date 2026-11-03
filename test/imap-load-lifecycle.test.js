/* eslint-disable import-x/order -- Initialize fixture configuration before application imports. */
/* eslint-disable unicorn/prefer-event-target -- IMAP transports expose Node EventEmitter streams and callbacks. */
const process = require('node:process')

const test = process.getBuiltinModule('node:test')
const assert = process.getBuiltinModule('node:assert/strict')
const {EventEmitter} = process.getBuiltinModule('node:events')
const {Buffer} = process.getBuiltinModule('node:buffer')
process.env.UX_DEBUG_MODE = 'true'
process.env.EMAIL_DOMAINS = '["fixture.invalid"]'
const imaps = require('imap-simple')
const ImapService = require('../application/imap-service')

const flush = () =>
	new Promise((resolve) => {
		setImmediate(resolve)
	})

function message(uid) {
	return {
		attributes: {uid, date: new Date('2099-01-01T00:00:00Z')},
		parts: [
			{
				body: {
					to: ['recipient@fixture.invalid'],
					from: ['sender@fixture.invalid'],
					subject: ['Synthetic fixture'],
					date: ['Thu, 01 Jan 2099 00:00:00 +0000'],
				},
			},
		],
	}
}

class Connection extends EventEmitter {
	constructor(messages = []) {
		super()
		this.messages = messages
		this.uidSearches = 0
		this.headerRequests = []
		this.endCalls = 0
		this.imap = {
			search: (criteria, callback) => {
				this.uidSearches++
				if (this.uidSearch) {
					this.uidSearch(criteria, callback)
				} else {
					queueMicrotask(() =>
						callback(
							null,
							this.messages.map((mail) => mail.attributes.uid),
						),
					)
				}
			},
			fetch: (uids, options) => {
				assert.deepEqual(options.bodies, [
					'HEADER.FIELDS (FROM TO SUBJECT DATE)',
				])
				assert.equal(options.markSeen, false)
				const fetch = new EventEmitter()
				queueMicrotask(() => {
					this.search([['UID', ...uids]])
						.then((mails) => {
							for (const mail of mails) {
								const item = new EventEmitter()
								const stream = new EventEmitter()
								fetch.emit('message', item)
								item.emit('body', stream, {which: options.bodies[0]})
								const body =
									Object.entries(mail.parts[0].body)
										.map(([key, values]) => `${key}: ${values.join(', ')}\r\n`)
										.join('') + '\r\n'
								stream.emit('data', Buffer.from(body))
								stream.emit('end')
								item.emit('attributes', mail.attributes)
								item.emit('end')
							}

							fetch.emit('end')
						})
						.catch((error) => fetch.emit('error', error))
				})
				return fetch
			},
		}
	}

	async openBox(box) {
		assert.equal(box, 'INBOX')
	}

	search(criteria) {
		const uids = criteria[0].slice(1)
		this.headerRequests.push(uids)
		return this.headers
			? this.headers(uids)
			: Promise.resolve(
					this.messages.filter((mail) => uids.includes(mail.attributes.uid)),
				)
	}

	end() {
		this.endCalls++
		this.emit('end')
	}
}

function observe(promise) {
	const result = {settled: false, error: null}
	promise
		.then(() => {
			result.settled = true
		})
		.catch((error) => {
			result.settled = true
			result.error = error
		})
	return result
}

function fixture(
	t,
	first = new Connection(),
	next = new Connection(),
	overrides = {},
) {
	const originalConnect = imaps.connect
	const options = []
	imaps.connect = async (value) => {
		options.push(value)
		return options.length === 1 ? first : next
	}

	const service = new ImapService({
		imap: {
			host: 'fixture.invalid',
			user: 'fixture',
			password: 'fixture',
			port: 993,
			secure: true,
			authTimeout: 1000,
			fetchChunkSize: 1,
			fetchConcurrency: 1,
			refreshIntervalSeconds: 0,
			reconnectBaseDelayMs: 1,
			reconnectMaxDelayMs: 2,
			...overrides,
		},
		email: {examples: {uids: []}},
	})
	service._sleep = async () => {}
	const emitted = []
	let initialEvents = 0
	service.on(ImapService.EVENT_NEW_MAIL, (mail) => {
		emitted.push(mail.uid)
	})
	service.on(ImapService.EVENT_INITIAL_LOAD_DONE, () => {
		initialEvents++
	})
	t.after(async () => {
		service.close()
		imaps.connect = originalConnect
		await flush()
	})
	return {
		service,
		first,
		next,
		options,
		emitted,
		initialEvents: () => initialEvents,
	}
}

test('reconnect resync proceeds even if the dead connection never completes its UID search', async (t) => {
	const first = new Connection()
	let completeOldSearch
	first.uidSearch = (_, callback) => {
		completeOldSearch = callback
	}

	const next = new Connection([message(2)])
	const f = fixture(t, first, next)
	t.after(async () => {
		completeOldSearch?.(null, [])
		await flush()
	})
	await f.service.connectAndLoadMessages()
	assert.equal(first.uidSearches, 1)
	first.emit('close')
	await f.service._reconnectPromise
	await flush()
	assert.ok(
		next.uidSearches > 0,
		'new live connection must start its own resync',
	)
	assert.deepEqual(f.emitted, [2])
	assert.equal(f.service.initialLoadDone, true)
})

test('a late UID callback cannot fetch old work through a replacement connection', async (t) => {
	const first = new Connection()
	let completeOldSearch
	first.uidSearch = (_, callback) => {
		completeOldSearch = callback
	}

	const f = fixture(t, first, new Connection([message(2)]))
	f.service._attachConnection(first)
	observe(f.service._loadMailSummariesAndEmitAsEvents())
	await flush()
	f.service._attachConnection(f.next)
	observe(f.service._loadMailSummariesAndEmitAsEvents())
	await flush()
	completeOldSearch(null, [1])
	await flush()
	assert.ok(f.next.headerRequests.every((uids) => !uids.includes(1)))
	assert.deepEqual(f.emitted, [2])
})

test('a superseded header completion cannot emit mail or release the replacement load lock', async (t) => {
	const oldHeaders = Promise.withResolvers()
	const newHeaders = Promise.withResolvers()
	const first = new Connection([message(1)])
	const next = new Connection([message(2)])
	first.headers = () => oldHeaders.promise
	next.headers = () => newHeaders.promise
	const f = fixture(t, first, next)
	t.after(() => {
		oldHeaders.resolve([message(1)])
		newHeaders.resolve([message(2)])
	})
	f.service._attachConnection(first)
	observe(f.service._loadMailSummariesAndEmitAsEvents())
	await flush()
	f.service._attachConnection(next)
	const currentLoad = f.service._loadMailSummariesAndEmitAsEvents()
	observe(currentLoad)
	await flush()
	oldHeaders.resolve([message(1)])
	await flush()
	assert.deepEqual(
		f.emitted,
		[],
		'old headers must not publish after replacement',
	)
	assert.equal(
		f.service.loadingInProgress,
		true,
		'only the current run may release its lock',
	)
	newHeaders.resolve([message(2)])
	await currentLoad
	assert.deepEqual(f.emitted, [2])
	assert.equal(f.service.loadingInProgress, false)
})

test('a close abandons pending work without marking the initial index complete', async (t) => {
	const first = new Connection()
	let completeSearch
	first.uidSearch = (_, callback) => {
		completeSearch = callback
	}

	const f = fixture(t, first)
	f.service._attachConnection(first)
	const load = observe(f.service._loadMailSummariesAndEmitAsEvents())
	await flush()
	f.service.close()
	await flush()
	assert.equal(
		load.settled,
		true,
		'logical work must finish when its owning connection is closed',
	)
	assert.equal(f.service.loadingInProgress, false)
	assert.equal(f.initialEvents(), 0)
	completeSearch(null, [1])
	await flush()
	assert.deepEqual(f.emitted, [])
})

test('mail arriving during initial indexing is caught up once without duplicate events', async (t) => {
	const first = new Connection([message(1)])
	let completeFirstSearch
	first.uidSearch = (_, callback) => {
		if (first.uidSearches === 1) {
			completeFirstSearch = callback
		} else {
			queueMicrotask(() =>
				callback(
					null,
					first.messages.map((mail) => mail.attributes.uid),
				),
			)
		}
	}

	const f = fixture(t, first)
	await f.service.connectAndLoadMessages()
	first.messages.push(message(2))
	for (let index = 0; index < 20; index++) {
		f.options[0].onmail()
	}

	completeFirstSearch(null, [1])
	await flush()
	await flush()
	assert.deepEqual(
		f.emitted.toSorted((a, b) => a - b),
		[1, 2],
	)
	assert.equal(f.initialEvents(), 1)
	assert.equal(
		first.uidSearches,
		2,
		'notifications during one load coalesce into one catch-up search',
	)
})

test('a failed worker does not release the live connection while another header request is pending', async (t) => {
	const pending = Promise.withResolvers()
	const first = new Connection([message(1), message(2), message(3)])
	first.headers = (uids) =>
		uids[0] === 3
			? Promise.reject(new Error('synthetic header failure'))
			: pending.promise
	const f = fixture(t, first, undefined, {fetchConcurrency: 2})
	t.after(() => pending.resolve([message(2)]))
	f.service._attachConnection(first)
	const load = observe(f.service._loadMailSummariesAndEmitAsEvents())
	await flush()
	assert.equal(
		f.service.loadingInProgress,
		true,
		'pending live work still owns the load',
	)
	assert.equal(
		first.headerRequests.length,
		2,
		'a failure must not schedule another chunk',
	)
	pending.resolve([message(2)])
	await flush()
	assert.equal(load.error?.message, 'synthetic header failure')
	assert.equal(f.service.loadingInProgress, false)
	assert.equal(f.service.initialLoadDone, false)
})

test('a healthy pending search remains serialized until it settles', async (t) => {
	const first = new Connection()
	let completeSearch
	first.uidSearch = (_, callback) => {
		completeSearch = callback
	}

	const f = fixture(t, first)
	f.service._attachConnection(first)
	const load = f.service._loadMailSummariesAndEmitAsEvents()
	observe(load)
	observe(f.service._loadMailSummariesAndEmitAsEvents())
	await flush()
	assert.equal(first.uidSearches, 1)
	assert.equal(f.service.loadingInProgress, true)
	completeSearch(null, [])
	await load
	assert.equal(f.service.loadingInProgress, false)
})

test('summary fetching completes when a searched UID vanishes before FETCH returns messages', async (t) => {
	const raw = new EventEmitter()
	raw.search = (_, callback) => queueMicrotask(() => callback(null, [1]))
	raw.fetch = () => {
		const fetch = new EventEmitter()
		queueMicrotask(() => fetch.emit('end'))
		return fetch
	}

	raw.end = () => raw.emit('end')
	const f = fixture(t)
	const connection = new imaps.ImapSimple(raw)
	f.service._attachConnection(connection)
	const load = observe(f.service._loadMailSummariesAndEmitAsEvents())
	await flush()
	assert.equal(
		load.settled,
		true,
		'FETCH completion must not wait for a vanished message',
	)
	assert.equal(f.service.loadingInProgress, false)
	assert.equal(f.service.initialLoadDone, true)
	assert.deepEqual(f.emitted, [])
})

test('summary indexing rejects an unrequested UID before marking it loaded', async (t) => {
	const first = new Connection([message(1)])
	first.headers = async () => [message(99)]
	const f = fixture(t, first)
	f.service._attachConnection(first)
	await assert.rejects(
		f.service._loadMailSummariesAndEmitAsEvents(),
		/Unexpected IMAP summary UID/v,
	)
	assert.equal(f.service.loadedUids.size, 0)
	assert.equal(f.initialEvents(), 0)
	delete first.headers
	await f.service._loadMailSummariesAndEmitAsEvents()
	assert.deepEqual(f.emitted, [1])
})

test('a malformed header does not poison the loaded UID set and can be retried', async (t) => {
	const first = new Connection([message(1)])
	const malformed = message(1)
	delete malformed.parts[0].body.from
	first.headers = async () => [malformed]
	const f = fixture(t, first)
	f.service._attachConnection(first)
	await assert.rejects(f.service._loadMailSummariesAndEmitAsEvents())
	assert.equal(f.service.loadedUids.size, 0)
	assert.equal(f.initialEvents(), 0)
	delete first.headers
	await f.service._loadMailSummariesAndEmitAsEvents()
	assert.deepEqual(f.emitted, [1])
})

test('summary completion waits for actual header-stream completion after FETCH end', async (t) => {
	const raw = new EventEmitter()
	let bodyStream
	raw.search = (_, callback) => queueMicrotask(() => callback(null, [1]))
	raw.fetch = (_, options) => {
		const fetch = new EventEmitter()
		queueMicrotask(() => {
			const item = new EventEmitter()
			bodyStream = new EventEmitter()
			fetch.emit('message', item)
			item.emit('body', bodyStream, {which: options.bodies[0]})
			item.emit('attributes', {uid: 1})
			item.emit('end')
			fetch.emit('end')
		})
		return fetch
	}

	raw.end = () => raw.emit('end')
	const f = fixture(t)
	f.service._attachConnection(new imaps.ImapSimple(raw))
	const load = f.service._loadMailSummariesAndEmitAsEvents()
	observe(load)
	await flush()
	assert.equal(f.service.initialLoadDone, false)
	bodyStream.emit(
		'data',
		Buffer.from(
			'To: recipient@fixture.invalid\r\nFrom: sender@fixture.invalid\r\n\r\n',
		),
	)
	bodyStream.emit('end')
	await load
	assert.deepEqual(f.emitted, [1])
	assert.equal(f.initialEvents(), 1)
})

test('a late error from an abandoned fetch cannot fail or mutate its replacement', async (t) => {
	const oldHeaders = Promise.withResolvers()
	const first = new Connection([message(1)])
	first.headers = () => oldHeaders.promise
	const f = fixture(t, first, new Connection([message(2)]))
	f.service._attachConnection(first)
	const oldLoad = observe(f.service._loadMailSummariesAndEmitAsEvents())
	await flush()
	f.service._attachConnection(f.next)
	await f.service._loadMailSummariesAndEmitAsEvents()
	oldHeaders.reject(new Error('late abandoned fetch failure'))
	await flush()
	assert.equal(oldLoad.error?.code, 'IMAP_LOAD_CANCELLED')
	assert.equal(f.service.connection, f.next)
	assert.equal(f.service.loadingInProgress, false)
	assert.deepEqual(f.emitted, [2])
})

test('summary fetching rejects a body part it did not request without reading its data', async (t) => {
	const raw = new EventEmitter()
	const stream = new EventEmitter()
	let descriptor = ''
	raw.search = (_, callback) => queueMicrotask(() => callback(null, [1]))
	raw.fetch = () => {
		const fetch = new EventEmitter()
		queueMicrotask(() => {
			const item = new EventEmitter()
			fetch.emit('message', item)
			item.emit('body', stream, {which: descriptor})
		})
		return fetch
	}

	raw.end = () => raw.emit('end')
	const f = fixture(t)
	f.service._attachConnection(new imaps.ImapSimple(raw))
	await assert.rejects(
		f.service._loadMailSummariesAndEmitAsEvents(),
		/Unexpected IMAP summary body part/v,
	)
	descriptor = {}
	await assert.rejects(
		f.service._loadMailSummariesAndEmitAsEvents(),
		/Unexpected IMAP summary body part/v,
	)
	descriptor = null
	await assert.rejects(
		f.service._loadMailSummariesAndEmitAsEvents(),
		/Unexpected IMAP summary body part/v,
	)
	assert.equal(stream.listenerCount('data'), 0)
	assert.equal(f.service.initialLoadDone, false)
	assert.equal(f.service.loadedUids.size, 0)
})
