const process = require('bare-process')
const packs = require('./packs')
const tasks = require('./tasks')

module.exports = runtime
runtime.foreground = foreground

// Everything the command line can do, as functions over packs and tasks, in this process.
// The daemon runs on top of this (daemon.js) and serves the same api to commands, which is
// how `cli` and `fw` reach it; starting a task in the background is therefore its job, not
// something this does.
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
    bot: {
      list: bots.list,
      info: bots.info,
      busy: name => bots.busy(bot_of(name)),
      create: bots.create,
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

// Hold a running task in this terminal until it finishes. Ctrl+C sends SIGINT and
// `--end` sends SIGTERM; either one stops it.
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
