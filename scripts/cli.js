#!/usr/bin/env bare
const process = require('bare-process')
const remote = require('./remote')
const { foreground } = require('./runtime')

const NAME = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/
const usage = `Usage:
  cli pkg +<name> <specifier> | cli pkg <name> --import=<specifier>
  cli pkg <name> [--see] | cli pkg
  cli pkg <name> <dirpath> | cli pkg <name> --export=<dirpath>
  cli pkg -<name>
  cli bot +<name> <specifier>
  cli bot <name> [--see|--run|--run --attach|--end|--log] | cli bot
  cli bot -<name>
  cli cap [--expand] | cli cap <name>
  cli cap +<name> | cli cap -<name>

<specifier> is a local folder or file, a package name, a drive id or a dat://
reference; add /<file> to run a generator from a drive.
Details: scripts/README.md#specifiers`
async function main () {
  const cmd = parse(process.argv.slice(2))
  if (cmd.action === 'help') return console.log(usage)
  const ds = await remote()
  try {
    const result = await command(ds, cmd, process.cwd())
    console.log(result.done ? await foreground(result) : result)
  } finally {
    await ds.close()
  }
}

// Turn the arguments into { kind, action, name, source }, resolving the aliases.
function parse (args) {
  const [kind, raw, option, ...flags] = args
  const attach = option === '--run' && flags[0] === '--attach'
  if (!['pkg', 'bot', 'cap'].includes(kind) || flags.length > (attach ? 1 : 0)) throw new Error(usage)
  if (raw === '--help' || raw === '-h') return { action: 'help' }
  if (!raw) return { kind, action: 'list' }
  if (kind === 'cap' && raw === '--expand' && !option) return { kind, action: 'expand' }
  const prefix = /^[+-]/.test(raw) ? raw[0] : ''
  const name = prefix ? raw.slice(1) : raw
  if (!NAME.test(name)) throw new Error('Invalid name: use letters, numbers, underscores and hyphens')
  if (kind === 'cap' && prefix === '+' && !option) return { kind, name, action: 'create' }
  if (prefix === '+' && option && !option.startsWith('--')) return { kind, name, action: 'create', source: option }
  if (prefix === '-' && !option) return { kind, name, action: 'delete' }
  if (prefix) throw new Error(usage)
  if (!option || option === '--see') return { kind, name, action: 'see' }
  if (kind === 'bot' && option === '--run') return { kind, name, action: attach ? 'attach' : 'run' }
  if (kind === 'bot' && option === '--end') return { kind, name, action: 'end' }
  if (kind === 'bot' && option === '--log') return { kind, name, action: 'log' }
  if (kind === 'pkg') {
    if (option.startsWith('--import=') && option.slice(9)) return { kind, name, action: 'create', source: option.slice(9) }
    if (option.startsWith('--export=') && option.slice(9)) return { kind, name, action: 'export', source: option.slice(9) }
    if (!option.startsWith('-')) return { kind, name, action: 'export', source: option }
  }
  throw new Error(usage)
}

// Call the runtime function the command asks for, and return what to print.
async function command (ds, { kind, action, name, source }, cwd) {
  if (kind === 'cap') {
    if (action === 'list') return await listing(ds.cap) || 'Nothing granted.'
    if (action === 'expand') return ds.cap.expand()
    if (action === 'create') await ds.cap.grant(name)
    if (action === 'delete') {
      await ds.cap.revoke(name)
      return `Revoked everywhere: ${name}`
    }
    return ds.cap.info(name)
  }
  if (kind === 'pkg') {
    if (action === 'list') return await listing(ds.pkg) || 'No pkgs.'
    if (action === 'create') await ds.pkg.create(name, source, cwd)
    if (action === 'export') return await ds.pkg.info(name) + '\nExported to: ' + await ds.pkg.export_to(name, source, cwd)
    if (action === 'delete') {
      await ds.pkg.remove(name)
      return `Deleted: ${name}`
    }
    return ds.pkg.info(name)
  }
  if (action === 'list') return await listing(ds.bot) || 'No bots.'
  if (action === 'create') {
    await ds.bot.create(name, source, cwd)
    return ds.bot.info(name)
  }
  if (action === 'run') return await ds.bot.run(name) + `\nRunning in the background. Its log: cli bot ${name} --log`
  if (action === 'attach') return ds.bot.attach(name, line => console.log(line))
  if (action === 'log') return await ds.bot.log(name) || 'This bot has logged nothing.'
  if (action === 'end') await ds.bot.end(name)
  if (action === 'delete') {
    await ds.bot.remove(name)
    return `Deleted: ${name}`
  }
  return ds.bot.info(name)
}

// Every package or bot there is, as the same info blocks the single name commands print.
async function listing ({ list, info }) {
  return (await Promise.all((await list()).map(info))).join('\n\n')
}

main()
  .then(() => process.exit(process.exitCode || 0))
  .catch(err => { console.error(err.message); process.exit(1) })
