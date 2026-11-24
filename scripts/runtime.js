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
      see: bots.see,
      create: bots.create,
      build: bots.build,
      run: bots.run,
      end: bots.end,
      log: bots.log,
      remove: async name => bots.remove((await bots.see(name)).drive)
    }
  }

  function pkg_of (name) {
    const link = pkgs.get(name)
    if (!link) throw new Error(`Unknown package: ${name}`)
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
