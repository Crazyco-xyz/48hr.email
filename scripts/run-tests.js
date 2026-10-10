// eslint-disable-next-line n/prefer-process-get-builtin-module -- Bootstrap the process reference used for getBuiltinModule.
const runtime = require('node:process')

const fs = runtime.getBuiltinModule('node:fs')
const path = runtime.getBuiltinModule('node:path')
const {spawnSync} = runtime.getBuiltinModule('node:child_process')

const directory = path.resolve(__dirname, '../test')
const files = fs
	.readdirSync(directory)
	.filter((name) => name.endsWith('.test.js'))
	.toSorted((left, right) => left.localeCompare(right))
	.map((name) => path.join(directory, name))

if (files.length === 0) {
	throw new Error('No application test files found')
}

const result = spawnSync(runtime.execPath, ['--test', ...files], {
	stdio: 'inherit',
	windowsHide: true,
})
if (result.error) {
	throw result.error
}

runtime.exitCode = result.status ?? 1
