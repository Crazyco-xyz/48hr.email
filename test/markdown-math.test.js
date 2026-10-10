/* eslint-disable import-x/no-extraneous-dependencies, n/no-extraneous-import -- Exercise the actual pinned transitive renderer, rather than an unrelated direct installation. */
// eslint-disable-next-line n/prefer-process-get-builtin-module -- Bootstrap the process reference used for getBuiltinModule.
const runtime = require('node:process')
const katex = require('katex')

const test = runtime.getBuiltinModule('node:test')
const assert = runtime.getBuiltinModule('node:assert/strict')

test('Markdown math dependency renders inline and display formulas with inherited trust disabled', async () => {
	const {micromark} = await import('micromark')
	const {math, mathHtml} = await import('micromark-extension-math')
	const render = (source) =>
		micromark(source, {
			extensions: [math()],
			htmlExtensions: [mathHtml()],
		})
	const output = render('Inline $x^2$\n\n$$\ny^2\n$$\n')
	assert.match(output, /class="katex"/v)
	assert.match(output, /katex-display/v)
	const expression = String.raw`\href{https://example.org}{x}`
	assert.match(
		katex.renderToString(expression, {trust: true}),
		/href="https:\/\/example.org"/v,
	)
	try {
		// eslint-disable-next-line unicorn/no-nonstandard-builtin-properties, no-use-extend-native/no-use-extend-native, no-extend-native -- Deliberately reproduce the upstream polluted-prototype vulnerability.
		Object.prototype.trust = true
		assert.doesNotMatch(katex.renderToString(expression), /href=/v)
		assert.doesNotMatch(render(`$${expression}$`), /href=/v)
	} finally {
		// eslint-disable-next-line unicorn/no-nonstandard-builtin-properties, no-use-extend-native/no-use-extend-native -- Restore the prototype after the security fixture.
		delete Object.prototype.trust
	}
})
