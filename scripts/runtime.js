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
      export_to: pkgs.export_to,
      remove: name => bots.remove(pkg_of(name))
    },
    cap: pkgs.caps,
    bot: {
      list: bots.list,
      info: bots.info,
      busy: name => bots.busy(bot_of(name)),
      create: bots.create,
      build: bots.build,
      attach: bots.start,
      end: bots.end,
      log: bots.read_log,
      remove: name => bots.remove(bot_of(name))
    }
  }

  function pkg_of (name) {
    const link = pkgs.get(name)
    if (!link) throw new Error(`Unknown package: ${name}`)
    return link
  }

  function bot_of (name) {
    const link = bots.get(name)
    if (!link) throw new Error(`Unknown bot: ${name}`)
    return link
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
