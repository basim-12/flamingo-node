const fs = require('bare-fs')
const path = require('bare-path')
const process = require('bare-process')
const { createServer } = require('bare-pipe')
const runtime = require('./runtime')
const { describe } = require('./tasks')
const { open, send, receive } = require('./socket')

// DESIGN.md#the-daemon
main()

async function main () {
  const root = process.argv[2]
  const socket_path = path.join(root, 'ds.sock')
  const pidfile = path.join(root, 'ds.pid')

  // A daemon that crashed leaves its socket behind. Whichever one still answers wins.
  if (fs.existsSync(socket_path)) {
    const live = await open(socket_path).then(socket => socket.end(), () => false)
    if (live !== false) return
    fs.rmSync(socket_path, { force: true })
  }

  const ds = await runtime(root)
  const clients = new Set()
  const running = new Map()

  const server = createServer(socket => {
    clients.add(socket)
    socket.on('error', () => socket.destroy()) // a command killed mid write must not take the daemon with it
    // bare-pipe reports the far end going away as `end`, and leaves this end open
    socket.on('end', () => {
      socket.end()
      clients.delete(socket)
      // a command that goes away, Ctrl+C included, stops watching and leaves the bot running
      for (const watchers of running.values()) watchers.delete(socket)
      finished()
    })
    receive(socket, message => serve(socket, message))
  })

  server.listen(socket_path)
  fs.writeFileSync(pidfile, JSON.stringify({ pid: process.pid }) + '\n', { mode: 0o600 })

  async function serve (socket, { id, kind, action, args = [] }) {
    try {
      if (action === 'attach' && running.has(args[0])) return await watch(socket, id, args[0])
      if (action === 'run' || action === 'attach') return await run(socket, id, action === 'attach', args[0])
      send(socket, { id, result: await ds[kind][action](...args) })
    } catch (err) {
      send(socket, { id, error: err.message })
    }
  }

  async function run (socket, id, attach, name) {
    const watchers = new Map(attach ? [[socket, id]] : [])
    const active = await ds.bot.run(name, line => { for (const [watcher, at] of watchers) send(watcher, { id: at, line }) })
    running.set(name, watchers)
    active.done.then(
      result => reply({ result }),
      err => reply({ error: err.message })
    )
    if (!attach) send(socket, { id, result: await ds.bot.see(name) })

    function reply (message) {
      running.delete(name)
      for (const [watcher, at] of watchers) send(watcher, { id: at, ...message })
      finished()
    }
  }

  async function watch (socket, id, name) {
    running.get(name).set(socket, id)
    send(socket, { id, line: describe(await ds.bot.see(name)) })
  }

  async function finished () {
    if (clients.size || running.size) return
    server.close()
    fs.rmSync(pidfile, { force: true })
    await ds.close()
  }
}
