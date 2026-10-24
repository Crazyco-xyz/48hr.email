/* eslint-disable import-x/order -- Bootstrap process before resolving builtin modules. */
const process = require('node:process')

const test = process.getBuiltinModule('node:test')
const assert = process.getBuiltinModule('node:assert/strict')
const path = process.getBuiltinModule('node:path')
const {spawnSync} = process.getBuiltinModule('node:child_process')
const addressparser = require('nodemailer/lib/addressparser')
const {simpleParser} = require('mailparser')

function addresses(rows) {
	return rows.flatMap((row) =>
		row.group ? addresses(row.group) : [row.address],
	)
}

const cases = [
	[
		'nested comment',
		'Victim (x(y) <evil@evil.invalid>) <v@victim.invalid>',
		'v@victim.invalid',
	],
	[
		'semicolon in a group comment',
		'G: (a; <evil@evil.invalid>) <v@victim.invalid>;',
		'v@victim.invalid',
	],
	[
		'angle bracket in a quoted local part',
		'<"a@evil.invalid>"@good.invalid>',
		'"a@evil.invalid>"@good.invalid',
	],
]
for (const [name, header, expected] of cases) {
	test(`outgoing and inbound mail preserve the actual mailbox for ${name}`, async () => {
		assert.deepEqual(addresses(addressparser(header)), [expected])
		const mail = await simpleParser(
			`From: sender@fixture.invalid\r\nTo: ${header}\r\nSubject: fixture\r\n\r\nNo mail is sent.`,
		)
		assert.deepEqual(addresses(mail.to.value), [expected])
	})
}

test('compressed JSON with trailing bytes does not crash the HTTP process', () => {
	const result = spawnSync(
		process.execPath,
		[path.join(__dirname, 'fixtures/compressed-request.cjs')],
		{
			cwd: path.resolve(__dirname, '..'),
			encoding: 'utf8',
			timeout: 10_000,
		},
	)
	assert.equal(result.status, 0, result.stderr)
	const row = JSON.parse(result.stdout)
	assert.equal(row.aliveAfterDecoder, true)
	assert.equal(row.compressedBody, true)
})
