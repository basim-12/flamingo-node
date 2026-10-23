const fs = require('bare-fs')
const path = require('bare-path')
const process = require('bare-process')
const { createServer } = require('bare-pipe')
const runtime = require('./runtime')
const { open, send, receive } = require('./socket')

// One daemon per storage root. It owns the drive storage and runs the bots, so a command
// never takes the lock for itself and a running bot's log is still readable. The first
// command that needs it starts it (see remote.js), and it exits once nothing is left to
// do: no command connected and no bot running.
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
    // bare-pipe reports the far end going away as `end`, and leaves our half open.
    socket.on('end', () => {
      socket.end()
      clients.delete(socket)
      for (const [name, run] of running) if (run.socket === socket) run.stop()
      finished()
    })
    receive(socket, message => serve(socket, message))
  })

  server.listen(socket_path)
  fs.writeFileSync(pidfile, JSON.stringify({ pid: process.pid }) + '\n', { mode: 0o600 })

  // Everything the api has, by name. `run` and `attach` are the exceptions: they start a
  // bot here and keep it, and attach also streams what it logs back to the command.
  async function serve (socket, { id, kind, action, args = [] }) {
    try {
      if (action === 'run' || action === 'attach') return await start(socket, id, action === 'attach' && socket, args[0])
      send(socket, { id, result: await ds[kind][action](...args) })
    } catch (err) {
      send(socket, { id, error: err.message })
    }
  }

  // `attached` is the command's socket when it wants the output, false when it only asked
  // for the bot to be started. Either way the bot runs here, in this process.
  async function start (socket, id, attached, name) {
    const run = await ds.bot.attach(name, line => attached && send(attached, { id, line }))
    running.set(name, { stop: run.stop, socket: attached })
    run.done.then(
      result => reply({ id, result }),
      err => reply({ id, error: err.message })
    )
    if (!attached) send(socket, { id, result: ds.bot.info(name) })

    function reply (message) {
      running.delete(name)
      if (attached) send(attached, message)
      finished()
    }
  }

  async function finished () {
    if (clients.size || running.size) return
    server.close()
    fs.rmSync(pidfile, { force: true })
    await ds.close()
  }
}
