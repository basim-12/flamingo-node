const fsp = require('bare-fs/promises')
const fss = require('bare-fs')
const process = require('bare-process')
const path = require('bare-path')
const os = require('bare-os')
const crypto = require('bare-crypto')
const { URLSearchParams, pathToFileURL } = require('bare-url')
const Module = require('bare-module')
const Corestore = require('corestore')
const Hyperdrive = require('hyperdrive')
const Localdrive = require('localdrive')
const MirrorDrive = require('mirror-drive')
const idEncoding = require('hypercore-id-encoding')
const coreCrypto = require('hypercore-crypto')
const storageKeys = require('hypercore-storage/lib/keys')

const ROOT = path.join(os.homedir(), '.flamingo')
const NAME = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/
const LINK = /^dat:\/\/(\d+)\.(\d+)\.([a-z0-9]+)\.([a-f0-9]{64})(\/[^?]*)?(?:\?(.*))?$/
const uuid = () => crypto.randomBytes(16).toString('hex')
const inside = (root, target) => target === root || target.startsWith(root + path.sep)
const RUN = 'run' // per-bot pidfiles live at ~/.flamingo/run/<name>.pid
const alivePid = pid => { try { process.kill(pid, 0); return true } catch (e) { return e.code === 'EPERM' } }
const usage = `Usage:
  fw pkg +<name> <specifier> | fw pkg <name> --import=<specifier>
  fw pkg <name> [--see] | fw pkg
  fw pkg <name> <dirpath> | fw pkg <name> --export=<dirpath>
  fw pkg -<name>
  fw bot +<name> <specifier>
  fw bot <name> [--see|--run|--end] | fw bot
  fw bot -<name>`

// Normalize aliases before accessing storage.
function parse (args) {
  const [kind, raw, option, ...extra] = args
  if (!['pkg', 'bot'].includes(kind) || extra.length) throw new Error(usage)
  if (raw === '--help' || raw === '-h') return { action: 'help' }
  if (!raw) return { kind, action: 'list' }
  const prefix = /^[+-]/.test(raw) ? raw[0] : ''
  const name = prefix ? raw.slice(1) : raw
  if (!NAME.test(name)) throw new Error('Invalid name: use letters, numbers, underscores and hyphens')
  if (prefix === '+' && option && !option.startsWith('--')) return { kind, name, action: 'create', source: option }
  if (prefix === '-' && !option) return { kind, name, action: 'delete' }
  if (prefix) throw new Error(usage)
  if (!option || option === '--see') return { kind, name, action: 'see' }
  if (kind === 'bot' && ['--run', '--end'].includes(option)) return { kind, name, action: option.slice(2) }
  if (kind === 'pkg') {
    if (option.startsWith('--import=') && option.slice(9)) return { kind, name, action: 'create', source: option.slice(9) }
    if (option.startsWith('--export=') && option.slice(9)) return { kind, name, action: 'export', source: option.slice(9) }
    if (!option.startsWith('-')) return { kind, name, action: 'export', source: option }
  }
  throw new Error(usage)
}

