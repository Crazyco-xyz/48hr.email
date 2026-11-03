const process = require('node:process')

const assert = process.getBuiltinModule('node:assert/strict')
const {Buffer} = process.getBuiltinModule('node:buffer')
const crypto = process.getBuiltinModule('node:crypto')
const fs = process.getBuiltinModule('node:fs')
const path = process.getBuiltinModule('node:path')

// Import-x 4.17.1 still imports minimatch.makeRe, removed in minimatch 11.
// Its rule only tests normalized import paths. Keep the legacy trailing-**
// zero-component match explicitly: makeRe('pkg/**').test('pkg') was true,
// whereas minimatch 11's match('pkg') is false. This matters for deny rules.
// Requalify these exact upstream files when upgrading import-x; never patch
// unknown dependency bytes or change package versions to bypass an audit.
const matcherHelper = String.raw`
function createInternalModuleMatcher(Minimatch, pattern) {
    const matcher = new Minimatch(pattern);
    const prefixes = matcher.globSet
        .filter(value => /(?:\/\*\*)+$/.test(value))
        .map(value => new Minimatch(value.replace(/(?:\/\*\*)+$/, ''), {
            nonegate: true, nocomment: true,
        }));
    return {
        match(input) {
            if (matcher.empty || matcher.comment || (!input && matcher.negate)) return false;
            if (prefixes.some(prefix => prefix.match(input))) return !matcher.negate;
            return matcher.match(input);
        },
    };
}
`.replaceAll('\r\n', '\n')

const patches = [
	{
		path: 'lib/rules/no-internal-modules.js',
		original:
			'e8e65c1449e1ade45229001595b08f33fc879c4673e0c9be9013dd1df87acd21',
		patched: 'a154e5cdfcdf3fc06f6d4788d80ab99d1e118685899607ba61e4ee9636d5b17f',
		replacements: [
			[
				"import { makeRe } from 'minimatch';",
				"import { Minimatch } from 'minimatch';",
				1,
			],
			['makeRe(p)', 'createInternalModuleMatcher(Minimatch, p)', 2],
			['re.test(importPath)', 're.match(importPath)', 2],
		],
	},
	{
		path: 'lib/index.cjs',
		original:
			'0d09a1c49ba7f3ec5030e246f81075ee5630cf216429e1db1ea7829bf4c52357',
		patched: 'c6081457db8ba07948614436ef2e69c4004443f087dfceeebc612abb3d56f060',
		replacements: [
			[
				'(0, minimatch.makeRe)(p)',
				'createInternalModuleMatcher(minimatch.Minimatch, p)',
				2,
			],
			['re.test(importPath)', 're.match(importPath)', 2],
		],
	},
]

function digest(bytes) {
	return crypto.createHash('sha256').update(bytes).digest('hex')
}

function planPatch(bytes, patch) {
	const current = digest(bytes)
	if (current === patch.patched) {
		return {status: 'already-compatible', bytes}
	}

	assert.equal(current, patch.original, `Unknown import-x bytes: ${patch.path}`)
	let source = bytes.toString('utf8')
	for (const [before, after, count] of patch.replacements) {
		assert.equal(source.split(before).length - 1, count, patch.path)
		source = source.replaceAll(before, () => after)
	}

	const result = Buffer.from(source + matcherHelper)
	assert.equal(
		digest(result),
		patch.patched,
		`Unexpected patch result: ${patch.path}`,
	)
	return {status: 'applied', bytes: result}
}

function checkVersion(version) {
	assert.equal(
		version,
		'4.17.1',
		'Requalify the import-x compatibility patch for this version',
	)
}

function assertPlainPath(filename, root) {
	const relative = path.relative(root, filename)
	assert.ok(
		relative !== '..' &&
			!relative.startsWith(`..${path.sep}`) &&
			!path.isAbsolute(relative),
	)
	let current = root
	assert.equal(
		fs.lstatSync(current).isSymbolicLink(),
		false,
		`Linked dependency path: ${current}`,
	)
	for (const part of relative.split(path.sep)) {
		if (!part) {
			continue
		}

		current = path.join(current, part)
		assert.equal(
			fs.lstatSync(current).isSymbolicLink(),
			false,
			`Linked dependency path: ${current}`,
		)
	}
}

function prepareLint() {
	const packageFile = require.resolve('eslint-plugin-import-x/package.json')
	const root = path.dirname(packageFile)
	const dependencyRoot = path.resolve(__dirname, '../node_modules')
	assertPlainPath(packageFile, dependencyRoot)
	checkVersion(JSON.parse(fs.readFileSync(packageFile, 'utf8')).version)
	// Validate every target before the first write. Unknown or partially written
	// bytes fail closed; reinstall locked dependencies to restore the known input.
	const plans = patches.map((patch) => {
		const filename = path.join(root, patch.path)
		assertPlainPath(filename, dependencyRoot)
		return {filename, patch, ...planPatch(fs.readFileSync(filename), patch)}
	})
	for (const plan of plans) {
		if (plan.status === 'applied') {
			fs.writeFileSync(plan.filename, plan.bytes)
		}
	}

	return plans.map(({patch, status}) => ({path: patch.path, status}))
}

module.exports = {
	prepareLint,
	planPatch,
	checkVersion,
	assertPlainPath,
	patches,
}

if (require.main === module) {
	console.log(JSON.stringify({importXCompatibility: prepareLint()}))
}
