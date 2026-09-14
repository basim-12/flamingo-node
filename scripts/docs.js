// Executable documentation for the `pkg` and `bot` commands.
//
// Each test runs the real CLI the way a user types it, and its comment says what
// behaviour it pins down. Tests run in order and build on each other, so read it
// top to bottom like a walkthrough. Run with `npm run docs`.
//
// The CLI keeps everything under ~/.flamingo. The tests point HOME at a throwaway
// folder, so real packages and bots are never touched.

const { test, hook } = require('brittle')
const fs = require('bare-fs')
const os = require('bare-os')
const path = require('bare-path')
const process = require('bare-process')
const { spawn } = require('bare-subprocess')
const { validateMnemonic } = require('bip39-mnemonic')

const repo = path.join(__dirname, '..')
const code_folder = path.join(repo, 'flamingo-node')
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'flamingo-docs-'))
let export_count = 0
let code_link = ''

function fw (...args) {
  return new Promise(resolve => {
    const child = spawn('node', [path.join(repo, 'lib', 'cli.js'), ...args], {
      cwd: repo,
      env: { ...process.env, HOME: home },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let out = ''
    let err = ''
    child.stdout.on('data', data => { out += data })
    child.stderr.on('data', data => { err += data })
    child.on('exit', code => resolve({ code, out: out.trim(), err: err.trim() }))
  })
}

function drive_of (result) {
  return result.out.match(/^Drive: (\S+)$/m)[1]
}

// dat://<length>.<fork>.<id>.<hash>
function parts_of (link) {
  const [length, fork, id, hash] = link.slice('dat://'.length).split('.')
  return { length, fork, id, hash }
}

function files_of (folder) {
  const files = {}
  for (const name of fs.readdirSync(folder)) files[name] = fs.readFileSync(path.join(folder, name), 'utf8')
  return files
}

async function export_pkg (name) {
  const folder = path.join(home, 'export-' + ++export_count)
  await fw('pkg', name, folder)
  return folder
}

function read_json (file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

const unhook = hook('use a throwaway home folder')

test('pkg --help prints the usage', async t => {
  const result = await fw('pkg', '--help')
  t.is(result.code, 0)
  t.ok(result.out.includes('fw pkg +<name> <specifier>'), 'lists the commands')
})

// A folder becomes a named drive. The printed reference pins that exact revision,
// and listing or inspecting the package shows the same reference.
test('pkg +<name> <folder> imports a folder as a named drive', async t => {
  const created = await fw('pkg', '+flamingo-node', './flamingo-node')
  t.is(created.code, 0, created.err)
  code_link = drive_of(created)
  t.ok(code_link.startsWith('dat://'), 'prints a dat:// reference')
  t.is(drive_of(await fw('pkg')), code_link, 'listed')
  t.is(drive_of(await fw('pkg', 'flamingo-node', '--see')), code_link, 'inspected')
})

// Names are how everything else refers to a drive, so they must be unique and simple.
test('package names are unique and validated', async t => {
  t.is((await fw('pkg', '+flamingo-node', './flamingo-node')).err, 'Package already exists: flamingo-node')
  t.is((await fw('pkg', '+bad/name', './flamingo-node')).err, 'Invalid name: use letters, numbers, underscores and hyphens')
})

// Export is the way back out: the files come back exactly as they went in.
// It never overwrites, so exporting into an existing folder is refused.
test('pkg <name> <folder> exports the files', async t => {
  const folder = await export_pkg('flamingo-node')
  t.alike(files_of(folder), files_of(code_folder))
  t.is((await fw('pkg', 'flamingo-node', folder)).code, 1, 'existing folder refused')
})

// The same drive can be named three ways: package name, full dat:// reference, or
// drive id. Copying through any of them gives a new drive with the same files.
test('copy specifiers: package name, dat:// reference, drive id', async t => {
  const specs = { 'by-name': 'flamingo-node', 'by-link': code_link, 'by-id': parts_of(code_link).id }
  for (const [name, spec] of Object.entries(specs)) {
    const result = await fw('pkg', '+' + name, spec)
    t.is(result.code, 0, result.err)
    t.alike(files_of(await export_pkg(name)), files_of(code_folder), name)
  }
})

// A reference is a promise about content. If the hash or length doesn't match what
// is stored, the CLI refuses rather than silently using something else.
test('a dat:// reference must match exactly', async t => {
  const { length, fork, id, hash } = parts_of(code_link)
  const wrong_hash = `dat://${length}.${fork}.${id}.${'0'.repeat(64)}`
  const wrong_length = `dat://${Number(length) + 5}.${fork}.${id}.${hash}`
  t.is((await fw('pkg', '+x', wrong_hash)).err, 'Drive hash mismatch')
  t.is((await fw('pkg', '+x', wrong_length)).err, 'Referenced drive revision is unavailable')
  t.ok((await fw('pkg', '+x', 'dat://not-a-reference')).err.startsWith('Invalid pinned drive reference'), 'malformed reference refused')
  t.ok((await fw('pkg', '+x', './no-such-folder')).err.startsWith('Unknown package or source'), 'missing source refused')
})

// Adding /<file> to a specifier runs that file as a generator instead of copying.
// The flamingo generator only writes the app's own data: a fresh wallet.json.
test('generator specifiers run a file from a drive', async t => {
  const specs = {
    'gen-name': 'flamingo-node/generate?ask=no',
    'gen-link': code_link + '/generate?ask=no',
    'gen-id': parts_of(code_link).id + '/generate?ask=no'
  }
  for (const [name, spec] of Object.entries(specs)) {
    const result = await fw('pkg', '+' + name, spec)
    t.is(result.code, 0, result.err)
    t.alike(fs.readdirSync(await export_pkg(name)), ['wallet.json'], name)
  }
})

// The one-step way to make a bot: run the generator and register the result.
// A new bot is stopped, and its drive is also kept as a package of the same name.
test('bot +<name> <generator> creates a stopped bot', async t => {
  const created = await fw('bot', '+alice', 'flamingo-node/generate?ask=no')
  t.is(created.code, 0, created.err)
  t.ok(created.out.includes('Status: stopped'), 'starts stopped')
  t.ok((await fw('bot')).out.includes('Name: alice'), 'listed')
  t.is(drive_of(await fw('pkg', 'alice')), drive_of(created), 'kept as a package')
})

// bot.json tells the CLI what to run. The CLI writes it itself, not the generator:
// the pinned reference of the drive the generator came from, plus its main.js.
// The code can't change under a bot without its reference changing.
test('bot.json pins the code the bot runs', async t => {
  const folder = await export_pkg('alice')
  t.alike(fs.readdirSync(folder).sort(), ['bot.json', 'wallet.json'])
  t.is(read_json(path.join(folder, 'bot.json')).entry, code_link + '/main.js')
})

// Every bot gets its own wallet, so two bots are two separate Lightning identities.
test('each bot gets its own 12-word identity', async t => {
  t.is((await fw('bot', '+bob', 'flamingo-node/generate?ask=no')).code, 0)
  const alice = read_json(path.join(await export_pkg('alice'), 'wallet.json'))
  const bob = read_json(path.join(await export_pkg('bob'), 'wallet.json'))
  t.is(alice.mnemonic.split(' ').length, 12)
  t.ok(validateMnemonic(alice.mnemonic), 'a valid BIP39 phrase')
  t.not(alice.mnemonic, bob.mnemonic)
})

// A configuration drive is just a drive with a bot.json in it, so it can also be
// written by hand, imported as a package, and then registered as a bot as it is.
test('bot +<name> <config drive> uses an existing configuration drive', async t => {
  const folder = path.join(home, 'carol-config')
  fs.mkdirSync(folder)
  fs.writeFileSync(path.join(folder, 'bot.json'), JSON.stringify({ entry: code_link + '/main.js' }))
  t.is((await fw('pkg', '+carol-config', folder)).code, 0)
  const result = await fw('bot', '+carol', 'carol-config')
  t.is(result.code, 0, result.err)
  t.is(drive_of(result), drive_of(await fw('pkg', 'carol-config')))
})

// The entry's job is to run the node, not to make an identity. Carol's drive has no
// wallet.json, so --run stops with an error before anything touches Docker.
test('bot <name> --run stops when the bot has no wallet.json', async t => {
  const result = await fw('bot', 'carol', '--run')
  t.is(result.code, 1)
  t.ok(result.err.includes('This bot has no wallet.json'), 'says why')
  t.ok((await fw('bot', 'carol')).out.includes('Status: stopped'), 'not left running')
})

// Two bots on one drive would share one wallet and one data folder, so a
// configuration drive belongs to exactly one bot, and it must contain bot.json.
// A bot must pin its code to a drive, so a local folder or local generator file
// is refused. Local paths win over package names, so ./flamingo-node is the folder.
test('bot registration is refused when it would clash', async t => {
  const local = 'A bot needs a drive, not a local path: pass a package name, drive id or dat:// reference'
  t.is((await fw('bot', '+alice', 'flamingo-node/generate?ask=no')).err, 'Bot already exists: alice')
  t.is((await fw('bot', '+dave', 'alice')).err, 'That configuration drive is already used by bot: alice')
  t.is((await fw('bot', '+dave', 'by-link')).err, 'Configuration drive must contain bot.json')
  t.is((await fw('bot', '+dave', './flamingo-node')).err, local, 'local folder refused')
  t.is((await fw('bot', '+dave', './flamingo-node/generate.js')).err, local, 'local generator refused')
})

// Deleting a bot removes its own drive, but never the code it was made from.
test('bot -<name> deletes the bot and its drive, keeping the code', async t => {
  t.is((await fw('bot', '-alice')).out, 'Deleted: alice')
  t.is((await fw('bot', 'alice')).err, 'Unknown bot: alice')
  t.is((await fw('pkg', 'alice')).code, 1, 'its package is gone too')
  t.is(drive_of(await fw('pkg', 'flamingo-node')), code_link, 'code package kept')
})

// Deleting a package removes it and its local data, freeing the name.
test('pkg -<name> deletes a package', async t => {
  t.is((await fw('pkg', '-by-name')).out, 'Deleted: by-name')
  t.is((await fw('pkg', 'by-name')).code, 1)
  t.is((await fw('pkg', '+by-name', 'flamingo-node')).code, 0, 'name is free again')
})

unhook('remove the throwaway home folder', () => {
  fs.rmSync(home, { recursive: true, force: true })
})
