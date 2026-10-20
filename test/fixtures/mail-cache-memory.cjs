/* eslint-disable import-x/order -- Configure fixture environment before loading application modules. */
/* eslint-disable no-await-in-loop -- Model serial distinct full-message reads. */
const process = require('node:process')

const assert = process.getBuiltinModule('node:assert/strict')
const crypto = process.getBuiltinModule('node:crypto')
const fs = process.getBuiltinModule('node:fs')

assert(
	!fs.existsSync('.env'),
	'fixture must not load an operational environment',
)
process.env.UX_DEBUG_MODE = 'true'
process.env.EMAIL_DOMAINS = '["fixture.example"]'
const Service = require('../../application/mail-processing-service')

const service = Object.create(Service.prototype)
service.imapService = {
	async fetchOneFullMail() {
		// Distinct flat strings: repeated ropes would conceal retained bytes.
		return crypto.randomBytes(65_536).toString('hex')
	},
}
service._initCache()
async function main() {
	for (let uid = 1; uid <= 1500; uid++) {
		const body = await service.cachedFetchFullMail(
			'fixture@example.invalid',
			uid,
			true,
		)
		assert.equal(body.length, 131_072)
	}

	globalThis.gc()
	console.log(
		JSON.stringify({
			entries: service.cacheStorage.size,
			heapUsed: process.memoryUsage().heapUsed,
		}),
	)
	assert(service.cacheStorage.size <= 64)
	assert(process.memoryUsage().heapUsed < 50_331_648)
}

main().catch((error) => {
	console.error(error)
	process.exitCode = 1
})
