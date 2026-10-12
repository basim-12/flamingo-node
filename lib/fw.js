const process = require('process')
const flamingo = require('./flamingo')

const usage = `Usage: fw up [options]

Options:
  --run <file.json>  Start node and run a network scenario
  --attach           Start node and stream logs to terminal
  --shutdown         Cleanly stop the nodes and remove the container

Note: fw up auto-creates env.json if missing and installs Docker if needed.
      All node interactions (getinfo, funds, etc.) are available via WebSocket API.`

// Read the command line and call the api in flamingo.js; nothing else belongs here.
async function main () {
  const [cmd, ...args] = process.argv.slice(2)
  if (cmd !== 'up' || args.includes('--help') || args.includes('-h')) return console.log(usage)
  if (args.includes('--shutdown')) return flamingo.down()
  const run = args.indexOf('--run')
  return flamingo.up({ scenario: run === -1 ? null : args[run + 1], attach: args.includes('--attach') })
}

main().catch(err => {
  console.error('❌ ' + err.message)
  process.exit(1)
})
