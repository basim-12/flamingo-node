const fsp = require('bare-fs/promises')
const fss = require('bare-fs')
const process = require('bare-process')
const path = require('bare-path')
const crypto = require('bare-crypto')
const packs = require('./packs')

const { reference } = packs
const NAME = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/
const uuid = () => crypto.randomBytes(16).toString('hex')
const RUN = 'run' // per-bot pidfiles live at ~/.flamingo/run/<name>.pid
const alivePid = pid => { try { process.kill(pid, 0); return true } catch (e) { return e.code === 'EPERM' } }
const usage = `Usage:
  cli pkg +<name> <specifier> | cli pkg <name> --import=<specifier>
  cli pkg <name> [--see] | cli pkg
  cli pkg <name> <dirpath> | cli pkg <name> --export=<dirpath>
  cli pkg -<name>
  cli bot +<name> <specifier>
  cli bot <name> [--see|--run|--end] | cli bot
  cli bot -<name>`

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

// Packages are the packs module's; this keeps the bots and dispatches commands.
class Packages {
  constructor (root) {
    this.packs = packs(root)
    this.root = this.packs.root
    this.bots = Object.create(null)
    this.running = new Map()
    this.saving = Promise.resolve()
  }

  async registries () {
    await this.packs.registries()
    await this.readBots()
  }

  async open () {
    await this.packs.open()
    await this.readBots()
  }

  async readBots () {
    this.bots = Object.assign(Object.create(null), await readJSON(path.join(this.root, 'bots.json')))
  }

  save () {
    // Serialize registry replacements, including updates from running bots.
    this.saving = this.saving.then(() => writeJSON(path.join(this.root, 'bots.json'), this.bots))
    return this.saving
  }

  async close () { await this.saving; await this.packs.close() }

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
    await this.packs.remove(link)
    const id = reference(link).id
    for (const name of Object.keys(this.bots)) if (reference(this.bots[name]).id === id) delete this.bots[name]
    await this.save()
  }

  info (name) {
    const link = this.bots[name]
    if (!link) throw new Error(`Unknown bot: ${name}`)
    return `Name: ${name}\nDrive: ${link}\nPackage: ${this.packs.find(link) || '(unnamed)'}\nStatus: ${this.busy(link) ? 'running' : 'stopped'}`
  }

  async command (cmd, cwd, log) {
    const { kind, action, name, source } = cmd
    if (kind === 'bot') {
      if (action === 'list') return Object.keys(this.bots).sort().map(name => this.info(name)).join('\n\n') || 'No bots.'
      return require('./bot').command(this, cmd, cwd, log)
    }
    if (action === 'list') return this.packs.list().map(name => this.packs.info(name)).join('\n\n') || 'No pkgs.'
    if (action === 'create') await this.packs.create(name, source, cwd)
    if (action === 'delete') {
      if (!this.packs.get(name)) throw new Error(`Unknown package: ${name}`)
      await this.remove(this.packs.get(name))
      return `Deleted: ${name}`
    }
    if (action === 'export') return this.packs.info(name) + '\nExported to: ' + await this.packs.export_to(name, source, cwd)
    return this.packs.info(name)
  }
}
module.exports = { Packages, RUN, usage, parse }
