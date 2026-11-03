/* eslint-disable import-x/order -- Bootstrap process before resolving builtin modules. */
const process = require('node:process')

const assert = process.getBuiltinModule('node:assert/strict')
const {Buffer} = process.getBuiltinModule('node:buffer')
const fs = process.getBuiltinModule('node:fs')
const os = process.getBuiltinModule('node:os')
const path = process.getBuiltinModule('node:path')
const test = process.getBuiltinModule('node:test')
const {execFileSync} = process.getBuiltinModule('node:child_process')
const {
	prepareLint,
	planPatch,
	checkVersion,
	assertPlainPath,
	patches,
} = require('../scripts/prepare-lint')

prepareLint()
const {ESLint} = require('eslint')

const root = path.resolve(__dirname, '..')
const packageRoot = path.dirname(
	require.resolve('eslint-plugin-import-x/package.json'),
)

test('lint preparation is idempotent and rejects unknown dependency versions or bytes', () => {
	const filenames = patches.map((patch) => path.join(packageRoot, patch.path))
	const before = filenames.map(
		(filename) => fs.statSync(filename, {bigint: true}).mtimeNs,
	)
	assert.ok(
		prepareLint().every((result) => result.status === 'already-compatible'),
	)
	assert.deepEqual(
		filenames.map((filename) => fs.statSync(filename, {bigint: true}).mtimeNs),
		before,
	)
	assert.throws(() => checkVersion('4.17.2'), /Requalify/v)
	for (const patch of patches) {
		const bytes = fs.readFileSync(path.join(packageRoot, patch.path))
		assert.equal(planPatch(bytes, patch).status, 'already-compatible')
		assert.throws(
			() => planPatch(Buffer.concat([bytes, Buffer.from('\n')]), patch),
			/Unknown import-x bytes/v,
		)
	}
})

test('lint preparation refuses paths outside its root and linked directory components', (t) => {
	const temporary = fs.mkdtempSync(path.join(os.tmpdir(), '48hr-lint-path-'))
	t.after(() => fs.rmSync(temporary, {recursive: true, force: true}))
	const directory = path.join(temporary, 'plain')
	fs.mkdirSync(directory)
	fs.writeFileSync(path.join(directory, 'fixture'), 'fixture')
	const linked = path.join(temporary, 'linked')
	fs.symlinkSync(
		directory,
		linked,
		process.platform === 'win32' ? 'junction' : 'dir',
	)
	assert.throws(() =>
		assertPlainPath(path.join(temporary, '../outside'), temporary),
	)
	assert.throws(
		() => assertPlainPath(path.join(linked, 'fixture'), temporary),
		/Linked dependency path/v,
	)
})

const ruleCases = [
	[
		'forbid package internals',
		{forbid: ['express/**']},
		'express/lib/application.js',
		true,
	],
	[
		'trailing globstar also forbids the bare package',
		{forbid: ['express/**']},
		'express',
		true,
	],
	[
		'single star does not forbid the bare package',
		{forbid: ['express/*']},
		'express',
		false,
	],
	[
		'repeated trailing globstars also forbid the bare package',
		{forbid: ['express/**/**']},
		'express',
		true,
	],
	[
		'negated trailing globstar excludes raw and prefixed bare paths',
		{forbid: ['!**/express/**']},
		'express',
		false,
	],
	[
		'unprefixed negation still forbids the prefixed bare path',
		{forbid: ['!express/**']},
		'express',
		true,
	],
	[
		'allow selected package internals',
		{allow: ['express/lib/router/**']},
		'express/lib/router/index.js',
		false,
	],
	[
		'reject other package internals',
		{allow: ['express/lib/router/**']},
		'express/lib/application.js',
		true,
	],
	[
		'forbid relative application modules',
		{forbid: ['application/**']},
		'./application/auth-service.js',
		true,
	],
	[
		'allow relative application modules',
		{allow: ['application/**']},
		'./application/auth-service.js',
		false,
	],
	[
		'reject relative modules outside allowlist',
		{allow: ['domain/**']},
		'./application/auth-service.js',
		true,
	],
	[
		'normalize parent portions before checking relative modules',
		{forbid: ['domain/**']},
		'./application/../domain/user-repository.js',
		true,
	],
	[
		'negated pattern allows its excluded directory',
		{forbid: ['!**/express/lib/router/**']},
		'express/lib/router/index.js',
		false,
	],
	[
		'negated pattern forbids other directories',
		{forbid: ['!**/express/lib/router/**']},
		'express/lib/application.js',
		true,
	],
	[
		'brace patterns keep selected modules',
		{allow: ['express/lib/{application,request}.js']},
		'express/lib/application.js',
		false,
	],
	[
		'brace patterns still reject other modules',
		{allow: ['express/lib/{application,request}.js']},
		'express/lib/response.js',
		true,
	],
	[
		'brace trailing globstars forbid the bare package',
		{forbid: ['{express/**,qs/**}']},
		'express',
		true,
	],
]

for (const entry of ['CommonJS', 'ESM']) {
	test(`the actual ${entry} import-x rule preserves allow, forbid and matching behavior`, async () => {
		const imported =
			entry === 'CommonJS' ? undefined : await import('eslint-plugin-import-x')
		const plugin =
			entry === 'CommonJS'
				? require('eslint-plugin-import-x')
				: imported.default
		await Promise.all(
			ruleCases.map(async ([name, options, source, denied]) => {
				const engine = new ESLint({
					cwd: root,
					overrideConfigFile: true,
					overrideConfig: [
						{
							plugins: {'import-x': plugin},
							languageOptions: {sourceType: 'module'},
							rules: {'import-x/no-internal-modules': ['error', options]},
						},
					],
				})
				const [result] = await engine.lintText(
					`import value from '${source}';\n`,
					{filePath: path.join(root, 'rule-fixture.js')},
				)
				assert.equal(result.fatalErrorCount, 0, name)
				assert.deepEqual(
					result.messages.map((message) => message.ruleId),
					denied ? ['import-x/no-internal-modules'] : [],
					name,
				)
			}),
		)
	})
}

test('the real XO configuration loads and traverses application and template-filter files', async () => {
	const engine = new ESLint({cwd: root})
	const files = [
		'application/config-service.js',
		'infrastructure/web/views/twig-filters.js',
	]
	const results = await engine.lintFiles(files)
	assert.equal(results.length, files.length)
	assert.ok(results.every((result) => result.fatalErrorCount === 0))
	const config = await engine.calculateConfigForFile(path.join(root, files[0]))
	assert.equal(config.rules['import-x/no-extraneous-dependencies'][0], 2)
	assert.equal(config.rules['no-eval'][0], 2)
})

test('the patched matcher bounds adversarial globstar-parent preprocessing', () => {
	const source = `
		const { Minimatch } = require('minimatch')
		const matcher = new Minimatch('**/../'.repeat(18) + 'fixture', {
			optimizationLevel: 2, braceExpandMax: 128,
		})
		matcher.match('fixture')
		process.stdout.write('completed')
	`
	assert.equal(
		execFileSync(process.execPath, ['--max-old-space-size=64', '-e', source], {
			cwd: root,
			encoding: 'utf8',
			timeout: 5000,
			maxBuffer: 4096,
			windowsHide: true,
		}),
		'completed',
	)
})
