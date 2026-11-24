const process = require('bare-process')
const packs = require('./packs')
const tasks = require('./tasks')

module.exports = runtime
runtime.foreground = foreground

async function runtime (root) {
  const pkgs = await packs(root)
  const bots = await tasks(pkgs)

  return {
    root: pkgs.root,
    close: async () => { await bots.close(); await pkgs.close() },
    pkg: {
      list: pkgs.list,
      info: pkgs.info,
      create: pkgs.create,
      export: pkgs.export,
      drop: drop_pkg
    },
    cap: pkgs.caps,
    bot: {
      list: bots.list,
      see: bots.see,
      create: bots.create,
      build: bots.build,
      run: bots.run,
      end: bots.end,
      log: bots.log,
      drop: bots.drop
    }
  }

  // a package that is a bot's drive goes with its bot, so the bot is not left without one
  async function drop_pkg (name) {
    const link = pkgs.get(name)
    if (!link) throw new Error(`Unknown package: ${name}`)
    const { id } = packs.reference(link)
    for (const bot of bots.list()) if (packs.reference((await bots.see(bot)).drive).id === id) return bots.drop(bot)
    await pkgs.drop(name)
  }
}

async function foreground ({ done, stop }) {
  process.on('SIGINT', () => stop())
  process.on('SIGTERM', () => stop())
  const keep_alive = setInterval(() => {}, 1 << 30)
  try {
    return await done
  } finally {
    clearInterval(keep_alive)
  }
}
