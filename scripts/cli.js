#!/usr/bin/env bare
const process = require('bare-process')
const { Packages, parse, usage } = require('./pkg')

// Inspection and stop never open the shared store, so they work while a bot runs.
const READONLY = new Set(['help', 'list', 'see', 'end'])

async function main () {
  const cmd = parse(process.argv.slice(2))
  if (cmd.action === 'help') return console.log(usage)
  const service = new Packages()

  // Ctrl+C sends SIGINT and `cli bot <name> --end` sends SIGTERM; both stop a running bot.
  let stopRequested = false
  let onstop = () => { stopRequested = true }
  process.on('SIGTERM', () => onstop())
  process.on('SIGINT', () => onstop())

  if (READONLY.has(cmd.action)) await service.registries()
  else await service.open()
  try {
    const result = await service.command(cmd, process.cwd(), line => console.log(line))
    if (result && result.done) {
      // A running bot: hold the foreground until it stops or a signal arrives.
      const keepAlive = setInterval(() => {}, 1 << 30)
      onstop = () => result.stop()
      if (stopRequested) result.stop()
      try {
        const final = await result.done
        if (final) console.log(final)
      } finally {
        onstop = () => {}
        clearInterval(keepAlive)
      }
    } else if (result) {
      console.log(result)
    }
  } finally {
    await service.close()
  }
}

main()
  .then(() => process.exit(process.exitCode || 0))
  .catch(error => { console.error(error.message); process.exit(1) })
