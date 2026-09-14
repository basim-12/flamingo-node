const fsp = require('bare-fs/promises')
const path = require('bare-path')
const os = require('bare-os')
const crypto = require('bare-crypto')
const { URLSearchParams, pathToFileURL } = require('bare-url')
const Module = require('bare-module')
const Corestore = require('corestore')
const Hyperdrive = require('hyperdrive')
const Localdrive = require('localdrive')
const MirrorDrive = require('mirror-drive')
const id_encoding = require('hypercore-id-encoding')
const core_crypto = require('hypercore-crypto')
const storage_keys = require('hypercore-storage/lib/keys')

const ROOT = path.join(os.homedir(), '.flamingo')
const LINK = /^dat:\/\/(\d+)\.(\d+)\.([a-z0-9]+)\.([a-f0-9]{64})(\/[^?]*)?(?:\?(.*))?$/
// Modules that code loaded from a drive may require. Per-drive dependencies come later.
const RUNTIME = ['bare-process', 'bare-path', 'bare-fs', 'bare-os', 'bare-crypto', 'bare-subprocess', 'bare-url', 'bip39-mnemonic', 'bare-ws']

module.exports = packs
packs.reference = reference
packs.drive_link = drive_link

function packs (root = ROOT) {
  let store = null
  let registry = Object.create(null)
  let saving = Promise.resolve()
  const api = { root, registries, open, close, list, get, find, info, source, open_drive, load, create, update, remove, export_to }
  return api

  // Read pkgs.json without opening the store, so inspecting still works while a
  // running bot holds the store's lock.
  async function registries () {
    await fsp.mkdir(root, { recursive: true, mode: 0o700 })
    registry = Object.assign(Object.create(null), await read_json(path.join(root, 'pkgs.json')))
  }

  async function open () {
    await registries()
    store = new Corestore(path.join(root, 'corestore'))
    await store.ready().catch(err => {
      throw /could not be locked/i.test(err.message) ? new Error('Drive storage is in use by another process, such as a running bot') : err
    })
  }

  async function close () {
    await saving
    if (store) await store.close()
  }

  function save () {
    saving = saving.then(() => write_json(path.join(root, 'pkgs.json'), registry))
    return saving
  }

  function list () {
    return Object.keys(registry).sort()
  }

  function get (name) {
    return registry[name]
  }

  // The package name registered for the drive behind `link`, if there is one.
  function find (link) {
    const { id } = reference(link)
    return list().find(name => reference(registry[name]).id === id)
  }

  function info (name) {
    if (!registry[name]) throw new Error(`Unknown package: ${name}`)
    return `Name: ${name}\nDrive: ${registry[name]}`
  }

  // Resolve a <specifier>: a local folder or file, a dat:// reference, a package
  // name or a drive id, each optionally followed by /<file> to run a generator.
  async function source (spec, cwd) {
    const q = spec.indexOf('?')
    const base = q < 0 ? spec : spec.slice(0, q)
    const options = Object.fromEntries(new URLSearchParams(q < 0 ? '' : spec.slice(q + 1)))
    if (base.startsWith('dat://')) return { link: spec, ...reference(spec) }
    const local = path.resolve(cwd, base)
    if (await exists(local)) {
      const real = await fsp.realpath(local)
      const storage = await fsp.realpath(root)
      if (inside(real, storage) || inside(storage, real)) throw new Error('Source must not overlap managed storage')
      const stat = await fsp.stat(real)
      if (!stat.isFile() && !stat.isDirectory()) throw new Error('Unsupported source')
      return { local: real, generator: stat.isFile(), options }
    }
    const [head, ...parts] = base.split('/')
    const file = parts.length ? '/' + parts.join('/') : ''
    if (registry[head]) return { link: registry[head], file, options }
    if (id_encoding.isValid(head)) {
      const known = Object.values(registry).find(link => reference(link).id === head)
      if (known) return { link: known, file, options }
      if (await store.storage.getAuth(core_crypto.discoveryKey(id_encoding.decode(head)))) {
        const drive = new Hyperdrive(store.session(), head)
        try {
          await drive.ready()
          return { link: await drive_link(drive), file, options }
        } finally { await drive.close() }
      }
    }
    throw new Error(`Unknown package or source: ${base}`)
  }

  // Open the drive behind `link`. Pinned: a read-only view at exactly that revision,
  // with its hash checked. Not pinned: the live drive.
  async function open_drive (link, pinned = true) {
    const ref = reference(link)
    if (!(await store.storage.getAuth(core_crypto.discoveryKey(id_encoding.decode(ref.id))))) throw new Error(`Drive is not available locally: ${ref.id}`)
    const drive = new Hyperdrive(store.session(), ref.id)
    await drive.ready()
    try {
      if (drive.core.fork !== ref.fork || drive.core.length < ref.length) throw new Error('Referenced drive revision is unavailable')
      if ((await drive.core.treeHash(ref.length)).toString('hex') !== ref.hash) throw new Error('Drive hash mismatch')
      const view = pinned ? drive.checkout(ref.length) : drive
      if (pinned) {
        await view.ready()
        // Check the content is here before copying or loading; don't wait for absent peers.
        for await (const entry of view.list()) {
          const blob = entry.value.blob
          if (blob && !(await drive.blobs.core.has(blob.blockOffset, blob.blockOffset + blob.blockLength))) throw new Error('Referenced file content is unavailable locally')
        }
      }
      return { drive, view, ref, close: async () => { if (pinned) await view.close(); await drive.close() } }
    } catch (err) { await drive.close(); throw err }
  }

  // Load the function a generator or entry file exports. Drive code is checked out
  // at its pinned revision into a temporary folder; `code` is that pinned reference.
  async function load (from) {
    let folder
    let file
    let code = null
    if (from.local) {
      folder = path.dirname(from.local)
      file = from.local
    } else {
      const opened = await open_drive(from.link)
      try {
        code = `dat://${opened.ref.length}.${opened.ref.fork}.${opened.ref.id}.${opened.ref.hash}`
        folder = path.join(root, 'code', uuid())
        await fsp.mkdir(path.dirname(folder), { recursive: true })
        await export_folder(opened.view, folder)
      } finally { await opened.close() }
      file = path.resolve(folder, '.' + from.file)
      if (!inside(folder, file) || file === folder) throw new Error('Invalid entry filepath')
    }
    const cleanup = async () => { if (!from.local) await fsp.rm(folder, { recursive: true, force: true }) }
    try {
      if (!(await exists(file)) && await exists(file + '.js')) file += '.js'
      if (!(await exists(file))) throw new Error(`Generator/entry file not found in the drive: ${from.file || '(root)'}`)
      const imports = Object.fromEntries(RUNTIME.map(name => [name, pathToFileURL(require.resolve(name)).href]))
      const loaded = Module.load(pathToFileURL(file), { imports, cache: Object.create(null) })
      const fn = loaded.exports.default || loaded.exports
      if (typeof fn !== 'function') throw new Error('Entry must export a function')
      return { fn, code, close: cleanup }
    } catch (err) { await cleanup(); throw err }
  }

  // Make a new named drive from a <specifier>: copy a folder or drive, or run a
  // generator into it. `prepare(drive, code)` runs after that and before the drive
  // is registered; `code` is the generator's pinned drive reference, if any.
  async function create (name, spec, cwd, { namespace = 'pkg', prepare } = {}) {
    if (registry[name]) throw new Error(`Package already exists: ${name}`)
    const from = await source(spec, cwd)
    const drive = new Hyperdrive(store.namespace(namespace).namespace(name).namespace(uuid()))
    await drive.ready()
    try {
      let code = null
      if (from.generator || from.file) {
        const generator = await load(from)
        code = generator.code
        try { await generator.fn(drive, from.options) } finally { await generator.close() }
      } else if (from.local) {
        await import_folder(drive, from.local)
      } else {
        const opened = await open_drive(from.link)
        try { await new MirrorDrive(opened.view, drive, { prune: false, preload: false }).done() } finally { await opened.close() }
      }
      if (prepare) await prepare(drive, code)
      registry[name] = await drive_link(drive)
      await save()
      return registry[name]
    } catch (err) {
      delete registry[name]
      await purge(store, drive)
      throw err
    } finally { await drive.close() }
  }

  // Point every package on this drive at its latest saved revision.
  async function update (drive) {
    const link = await drive_link(drive)
    for (const name of list()) if (reference(registry[name]).id === drive.id) registry[name] = link
    await save()
    return link
  }

  // Delete the drive behind `link` and every package name registered for it.
  async function remove (link) {
    const { id } = reference(link)
    const opened = await open_drive(link, false)
    await purge(store, opened.drive)
    for (const name of list()) if (reference(registry[name]).id === id) delete registry[name]
    await save()
  }

  // Copy a package's latest files into a new folder outside managed storage.
  async function export_to (name, folder, cwd) {
    if (!registry[name]) throw new Error(`Unknown package: ${name}`)
    const dest = path.resolve(cwd, folder)
    const real = path.join(await fsp.realpath(path.dirname(dest)), path.basename(dest))
    if (inside(await fsp.realpath(root), real)) throw new Error('Export must be outside managed storage')
    const opened = await open_drive(registry[name], false)
    try { await export_folder(opened.view, real) } finally { await opened.close() }
    return real
  }
}

