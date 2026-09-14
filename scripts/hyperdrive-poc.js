#!/usr/bin/env bare

const Corestore = require('corestore')
const Hyperdrive = require('hyperdrive')
const fs = require('bare-fs')
const fsp = require('bare-fs/promises')
const path = require('bare-path')
const process = require('bare-process')
const crypto = require('bare-crypto')
const b4a = require('b4a')
const { Transform } = require('bare-stream')
const { pipeline } = require('bare-stream/promises')

const FORMAT = 'flamingo-hyperdrive-poc/v1'

// Print the available commands and their required safety conditions
function usage () {
  console.log(`Flamingo Hyperdrive backup PoC

Usage:
  bare scripts/hyperdrive-poc.js backup [--config bot.json]
  bare scripts/hyperdrive-poc.js restore [--config bot.json] [--target <dir>]
  bare scripts/hyperdrive-poc.js verify [--config bot.json] [--target <dir>]

Stop Bitcoin and Lightning cleanly before backup or restore.`)
}

// Convert command line arguments into a small options object
function parseArgs (argv) {
  const args = { _: [] }
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index]
    if (!value.startsWith('--')) args._.push(value)
    else args[value.slice(2)] = argv[++index]
  }
  return args
}

// Check whether a file or directory exists without throwing an error
async function exists (filename) {
  try {
    await fsp.access(filename)
    return true
  } catch {
    return false
  }
}

// Read bot.json and resolve its data and backup paths
async function loadConfig (filename = 'bot.json') {
  const configFile = path.resolve(filename)
  const config = JSON.parse(await fsp.readFile(configFile, 'utf8'))
  if (config.format !== FORMAT) throw new Error(`Unsupported bot config: ${config.format}`)
  const root = path.dirname(configFile)
  return {
    ...config,
    configFile,
    dataDir: path.resolve(root, config.dataDir),
    storeDir: path.resolve(root, config.storeDir)
  }
}

// Refuse a backup unless Bitcoin and Lightning finished their latest shutdown
async function requireCleanShutdown (dataDir) {
  const checks = [
    {
      name: 'Bitcoin Core',
      log: path.join(dataDir, 'bitcoin', 'regtest', 'debug.log'),
      started: 'Bitcoin Core version',
      stopped: 'Shutdown: done'
    }
  ]
  for (const node of ['lightning4', 'lightning5', 'lightning6']) {
    const nodeDir = path.join(dataDir, node)
    if (await exists(nodeDir)) {
      checks.push({
        name: node,
        log: path.join(nodeDir, 'debug.log'),
        started: 'Server started with public key',
        stopped: 'JSON-RPC shutdown'
      })
    }
  }
  for (const check of checks) {
    if (!(await exists(check.log))) throw new Error(`${check.name} shutdown log is missing`)
    const log = await fsp.readFile(check.log, 'utf8')
    if (log.lastIndexOf(check.stopped) < log.lastIndexOf(check.started)) {
      throw new Error(`${check.name} was not cleanly stopped; refusing an unsafe backup`)
    }
  }
}

// Recognize temporary files that should not be included in a backup
function runtimeOnly (name) {
  const base = path.basename(name)
  return base === '.lock' || base.endsWith('.pid') || base.endsWith('.sock') || base.endsWith('.socket')
}

// Recursively collect persistent files, directories, and skipped entries
async function walk (root, relative = '', output = { directories: [], files: [], skipped: [] }) {
  const entries = await fsp.readdir(path.join(root, relative), { withFileTypes: true })
  for (const entry of entries) {
    const name = relative ? path.join(relative, entry.name) : entry.name
    if (runtimeOnly(name)) {
      output.skipped.push(name)
      continue
    }
    const filename = path.join(root, name)
    const stat = await fsp.lstat(filename)
    if (entry.isDirectory()) {
      output.directories.push({ path: name, mode: stat.mode & 0o777 })
      await walk(root, name, output)
    } else if (entry.isFile()) {
      output.files.push({ path: name, mode: stat.mode & 0o777, size: stat.size })
    } else {
      throw new Error(`Unsupported data entry: ${name}`)
    }
  }
  return output
}

// Pass file data through a stream while calculating its SHA-256 hash
function hashStream (hash) {
  return new Transform({
    transform (chunk, encoding, callback) {
      hash.update(chunk)
      callback(null, chunk)
    }
  })
}

// Ensure a restored path cannot escape the selected destination directory
function safeTarget (root, relative) {
  const target = path.resolve(root, relative)
  if (target !== root && !target.startsWith(root + path.sep)) throw new Error(`Unsafe backup path: ${relative}`)
  return target
}

// Open the Hyperdrive stored in the configured local Corestore directory
async function openDrive (storeDir) {
  const store = new Corestore(storeDir)
  const drive = new Hyperdrive(store)
  await drive.ready()
  return { store, drive }
}

// Close the Hyperdrive and its Corestore
async function closeDrive ({ store, drive }) {
  try { await drive.close() } finally { await store.close() }
}

