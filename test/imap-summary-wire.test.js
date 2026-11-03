/* eslint-disable import-x/order -- Initialize synthetic configuration before importing the mail service. */
const process = require('node:process')

const test = process.getBuiltinModule('node:test')
const assert = process.getBuiltinModule('node:assert/strict')
const net = process.getBuiltinModule('node:net')
const {once} = process.getBuiltinModule('node:events')
const {Buffer} = process.getBuiltinModule('node:buffer')
process.env.UX_DEBUG_MODE = 'true'
process.env.EMAIL_DOMAINS = '["fixture.invalid"]'
const ImapService = require('../application/imap-service')

test(
	'real IMAP parsing indexes the available headers when a searched UID vanishes before FETCH',
	{timeout: 5000},
	async (t) => {
		const sockets = new Set()
		// eslint-disable-next-line prefer-const -- Cleanup also runs if setup fails before service creation.
		let service
		let searches = 0
		let fetches = 0
		const header =
			'From: sender@fixture.invalid\r\nTo: recipient@fixture.invalid\r\nSubject: Synthetic wire fixture\r\nDate: Thu, 01 Jan 2099 00:00:00 +0000\r\n\r\n'
		const server = net.createServer((socket) => {
			sockets.add(socket)
			socket.on('close', () => sockets.delete(socket))
			socket.write('* OK synthetic local IMAP fixture\r\n')
			let buffer = ''
			socket.on('data', (data) => {
				buffer += data.toString('ascii')
				while (buffer.includes('\r\n')) {
					const at = buffer.indexOf('\r\n')
					const line = buffer.slice(0, at)
					buffer = buffer.slice(at + 2)
					const [tag] = line.split(' ', 1)
					const command = line.slice(tag.length + 1)
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
							'* FLAGS (\\Seen \\Deleted)\r\n* 2 EXISTS\r\n* 0 RECENT\r\n* OK [UIDVALIDITY 1] fixture\r\n* OK [UIDNEXT 3] fixture\r\n',
						)
						ok()
					} else if (command.startsWith('UID SEARCH')) {
						searches++
						socket.write(`* SEARCH ${fetches ? '2' : '1 2'}\r\n`)
						ok()
					} else if (command.startsWith('UID FETCH')) {
						fetches++
						assert.match(
							command,
							/BODY\.PEEK\[HEADER\.FIELDS \(FROM TO SUBJECT DATE\)\]/v,
						)
						assert.doesNotMatch(command, /BODY(?:\.PEEK)?\[\]/v)
						// UID 1 disappeared after SEARCH. Only UID 2 is returned before
						// the tagged FETCH completion, as a real expunge race permits.
						socket.write('* 1 EXPUNGE\r\n')
						socket.write(
							`* 1 FETCH (UID 2 FLAGS () INTERNALDATE "01-Jan-2099 00:00:00 +0000" ENVELOPE (NIL NIL NIL NIL NIL NIL NIL NIL NIL NIL) BODY[HEADER.FIELDS (FROM TO SUBJECT DATE)] {${Buffer.byteLength(header)}}\r\n${header})\r\n`,
						)
						ok()
					} else if (command.startsWith('NOOP')) {
						ok()
					} else if (command.startsWith('LOGOUT')) {
						socket.end(`* BYE fixture closed\r\n${tag} OK logout\r\n`)
					} else {
						socket.write(`${tag} BAD unsupported fixture command\r\n`)
					}
				}
			})
		})
		t.after(async () => {
			service?.close()
			for (const socket of sockets) {
				socket.destroy()
			}

			if (server.listening) {
				await new Promise((resolve) => {
					server.close(resolve)
				})
			}
		})
		server.listen(0, '127.0.0.1')
		await once(server, 'listening')
		service = new ImapService({
			imap: {
				user: 'synthetic',
				password: 'synthetic',
				host: '127.0.0.1',
				port: server.address().port,
				secure: false,
				authTimeout: 2000,
				fetchChunkSize: 2,
				fetchConcurrency: 1,
				refreshIntervalSeconds: 0,
			},
			email: {examples: {uids: []}},
		})
		const indexed = []
		service.on(ImapService.EVENT_NEW_MAIL, (mail) => {
			indexed.push(mail)
		})
		const initial = once(service, ImapService.EVENT_INITIAL_LOAD_DONE)
		await service.connectAndLoadMessages()
		await initial
		if (service._loadRun) {
			await service._loadRun.promise
		}

		assert.equal(indexed.length, 1)
		assert.equal(indexed[0].uid, 2)
		assert.deepEqual(indexed[0].to, ['recipient@fixture.invalid'])
		assert.equal(indexed[0].subject, 'Synthetic wire fixture')
		assert.equal(indexed[0].date.toISOString(), '2099-01-01T00:00:00.000Z')
		assert.equal(fetches, 1)
		assert.equal(searches, 2)
		assert.equal(service.loadingInProgress, false)
	},
)
