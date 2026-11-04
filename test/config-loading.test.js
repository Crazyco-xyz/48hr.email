const process = require('node:process')

const test = process.getBuiltinModule('node:test')
const assert = process.getBuiltinModule('node:assert/strict')
const fs = process.getBuiltinModule('node:fs')
const os = process.getBuiltinModule('node:os')
const path = process.getBuiltinModule('node:path')
const {spawnSync} = process.getBuiltinModule('node:child_process')

const configPath = path.resolve(__dirname, '../application/config-service.js')
const dotenvPath = require.resolve('dotenv')
const marker = 'CONFIG_RESULT:'
const fixture = [
	'UX_DEBUG_MODE=true',
	'EMAIL_DOMAINS=\'["fixture.example", "second.example"]\'',
	'HTTP_PORT=18001',
	'HTTP_API_ENABLED=true',
	'HTTP_TRUST_PROXY=\'["127.0.0.1/8", "::1"]\'',
	'HTTP_SESSION_SECRET="fixture=value#suffix"',
	String.raw`IMAP_PASSWORD="first\nsecond"`,
	'HTTP_BRANDING="Fixture mail" # inline comment',
].join('\n')

function load({files = {'.env': fixture}, env = {}, options} = {}) {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), '48hr-config-'))
	try {
		for (const [name, content] of Object.entries(files)) {
			fs.writeFileSync(path.join(directory, name), content)
		}

		// Child environments contain synthetic settings and essential OS paths only.
		const isolatedEnvironment = {}
		for (const name of ['SystemRoot', 'SYSTEMROOT', 'WINDIR']) {
			if (process.env[name] !== undefined) {
				isolatedEnvironment[name] = process.env[name]
			}
		}

		Object.assign(isolatedEnvironment, env)
		const setup =
			options === undefined
				? ''
				: `
			const dotenv = require(${JSON.stringify(dotenvPath)})
			const outcome = dotenv.config(${JSON.stringify(options)})
			if (outcome.error) throw outcome.error
		`
		const script = `${setup}
			const config = require(${JSON.stringify(configPath)})
			console.log(${JSON.stringify(marker)} + JSON.stringify({
				domains: config.email.domains,
				port: config.http.port,
				api: config.apiEnabled,
				proxies: config.http.trustedProxies,
				secret: config.http.sessionSecret,
				password: config.imap.password,
				branding: config.http.features.branding
			}))
		`
		const result = spawnSync(process.execPath, ['-e', script], {
			cwd: directory,
			env: isolatedEnvironment,
			encoding: 'utf8',
			timeout: 5000,
			maxBuffer: 64 * 1024,
			windowsHide: true,
		})
		assert.ifError(result.error)
		const lines = result.stdout.split(/\r?\n/v)
		const value = lines.find((line) => line.startsWith(marker))
		return {
			status: result.status,
			stdout: lines
				.filter((line) => !line.startsWith(marker))
				.join('\n')
				.trim(),
			stderr: result.stderr.trim(),
			config: value ? JSON.parse(value.slice(marker.length)) : undefined,
		}
	} finally {
		fs.rmSync(directory, {recursive: true, force: true})
	}
}

test('application configuration loads quoted and structured dotenv values quietly', () => {
	const result = load()
	assert.equal(result.status, 0, result.stderr)
	assert.deepEqual(result.config, {
		domains: ['fixture.example', 'second.example'],
		port: 18_001,
		api: true,
		proxies: ['127.0.0.1/8', '::1'],
		secret: 'fixture=value#suffix',
		password: 'first\nsecond',
		branding: 'Fixture mail',
	})
	assert.equal(result.stdout, '')
	assert.equal(result.stderr, '')
})

test('existing process settings win by default and missing dotenv files allow environment-only setup', () => {
	const existing = load({
		env: {HTTP_PORT: '18002', HTTP_API_ENABLED: 'false'},
	})
	assert.equal(existing.status, 0, existing.stderr)
	assert.equal(existing.config.port, 18_002)
	assert.equal(existing.config.api, false)
	const absent = load({
		files: {},
		env: {
			UX_DEBUG_MODE: 'true',
			EMAIL_DOMAINS: '["environment.example"]',
			HTTP_PORT: '18003',
		},
	})
	assert.equal(absent.status, 0, absent.stderr)
	assert.deepEqual(absent.config.domains, ['environment.example'])
	assert.equal(absent.config.port, 18_003)
	assert.equal(absent.stdout, '')
	assert.equal(absent.stderr, '')
})

test('dotenv path defaults prefer current environment names over legacy names', () => {
	const files = {
		'.env': fixture,
		'legacy.env': fixture.replace('18001', '18004'),
		'current.env': fixture.replace('18001', '18005'),
	}
	const legacy = load({files, env: {DOTENV_CONFIG_PATH: 'legacy.env'}})
	assert.equal(legacy.status, 0, legacy.stderr)
	assert.equal(legacy.config.port, 18_004)
	const current = load({
		files,
		env: {DOTENV_CONFIG_PATH: 'legacy.env', DOTENV_PATH: 'current.env'},
	})
	assert.equal(current.status, 0, current.stderr)
	assert.equal(current.config.port, 18_005)
})

test('string override flags preserve or replace existing application settings as requested', () => {
	for (const flag of ['false', '0', 'no', 'off', '']) {
		const result = load({env: {HTTP_PORT: '18006', DOTENV_OVERRIDE: flag}})
		assert.equal(result.status, 0, result.stderr)
		assert.equal(result.config.port, 18_006, `override=${flag}`)
	}

	const result = load({env: {HTTP_PORT: '18006', DOTENV_OVERRIDE: 'true'}})
	assert.equal(result.status, 0, result.stderr)
	assert.equal(result.config.port, 18_001)
})

test('explicit quiet application startup suppresses dotenv messages despite environment quiet defaults', () => {
	const result = load({
		env: {DOTENV_QUIET: 'false', DOTENV_CONFIG_QUIET: 'false'},
	})
	assert.equal(result.status, 0, result.stderr)
	assert.equal(result.stdout, '')
	assert.equal(result.stderr, '')
})

test('classic and opt-in fast parsers preserve the same application configuration', () => {
	const classic = load({env: {DOTENV_FAST: 'false'}})
	const fast = load({env: {DOTENV_FAST: 'true'}})
	assert.equal(classic.status, 0, classic.stderr)
	assert.equal(fast.status, 0, fast.stderr)
	assert.deepEqual(fast.config, classic.config)
})

test('explicit config options override environment defaults before the actual application import', () => {
	const result = load({
		files: {
			'.env': fixture,
			'selected.env': fixture.replace('18001', '18007'),
		},
		env: {
			HTTP_PORT: '18008',
			DOTENV_PATH: 'missing.env',
			DOTENV_OVERRIDE: 'true',
			DOTENV_DEBUG: 'true',
		},
		options: {
			path: 'selected.env',
			override: false,
			debug: false,
			quiet: true,
		},
	})
	assert.equal(result.status, 0, result.stderr)
	assert.equal(result.config.port, 18_008)
	assert.deepEqual(result.config.domains, ['fixture.example', 'second.example'])
	// The application's second config() call still honors the synthetic debug setting.
	assert.match(result.stdout, /failed to load missing.env/v)
})

test('dotenv does not hide invalid application configuration', () => {
	const result = load({
		files: {
			'.env': fixture.replace('["127.0.0.1/8", "::1"]', '["invalid-proxy"]'),
		},
	})
	assert.notEqual(result.status, 0)
	assert.match(result.stderr, /HTTP_TRUST_PROXY must be a JSON array/v)
})