// Stream stopped node data into Hyperdrive and save its file manifest
async function backup (config) {
  if (!(await exists(config.dataDir))) throw new Error(`Node data directory does not exist: ${config.dataDir}`)
  await requireCleanShutdown(config.dataDir)
  if (await exists(config.storeDir) && (await fsp.readdir(config.storeDir)).length) {
    throw new Error(`Backup store must be new or empty: ${config.storeDir}`)
  }
  const relativeStore = path.relative(config.dataDir, config.storeDir)
  if (!relativeStore.startsWith('..') && !path.isAbsolute(relativeStore)) {
    throw new Error('Backup store cannot be inside the node data directory')
  }

  await fsp.mkdir(config.storeDir, { recursive: true })
  const opened = await openDrive(config.storeDir)
  try {
    const tree = await walk(config.dataDir)
    const manifest = { format: FORMAT, createdAt: new Date().toISOString(), directories: tree.directories, files: [], skipped: tree.skipped }
    for (const file of tree.files) {
      const hash = crypto.createHash('sha256')
      await pipeline(
        fs.createReadStream(path.join(config.dataDir, file.path)),
        hashStream(hash),
        opened.drive.createWriteStream(`/data/${file.path}`, { metadata: { mode: file.mode } })
      )
      manifest.files.push({ ...file, sha256: hash.digest('hex') })
    }
    const publicConfig = JSON.parse(await fsp.readFile(config.configFile, 'utf8'))
    await opened.drive.put('/bot.json', b4a.from(JSON.stringify(publicConfig, null, 2) + '\n'))
    await opened.drive.put('/manifest.json', b4a.from(JSON.stringify(manifest, null, 2) + '\n'))
    console.log(`Backup complete: ${manifest.files.length} files`)
    console.log(`Hyperdrive key: ${b4a.toString(opened.drive.key, 'hex')}`)
    return manifest
  } finally {
    await closeDrive(opened)
  }
}

// Load and validate the backup manifest stored inside Hyperdrive
async function readManifest (drive) {
  const data = await drive.get('/manifest.json')
  if (!data) throw new Error('Backup manifest is missing')
  const manifest = JSON.parse(b4a.toString(data))
  if (manifest.format !== FORMAT) throw new Error('Unsupported backup format')
  return manifest
}

// Recreate the node data directory from the files stored in Hyperdrive
async function restore (config, targetName) {
  const target = path.resolve(targetName || config.dataDir)
  if (await exists(target) && (await fsp.readdir(target)).length) {
    throw new Error(`Restore target must be empty: ${target}`)
  }
  await fsp.mkdir(target, { recursive: true })
  const opened = await openDrive(config.storeDir)
  try {
    const manifest = await readManifest(opened.drive)
    for (const directory of manifest.directories) {
      await fsp.mkdir(safeTarget(target, directory.path), { recursive: true, mode: directory.mode })
    }
    for (const file of manifest.files) {
      const destination = safeTarget(target, file.path)
      await fsp.mkdir(path.dirname(destination), { recursive: true })
      const temporary = destination + '.restore'
      const hash = crypto.createHash('sha256')
      await pipeline(
        opened.drive.createReadStream(`/data/${file.path}`),
        hashStream(hash),
        fs.createWriteStream(temporary, { mode: file.mode })
      )
      if (hash.digest('hex') !== file.sha256) throw new Error(`Restore verification failed: ${file.path}`)
      await fsp.rename(temporary, destination)
      try { await fsp.chmod(destination, file.mode) } catch { }
    }
    console.log(`Restore complete: ${manifest.files.length} files`)
    return manifest
  } finally {
    await closeDrive(opened)
  }
}

// Compare every restored file with the hash recorded during backup
async function verify (config, targetName) {
  const target = path.resolve(targetName || config.dataDir)
  const opened = await openDrive(config.storeDir)
  try {
    const manifest = await readManifest(opened.drive)
    for (const file of manifest.files) {
      const filename = safeTarget(target, file.path)
      if (!(await exists(filename))) throw new Error(`Restored file is missing: ${file.path}`)
      const hash = crypto.createHash('sha256')
      for await (const chunk of fs.createReadStream(filename)) hash.update(chunk)
      if (hash.digest('hex') !== file.sha256) throw new Error(`Restored file differs: ${file.path}`)
    }
    console.log(`Verification passed: ${manifest.files.length} files match`)
    return manifest
  } finally {
    await closeDrive(opened)
  }
}

async function main (argv = process.argv.slice(2)) {
  const args = parseArgs(argv)
  const command = args._[0]
  if (!command || command === 'help') return usage()
  const config = await loadConfig(args.config)
  if (command === 'backup') return backup(config)
  if (command === 'restore') return restore(config, args.target)
  if (command === 'verify') return verify(config, args.target)
  throw new Error(`Unknown command: ${command}`)
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.message)
    process.exitCode = 1
  })
}

module.exports = { loadConfig, backup, restore, verify }
