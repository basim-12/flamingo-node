const fs = require('fs')
const fsp = require('fs/promises')
const path = require('path')
const { randomUUID } = require('crypto')
const { pipeline } = require('stream/promises')
const Corestore = require('corestore')
const Hyperdrive = require('hyperdrive')
const storageKeys = require('hypercore-storage/lib/keys')

const usage = `Usage:
  fw pkg +<name> <dirpath> | fw pkg <name> --import=<dirpath>
  fw pkg <name> [--see]
  fw pkg
  fw pkg <name> <dirpath> | fw pkg <name> --export=<dirpath>
  fw pkg -<name>`

// Convert command aliases into one action, package name and optional folder path.
function parse(args) {
  if (!args.length) return { action: 'list' }
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) return { action: 'help' }
  const [first, option] = args
  const prefix = /^[+-]/.test(first) ? first[0] : ''
  const name = prefix ? first.slice(1) : first
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(name) || args.length > 2) {
    throw new Error('Use a name containing letters, numbers, underscores or hyphens.\n' + usage)
  }
  if (prefix === '+' && option && !option.startsWith('--')) return { action: 'import', name, dir: option }
  if (prefix === '-' && !option) return { action: 'delete', name }
  if (prefix) throw new Error(usage)
  if (!option || option === '--see') return { action: 'see', name }
  for (const action of ['import', 'export']) {
    if (option.startsWith(`--${action}=`) && option.length > action.length + 3) {
      return { action, name, dir: option.slice(action.length + 3) }
    }
  }
  if (!option.startsWith('-')) return { action: 'export', name, dir: option }
  throw new Error(usage)
}

// Load and validate the name-to-drive-ID map, starting empty on first use.
async function readRegistry(file) {
  let text
  try {
    text = await fsp.readFile(file, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return Object.create(null)
    throw error
  }
  const registry = JSON.parse(text)
  if (!registry || Array.isArray(registry) || typeof registry !== 'object' ||
    Object.values(registry).some(id => typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id))) {
    throw new Error('Invalid package registry')
  }
  return registry
}

