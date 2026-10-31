const fsp = require('bare-fs/promises')
const path = require('bare-path')
const os = require('bare-os')
const { URLSearchParams } = require('bare-url')
const Module = require('bare-module')
const Corestore = require('corestore')
const Hyperdrive = require('hyperdrive')
const Localdrive = require('localdrive')
const MirrorDrive = require('mirror-drive')
const id_encoding = require('hypercore-id-encoding')
const acorn = require('acorn')
const walk = require('acorn-walk')
const capabilities = require('../cap')
const { read_json, write_json, uuid } = require('../json')

const ROOT = path.join(os.homedir(), '.ds')
const LINK = /^dat:\/\/(\d+)\.(\d+)\.([a-z0-9]+)\.([a-f0-9]{64})(\/[^?]*)?(?:\?(.*))?$/

module.exports = packs
packs.ROOT = ROOT
packs.reference = reference
packs.drive_link = drive_link

async function packs (root = ROOT) {
  let corestore = null
  let saving = Promise.resolve()
  await fsp.mkdir(root, { recursive: true, mode: 0o700 })
  const registry = Object.assign(Object.create(null), await read_json(path.join(root, 'pkgs.json')))
  const caps = await capabilities(root)
  return { root, caps, close, list, get, find, info, source, open_drive, load, core, create, update, remove, export_to }

  // The shared store, opened the first time a drive is touched. Reading names never
  // opens it, so inspecting works while a running bot holds its lock.
  async function drives () {
    if (corestore === null) {
      corestore = new Corestore(path.join(root, 'corestore'))
      await corestore.ready().catch(err => {
        throw err.code === 'ELOCKED' ? new Error('Drive storage is in use by another process, such as a running bot') : err
      })
    }
    return corestore
  }

  async function close () {
    await saving
    if (corestore !== null) await corestore.close()
  }

  // A plain hypercore in its own namespace, for what a task keeps outside its drive.
  async function core (namespace, name) {
    return (await drives()).namespace(namespace).get({ name })
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

  // Resolve a <specifier>: a local folder or file (`./x`, `../x`, `/x`), a dat://
  // reference, a package name or a drive id, each optionally followed by /<file> to
  // run a generator. A path says so, so the forms never overlap.
  async function source (spec, cwd) {
    const q = spec.indexOf('?')
    const base = q < 0 ? spec : spec.slice(0, q)
    const options = Object.fromEntries(new URLSearchParams(q < 0 ? '' : spec.slice(q + 1)))
    if (base.startsWith('dat://')) return { link: spec, ...reference(spec) }
    if (/^\.{0,2}\//.test(base)) {
      const local = path.resolve(cwd, base)
      if (!(await exists(local))) throw new Error(`No such file or folder: ${base}`)
      const real = await fsp.realpath(local)
      const storage = await fsp.realpath(root)
      if (inside(real, storage) || inside(storage, real)) throw new Error('Source must not overlap managed storage')
      return { local: real, generator: (await fsp.stat(real)).isFile(), options }
    }
    const [head, ...parts] = base.split('/')
    const file = parts.length ? '/' + parts.join('/') : ''
    if (registry[head]) return { link: registry[head], file, options }
    if (id_encoding.isValid(head)) {
      const registered = Object.values(registry).find(link => reference(link).id === head)
      if (registered) return { link: registered, file, options }
      const store = await drives()
      if (await known(store, head)) {
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
    const store = await drives()
    if (!(await known(store, ref.id))) throw new Error(`Drive is not available locally: ${ref.id}`)
    const drive = new Hyperdrive(store.session(), ref.id)
    await drive.ready()
    try {
      if (drive.core.fork !== ref.fork || drive.core.length < ref.length) throw new Error('Referenced drive revision is unavailable')
      if ((await drive.core.treeHash(ref.length)).toString('hex') !== ref.hash) throw new Error('Drive hash mismatch')
      const view = pinned ? drive.checkout(ref.length) : drive
      await view.ready()
      return { drive, view, ref, close: async () => { if (pinned) await view.close(); await drive.close() } }
    } catch (err) { await drive.close(); throw err }
  }

  // Load the function a generator or entry file exports, reading the code straight
  // from its drive at the pinned revision (or from its local folder); nothing is
  // copied to disk. `code` is the drive's pinned reference.
  async function load (from) {
    let drive
    let file
    let code = null
    let close = async () => { }
    if (from.local) {
      drive = new Localdrive(path.dirname(from.local))
      file = '/' + path.basename(from.local)
    } else {
      const opened = await open_drive(from.link)
      drive = opened.view
      close = opened.close
      code = `dat://${opened.ref.length}.${opened.ref.fork}.${opened.ref.id}.${opened.ref.hash}`
      file = from.file
    }
    try {
      if (!(await drive.entry(file)) && await drive.entry(file + '.js')) file += '.js'
      if (!(await drive.entry(file))) throw new Error(`Generator/entry file not found in the drive: ${from.file}`)
      const fn = await run_from(drive, file)
      if (typeof fn !== 'function') throw new Error('Entry must export a function')
      return { fn, code }
    } finally { await close() }
  }

  // Make a new named drive from a <specifier>: copy a folder or drive, or run a
  // generator into it. `prepare(drive, code)` runs after that and before the drive
  // is registered; `code` is the generator's pinned drive reference, if any.
  async function create (name, spec, cwd, { namespace = 'pkg', prepare } = {}) {
    if (registry[name]) throw new Error(`Package already exists: ${name}`)
    const from = await source(spec, cwd)
    const store = await drives()
    const drive = new Hyperdrive(store.namespace(namespace).namespace(name).namespace(uuid()))
    await drive.ready()
    try {
      let code = null
      if (from.generator || from.file) {
        const generator = await load(from)
        code = generator.code
        await generator.fn(drive, from.options)
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
      await purge(drive)
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
    await purge(opened.drive)
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

  // Evaluate a module graph read straight from drive with bare module's Loader.
  // Every file goes through the drive. What it may require comes in as builtins.
  async function run_from (drive, file) {
    const provided = await modules_for(drive)
    const protocol = new Module.Protocol({
      async exists (url) {
        return (await drive.entry(url.pathname)) !== null
      },
      async read (url) {
        const data = await drive.get(url.pathname)
        if (!url.pathname.endsWith('.js')) return data
        const source = data.toString()
        validate_cjs(source, url, provided, caps.allows)
        return source
      }
    })
    const loader = new Module.Loader({ protocol, builtins: provided, defaultType: Module.constants.SCRIPT })
    return loader.import(new URL('drive://' + file))
  }

  // What code in a drive may require: the builtins, plus whatever its own package.json
  // declares and has been granted. Declaring is not granting, so anything ungranted is
  // left out and the require that wants it says so.
  async function modules_for (drive) {
    const provided = {}
    const manifest = await drive.get('/package.json')
    const declared = Object.keys(manifest ? JSON.parse(manifest).dependencies || {} : {})
    for (const name of [...capabilities.BUILTINS, ...declared]) {
      if (provided[name] || !caps.allows(name)) continue
      try {
        provided[name] = require(name) // The host process resolves the name against its own node_modules.
      } catch (err) {
        if (err.code !== 'MODULE_NOT_FOUND') throw err
        throw new Error(`This drive needs ${name}, which is not installed here`)
      }
    }
    return provided
  }
}

// A dynamic import() would load code around the Loader, so drive code may not use it.
// A require of something it does not have is caught here too: the Loader would otherwise
// go looking for it in the drive and fail without ever naming it.
function validate_cjs (source, url, provided, allows) {
  const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'script' })
  walk.simple(ast, {
    ImportExpression () {
      throw new SyntaxError(`Dynamic import is disabled: ${url.href}`)
    },
    CallExpression (node) {
      if (node.callee.name !== 'require') return
      const [arg] = node.arguments
      if (arg?.type !== 'Literal' || /^\.{0,2}\//.test(arg.value) || arg.value in provided) return
      throw new Error(allows(arg.value)
        ? `This drive requires ${arg.value} without declaring it in package.json`
        : `This drive requires ${arg.value}, which it was not granted`)
    }
  })
}

function reference (link) {
  const m = LINK.exec(link)
  if (!m) throw new Error(`Invalid pinned drive reference: ${link}`)
  return { length: Number(m[1]), fork: Number(m[2]), id: m[3], hash: m[4], file: m[5] || '', options: Object.fromEntries(new URLSearchParams(m[6] || '')) }
}

async function drive_link (drive) {
  const hash = await drive.core.treeHash(drive.core.length)
  return `dat://${drive.core.length}.${drive.core.fork}.${drive.id}.${hash.toString('hex')}`
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
      if (value.metadata?.directory) {
        const dest = path.join(folder, key)
        await fsp.mkdir(dest, { recursive: true })
        dirs.push([dest, value.metadata.mode])
      }
    }
    await new MirrorDrive(drive, new Localdrive(folder, { metadata }), {
      prune: false, preload: false, filter: key => !dirs.some(([dir]) => dir === path.join(folder, key))
    }).done()
    for (const [key, meta] of metadata) if (meta?.mode !== undefined) await fsp.chmod(path.join(folder, key), meta.mode)
    for (const [dir, mode] of dirs.reverse()) await fsp.chmod(dir, mode)
  } catch (err) {
    await fsp.rm(folder, { recursive: true, force: true })
    throw err
  }
}

// Whether a drive's data is already here. Corestore has no "do you have this?" call, so
// open its core without letting it be created: a missing one says so on ready().
async function known (store, id) {
  const core = store.get({ key: id_encoding.decode(id), createIfMissing: false })
  try {
    await core.ready()
  } catch (err) {
    if (err.code !== 'STORAGE_EMPTY') throw err
    return false
  }
  await core.close()
  return true
}

// Delete a drive's data: the files it holds and the metadata that lists them.
async function purge (drive) {
  await drive.ready()
  const blobs = await drive.getBlobs()
  await drive.close()
  await blobs.core.purge()
  await drive.core.purge()
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

// Write to a temporary file and rename it, so a crash never leaves half a registry.
function inside (root, target) {
  return target === root || target.startsWith(root + path.sep)
}
