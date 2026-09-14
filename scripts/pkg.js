const NAME = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/
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

// Map a parsed command onto the packs and tasks APIs.
async function command (pkgs, bots, cmd, cwd, log) {
  const { kind, action, name, source } = cmd
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
  if (action === 'run') return bots.start(name, log)
  if (action === 'end') await bots.end(name)
  if (action === 'delete') {
    await bots.remove(bots.get(name))
    return `Deleted: ${name}`
  }
  return bots.info(name)
}

module.exports = { usage, parse, command }