// Replace the registry through a temporary file to avoid partially written JSON.
async function saveRegistry(file, registry) {
  const temp = `${file}.${randomUUID()}.tmp`
  try {
    await fsp.writeFile(temp, JSON.stringify(registry, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
    await fsp.rename(temp, file)
  } finally {
    await fsp.rm(temp, { force: true })
  }
}

// Check whether a resolved path is inside a directory or is the directory itself.
function within(root, target) {
  const relative = path.relative(root, target)
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
}

// Stream files into the drive and record directory entries and permission bits.
async function importFolder(drive, root, relative = '') {
  for (const item of await fsp.readdir(path.join(root, relative), { withFileTypes: true })) {
    const name = relative ? `${relative}/${item.name}` : item.name
    const filename = path.join(root, name)
    const stat = await fsp.lstat(filename)
    const metadata = { mode: stat.mode & 0o777 }
    if (stat.isDirectory()) {
      await drive.put(name, Buffer.alloc(0), { metadata: { ...metadata, directory: true } })
      await importFolder(drive, root, name)
    } else if (stat.isFile()) {
      await pipeline(fs.createReadStream(filename), drive.createWriteStream(name, {
        executable: !!(stat.mode & 0o111), metadata
      }))
    } else {
      throw new Error(`Unsupported entry (only regular files and directories are supported): ${name}`)
    }
  }
}

// Recreate stored files in a new folder and remove incomplete output on failure.
async function exportFolder(drive, destination) {
  // mkdir must succeed before cleanup is allowed to touch this destination.
  await fsp.mkdir(destination, { mode: 0o700 })
  try {
    const directories = []
    for await (const { key, value } of drive.list()) {
      const target = path.resolve(destination, '.' + key)
      if (!key.startsWith('/') || target === destination || !within(destination, target) || value.linkname) {
        throw new Error(`Unsupported drive path: ${key}`)
      }
      const mode = value.metadata?.mode ?? (value.executable ? 0o755 : 0o644)
      if (value.metadata?.directory) {
        await fsp.mkdir(target, { recursive: true })
        directories.push([target, mode])
      } else {
        await fsp.mkdir(path.dirname(target), { recursive: true })
        await pipeline(drive.createReadStream(key), fs.createWriteStream(target, { flags: 'wx', mode: 0o600 }))
        await fsp.chmod(target, mode)
      }
    }
    for (const [target, mode] of directories.reverse()) await fsp.chmod(target, mode)
  } catch (error) {
    await fsp.rm(destination, { recursive: true, force: true })
    throw error
  }
}

// Remove only this drive's local metadata, content and storage aliases.
async function purgeDrive(store, drive) {
  if (require('hypercore-storage/package.json').version !== '3.2.1') {
    throw new Error('Package purge requires hypercore-storage 3.2.1; review purge compatibility before upgrading')
  }
  await drive.ready()
  const keys = [drive.core.discoveryKey, drive.blobs?.core.discoveryKey].filter(Boolean)
  const records = []
  for await (const record of store.storage.createCoreStream()) {
    if (keys.some(key => key.equals(record.discoveryKey))) records.push(record)
  }
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

// Validate paths, open repository storage and dispatch the requested package action.
module.exports = async function pkg(args) {
  const command = parse(args)
  if (command.action === 'help') return console.log(usage)
  const root = path.resolve(__dirname, '../storage')
  await fsp.mkdir(root, { recursive: true, mode: 0o700 })
  const realRoot = await fsp.realpath(root)
  let directory
  if (command.dir) {
    directory = path.resolve(command.dir)
    if (command.action === 'import') {
      directory = await fsp.realpath(directory)
      if (!(await fsp.stat(directory)).isDirectory()) throw new Error('Import source must be a directory')
      if (within(directory, realRoot) || within(realRoot, directory)) throw new Error(`Import source must not overlap storage: ${root}`)
    } else {
      directory = path.join(await fsp.realpath(path.dirname(directory)), path.basename(directory))
      if (within(realRoot, directory)) throw new Error(`Export destination must be outside storage: ${root}`)
    }
  }
  const store = new Corestore(path.join(root, 'corestore'))
  let drive
  try {
    // Acquire Corestore's storage lock before reading or changing the registry.
    await store.ready()
    const registryFile = path.join(root, 'pkgs.json')
    const registry = await readRegistry(registryFile)
    const { name, action } = command
    const exists = Object.hasOwn(registry, name)
    if (action === 'list') {
      for (const name of Object.keys(registry).sort()) console.log(`${name}\t${registry[name]}`)
      if (!Object.keys(registry).length) console.log('No packages.')
      return
    }
    if (action === 'import') {
      if (exists) throw new Error(`Package already exists: ${name}`)
      // A fresh generation avoids reusing a purged drive's signing identity.
      const namespace = store.namespace('pkg').namespace(name).namespace(randomUUID())
      drive = new Hyperdrive(namespace)
      try {
        await drive.ready()
        await importFolder(drive, directory)
        // Register the drive only after every source entry has been imported.
        registry[name] = drive.key.toString('hex')
        await saveRegistry(registryFile, registry)
      } catch (error) {
        await purgeDrive(store, drive)
        throw error
      }
    } else {
      if (!exists) throw new Error(`Unknown package: ${name}`)
      if (action === 'see') return console.log(`Name: ${name}\nDrive ID: ${registry[name]}`)
      // Reopen the existing drive by its saved ID instead of creating a new one.
      drive = new Hyperdrive(store.namespace('pkg').namespace(name), Buffer.from(registry[name], 'hex'))
      await drive.ready()
      if (action === 'export') await exportFolder(drive, directory)
      if (action === 'delete') {
        await purgeDrive(store, drive)
        delete registry[name]
        await saveRegistry(registryFile, registry)
        return console.log(`Deleted: ${name}`)
      }
    }
    console.log(`Name: ${name}\nDrive ID: ${registry[name]}`)
    if (command.action === 'export') console.log(`Exported to: ${directory}`)
  } finally {
    // Release drive sessions and the shared storage lock on success or failure.
    if (drive) await drive.close()
    await store.close()
  }
}