function reference (link) {
  const m = LINK.exec(link)
  if (!m) throw new Error(`Invalid pinned drive reference: ${link}`)
  const length = Number(m[1])
  const fork = Number(m[2])
  if (!Number.isSafeInteger(length) || !Number.isSafeInteger(fork)) throw new Error('Invalid drive revision')
  return { length, fork, id: m[3], hash: m[4], file: m[5] || '', options: Object.fromEntries(new URLSearchParams(m[6] || '')) }
}

async function drive_link (drive) {
  const length = drive.core.length
  const fork = drive.core.fork
  const hash = await drive.core.treeHash(length)
  if (drive.core.fork !== fork) return drive_link(drive)
  return `dat://${length}.${fork}.${drive.id}.${hash.toString('hex')}`
}

// MirrorDrive copies bytes; the metadata hooks keep empty folders and permissions.
async function import_folder (drive, folder) {
  const metadata = new Map()
  const dirs = []
  async function walk (relative = '') {
    for (const item of await fsp.readdir(path.join(folder, relative), { withFileTypes: true })) {
      const key = relative + '/' + item.name
      const stat = await fsp.lstat(path.join(folder, key))
      if (!stat.isDirectory() && !stat.isFile()) throw new Error(`Unsupported filesystem entry: ${key}`)
      metadata.set(key, { mode: stat.mode & 0o777 })
      if (stat.isDirectory()) {
        dirs.push(key)
        await walk(key)
      }
    }
  }
  await walk()
  await new MirrorDrive(new Localdrive(folder, { metadata }), drive, { prune: false, preload: false }).done()
  for (const key of dirs) await drive.put(key, Buffer.alloc(0), { metadata: { ...metadata.get(key), directory: true } })
}

