const fs = require('bare-fs')
const fsp = require('bare-fs/promises')
const path = require('bare-path')
const process = require('bare-process')
const { reference, drive_link } = require('../packs')
const { read_json, write_json } = require('../json')
const { run: sandbox, lazy } = require('../sandbox/run')

module.exports = tasks
tasks.describe = describe

async function tasks (pkgs) {
  const run_dir = path.join(pkgs.root, 'run')
  const running = new Map()
  let saving = Promise.resolve()
  const api = { close, list, see, create, build, run, end, log, drop }

  const registry = Object.assign(Object.create(null), await read_json(path.join(pkgs.root, 'bots.json')))
  return api

  async function close () {
    await saving
  }

  function save () {
    saving = saving.then(() => write_json(path.join(pkgs.root, 'bots.json'), registry))
    return saving
  }

  function list () {
    return Object.keys(registry).sort()
  }

  async function see (name) {
    const link = registry[name]
    if (!link) throw new Error(`Unknown bot: ${name}`)
    const out = await output_drive(name)
    const core = await pkgs.core('log', name)
    await core.ready()
    try {
      return { name, drive: link, package: pkgs.find(link) || null, output: await drive_link(out), logged: core.length, running: busy(link) }
    } finally {
      await core.close()
      await out.close()
    }
  }

  function output_drive (name) {
    return pkgs.disk('build', name)
  }

  // running here, or a live process claims it in its pidfile
  function runner (name) {
    if (running.has(name)) return { pid: process.pid }
    try {
      const { pid } = JSON.parse(fs.readFileSync(path.join(run_dir, name + '.pid'), 'utf8'))
      if (alive(pid)) return { pid }
    } catch { }
    return null
  }

  function busy (link) {
    const { id } = reference(link)
    return list().some(name => reference(registry[name]).id === id && runner(name))
  }

  async function create (name, spec) {
    if (registry[name]) throw new Error(`Bot already exists: ${name}`)
    const from = await pkgs.source(spec)
    let link
    if (from.local) {
      // a folder or a local generator brings its own bot.json, because there is no code drive
      // here for the cli to point one at
      link = await pkgs.create(name, spec, { namespace: 'bot', prepare: config })
    } else if (from.file) {
      link = await pkgs.create(name, spec, { namespace: 'bot', prepare: write_bot_json })
    } else {
      const opened = await pkgs.open_drive(from.link, false)
      try {
        await config(opened.drive)
        link = await drive_link(opened.drive)
      } finally { await opened.close() }
      const { id } = reference(link)
      const clash = list().find(other => reference(registry[other]).id === id)
      if (clash) throw new Error(`That drive is already the drive of bot: ${clash}`)
    }
    registry[name] = link
    await save()
    return link
  }

  async function build (name) {
    if (!registry[name]) throw new Error(`Unknown bot: ${name}`)
    if (busy(registry[name])) throw new Error('This bot is running')
    const opened = await pkgs.open_drive(registry[name], false)
    try {
      const built = await opened.drive.get('/build.json')
      if (built) return `Already built: ${JSON.parse(built).drive}`

      const code = await pkgs.open_drive(await config(opened.drive))
      try {
        if (!await code.view.entry('/setup.js')) return 'Nothing to build'
        const out = await output_drive(name)
        const said = (printed, line) => printed ? `${printed}\n${line}` : line
        try {
          const setup = await sandbox({
            drive: code.view,
            output: out,
            // `msb wait` loses the exit code, so the marker says whether setup.js passed
            command: ['sh', '-c', 'node /app/setup.js && touch /out/.built'],
            audit: await pkgs.core('audit', name)
          })
          const printed = await setup.done
          if (!await out.entry('/.built')) throw new Error(said(printed, 'setup.js failed, so nothing was built'))
          await out.del('/.built')
          const link = await drive_link(out)
          await opened.drive.put('/build.json', Buffer.from(JSON.stringify({ drive: link }, null, 2) + '\n'))
          return said(printed, `Built: ${link}`)
        } finally { await out.close() }
      } finally { await code.close() }
    } finally { await opened.close() }
  }

  async function run (name, print) {
    if (!registry[name]) throw new Error(`Unknown bot: ${name}`)
    if (busy(registry[name])) throw new Error('This bot is already running')
    const opened = await pkgs.open_drive(registry[name], false)
    let loaded
    // index.js reaches the handle through require('sandbox'), so it is made first
    let box
    try {
      const link = await config(opened.drive)
      box = lazy({ drive: opened.drive, audit: await pkgs.core('audit', name) })
      loaded = await pkgs.load({ link, ...reference(link) }, box.handle)
    } catch (err) {
      if (box) await box.stop()
      await opened.close()
      throw err
    }

    const core = await pkgs.core('log', name)
    await core.ready()
    let appends = Promise.resolve()
    const append = line => { appends = appends.then(() => core.append(line)); return appends }
    // one block per line, so the log's length counts lines. A zero length block cannot be read
    // back under Bare (random-access-file 4.1.2 calls process.nextTick, and Bare has no global
    // process), so blank lines are not stored
    const record = text => {
      for (const line of String(text).split('\n')) if (line) append(line)
      print(text)
    }

    let stop
    const exit = new Promise(resolve => { stop = resolve })
    const listeners = []
    const on = (event, listener) => {
      if (event !== 'exit') throw new Error(`A bot has one event, exit, not ${event}`)
      if (listener) listeners.push(listener)
      return exit
    }
    const active = { stop, done: null }
    running.set(name, active)

    let updates = Promise.resolve()
    const updated = () => { updates = updates.then(() => refresh(opened.drive)) }
    opened.drive.core.on('append', updated)

    const pidfile = path.join(run_dir, name + '.pid')
    await fsp.mkdir(run_dir, { recursive: true, mode: 0o700 })
    await fsp.writeFile(pidfile, JSON.stringify({ pid: process.pid, started: Date.now() }) + '\n', { mode: 0o600 })
    print(describe(await see(name)))

    active.done = (async () => {
      try {
        await loaded.fn(opened.drive, { on, log: record })
        // index.js returned, but a bot that set exit listeners keeps running until it is stopped
        if (listeners.length) {
          await exit
          for (const listener of listeners) await listener()
        }
      } catch (err) {
        append('Error: ' + err.message)
        throw err
      } finally {
        opened.drive.core.off('append', updated)
        try {
          await updates
          await refresh(opened.drive)
        } finally {
          await box.stop()
          await appends
          await core.close()
          await fsp.rm(pidfile, { force: true })
          await opened.close()
          running.delete(name)
        }
      }
      return await see(name)
    })()
    return { done: active.done, stop }
  }

  async function end (name) {
    if (!registry[name]) throw new Error(`Unknown bot: ${name}`)
    const local = running.get(name)
    if (local) {
      local.stop()
      await local.done
      return
    }
    const found = runner(name)
    if (!found) return
    try { process.kill(found.pid, 'SIGTERM') } catch (err) { if (err.code !== 'ESRCH') throw err }
    for (let i = 0; i < 600 && runner(name); i++) await new Promise(resolve => setTimeout(resolve, 50))
    if (runner(name)) throw new Error('The running bot did not stop in time')
  }

  async function log (name, count) {
    if (!registry[name]) throw new Error(`Unknown bot: ${name}`)
    const core = await pkgs.core('log', name)
    await core.ready()
    try {
      const lines = []
      // count arrives as null over the daemon's socket when it was not given
      for (let i = count ? Math.max(0, core.length - count) : 0; i < core.length; i++) lines.push((await core.get(i)).toString())
      return lines.join('\n')
    } finally { await core.close() }
  }

  async function drop (name) {
    const link = registry[name]
    if (!link) throw new Error(`Unknown bot: ${name}`)
    if (busy(link)) throw new Error('Cannot delete a running bot or its package')
    const pack = pkgs.find(link)
    if (pack) await pkgs.drop(pack)
    // named after the bot, so a later bot with the same name would inherit them
    for (const kind of ['log', 'audit']) await (await pkgs.core(kind, name)).purge()
    delete registry[name]
    await save()
  }

  async function refresh (drive) {
    const link = await pkgs.update(drive)
    for (const name of list()) if (reference(registry[name]).id === drive.id) registry[name] = link
    await save()
  }
}

// the lines `cli bot <name>` prints, from what see() returns
function describe ({ name, drive, package: pack, output, logged, running }) {
  return `Name: ${name}\nDrive: ${drive}\nPackage: ${pack || '(unnamed)'}\nOutput: ${output}\nLog: ${logged} ${logged === 1 ? 'line' : 'lines'}\nStatus: ${running ? 'running' : 'stopped'}`
}

function write_bot_json (drive, code) {
  return drive.put('/bot.json', Buffer.from(JSON.stringify({ run: code + '/index.js' }, null, 2)))
}

async function config (drive) {
  const data = await drive.get('/bot.json')
  if (!data) throw new Error("A bot's drive must contain bot.json, which says what to run")
  const { run } = JSON.parse(data)
  if (typeof run !== 'string' || !reference(run).file) throw new Error('bot.json.run must be a pinned drive URL with a filepath')
  return run
}

function alive (pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
