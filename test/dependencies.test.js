const test = require('node:test')
const assert = require('node:assert/strict')
const { once } = require('node:events')
const net = require('node:net')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')

// Direct module tests use fixture configuration and never need live mail credentials.
process.env.UX_DEBUG_MODE = 'true'
process.env.EMAIL_DOMAINS = '["fixture.example"]'

const browserHeaders = {
	'user-agent': 'Mozilla/5.0 Firefox/140.0',
	accept: 'text/html',
	'accept-language': 'en-US',
}

test('SQLite upgrade preserves existing-account login and transaction rollback against the real schema', async () => {
	const UserRepository = require('../domain/user-repository')
	const AuthService = require('../application/auth-service')
	const repo = new UserRepository(':memory:')
	try {
		const auth = new AuthService(repo, {})
		const hash = await auth.hashPassword('Fixture-only-123!')
		const inserted = repo.db
			.prepare(
				'INSERT INTO users (instance_id, username, password_hash, created_at) VALUES (?, ?, ?, ?)',
			)
			.run('fixture', 'maintenance_fixture', hash, Date.now())
		assert.equal(
			(await auth.login('maintenance_fixture', 'Fixture-only-123!')).success,
			true,
		)
		assert.equal(
			(await auth.login('maintenance_fixture', 'wrong')).success,
			false,
		)
		const write = repo.db.transaction(() => {
			repo.db
				.prepare('DELETE FROM users WHERE id = ?')
				.run(inserted.lastInsertRowid)
			throw new Error('rollback fixture')
		})
		assert.throws(write, /rollback fixture/)
		assert.equal(
			repo.getUserByUsername('maintenance_fixture').id,
			inserted.lastInsertRowid,
		)
	} finally {
		repo.close()
	}
})

test('upgraded SMTP and mail parser preserve forwarded MIME content without sending mail', async () => {
	const nodemailer = require('nodemailer')
	const { simpleParser } = require('mailparser')
	const SmtpService = require('../application/smtp-service')
	const service = new SmtpService({
		smtp: { enabled: false, user: 'forwarder@example.com' },
	})
	const transport = nodemailer.createTransport({
		streamTransport: true,
		buffer: true,
	})
	let raw
	service.transporter = {
		sendMail: async (message) => {
			const info = await transport.sendMail(message)
			raw = info.message
			return info
		},
	}
	const result = await service.forwardMail(
		{
			from: { text: 'Sender <sender@example.com>' },
			to: { text: 'alias@example.com' },
			subject: 'Fixture subject',
			text: 'Fixture body',
			html: '<p>Fixture body</p>',
			attachments: [
				{
					filename: 'fixture.txt',
					content: Buffer.from('fixture attachment'),
					contentType: 'text/plain',
				},
			],
		},
		'recipient@example.com',
	)
	assert.equal(result.success, true, result.error)
	const parsed = await simpleParser(raw)
	assert.equal(parsed.subject, 'Fwd: Fixture subject')
	assert.equal(parsed.to.value[0].address, 'recipient@example.com')
	assert.match(parsed.text, /Fixture body/)
	assert.match(parsed.html, /Fixture body/)
	assert.equal(parsed.attachments[0].content.toString(), 'fixture attachment')
})

test(
	'upgraded app boots and renders real Twig pages with healthy API JSON',
	{ timeout: 20000 },
	async () => {
		const root = path.resolve(__dirname, '..')
		const scratch = await fs.mkdtemp(
			path.join(os.tmpdir(), '48hr-maintenance-'),
		)
		const reserve = net.createServer()
		reserve.listen(0, '127.0.0.1')
		await once(reserve, 'listening')
		const port = reserve.address().port
		reserve.close()
		await once(reserve, 'close')
		const example = require('dotenv').parse(
			await fs.readFile(path.join(root, '.env.example')),
		)
		const child = spawn(process.execPath, [path.join(root, 'app.js')], {
			cwd: scratch,
			env: {
				...process.env,
				...example,
				UX_DEBUG_MODE: 'true',
				HTTP_PORT: String(port),
				USER_AUTH_ENABLED: 'true',
				HTTP_STATISTICS_ENABLED: 'true',
			},
			stdio: ['ignore', 'pipe', 'pipe'],
			windowsHide: true,
		})
		let output = ''
		for (const stream of [child.stdout, child.stderr])
			stream.on('data', (chunk) => {
				output = (output + chunk.toString()).slice(-16000)
			})
		const base = `http://127.0.0.1:${port}`
		try {
			let ready = false
			for (let i = 0; i < 100; i++) {
				if (child.exitCode !== null)
					throw new Error(`App exited ${child.exitCode}: ${output}`)
				try {
					const response = await fetch(`${base}/api/v1/health`)
					const body = await response.json()
					ready =
						response.ok && body.success === true && body.data?.status === 'ok'
				} catch {}
				if (ready) break
				await new Promise((resolve) => setTimeout(resolve, 100))
			}
			assert.equal(ready, true, output)
			for (const route of ['/', '/auth', '/stats']) {
				const response = await fetch(base + route, { headers: browserHeaders })
				assert.equal(response.status, 200, route)
				const html = await response.text()
				assert.match(html, /<!DOCTYPE html>/i, route)
				assert.doesNotMatch(
					html,
					/Internal Server Error|<title>Loading\.\.\./,
					route,
				)
			}
			const response = await fetch(`${base}/api/v1/config/domains`)
			assert.equal(response.status, 200)
			assert.equal((await response.json()).success, true)
			assert.doesNotMatch(output, /DeprecationWarning|ExperimentalWarning/)
		} finally {
			if (child.exitCode === null) {
				const exited = once(child, 'exit')
				child.kill()
				await exited
			}
			// This is the exact scratch directory created by this test under the OS temp directory.
			await fs.rm(scratch, { recursive: true, force: true })
		}
	},
)