async function export_folder (drive, folder) {
  await fsp.mkdir(folder, { mode: 0o700 })
  try {
    const dirs = []
    const metadata = new Map()
    for await (const { key, value } of drive.list()) {
      const dest = path.resolve(folder, '.' + key)
      if (!key.startsWith('/') || dest === folder || !inside(folder, dest) || value.linkname) throw new Error(`Unsupported drive entry: ${key}`)
      if (value.metadata?.directory) {
        await fsp.mkdir(dest, { recursive: true })
        dirs.push([dest, value.metadata.mode])
      }
    }
    await new MirrorDrive(drive, new Localdrive(folder, { metadata }), {
      prune: false, preload: false, filter: key => !dirs.some(([dir]) => dir === path.resolve(folder, '.' + key))
    }).done()
    for (const [key, meta] of metadata) if (meta?.mode !== undefined) await fsp.chmod(path.join(folder, key), meta.mode)
    for (const [dir, mode] of dirs.reverse()) await fsp.chmod(dir, mode ?? 0o755)
  } catch (err) {
    await fsp.rm(folder, { recursive: true, force: true })
    throw err
  }
}

// Delete one drive's cores from the shared store, never the store itself. Tied to
// hypercore-storage's layout, so it refuses to run against a different version.
async function purge (store, drive) {
  if (require('hypercore-storage/package.json').version !== '3.2.1') throw new Error('Review purge compatibility before upgrading hypercore-storage')
  await drive.ready()
  const keys = [drive.core.discoveryKey, drive.blobs?.core.discoveryKey].filter(Boolean)
  const records = []
  for await (const record of store.storage.createCoreStream()) if (keys.some(key => key.equals(record.discoveryKey))) records.push(record)
  await drive.close()
  const tx = store.storage.db.write({ autoDestroy: true })
  for (const { discoveryKey, core } of records) {
    tx.tryDelete(storage_keys.store.core(discoveryKey))
    if (core.alias) tx.tryDelete(storage_keys.store.coreByAlias(core.alias))
    tx.tryDeleteRange(storage_keys.core.core(core.corePointer), storage_keys.core.core(core.corePointer + 1))
    tx.tryDeleteRange(storage_keys.core.data(core.dataPointer), storage_keys.core.data(core.dataPointer + 1))
  }
  await tx.flush()
}

async function exists (file) {
  try {
    await fsp.lstat(file)
    return true
  } catch (err) {
    if (err.code === 'ENOENT') return false
    throw err
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
  const temp = file + '.' + uuid()
  try {
    await fsp.writeFile(temp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
    await fsp.rename(temp, file)
  } finally { await fsp.rm(temp, { force: true }) }
}

function inside (root, target) {
  return target === root || target.startsWith(root + path.sep)
}

function uuid () {
  return crypto.randomBytes(16).toString('hex')
}
