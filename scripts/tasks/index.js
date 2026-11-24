const fs = require('bare-fs')
const fsp = require('bare-fs/promises')
const path = require('bare-path')
const process = require('bare-process')
const crypto = require('bare-crypto')
const { reference, drive_link } = require('../packs')
const { run: sandbox, lazy } = require('../sandbox/run')

module.exports = tasks

async function tasks (pkgs) {
  const run_dir = path.join(pkgs.root, 'run')
  const running = new Map()
  let saving = Promise.resolve()
  const api = { close, list, get, info, busy, create, build, start, end, read_log, remove }

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

  function get (name) {
    return registry[name]
  }

  async function info (name) {
    const link = registry[name]
    if (!link) throw new Error(`Unknown bot: ${name}`)
    const out = await output_drive(name)
    try {
      return `Name: ${name}\nDrive: ${link}\nPackage: ${pkgs.find(link) || '(unnamed)'}\nOutput: ${await drive_link(out)}\nStatus: ${busy(link) ? 'running' : 'stopped'}`
    } finally { await out.close() }
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

  async function create (name, spec, cwd) {
    if (registry[name]) throw new Error(`Bot already exists: ${name}`)
    const from = await pkgs.source(spec, cwd)
    if (from.local) throw new Error('A bot needs a drive, not a local path: pass a package name, drive id or dat:// reference')
    let link
    if (from.file) {
      link = await pkgs.create(name, spec, cwd, { namespace: 'bot', prepare: write_bot_json })
    } else {
      const opened = await pkgs.open_drive(from.link, false)
      try {
        await config(opened.drive)
        link = await drive_link(opened.drive)
      } finally { await opened.close() }
      const { id } = reference(link)
      const clash = list().find(other => reference(registry[other]).id === id)
      if (clash) throw new Error(`That configuration drive is already used by bot: ${clash}`)
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
          const run = await sandbox({
            drive: code.view,
            output: out,
            // `msb wait` loses the exit code, so the marker says whether setup.js passed
            command: ['sh', '-c', 'node /app/setup.js && touch /out/.built'],
            audit: await pkgs.core('audit', name)
          })
          const printed = await run.done
          if (!await out.entry('/.built')) throw new Error(said(printed, 'setup.js failed, so nothing was built'))
          await out.del('/.built')
          const link = await drive_link(out)
          await opened.drive.put('/build.json', Buffer.from(JSON.stringify({ drive: link }, null, 2) + '\n'))
          return said(printed, `Built: ${link}`)
        } finally { await out.close() }
      } finally { await code.close() }
    } finally { await opened.close() }
  }

  async function start (name, print) {
    if (!registry[name]) throw new Error(`Unknown bot: ${name}`)
    if (busy(registry[name])) throw new Error('This bot is already running')
    const opened = await pkgs.open_drive(registry[name], false)
    let entry
    // the entry reaches the handle through require('sandbox'), so it is made first
    let box
    try {
      const link = await config(opened.drive)
      box = lazy({ drive: opened.drive, audit: await pkgs.core('audit', name) })
      entry = await pkgs.load({ link, ...reference(link) }, box.handle)
    } catch (err) {
      if (box) await box.stop()
      await opened.close()
      throw err
    }

    const core = await pkgs.core('log', name)
    await core.ready()
    let appends = Promise.resolve()
    const append = line => { appends = appends.then(() => core.append(line)); return appends }
    // a zero length block cannot be read back under Bare (random-access-file 4.1.2 calls
    // process.nextTick, and Bare has no global process), so blank lines are not stored
    const log = line => { if (line) append(line); print(line) }

    let stop
    const stopped = new Promise(resolve => { stop = resolve })
    const run = { stop, done: null }
    running.set(name, run)

    let updates = Promise.resolve()
    const updated = () => { updates = updates.then(() => refresh(opened.drive)) }
    opened.drive.core.on('append', updated)

    const pidfile = path.join(run_dir, name + '.pid')
    await fsp.mkdir(run_dir, { recursive: true, mode: 0o700 })
    await fsp.writeFile(pidfile, JSON.stringify({ pid: process.pid, started: Date.now() }) + '\n', { mode: 0o600 })
    log(await info(name))

    run.done = (async () => {
      try {
        const cleanup = await entry.fn(opened.drive, { stopped, log })
        if (typeof cleanup === 'function') {
          await stopped
          await cleanup()
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
      return await info(name)
    })()
    return { done: run.done, stop }
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

  async function read_log (name) {
    if (!registry[name]) throw new Error(`Unknown bot: ${name}`)
    const core = await pkgs.core('log', name)
    await core.ready()
    try {
      const lines = []
      for (let i = 0; i < core.length; i++) lines.push((await core.get(i)).toString())
      return lines.join('\n')
    } finally { await core.close() }
  }

  async function remove (link) {
    if (busy(link)) throw new Error('Cannot delete a running bot or its package')
    await pkgs.remove(link)
    const { id } = reference(link)
    for (const name of list()) {
      if (reference(registry[name]).id !== id) continue
      // named after the bot, so a later bot with the same name would inherit them
      for (const kind of ['log', 'audit']) await (await pkgs.core(kind, name)).purge()
      delete registry[name]
    }
    await save()
  }

  async function refresh (drive) {
    const link = await pkgs.update(drive)
    for (const name of list()) if (reference(registry[name]).id === drive.id) registry[name] = link
    await save()
  }
}

function write_bot_json (drive, code) {
  return drive.put('/bot.json', Buffer.from(JSON.stringify({ run: code + '/index.js' }, null, 2)))
}

async function config (drive) {
  const data = await drive.get('/bot.json')
  if (!data) throw new Error('Configuration drive must contain bot.json')
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

async function read_json (file) {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'))
  } catch (err) {
    if (err.code === 'ENOENT') return {}
    throw err
  }
}

// a crash never leaves half a registry
async function write_json (file, data) {
  const temp = file + '.' + crypto.randomBytes(16).toString('hex')
  try {
    await fsp.writeFile(temp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
    await fsp.rename(temp, file)
  } finally { await fsp.rm(temp, { force: true }) }
}
