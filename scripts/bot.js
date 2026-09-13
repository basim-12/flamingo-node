const path = require('bare-path')
const fsp = require('bare-fs/promises')
const process = require('bare-process')
const { reference, driveLink, RUN } = require('./pkg')

const pidPath = (service, name) => path.join(service.root, RUN, name + '.pid')

// Keep the bot and every name for its mutable drive on the latest saved revision.
async function refresh (service, drive) {
  const link = await driveLink(drive)
  for (const registry of [service.pkgs, service.bots]) {
    for (const name of Object.keys(registry)) if (reference(registry[name]).id === drive.id) registry[name] = link
  }
  await service.save()
}

async function config (drive) {
  const data = await drive.get('/bot.json', { wait: false })
  if (!data) throw new Error('Configuration drive must contain bot.json')
  const json = JSON.parse(data.toString())
  if (typeof json.entry !== 'string' || !reference(json.entry).file) throw new Error('bot.json.entry must be a pinned drive URL with an entry filepath')
  return json
}

async function start (service, name, log) {
  // A bot is a singleton: refuse if it, or another bot on the same drive, runs.
  if (service.busy(service.bots[name])) throw new Error('This bot is already running')
  const opened = await service.openDrive(service.bots[name], false)
  let entry
  try {
    if (!opened.drive.writable) throw new Error('The bot drive is not writable on this device')
    const settings = await config(opened.drive)
    entry = await service.load({ link: settings.entry, ...reference(settings.entry) })
  } catch (e) { await opened.close(); throw e }

  let stop
  const stopped = new Promise(resolve => { stop = resolve })
  const run = { id: opened.drive.id, drive: opened.drive, stop, done: null }
  service.running.set(name, run)

  let updates = Promise.resolve()
  const updated = () => { updates = updates.then(() => refresh(service, opened.drive)) }
  opened.drive.core.on('append', updated)

  await fsp.mkdir(path.dirname(pidPath(service, name)), { recursive: true, mode: 0o700 })
  await fsp.writeFile(pidPath(service, name), JSON.stringify({ pid: process.pid, started: Date.now() }) + '\n', { mode: 0o600 })
  log(service.info('bot', name))

  run.done = (async () => {
    try {
      const cleanup = await entry.fn(opened.drive, { stopped, log })
      if (typeof cleanup === 'function') { await stopped; await cleanup() }
    } finally {
      opened.drive.core.off('append', updated)
      try { await updates; await refresh(service, opened.drive) } finally {
        await fsp.rm(pidPath(service, name), { force: true })
        await opened.close()
        await entry.close()
        service.running.delete(name)
      }
    }
    return service.info('bot', name)
  })()
  return { done: run.done, stop }
}

// Stop a running bot: resolve it in-process, or signal the foreground process.
async function end (service, name) {
  const local = service.running.get(name)
  if (local) { local.stop(); await local.done; return }
  const info = service.runner(name)
  if (!info || !info.pid) return
  try { process.kill(info.pid, 'SIGTERM') } catch (e) { if (e.code !== 'ESRCH') throw e }
  for (let i = 0; i < 600 && service.runner(name); i++) await new Promise(resolve => setTimeout(resolve, 50))
  if (service.runner(name)) throw new Error('The running bot did not stop in time')
}

async function command (service, cmd, cwd, log) {
  const { name, action } = cmd
  if (action === 'create') {
    if (service.bots[name]) throw new Error(`Bot already exists: ${name}`)
    const source = await service.source(cmd.source, cwd)
    if (source.local) throw new Error('A bot needs a drive, not a local path: pass a package name, drive id or dat:// reference')
    const generated = !!source.file
    if (generated && service.pkgs[name]) throw new Error(`Package already exists: ${name}`)
    let link
    let created = false
    try {
      if (generated) { link = await service.create(name, cmd.source, cwd, 'bot'); created = true } else link = source.link
      const opened = await service.openDrive(link, false)
      try {
        await config(opened.drive)
        if (!opened.drive.writable) throw new Error('The bot drive is not writable on this device')
        link = await driveLink(opened.drive)
      } finally { await opened.close() }
      // One configuration drive belongs to at most one bot: sharing it would mean
      // two bots running the same identity.
      const id = reference(link).id
      const clash = Object.keys(service.bots).find(other => reference(service.bots[other]).id === id)
      if (clash) throw new Error(`That configuration drive is already used by bot: ${clash}`)
      service.bots[name] = link
      await service.save()
      return service.info('bot', name)
    } catch (e) {
      delete service.bots[name]
      if (created && service.pkgs[name]) await service.remove(service.pkgs[name])
      throw e
    }
  }
  if (!service.bots[name]) throw new Error(`Unknown bot: ${name}`)
  if (action === 'see') return service.info('bot', name)
  if (action === 'run') return start(service, name, log)
  if (action === 'end') { await end(service, name); return service.info('bot', name) }
  if (action === 'delete') { await service.remove(service.bots[name]); return `Deleted: ${name}` }
  throw new Error('Unsupported bot command')
}
module.exports = { command }
