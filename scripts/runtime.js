const path = require('bare-path')
const process = require('bare-process')
const { spawn: daemon } = require('bare-daemon')
const packs = require('./packs')
const tasks = require('./tasks')

module.exports = runtime
runtime.foreground = foreground

// Everything the command line can do, as functions over packs and tasks. A custom cli
// such as `fw` requires this and exposes its own opinionated subset, so both end up
// doing the same things to the same storage.
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
      run: background,
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

  // Start a bot as a daemon: the generic cli with --run --attach, in its own session so
  // it outlives this process and the terminal. The bot logs to its own hypercore, so
  // nothing is piped back here. Return once it is running; if it dies before that, read
  // what it logged, which the dead bot has now released.
  async function background (name) {
    if (bots.busy(bot_of(name))) throw new Error('This bot is already running')
    const { pid } = daemon(process.execPath, [path.join(__dirname, 'cli.js'), 'bot', name, '--run', '--attach'])
    while (!bots.busy(bots.get(name))) {
      if (!alive(pid)) throw new Error(await bots.read_log(name) || 'This bot exited without logging anything')
      await new Promise(resolve => setTimeout(resolve, 100))
    }
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

function alive (pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
