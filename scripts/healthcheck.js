// Require the JSON readiness response: startup can temporarily return HTML with HTTP 200.
const config = require('../application/config-service')

async function main() {
	const response = await fetch(
		`http://127.0.0.1:${config.http.port}/api/v1/health`,
		{
			signal: AbortSignal.timeout(3000),
			redirect: 'error',
		},
	)
	if (!response.ok) throw new Error('Health endpoint is unavailable')
	const body = await response.json()
	if (body.success !== true || body.data?.status !== 'ok') {
		throw new Error('Application is not ready')
	}
}

if (require.main === module) {
	main().catch(() => {
		process.exitCode = 1
	})
}

module.exports = main
