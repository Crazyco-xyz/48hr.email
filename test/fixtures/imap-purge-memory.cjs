const process = require('node:process')
// Synthetic loopback IMAP workload; never connects to production or reads mail.
const assert = process.getBuiltinModule('node:assert/strict')
const net = process.getBuiltinModule('node:net')
const fs = process.getBuiltinModule('node:fs')
const path = process.getBuiltinModule('node:path')
const {createRequire} = process.getBuiltinModule('node:module')
const {Buffer} = process.getBuiltinModule('node:buffer')

const project = process.argv[2] || path.resolve(__dirname, '../..')
const requireApp = createRequire(path.join(project, 'package.json'))
assert(
	!fs.existsSync('.env'),
	'fixture must not load an operational environment',
)
Object.assign(process.env, {
	IMAP_USER: 'synthetic',
	IMAP_PASSWORD: 'synthetic',
	IMAP_SERVER: '127.0.0.1',
	EMAIL_DOMAINS: '["example.invalid"]',
	EMAIL_PURGE_TIME: '48',
	EMAIL_PURGE_UNIT: 'hours',
})
const Service = requireApp('./application/imap-service')
requireApp('./application/config-service').email.purgeTime = {
	time: 48,
	unit: 'hours',
}
const total = 5000
const all = Array.from({length: total}, (_, i) => i + 1)
const sockets = new Set()
let fetchCount = 0
let searchCount = 0
const commands = new Set()
const protocolSamples = []
let phase = 'connect'
const server = net.createServer((socket) => {
	sockets.add(socket)
	socket.on('close', () => sockets.delete(socket))
	socket.write('* OK synthetic IMAP fixture\r\n')
	let buffered = ''
	socket.on('data', (data) => {
		buffered += data.toString('ascii')
		while (buffered.includes('\r\n')) {
			const at = buffered.indexOf('\r\n')
			const line = buffered.slice(0, at)
			buffered = buffered.slice(at + 2)
			const [tag] = line.split(' ', 1)
			const command = line.slice(tag.length + 1)
			commands.add(command.split(' ', 1)[0])
			if (protocolSamples.length < 12) {
				protocolSamples.push(
					command.startsWith('LOGIN')
						? 'LOGIN synthetic'
						: command.slice(0, 180),
				)
			}

			const ok = () => socket.write(`${tag} OK fixture complete\r\n`)
			if (command.startsWith('CAPABILITY')) {
				socket.write('* CAPABILITY IMAP4rev1\r\n')
				ok()
			} else if (command.startsWith('LOGIN')) {
				ok()
			} else if (command.startsWith('LIST')) {
				socket.write('* LIST (\\Noselect) "/" ""\r\n')
				ok()
			} else if (/^(?:SELECT|EXAMINE)/v.test(command)) {
				socket.write(
					`* FLAGS (\\Seen \\Deleted)\r\n* ${total} EXISTS\r\n* 0 RECENT\r\n* OK [UIDVALIDITY 1] valid\r\n* OK [UIDNEXT ${total + 1}] next\r\n`,
				)
				ok()
			} else if (command.startsWith('UID SEARCH')) {
				searchCount++
				const match = command.match(/^UID SEARCH UID (?<uids>[,0-9:]+)/v)
				const selected = match
					? match.groups.uids.split(',').flatMap((item) => {
							const [lo, hi] = item.split(':').map(Number)
							return hi ? all.filter((uid) => uid >= lo && uid <= hi) : [lo]
						})
					: all
				socket.write(`* SEARCH ${selected.join(' ')}\r\n`)
				ok()
			} else if (command.startsWith('UID FETCH')) {
				fetchCount++
				const spec = command.match(/^UID FETCH (?<uids>[,0-9:]+)/v).groups.uids
				const selected = spec.split(',').flatMap((item) => {
					const [lo, hi] = item.split(':').map(Number)
					return hi ? all.filter((uid) => uid >= lo && uid <= hi) : [lo]
				})
				for (const uid of selected) {
					const {fields} = command.match(
						/BODY(?:\.PEEK)?\[HEADER\.FIELDS \((?<fields>[ A-Z]+)\)\]/v,
					).groups
					const values = {
						FROM: 'fixture@example.invalid',
						TO: `recipient${uid}@example.invalid`,
						SUBJECT: `Synthetic message ${uid}`,
						DATE: 'Thu, 01 Jan 2099 00:00:00 +0000',
					}
					const body =
						fields
							.split(' ')
							.map((field) => `${field}: ${values[field]}\r\n`)
							.join('') + '\r\n'
					socket.write(
						`* ${uid} FETCH (UID ${uid} FLAGS () INTERNALDATE "01-Jan-2099 00:00:00 +0000"${command.includes('ENVELOPE') ? ' ENVELOPE (NIL NIL NIL NIL NIL NIL NIL NIL NIL NIL)' : ''} BODY[HEADER.FIELDS (${fields})] {${Buffer.byteLength(body)}}\r\n${body})\r\n`,
					)
				}

				ok()
			} else if (command.startsWith('NOOP')) {
				ok()
			} else if (command.startsWith('LOGOUT')) {
				socket.write(`* BYE fixture closed\r\n${tag} OK logout\r\n`)
				socket.end()
			} else {
				socket.write(`${tag} BAD unsupported fixture command\r\n`)
			}
		}
	})
})
let service
const samples = []
const deadline = setTimeout(() => {
	console.error(
		JSON.stringify({
			state: 'fixture_deadline',
			phase,
			commands: [...commands],
			protocolSamples,
			fetchCount,
			searchCount,
			samples,
		}),
	)
	// eslint-disable-next-line unicorn/no-process-exit -- This CLI fixture must terminate its owned child on a deadline.
	process.exit(2)
}, 90_000)
;(async () => {
	await new Promise((resolve) => {
		server.listen(0, '127.0.0.1', resolve)
	})
	const cfg = {
		imap: {fetchChunkSize: 500, fetchConcurrency: 12},
		email: {examples: {uids: []}},
	}
	service = new Service(cfg)
	await service._connectOnce({
		imap: {
			host: '127.0.0.1',
			port: server.address().port,
			user: 'synthetic',
			password: 'synthetic',
			tls: false,
			authTimeout: 3000,
			connTimeout: 3000,
			keepalive: false,
		},
	})
	let emitted = 0
	service.on(Service.EVENT_NEW_MAIL, () => emitted++)
	for (let cycle = 0; cycle < 20; cycle++) {
		phase = `load_${cycle}`
		// eslint-disable-next-line no-await-in-loop -- Measure complete sequential scans, not skipped overlapping calls.
		await service._loadMailSummariesAndEmitAsEvents()
		phase = `purge_${cycle}`
		// eslint-disable-next-line no-await-in-loop -- Each measured purge must finish before the next sample.
		await service.deleteOldMails(new Date(0))
		globalThis.gc()
		samples.push({
			cycle,
			heap: process.memoryUsage().heapUsed,
			queue: service.connection.imap._queue.length,
			loaded: service.loadedUids.size,
		})
	}

	assert.equal(emitted, total)
	assert.equal(service.loadedUids.size, total)
	assert(samples.every((s) => s.queue === 0))
	const report = {
		state: 'completed',
		synthetic: true,
		productionChanges: false,
		node: process.version,
		total,
		cycles: samples.length,
		emitted,
		fetchCount,
		searchCount,
		commands: [...commands],
		samples,
		retainedGrowthBytes: samples.at(-1).heap - samples[0].heap,
		finalHeap: process.memoryUsage().heapUsed,
	}
	console.log(JSON.stringify(report))
})()
	.catch((error) => {
		console.error(error.stack)
		process.exitCode = 1
	})
	.finally(() => {
		service?.close()
		for (const socket of sockets) {
			socket.destroy()
		}

		server.close()
		clearTimeout(deadline)
	})
