const fsp = require('bare-fs/promises')
const path = require('bare-path')
const process = require('bare-process')
const { spawn: daemon } = require('bare-daemon')
const packs = require('./packs')
const { open, send, receive } = require('./socket')

module.exports = remote

// The same api as runtime.js, but over the daemon that owns the storage (daemon.js), so
// commands no longer take the drive storage lock for themselves and a running bot's log
// can be read. The daemon is started here if it is not up yet.
async function remote (root = packs.ROOT) {
  await fsp.mkdir(root, { recursive: true, mode: 0o700 })
  const socket = await connect(root)
  const waiting = new Map()
  let next = 0

  receive(socket, message => {
    const pending = waiting.get(message.id)
    if (message.line !== undefined) return pending.online(message.line)
    waiting.delete(message.id)
    if (message.error === undefined) pending.resolve(message.result)
    else pending.reject(new Error(message.error))
  })
  socket.on('end', () => {
    for (const pending of waiting.values()) pending.reject(new Error('The datashell daemon stopped'))
    waiting.clear()
  })

  function call (kind, action, args, online) {
    return new Promise((resolve, reject) => {
      const id = next++
      waiting.set(id, { resolve, reject, online })
      send(socket, { id, kind, action, args })
    })
  }

  // The same names runtime.js has, each one a call to the daemon.
  const namespace = (kind, actions) =>
    Object.fromEntries(actions.map(action => [action, (...args) => call(kind, action, args)]))

  return {
    root,
    close: () => socket.end(),
    pkg: namespace('pkg', ['list', 'info', 'create', 'export_to', 'remove']),
    bot: {
      ...namespace('bot', ['list', 'info', 'busy', 'create', 'run', 'end', 'log', 'remove']),
      // The bot runs in the daemon and prints here. Stopping is the same `end` any other
      // command would send, so this one still receives the bot's last lines and its result.
      attach: (name, print) => ({ done: call('bot', 'attach', [name], print), stop: () => call('bot', 'end', [name]) })
    }
  }
}

async function connect (root) {
  const socket_path = path.join(root, 'ds.sock')
  for (let attempt = 0; ; attempt++) {
    try {
      return await open(socket_path)
    } catch (err) {
      if (err.code !== 'ENOENT' && err.code !== 'ECONNREFUSED') throw err
      if (attempt === 0) daemon(process.execPath, [path.join(__dirname, 'daemon.js'), root])
      if (attempt === 100) throw new Error('The datashell daemon did not start')
      await new Promise(resolve => setTimeout(resolve, 50))
    }
  }
}
