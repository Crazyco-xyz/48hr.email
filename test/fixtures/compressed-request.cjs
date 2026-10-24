/* eslint-disable import-x/order -- Bootstrap process before resolving builtin modules. */
/* eslint-disable unicorn/no-process-exit -- This isolated child observes process survival after decoder errors. */
const process = require('node:process')

const assert = process.getBuiltinModule('node:assert/strict')
const http = process.getBuiltinModule('node:http')
const zlib = process.getBuiltinModule('node:zlib')
const {once} = process.getBuiltinModule('node:events')
const {setTimeout: delay} = process.getBuiltinModule('node:timers/promises')
const {Buffer} = process.getBuiltinModule('node:buffer')
const express = require('express')

const app = express()
app.use(express.json())
app.post('/', (request, response) => response.json(request.body))
app.get('/health', (_request, response) => response.sendStatus(200))
const server = app.listen(0, '127.0.0.1')
async function main() {
	if (!server.listening) {
		await once(server, 'listening')
	}

	const body = Buffer.concat([
		zlib.gzipSync(Buffer.from('{"fixture":true}')),
		Buffer.from([0]),
		Buffer.alloc(100 * 1024, 88),
	])
	const response = await new Promise((resolve, reject) => {
		const request = http.request(
			{
				hostname: '127.0.0.1',
				port: server.address().port,
				path: '/',
				method: 'POST',
				agent: false,
				headers: {
					'content-type': 'application/json',
					'content-encoding': 'gzip',
					'content-length': body.length,
				},
			},
			(incoming) => {
				let text = ''
				incoming.setEncoding('utf8')
				incoming.on('data', (chunk) => {
					text += chunk
				})
				incoming.on('end', () => resolve({status: incoming.statusCode, text}))
				incoming.on('error', reject)
			},
		)
		request.on('error', reject)
		request.setTimeout(2000, () =>
			request.destroy(new Error('compressed request did not finish')),
		)
		request.end(body)
	})
	assert.equal(response.status, 200)
	assert.deepEqual(JSON.parse(response.text), {fixture: true})
	await delay(250)
	const health = await fetch(`http://127.0.0.1:${server.address().port}/health`)
	assert.equal(health.status, 200)
	server.closeAllConnections()
	await new Promise((resolve) => {
		server.close(resolve)
	})
	console.log(
		JSON.stringify({
			compressedBody: true,
			trailingBytes: 102_401,
			aliveAfterDecoder: true,
		}),
	)
	process.exit(0)
}

main().catch((error) => {
	console.error(error)
	process.exit(1)
})
