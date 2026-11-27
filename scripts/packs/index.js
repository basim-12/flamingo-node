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
const { import_folder, export_folder } = require('../mirror')
const { read_json, write_json, uuid } = require('../json')

const STORAGE = path.join(os.homedir(), '.ds')
const LINK = /^dat:\/\/(\d+)\.(\d+)\.([a-z0-9]+)\.([a-f0-9]{64})(\/[^?]*)?(?:\?(.*))?$/

module.exports = packs
packs.STORAGE = STORAGE
packs.reference = reference
packs.drive_link = drive_link

async function packs (root = STORAGE) {
  let corestore = null
  let saving = Promise.resolve()
  await fsp.mkdir(root, { recursive: true, mode: 0o700 })
  const registry = Object.assign(Object.create(null), await read_json(path.join(root, 'pkgs.json')))
  const caps = await capabilities(root)
  return { root, caps, close, list, get, find, info, source, open_drive, load, core, disk, create, update, drop, export: export_files }

  // opened the first time a function needs a drive: README.md#api
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

  async function core (namespace, name) {
    return (await drives()).namespace(namespace).get({ name })
  }

  async function disk (namespace, name) {
    const drive = new Hyperdrive((await drives()).namespace(namespace).namespace(name))
    await drive.ready()
    return drive
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

  function find (link) {
    const { id } = reference(link)
    return list().find(name => reference(registry[name]).id === id)
  }

  function info (name) {
    if (!registry[name]) throw new Error(`Unknown package: ${name}`)
    return `Name: ${name}\nDrive: ${registry[name]}`
  }

  // ../README.md#specifiers
  async function source (spec) {
    const q = spec.indexOf('?')
    const base = q < 0 ? spec : spec.slice(0, q)
    const options = Object.fromEntries(new URLSearchParams(q < 0 ? '' : spec.slice(q + 1)))
    if (base.startsWith('dat://')) return { link: spec, ...reference(spec) }
    if (/^\.{0,2}\//.test(base)) {
      if (!path.isAbsolute(base)) throw new Error(`Not an absolute path: ${base}`)
      if (!(await exists(base))) throw new Error(`No such file or folder: ${base}`)
      const real = await fsp.realpath(base)
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

  async function load (from, sandbox) {
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
      if (!(await drive.entry(file))) throw new Error(`File not found in the drive: ${from.file}`)
      const fn = await run_from(drive, file, Boolean(from.local), sandbox)
      if (typeof fn !== 'function') throw new Error(`${file} must export a function`)
      return { fn, code }
    } finally { await close() }
  }

  async function create (name, spec, { namespace = 'pkg', prepare } = {}) {
    if (registry[name]) throw new Error(`Package already exists: ${name}`)
    const from = await source(spec)
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

  async function update (drive) {
    const link = await drive_link(drive)
    for (const name of list()) if (reference(registry[name]).id === drive.id) registry[name] = link
    await save()
    return link
  }

  async function drop (name) {
    if (!registry[name]) throw new Error(`Unknown package: ${name}`)
    const { id } = reference(registry[name])
    const opened = await open_drive(registry[name], false)
    await purge(opened.drive)
    for (const other of list()) if (reference(registry[other]).id === id) delete registry[other]
    await save()
  }

  async function export_files (name, dirpath) {
    if (!registry[name]) throw new Error(`Unknown package: ${name}`)
    if (!path.isAbsolute(dirpath)) throw new Error(`Not an absolute path: ${dirpath}`)
    const real = path.join(await fsp.realpath(path.dirname(dirpath)), path.basename(dirpath))
    if (inside(await fsp.realpath(root), real)) throw new Error('Export must be outside managed storage')
    const opened = await open_drive(registry[name], false)
    try { await export_folder(opened.view, real) } finally { await opened.close() }
    return real
  }

  // README.md#code-loaded-from-drives
  async function run_from (drive, file, own, sandbox) {
    const provided = await modules_for(drive, own, sandbox)
    const protocol = new Module.Protocol({
      exists (url) {
        return handled(drive.entry(url.pathname).then(entry => entry !== null))
      },
      read (url) {
        return handled(drive.get(url.pathname).then(data => {
          if (!url.pathname.endsWith('.js')) return data
          const source = data.toString()
          validate_cjs(source, url, provided, caps.allows, Boolean(sandbox))
          return source
        }))
      }
    })
    const loader = new Module.Loader({ protocol, builtins: provided, defaultType: Module.constants.SCRIPT })
    return loader.import(new URL('drive://' + file))
  }

  // which code gets which modules: ../cap/README.md#which-code-gets-what
  // `own` is true for a generator run from a local file
  async function modules_for (drive, own, sandbox) {
    const provided = {}
    const manifest = own || sandbox ? null : await drive.get('/package.json')
    const declared = sandbox ? [] : own ? caps.list() : Object.keys(manifest ? JSON.parse(manifest).dependencies || {} : {})
    for (const name of [...capabilities.BUILTINS, ...declared]) {
      if (provided[name] || !caps.allows(name)) continue
      try {
        provided[name] = require(name) // The host process resolves the name against its own node_modules.
      } catch (err) {
        if (err.code !== 'MODULE_NOT_FOUND') throw err
        throw new Error(`This drive needs ${name}, which is not installed here`)
      }
    }
    if (sandbox) provided.sandbox = sandbox
    return provided
  }
}

function handled (promise) {
  promise.catch(() => {})
  return promise
}

// README.md#code-loaded-from-drives, and the messages in ../cap/README.md#what-a-refused-require-says
function validate_cjs (source, url, provided, allows, strict) {
  const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'script' })
  walk.simple(ast, {
    ImportExpression () {
      throw new SyntaxError(`Dynamic import is disabled: ${url.href}`)
    },
    CallExpression (node) {
      if (node.callee.name !== 'require') return
      const [arg] = node.arguments
      if (arg?.type !== 'Literal' || /^\.{0,2}\//.test(arg.value) || arg.value in provided) return
      if (strict) throw new Error(`A bot's index.js may require only the builtins and sandbox, so ${arg.value} is not there`)
      throw new Error(allows(arg.value)
        ? `Cannot find module '${arg.value}'`
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

function inside (root, target) {
  return target === root || target.startsWith(root + path.sep)
}
