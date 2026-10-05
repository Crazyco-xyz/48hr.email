import eslintConfigXo from 'eslint-config-xo'
import globals from 'globals'

export default [
	{ ignores: ['.jolli/**'] },
	...eslintConfigXo({
		semicolon: false,
		prettier: true,
		gitignore: import.meta.url,
	}),
	{
		files: ['**/*.js'],
		languageOptions: { sourceType: 'commonjs' },
		rules: {
			'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
			'unicorn/prefer-module': 'off',
		},
	},
	{
		files: [
			'infrastructure/web/public/javascripts/*.js',
			'public/javascripts/*.js',
		],
		languageOptions: {
			sourceType: 'script',
			globals: { ...globals.browser, io: 'readonly' },
		},
	},
]
