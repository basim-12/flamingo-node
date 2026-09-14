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
const packs = require('./packs')
const tasks = require('./tasks')

const repo = path.join(__dirname, '..')
const code_folder = path.join(repo, 'flamingo-node')
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'flamingo-docs-'))
let export_count = 0
let code_link = ''

function cli (...args) {
  return cli_in(repo, ...args)
}

function cli_in (cwd, ...args) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [path.join(repo, 'scripts', 'cli.js'), ...args], {
      cwd,
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
  await cli('pkg', name, folder)
  return folder
}

function read_json (file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

const unhook = hook('use a throwaway home folder')

test('pkg --help prints the usage', async t => {
  const result = await cli('pkg', '--help')
  t.is(result.code, 0)
  t.ok(result.out.includes('cli pkg +<name> <specifier>'), 'lists the commands')
})

// This CLI is generic and runs on its own under Bare (`bare scripts/cli.js`).
// Flamingo's own `fw` command only runs the Flamingo node; it has no pkg or bot.
test('fw has no pkg or bot commands', async t => {
  const result = await new Promise(resolve => {
    const child = spawn('node', [path.join(repo, 'lib', 'cli.js'), 'pkg'], { stdio: ['ignore', 'pipe', 'ignore'] })
    let out = ''
    child.stdout.on('data', data => { out += data })
    child.on('exit', () => resolve(out))
  })
  t.ok(result.startsWith('Usage: fw up'), 'prints fw usage')
  t.absent(result.includes('pkg'), 'no mention of pkg')
})

// A folder becomes a named drive. The printed reference pins that exact revision,
// and listing or inspecting the package shows the same reference.
test('pkg +<name> <folder> imports a folder as a named drive', async t => {
  const created = await cli('pkg', '+flamingo-node', './flamingo-node')
  t.is(created.code, 0, created.err)
  code_link = drive_of(created)
  t.ok(code_link.startsWith('dat://'), 'prints a dat:// reference')
  t.is(drive_of(await cli('pkg')), code_link, 'listed')
  t.is(drive_of(await cli('pkg', 'flamingo-node', '--see')), code_link, 'inspected')
})

// Names are how everything else refers to a drive, so they must be unique and simple.
test('package names are unique and validated', async t => {
  t.is((await cli('pkg', '+flamingo-node', './flamingo-node')).err, 'Package already exists: flamingo-node')
  t.is((await cli('pkg', '+bad/name', './flamingo-node')).err, 'Invalid name: use letters, numbers, underscores and hyphens')
})

// Export is the way back out: the files come back exactly as they went in.
// It never overwrites, so exporting into an existing folder is refused.
test('pkg <name> <folder> exports the files', async t => {
  const folder = await export_pkg('flamingo-node')
  t.alike(files_of(folder), files_of(code_folder))
  t.is((await cli('pkg', 'flamingo-node', folder)).code, 1, 'existing folder refused')
})

// The flamingo drive carries its own Docker setup, so whoever gets the drive also
// gets the Dockerfile and compose file needed to build and start the node.
test('the flamingo code drive includes its Docker files', async t => {
  const files = files_of(await export_pkg('flamingo-node'))
  t.ok('Dockerfile' in files, 'Dockerfile')
  t.ok('docker-compose.json' in files, 'docker-compose.json')
})

// The same drive can be named three ways: package name, full dat:// reference, or
// drive id. Copying through any of them gives a new drive with the same files.
test('copy specifiers: package name, dat:// reference, drive id', async t => {
  const specs = { 'by-name': 'flamingo-node', 'by-link': code_link, 'by-id': parts_of(code_link).id }
  for (const [name, spec] of Object.entries(specs)) {
    const result = await cli('pkg', '+' + name, spec)
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
  t.is((await cli('pkg', '+x', wrong_hash)).err, 'Drive hash mismatch')
  t.is((await cli('pkg', '+x', wrong_length)).err, 'Referenced drive revision is unavailable')
  t.ok((await cli('pkg', '+x', 'dat://not-a-reference')).err.startsWith('Invalid pinned drive reference'), 'malformed reference refused')
  t.ok((await cli('pkg', '+x', './no-such-folder')).err.startsWith('Unknown package or source'), 'missing source refused')
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
    const result = await cli('pkg', '+' + name, spec)
    t.is(result.code, 0, result.err)
    t.alike(fs.readdirSync(await export_pkg(name)), ['wallet.json'], name)
  }
})

// The one-step way to make a bot: run the generator and register the result.
// A new bot is stopped, and its drive is also kept as a package of the same name.
test('bot +<name> <generator> creates a stopped bot', async t => {
  const created = await cli('bot', '+alice', 'flamingo-node/generate?ask=no')
  t.is(created.code, 0, created.err)
  t.ok(created.out.includes('Status: stopped'), 'starts stopped')
  t.ok((await cli('bot')).out.includes('Name: alice'), 'listed')
  t.is(drive_of(await cli('pkg', 'alice')), drive_of(created), 'kept as a package')
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
  t.is((await cli('bot', '+bob', 'flamingo-node/generate?ask=no')).code, 0)
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
  t.is((await cli('pkg', '+carol-config', folder)).code, 0)
  const result = await cli('bot', '+carol', 'carol-config')
  t.is(result.code, 0, result.err)
  t.is(drive_of(result), drive_of(await cli('pkg', 'carol-config')))
})

// The entry's job is to run the node, not to make an identity. Carol's drive has no
// wallet.json, so --run stops with an error before anything touches Docker.
test('bot <name> --run stops when the bot has no wallet.json', async t => {
  const result = await cli('bot', 'carol', '--run')
  t.is(result.code, 1)
  t.ok(result.err.includes('This bot has no wallet.json'), 'says why')
  t.ok((await cli('bot', 'carol')).out.includes('Status: stopped'), 'not left running')
})

// The flamingo backend isn't in the drive yet; Docker runs it from the local
// flamingo-node folder. So a bot started anywhere else stops with an error
// before anything touches Docker.
test('bot <name> --run must start from the flamingo-node folder', async t => {
  const result = await cli_in(home, 'bot', 'alice', '--run')
  t.is(result.code, 1)
  t.ok(result.err.includes('Run this bot from the flamingo-node folder'), 'says why')
})

// Two bots on one drive would share one wallet and one data folder, so a
// configuration drive belongs to exactly one bot, and it must contain bot.json.
// A bot must pin its code to a drive, so a local folder or local generator file
// is refused. Local paths win over package names, so ./flamingo-node is the folder.
test('bot registration is refused when it would clash', async t => {
  const local = 'A bot needs a drive, not a local path: pass a package name, drive id or dat:// reference'
  t.is((await cli('bot', '+alice', 'flamingo-node/generate?ask=no')).err, 'Bot already exists: alice')
  t.is((await cli('bot', '+dave', 'alice')).err, 'That configuration drive is already used by bot: alice')
  t.is((await cli('bot', '+dave', 'by-link')).err, 'Configuration drive must contain bot.json')
  t.is((await cli('bot', '+dave', './flamingo-node')).err, local, 'local folder refused')
  t.is((await cli('bot', '+dave', './flamingo-node/generate.js')).err, local, 'local generator refused')
})

// Deleting a bot removes its own drive, but never the code it was made from.
test('bot -<name> deletes the bot and its drive, keeping the code', async t => {
  t.is((await cli('bot', '-alice')).out, 'Deleted: alice')
  t.is((await cli('bot', 'alice')).err, 'Unknown bot: alice')
  t.is((await cli('pkg', 'alice')).code, 1, 'its package is gone too')
  t.is(drive_of(await cli('pkg', 'flamingo-node')), code_link, 'code package kept')
})

// Deleting a package removes it and its local data, freeing the name.
test('pkg -<name> deletes a package', async t => {
  t.is((await cli('pkg', '-by-name')).out, 'Deleted: by-name')
  t.is((await cli('pkg', 'by-name')).code, 1)
  t.is((await cli('pkg', '+by-name', 'flamingo-node')).code, 0, 'name is free again')
})

// The pkg commands are a thin layer over the packs module (packs/README.md), which
// works on its own. Here is the same import, export and delete, called as functions.
test('packs module: package operations as plain functions', async t => {
  const pkgs = packs(path.join(home, 'packs-api'))
  await pkgs.open()
  const link = await pkgs.create('code', './flamingo-node', repo)
  t.is(pkgs.get('code'), link, 'registered')
  t.alike(pkgs.list(), ['code'])
  const folder = await pkgs.export_to('code', path.join(home, 'packs-api-export'), repo)
  t.alike(files_of(folder), files_of(code_folder), 'exported')
  await pkgs.remove(link)
  t.alike(pkgs.list(), [], 'removed')
  await pkgs.close()
})

// The bot commands are a thin layer over the tasks module (tasks/README.md), built
// on packs. A task runs in-process: start it, it saves data to its drive, stop it,
// and both the task and its package now point at the revision with that data.
test('tasks module: start a task, let it save, stop it', async t => {
  const code = path.join(home, 'tasks-api-code')
  fs.mkdirSync(code)
  fs.writeFileSync(path.join(code, 'generate.js'), 'module.exports = async function () {}\n')
  fs.writeFileSync(path.join(code, 'main.js'), [
    'module.exports = async function (drive, { stopped }) {',
    "  await drive.put('/hello.txt', Buffer.from('saved while running'))",
    '  await stopped',
    '}'
  ].join('\n'))
  const pkgs = packs(path.join(home, 'tasks-api'))
  const bots = tasks(pkgs)
  await pkgs.open()
  await bots.registries()
  await pkgs.create('code', code, repo)
  const created = await bots.create('hello', 'code/generate', repo)

  await bots.start('hello', () => {})
  t.ok(bots.info('hello').includes('Status: running'), 'running')
  await bots.end('hello')
  t.ok(bots.info('hello').includes('Status: stopped'), 'stopped')

  t.not(bots.get('hello'), created, 'moved to a newer revision')
  t.is(pkgs.get('hello'), bots.get('hello'), 'package moved with it')
  const folder = await pkgs.export_to('hello', path.join(home, 'tasks-api-export'), repo)
  t.is(fs.readFileSync(path.join(folder, 'hello.txt'), 'utf8'), 'saved while running')
  await bots.close()
  await pkgs.close()
})

unhook('remove the throwaway home folder', () => {
  fs.rmSync(home, { recursive: true, force: true })
})