async function exists (file) {
  try { await fsp.lstat(file); return true } catch (e) { if (e.code === 'ENOENT') return false; throw e }
}
async function readJSON (file, fallback = {}) {
  try { return JSON.parse(await fsp.readFile(file, 'utf8')) } catch (e) { if (e.code === 'ENOENT') return fallback; throw e }
}
async function writeJSON (file, data) {
  const temp = file + '.' + uuid()
  try {
    await fsp.writeFile(temp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
    await fsp.rename(temp, file)
  } finally { await fsp.rm(temp, { force: true }) }
}

function reference (link) {
  const m = LINK.exec(link)
  if (!m) throw new Error(`Invalid pinned drive reference: ${link}`)
  const length = Number(m[1]); const fork = Number(m[2])
  if (!Number.isSafeInteger(length) || !Number.isSafeInteger(fork)) throw new Error('Invalid drive revision')
  return { length, fork, id: m[3], hash: m[4], file: m[5] || '', options: Object.fromEntries(new URLSearchParams(m[6] || '')) }
}
async function driveLink (drive) {
  const length = drive.core.length
  const fork = drive.core.fork
  const hash = await drive.core.treeHash(length)
  if (drive.core.fork !== fork) return driveLink(drive)
  return `dat://${length}.${fork}.${drive.id}.${hash.toString('hex')}`
}

// MirrorDrive copies bytes; metadata hooks retain directory markers and permissions.
async function importFolder (drive, folder) {
  const metadata = new Map()
  const dirs = []
  async function walk (relative = '') {
    for (const item of await fsp.readdir(path.join(folder, relative), { withFileTypes: true })) {
      const key = relative + '/' + item.name
      const stat = await fsp.lstat(path.join(folder, key))
      if (!stat.isDirectory() && !stat.isFile()) throw new Error(`Unsupported filesystem entry: ${key}`)
      metadata.set(key, { mode: stat.mode & 0o777 })
      if (stat.isDirectory()) { dirs.push(key); await walk(key) }
    }
  }
  await walk()
  await new MirrorDrive(new Localdrive(folder, { metadata }), drive, { prune: false, preload: false }).done()
  for (const key of dirs) await drive.put(key, Buffer.alloc(0), { metadata: { ...metadata.get(key), directory: true } })
}
async function exportFolder (drive, folder) {
  await fsp.mkdir(folder, { mode: 0o700 })
  try {
    const dirs = []; const metadata = new Map()
    for await (const { key, value } of drive.list()) {
      const dest = path.resolve(folder, '.' + key)
      if (!key.startsWith('/') || dest === folder || !inside(folder, dest) || value.linkname) throw new Error(`Unsupported drive entry: ${key}`)
      if (value.metadata?.directory) { await fsp.mkdir(dest, { recursive: true }); dirs.push([dest, value.metadata.mode]) }
    }
    await new MirrorDrive(drive, new Localdrive(folder, { metadata }), {
      prune: false, preload: false, filter: key => !dirs.some(([dir]) => dir === path.resolve(folder, '.' + key))
    }).done()
    for (const [key, meta] of metadata) if (meta?.mode !== undefined) await fsp.chmod(path.join(folder, key), meta.mode)
    for (const [dir, mode] of dirs.reverse()) await fsp.chmod(dir, mode ?? 0o755)
  } catch (e) { await fsp.rm(folder, { recursive: true, force: true }); throw e }
}

// Compatibility deletion for the pinned storage layout; never remove the shared store.
async function purge (store, drive) {
  if (require('hypercore-storage/package.json').version !== '3.2.1') throw new Error('Review purge compatibility before upgrading hypercore-storage')
  await drive.ready()
  const keys = [drive.core.discoveryKey, drive.blobs?.core.discoveryKey].filter(Boolean)
  const records = []
  for await (const record of store.storage.createCoreStream()) if (keys.some(key => key.equals(record.discoveryKey))) records.push(record)
  await drive.close()
  const tx = store.storage.db.write({ autoDestroy: true })
  for (const { discoveryKey, core } of records) {
    tx.tryDelete(storageKeys.store.core(discoveryKey))
    if (core.alias) tx.tryDelete(storageKeys.store.coreByAlias(core.alias))
    tx.tryDeleteRange(storageKeys.core.core(core.corePointer), storageKeys.core.core(core.corePointer + 1))
    tx.tryDeleteRange(storageKeys.core.data(core.dataPointer), storageKeys.core.data(core.dataPointer + 1))
  }
  await tx.flush()
}

class Packages {
  constructor (root = ROOT) {
    this.root = root
    this.store = null
    this.pkgs = Object.create(null)
    this.bots = Object.create(null)
    this.running = new Map()
    this.saving = Promise.resolve()
  }

  async registries () {
    // Load and validate the JSON registries without opening the shared store,
    // so inspection and stop keep working while a bot holds the store lock.
    await fsp.mkdir(this.root, { recursive: true, mode: 0o700 })
    for (const kind of ['pkgs', 'bots']) {
      const entries = await readJSON(path.join(this.root, kind + '.json'))
      if (!entries || typeof entries !== 'object' || Array.isArray(entries)) throw new Error(`Invalid ${kind} registry`)
      for (const [name, link] of Object.entries(entries)) {
        if (!NAME.test(name) || typeof link !== 'string') throw new Error(`Invalid ${kind} entry`)
      }
      this[kind] = Object.assign(Object.create(null), entries)
    }
  }

  async open () {
    await this.registries()
    this.store = new Corestore(path.join(this.root, 'corestore'))
    try {
      await this.store.ready()
    } catch (e) {
      if (/could not be locked/i.test(e.message)) throw new Error('A Flamingo bot is running; stop it with `fw bot <name> --end` before changing packages')
      throw e
    }
    let changed = false
    for (const kind of ['pkgs', 'bots']) {
      for (const [name, link] of Object.entries(this[kind])) {
        if (link.startsWith('dat://')) { reference(link); continue }
        // Upgrade a legacy raw-key entry from the old storage/ layout to a pinned reference.
        const drive = new Hyperdrive(this.store.session(), link)
        await drive.ready(); this[kind][name] = await driveLink(drive); await drive.close(); changed = true
      }
    }
    if (changed) await this.save()
  }

  save () {
    // Serialize registry replacements, including updates from running bots.
    this.saving = this.saving.then(async () => {
      await writeJSON(path.join(this.root, 'pkgs.json'), this.pkgs)
      await writeJSON(path.join(this.root, 'bots.json'), this.bots)
    })
    return this.saving
  }

  async close () { await this.saving; if (this.store) await this.store.close() }

  async openDrive (link, pinned = true) {
    const ref = reference(link)
    const stored = await this.store.storage.getAuth(coreCrypto.discoveryKey(idEncoding.decode(ref.id)))
    if (!stored) throw new Error(`Drive is not available locally: ${ref.id}`)
    const active = [...this.running.values()].find(run => run.id === ref.id)
    const drive = active ? active.drive : new Hyperdrive(this.store.session(), ref.id)
    await drive.ready()
    try {
      if (drive.core.fork !== ref.fork || drive.core.length < ref.length) throw new Error('Referenced drive revision is unavailable')
      if ((await drive.core.treeHash(ref.length)).toString('hex') !== ref.hash) throw new Error('Drive hash mismatch')
      const view = pinned ? drive.checkout(ref.length) : active ? drive.checkout(drive.version) : drive
      if (view !== drive) await view.ready()
      // Check local content before copying/loading; do not wait for absent peers.
      if (pinned) {
        for await (const entry of view.list()) {
          const blob = entry.value.blob
          if (blob && !(await drive.blobs.core.has(blob.blockOffset, blob.blockOffset + blob.blockLength))) throw new Error('Referenced file content is unavailable locally')
        }
      }
      return { drive, view, ref, close: async () => { if (view !== drive) await view.close(); if (!active) await drive.close() } }
    } catch (e) { if (!active) await drive.close(); throw e }
  }

  async source (spec, cwd) {
    const q = spec.indexOf('?')
    const base = q < 0 ? spec : spec.slice(0, q)
    const options = Object.fromEntries(new URLSearchParams(q < 0 ? '' : spec.slice(q + 1)))
    if (base.startsWith('dat://')) return { link: spec, ...reference(spec) }
    const local = path.resolve(cwd, base)
    if (await exists(local)) {
      const real = await fsp.realpath(local)
      const storage = await fsp.realpath(this.root)
      if (inside(real, storage) || inside(storage, real)) throw new Error('Source must not overlap managed storage')
      const stat = await fsp.stat(real)
      if (!stat.isFile() && !stat.isDirectory()) throw new Error('Unsupported source')
      return { local: real, generator: stat.isFile(), options }
    }
    const [head, ...parts] = base.split('/')
    const file = parts.length ? '/' + parts.join('/') : ''
    if (this.pkgs[head]) return { link: this.pkgs[head], file, options }
    // A bare Hyperdrive id (disk.id) for a drive already in the local store.
    if (idEncoding.isValid(head)) {
      const known = [...Object.values(this.pkgs), ...Object.values(this.bots)].find(link => reference(link).id === head)
      if (known) return { link: known, file, options }
      if (await this.store.storage.getAuth(coreCrypto.discoveryKey(idEncoding.decode(head)))) {
        const drive = new Hyperdrive(this.store.session(), head)
        try { await drive.ready(); return { link: await driveLink(drive), file, options } } finally { await drive.close() }
      }
    }
    throw new Error(`Unknown package or source: ${base}`)
  }

  async load (source) {
    let folder; let file; let code = null
    if (source.local) { folder = path.dirname(source.local); file = source.local } else {
      const opened = await this.openDrive(source.link)
      try {
        code = `dat://${opened.ref.length}.${opened.ref.fork}.${opened.ref.id}.${opened.ref.hash}`
        folder = path.join(this.root, 'code', uuid())
        await fsp.mkdir(path.dirname(folder), { recursive: true })
        await exportFolder(opened.view, folder)
      } finally { await opened.close() }
      file = path.resolve(folder, '.' + source.file)
      if (!inside(folder, file) || file === folder) throw new Error('Invalid entry filepath')
    }
    try {
      if (!(await exists(file)) && await exists(file + '.js')) file += '.js'
      if (!(await exists(file))) throw new Error(`Generator/entry file not found in the drive: ${source.file || '(root)'}`)
      const url = pathToFileURL(file)
      // Generators and entries run against this CLI's runtime; expose a small fixed
      // set of modules. Reproducible per-package dependency installs are deferred.
      const runtime = ['bare-process', 'bare-path', 'bare-fs', 'bare-os', 'bare-crypto', 'bare-subprocess', 'bare-url', 'bip39-mnemonic']
      const imports = Object.fromEntries(runtime.flatMap(name => {
        try { return [[name, pathToFileURL(require.resolve(name)).href]] } catch { return [] }
      }))
      const loaded = Module.load(url, { imports, cache: Object.create(null) })
      const fn = loaded.exports.default || loaded.exports
      if (typeof fn !== 'function') throw new Error('Entry must export a function')
      return { fn, code, folder, close: async () => { if (!source.local) await fsp.rm(folder, { recursive: true, force: true }) } }
    } catch (e) { if (!source.local) await fsp.rm(folder, { recursive: true, force: true }); throw e }
  }

  async create (name, spec, cwd, kind = 'pkg') {
    if (this.pkgs[name]) throw new Error(`Package already exists: ${name}`)
    const source = await this.source(spec, cwd)
    const drive = new Hyperdrive(this.store.namespace(kind).namespace(name).namespace(uuid()))
    await drive.ready()
    try {
      if (source.generator || source.file) {
        const generator = await this.load(source)
        try { await generator.fn(drive, source.options) } finally { await generator.close() }
        if (kind === 'bot') await drive.put('/bot.json', Buffer.from(JSON.stringify({ entry: generator.code + '/main.js' }, null, 2)))
      } else if (source.local) await importFolder(drive, source.local)
      else {
        const opened = await this.openDrive(source.link)
        try { await new MirrorDrive(opened.view, drive, { prune: false, preload: false }).done() } finally { await opened.close() }
      }
      const link = await driveLink(drive)
      this.pkgs[name] = link
      await this.save()
      return link
    } catch (e) { delete this.pkgs[name]; await purge(this.store, drive); throw e } finally { await drive.close() }
  }

  // A bot counts as running if this process runs it or a live pidfile claims it.
  runner (name) {
    if (this.running.has(name)) return { pid: process.pid }
    try {
      const info = JSON.parse(fss.readFileSync(path.join(this.root, RUN, name + '.pid'), 'utf8'))
      if (info && typeof info.pid === 'number' && alivePid(info.pid)) return info
    } catch {}
    return null
  }

  busy (link) {
    const id = reference(link).id
    return Object.keys(this.bots).some(name => reference(this.bots[name]).id === id && this.runner(name))
  }

  async remove (link) {
    if (this.busy(link)) throw new Error('Cannot delete a running bot or its package')
    const opened = await this.openDrive(link, false)
    await purge(this.store, opened.drive)
    const id = reference(link).id
    for (const registry of [this.pkgs, this.bots]) for (const name of Object.keys(registry)) if (reference(registry[name]).id === id) delete registry[name]
    await this.save()
  }

  info (kind, name) {
    const link = (kind === 'pkg' ? this.pkgs : this.bots)[name]
    if (!link) throw new Error(`Unknown ${kind}: ${name}`)
    const pkg = Object.keys(this.pkgs).find(key => reference(this.pkgs[key]).id === reference(link).id)
    return `Name: ${name}\nDrive: ${link}` + (kind === 'bot' ? `\nPackage: ${pkg || '(unnamed)'}\nStatus: ${this.busy(link) ? 'running' : 'stopped'}` : '')
  }

  async command (cmd, cwd, log) {
    const registry = cmd.kind === 'pkg' ? this.pkgs : this.bots
    const { action, name, source } = cmd
    if (action === 'list') return Object.keys(registry).sort().map(name => this.info(cmd.kind, name)).join('\n\n') || `No ${cmd.kind}s.`
    if (cmd.kind === 'bot') return require('./bot').command(this, cmd, cwd, log)
    if (action === 'create') await this.create(name, source, cwd)
    else {
      if (!registry[name]) throw new Error(`Unknown package: ${name}`)
      if (action === 'delete') { await this.remove(registry[name]); return `Deleted: ${name}` }
      if (action === 'export') {
        const dest = path.resolve(cwd, source)
        const real = path.join(await fsp.realpath(path.dirname(dest)), path.basename(dest))
        if (inside(await fsp.realpath(this.root), real)) throw new Error('Export must be outside managed storage')
        const opened = await this.openDrive(registry[name], false)
        try { await exportFolder(opened.view, real) } finally { await opened.close() }
        return this.info('pkg', name) + '\nExported to: ' + real
      }
    }
    return this.info('pkg', name)
  }
}
module.exports = { Packages, RUN, usage, parse, reference, driveLink }
