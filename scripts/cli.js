#!/usr/bin/env bare
const fs = require('bare-fs')
const path = require('bare-path')
const process = require('bare-process')
const { spawn: daemon } = require('bare-daemon')
const packs = require('./packs')
const tasks = require('./tasks')

const NAME = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/
const usage = `Usage:
  cli pkg +<name> <specifier> | cli pkg <name> --import=<specifier>
  cli pkg <name> [--see] | cli pkg
  cli pkg <name> <dirpath> | cli pkg <name> --export=<dirpath>
  cli pkg -<name>
  cli bot +<name> <specifier>
  cli bot <name> [--see|--run|--run --attach|--end] | cli bot
  cli bot -<name>

<specifier> is a local folder or file, a package name, a drive id or a dat://
reference; add /<file> to run a generator from a drive.
Details: scripts/README.md#specifiers`
// These never open the shared store, so they work while a bot is running. `run`
// only launches the background process, which opens the store itself.
const READONLY = new Set(['list', 'see', 'end', 'run'])

async function main () {
  const cmd = parse(process.argv.slice(2))
  if (cmd.action === 'help') return console.log(usage)
  const pkgs = packs()
  const bots = tasks(pkgs)
  if (READONLY.has(cmd.action)) await pkgs.registries()
  else await pkgs.open()
  await bots.registries()
  try {
    const result = await command(pkgs, bots, cmd, process.cwd())
    console.log(result.done ? await foreground(result) : result)
  } finally {
    await bots.close()
    await pkgs.close()
  }
}

// Turn the arguments into { kind, action, name, source }, resolving the aliases.
function parse (args) {
  const [kind, raw, option, ...flags] = args
  const attach = option === '--run' && flags[0] === '--attach'
  if (!['pkg', 'bot'].includes(kind) || flags.length > (attach ? 1 : 0)) throw new Error(usage)
  if (raw === '--help' || raw === '-h') return { action: 'help' }
  if (!raw) return { kind, action: 'list' }
  const prefix = /^[+-]/.test(raw) ? raw[0] : ''
  const name = prefix ? raw.slice(1) : raw
  if (!NAME.test(name)) throw new Error('Invalid name: use letters, numbers, underscores and hyphens')
  if (prefix === '+' && option && !option.startsWith('--')) return { kind, name, action: 'create', source: option }
  if (prefix === '-' && !option) return { kind, name, action: 'delete' }
  if (prefix) throw new Error(usage)
  if (!option || option === '--see') return { kind, name, action: 'see' }
  if (kind === 'bot' && option === '--run') return { kind, name, action: attach ? 'attach' : 'run' }
  if (kind === 'bot' && option === '--end') return { kind, name, action: 'end' }
  if (kind === 'pkg') {
    if (option.startsWith('--import=') && option.slice(9)) return { kind, name, action: 'create', source: option.slice(9) }
    if (option.startsWith('--export=') && option.slice(9)) return { kind, name, action: 'export', source: option.slice(9) }
    if (!option.startsWith('-')) return { kind, name, action: 'export', source: option }
  }
  throw new Error(usage)
}

// Call the packs or tasks function the command asks for, and return what to print.
async function command (pkgs, bots, { kind, action, name, source }, cwd) {
  if (kind === 'pkg') {
    if (action === 'list') return pkgs.list().map(pkgs.info).join('\n\n') || 'No pkgs.'
    if (action === 'create') await pkgs.create(name, source, cwd)
    if (action === 'export') return pkgs.info(name) + '\nExported to: ' + await pkgs.export_to(name, source, cwd)
    if (action === 'delete') {
      if (!pkgs.get(name)) throw new Error(`Unknown package: ${name}`)
      await bots.remove(pkgs.get(name))
      return `Deleted: ${name}`
    }
    return pkgs.info(name)
  }
  if (action === 'list') return bots.list().map(bots.info).join('\n\n') || 'No bots.'
  if (action === 'create') {
    await bots.create(name, source, cwd)
    return bots.info(name)
  }
  if (!bots.get(name)) throw new Error(`Unknown bot: ${name}`)
  if (action === 'run') return background(pkgs, bots, name)
  if (action === 'attach') return bots.start(name, line => console.log(line))
  if (action === 'end') await bots.end(name)
  if (action === 'delete') {
    await bots.remove(bots.get(name))
    return `Deleted: ${name}`
  }
  return bots.info(name)
}

// Start a bot as a daemon: this CLI again with --run --attach, in its own session so
// it outlives this process and the terminal. bare-daemon can't redirect output, so
// `sh -c 'exec …'` sends it to run/<name>.log and then becomes the bot process.
// Return once the bot is running; if it dies before that, fail with what it printed.
async function background (pkgs, bots, name) {
  if (bots.busy(bots.get(name))) throw new Error('This bot is already running')
  const output = path.join(pkgs.root, 'run', name + '.log')
  fs.mkdirSync(path.dirname(output), { recursive: true })
  const { pid } = daemon('/bin/sh', ['-c', 'exec "$@" > "$0" 2>&1', output, process.execPath, __filename, 'bot', name, '--run', '--attach'])
  while (!bots.busy(bots.get(name))) {
    if (!alive(pid)) throw new Error(fs.readFileSync(output, 'utf8').trim())
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  return bots.info(name) + '\nRunning in the background. Output: ' + output
}

function alive (pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

// Hold a running bot in this terminal until it finishes. Ctrl+C sends SIGINT and
// `cli bot <name> --end` sends SIGTERM; either one stops it.
async function foreground ({ done, stop }) {
  process.on('SIGINT', () => stop())
  process.on('SIGTERM', () => stop())
  const keep_alive = setInterval(() => {}, 1 << 30)
  try {
    return await done
  } finally {
    clearInterval(keep_alive)
  }
}

main()
  .then(() => process.exit(process.exitCode || 0))
  .catch(err => { console.error(err.message); process.exit(1) })
