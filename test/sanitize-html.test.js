/* eslint-disable import-x/order -- Use fixture configuration before loading the application filter. */
const process = require('node:process')

const test = process.getBuiltinModule('node:test')
const assert = process.getBuiltinModule('node:assert/strict')
process.env.UX_DEBUG_MODE = 'true'
process.env.EMAIL_DOMAINS = '["fixture.example"]'
const {
	sanitizeHtmlTwigFilter,
} = require('../infrastructure/web/views/twig-filters')

test('the actual mail HTML filter handles deeply discarded iframe fallbacks', () => {
	const result = sanitizeHtmlTwigFilter('<iframe>'.repeat(4000))
	assert.equal(typeof result, 'string')
	assert.doesNotMatch(result, /<iframe/iv)
})

test('the mail HTML filter retains safe markup and protected links while removing scripts', () => {
	const result = sanitizeHtmlTwigFilter(
		'<p>Hello <a href="https://example.invalid/" onclick="fixture_payload()">mail</a><script>fixture_payload()</script></p>',
	)
	assert.match(result, /<p>Hello <a /v)
	assert.match(result, /href="https:\/\/example\.invalid\/"/v)
	assert.match(result, /rel="noreferrer noopener"/v)
	assert.match(result, /target="_blank"/v)
	assert.doesNotMatch(result, /<script|onclick|fixture_payload/iv)
})
