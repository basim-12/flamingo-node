const fs = require('bare-fs')
const fsp = require('bare-fs/promises')
const path = require('bare-path')
const process = require('bare-process')
const crypto = require('bare-crypto')
const { reference, drive_link } = require('../packs')

module.exports = tasks

// Things that run from a pack's drive and can be stopped and started again, such as
// a bot. Built on a packs() instance; the drive holds bot.json (what to run) and
// whatever the task saves.
function tasks (pkgs) {
  const run_dir = path.join(pkgs.root, 'run')
  const running = new Map()
  let registry = Object.create(null)
  let saving = Promise.resolve()
  const api = { registries, close, list, get, info, busy, create, start, end, remove }
  return api

  // Read bots.json. Needs no store, so it works while a running bot holds it.
  async function registries () {
    registry = Object.assign(Object.create(null), await read_json(path.join(pkgs.root, 'bots.json')))
  }

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

  function info (name) {
    const link = registry[name]
    if (!link) throw new Error(`Unknown bot: ${name}`)
    return `Name: ${name}\nDrive: ${link}\nPackage: ${pkgs.find(link) || '(unnamed)'}\nStatus: ${busy(link) ? 'running' : 'stopped'}`
  }

  // A task runs if this process runs it, or a live process claims it in its pidfile.
  function runner (name) {
    if (running.has(name)) return { pid: process.pid }
    try {
      const { pid } = JSON.parse(fs.readFileSync(path.join(run_dir, name + '.pid'), 'utf8'))
      if (alive(pid)) return { pid }
    } catch {}
    return null
  }

  // Whether any task on the drive behind `link` is running.
  function busy (link) {
    const { id } = reference(link)
    return list().some(name => reference(registry[name]).id === id && runner(name))
  }

  // Register a task from a <specifier> naming either a drive that already holds
  // bot.json, or a generator in a drive (<drive>/generate) that fills a fresh drive,
  // in which case bot.json is written here. One drive belongs to at most one task:
  // sharing it would mean two bots with one identity.
  async function create (name, spec, cwd) {
    if (registry[name]) throw new Error(`Bot already exists: ${name}`)
    const from = await pkgs.source(spec, cwd)
    if (from.local) throw new Error('A bot needs a drive, not a local path: pass a package name, drive id or dat:// reference')
    const generated = !!from.file
    let link = generated ? await pkgs.create(name, spec, cwd, { namespace: 'bot', prepare: write_bot_json }) : from.link
    try {
      const opened = await pkgs.open_drive(link, false)
      try {
        await config(opened.drive)
        if (!opened.drive.writable) throw new Error('The bot drive is not writable on this device')
        link = await drive_link(opened.drive)
      } finally { await opened.close() }
      const { id } = reference(link)
      const clash = list().find(other => reference(registry[other]).id === id)
      if (clash) throw new Error(`That configuration drive is already used by bot: ${clash}`)
      registry[name] = link
      await save()
      return link
    } catch (err) {
      delete registry[name]
      if (generated) await pkgs.remove(pkgs.get(name))
      throw err
    }
  }

  // Run a task's entry in this process until it is stopped. Returns { done, stop }.
  async function start (name, log) {
    if (busy(registry[name])) throw new Error('This bot is already running')
    const opened = await pkgs.open_drive(registry[name], false)
    let entry
    try {
      if (!opened.drive.writable) throw new Error('The bot drive is not writable on this device')
      const link = await config(opened.drive)
      entry = await pkgs.load({ link, ...reference(link) })
    } catch (err) {
      await opened.close()
      throw err
    }

    let stop
    const stopped = new Promise(resolve => { stop = resolve })
    const run = { stop, done: null }
    running.set(name, run)

    // Keep the registries on the latest revision as the task saves data.
    let updates = Promise.resolve()
    const updated = () => { updates = updates.then(() => refresh(opened.drive)) }
    opened.drive.core.on('append', updated)

    const pidfile = path.join(run_dir, name + '.pid')
    await fsp.mkdir(run_dir, { recursive: true, mode: 0o700 })
    await fsp.writeFile(pidfile, JSON.stringify({ pid: process.pid, started: Date.now() }) + '\n', { mode: 0o600 })
    log(info(name))

    run.done = (async () => {
      try {
        const cleanup = await entry.fn(opened.drive, { stopped, log })
        if (typeof cleanup === 'function') {
          await stopped
          await cleanup()
        }
      } finally {
        opened.drive.core.off('append', updated)
        try {
          await updates
          await refresh(opened.drive)
        } finally {
          await fsp.rm(pidfile, { force: true })
          await opened.close()
          await entry.close()
          running.delete(name)
        }
      }
      return info(name)
    })()
    return { done: run.done, stop }
  }

  // Stop a running task: directly if it runs in this process, otherwise by
  // signalling the process that runs it and waiting for it to exit.
  async function end (name) {
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

  // Delete a drive with every package and task registered on it. Refused while a
  // task on that drive is running.
  async function remove (link) {
    if (busy(link)) throw new Error('Cannot delete a running bot or its package')
    await pkgs.remove(link)
    const { id } = reference(link)
    for (const name of list()) if (reference(registry[name]).id === id) delete registry[name]
    await save()
  }

  async function refresh (drive) {
    const link = await pkgs.update(drive)
    for (const name of list()) if (reference(registry[name]).id === drive.id) registry[name] = link
    await save()
  }
}

// The CLI, not the generator, records what a bot runs: the generator's drive at its
// pinned revision, and that drive's main.js.
function write_bot_json (drive, code) {
  return drive.put('/bot.json', Buffer.from(JSON.stringify({ entry: code + '/main.js' }, null, 2)))
}

async function config (drive) {
  const data = await drive.get('/bot.json', { wait: false })
  if (!data) throw new Error('Configuration drive must contain bot.json')
  const { entry } = JSON.parse(data)
  if (typeof entry !== 'string' || !reference(entry).file) throw new Error('bot.json.entry must be a pinned drive URL with an entry filepath')
  return entry
}

function alive (pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return err.code === 'EPERM'
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

// Write to a temporary file and rename it, so a crash never leaves half a registry.
async function write_json (file, data) {
  const temp = file + '.' + crypto.randomBytes(16).toString('hex')
  try {
    await fsp.writeFile(temp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
    await fsp.rename(temp, file)
  } finally { await fsp.rm(temp, { force: true }) }
}
