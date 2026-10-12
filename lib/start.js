const flamingo = require('./flamingo')

// The container entrypoint. Docker runs this after mounting the package into /app, and it
// stays alive so it remains the container's main process while the services run in the
// background. Node only: bitcoind, lightningd and the WebSocket daemon need it.
async function main () {
  flamingo.load_env() // before the service modules read their settings

  const bitcoind = require('bitcoind')
  const lightningd = require('lightningd')
  const websocketd = require('websocketd')

  console.log('=== Starting all services ===')
  await bitcoind.start()
  await lightningd.start()
  await websocketd.start()
  console.log('✅ All services started.')

  setInterval(() => {}, 60 * 60 * 1000)
}

// Exit cleanly when Docker stops the container. Stopping the nodes themselves is
// `fw up --shutdown`, not a signal.
process.on('SIGINT', () => process.exit(0))
process.on('SIGTERM', () => process.exit(0))

main().catch(err => {
  console.error('❌ ' + err.message)
  process.exit(1)
})
