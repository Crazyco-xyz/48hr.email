/* eslint-disable import-x/order -- Bootstrap process before resolving builtin modules. */
const process = require('node:process')

const test = process.getBuiltinModule('node:test')
const assert = process.getBuiltinModule('node:assert/strict')
const {once} = process.getBuiltinModule('node:events')
const {createRequire} = process.getBuiltinModule('node:module')
const express = require('express')

// Exercise the exact qs instance used by Express instead of a separate test dependency.
const requireFromExpress = createRequire(
	require.resolve('express/package.json'),
)
const qs = requireFromExpress('qs')

test('query serialization tolerates array elements with a non-callable toString', () => {
	const value = {a: [{toString: 'fixture'}]}
	for (const encodeValuesOnly of [false, true]) {
		assert.doesNotThrow(() =>
			qs.stringify(value, {
				arrayFormat: 'comma',
				encodeValuesOnly,
			}),
		)
	}

	assert.equal(
		qs.stringify({a: ['one', 'two']}, {arrayFormat: 'comma'}),
		'a=one%2Ctwo',
	)
})

test(
	'Express query parsing and comma serialization survive hostile toString keys',
	{timeout: 5000},
	async (t) => {
		const app = express()
		app.get('/query', (request, response) => {
			response.json({
				query: qs.stringify(request.query, {arrayFormat: 'comma'}),
			})
		})
		const server = app.listen(0, '127.0.0.1')
		t.after(
			() =>
				new Promise((resolve) => {
					server.closeAllConnections()
					server.close(resolve)
				}),
		)
		await once(server, 'listening')
		const base = `http://127.0.0.1:${server.address().port}/query`
		const hostile = await fetch(`${base}?a%5B0%5D%5BtoString%5D=fixture`)
		assert.equal(hostile.status, 200)
		const hostileBody = await hostile.json()
		assert.equal(typeof hostileBody.query, 'string')
		const ordinary = await fetch(`${base}?a=one&a=two`)
		assert.equal(ordinary.status, 200)
		assert.deepEqual(await ordinary.json(), {query: 'a=one%2Ctwo'})
	},
)
