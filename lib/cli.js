#!/usr/bin/env node
const flamingo = require('./flamingo')

const usage = `Usage: fw up [options]

Options:
  --run <file.json>  Start node and run a network scenario
  --attach           Start node and stream logs to terminal
  --shutdown         Cleanly stop the nodes and remove the container

Note: fw up auto-creates env.json if missing and installs Docker if needed.
      All node interactions (getinfo, funds, etc.) are available via WebSocket API.`

// Read the command line and call the api in flamingo.js; nothing else belongs here.
async function main() {
  const [cmd, ...args] = process.argv.slice(2)
  if (cmd === 'start') return start()
  if (cmd !== 'up' || args.includes('--help') || args.includes('-h')) return console.log(usage)
  if (args.includes('--shutdown')) return flamingo.down()
  const run = args.indexOf('--run')
  return flamingo.up({ scenario: run === -1 ? null : args[run + 1], attach: args.includes('--attach') })
}

// Internal container entrypoint. The Docker image invokes this command after mounting
// the local flamingo-node package into /app. Keep the process alive so it remains PID 1
// while the service modules run in the background.
async function start() {
  flamingo.load_env()
  const bitcoind = require('bitcoind')
  const lightningd = require('lightningd')
  const websocketd = require('websocketd')

  console.log('=== Starting all services ===')
  await bitcoind.start()
  await lightningd.start()
  await websocketd.start()
  console.log('✅ All services started.')

  setInterval(() => { }, 60 * 60 * 1000)
}

// Exit cleanly when Docker or the terminal stops us. Stopping the node itself is
// `fw up --shutdown`.
process.on('SIGINT', () => process.exit(0))
process.on('SIGTERM', () => process.exit(0))

main().catch(err => {
  console.error('❌ ' + err.message)
  process.exit(1)
})
