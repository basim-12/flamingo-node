const path = require('path')
const process = require('process')
const flamingo = require('./flamingo')
const runtime = require('../scripts/runtime')

// fw owns one code package and one bot: the node it runs. Both are ordinary datashell
// things, so `cli pkg` and `cli bot` see them too.
const PKG = 'flamingo-node'
const BOT = 'flamingo'
const app = path.resolve(__dirname, '..')

const usage = `Usage: fw up [options]

Options:
  --run <file.json>  Start node and run a network scenario
  --attach           Start node and stream logs to terminal
  --shutdown         Cleanly stop the node

Note: fw up runs the node as a datashell bot, so \`cli bot ${BOT}\` sees it too.
      All node interactions (getinfo, funds, etc.) are available via WebSocket API.`

async function main () {
  const [cmd, ...args] = process.argv.slice(2)
  if (cmd !== 'up' || args.includes('--help') || args.includes('-h')) return console.log(usage)

  // The bot's entry asks for the node itself with --node, which skips the bot layer it is
  // already running inside.
  if (args.includes('--node')) return args.includes('--shutdown') ? flamingo.down() : flamingo.up()

  // A scenario has to wait for lightning to answer, which the direct path already does.
  const scenario = args.indexOf('--run')
  if (scenario !== -1) return flamingo.up({ scenario: args[scenario + 1] })

  const ds = await runtime()
  try {
    if (args.includes('--shutdown')) {
      if (!ds.bot.list().includes(BOT)) return console.log('Flamingo is not running.')
      await ds.bot.end(BOT)
      return console.log('🛑 Flamingo stopped.')
    }
    await ensure(ds)
  } finally {
    // Making the package and bot takes the drive storage lock, and a bot started in the
    // background needs that lock for itself, so let go of it before starting one.
    await ds.close()
  }

  const node = await runtime()
  try {
    if (node.bot.busy(BOT)) return console.log('🟢 Flamingo is already running.')
    if (args.includes('--attach')) return await runtime.foreground(await node.bot.attach(BOT, line => console.log(line)))
    await node.bot.run(BOT)
    console.log('🦩 Flamingo is starting in the background.')
    console.log('   Stop it with: fw up --shutdown')
  } finally {
    await node.close()
  }
}

// The code package is built from lib/build.js, and the bot's own drive is generated from
// it, which is where its wallet lives. Both are pinned once made, so they are created the
// first time and kept.
async function ensure (ds) {
  if (!ds.pkg.list().includes(PKG)) await ds.pkg.create(PKG, './lib/build.js', app)
  if (!ds.bot.list().includes(BOT)) await ds.bot.create(BOT, `${PKG}/generate?ask=no`, app)
}

main().catch(err => {
  console.error('❌ ' + err.message)
  process.exit(1)
})
