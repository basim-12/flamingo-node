// Executable documentation for the `pkg` and `bot` commands.
//
// Each test runs the real CLI the way a user types it, and its comment says what
// behaviour it pins down. Tests run in order and build on each other, so read it
// top to bottom like a walkthrough. Run with `npm run docs`.
//
// Everything here is about the CLI itself, so the code it runs is a throwaway
// sample made below, never Flamingo's. Flamingo's own tests are in ../docs.js.
//
// The CLI keeps everything under ~/.flamingo. The tests point HOME at a throwaway
// folder, so real packages and bots are never touched.

const { test, hook } = require('brittle')
const fs = require('bare-fs')
const os = require('bare-os')
const path = require('bare-path')
const process = require('bare-process')
const { spawn } = require('bare-subprocess')
const packs = require('./packs')
const tasks = require('./tasks')

const repo = path.join(__dirname, '..')
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-docs-'))
const sample = path.join(home, 'sample')
let export_count = 0
let code_link = ''

// A code package of our own: a generator that writes config.json, and an entry that
// saves a file, waits to be stopped, and says so on the way in and out.
fs.mkdirSync(sample)
fs.writeFileSync(path.join(sample, 'generate.js'), [
  'module.exports = async function (drive, options) {',
  "  await drive.put('/config.json', Buffer.from(JSON.stringify(options)))",
  '}'
].join('\n') + '\n')
fs.writeFileSync(path.join(sample, 'main.js'), [
  'module.exports = async function (drive, { stopped, log }) {',
  "  await drive.put('/data.txt', Buffer.from('saved while running'))",
  "  log('sample started')",
  '  await stopped',
  "  log('sample stopping')",
  '}'
].join('\n') + '\n')
fs.writeFileSync(path.join(sample, 'notes.txt'), 'anything else in the folder travels too\n')

function cli (...args) {
  return launch(repo, args).exited
}

function cli_in (cwd, ...args) {
  return launch(cwd, args).exited
}

// Start the CLI and hand back both the process and a promise of its output.
function launch (cwd, args) {
  const child = spawn(process.execPath, [path.join(repo, 'scripts', 'cli.js'), ...args], {
    cwd,
    env: { ...process.env, HOME: home },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let out = ''
  let err = ''
  child.stdout.on('data', data => { out += data })
  child.stderr.on('data', data => { err += data })
  const exited = new Promise(resolve => child.on('exit', code => resolve({ code, out: out.trim(), err: err.trim() })))
  return { child, exited }
}

// Wait up to ten seconds for `check` to come true.
async function until (check) {
  for (let i = 0; i < 100; i++) {
    if (await check()) return true
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  return false
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

// The help names the commands and says what a <specifier> can be, then points to
// the README section with the full table. That section has to exist for the link.
test('pkg --help prints the usage and links the specifier details', async t => {
  const result = await cli('pkg', '--help')
  t.is(result.code, 0)
  t.ok(result.out.includes('cli pkg +<name> <specifier>'), 'lists the commands')
  t.ok(result.out.includes('Details: scripts/README.md#specifiers'), 'links the details')
  t.ok(fs.readFileSync(path.join(repo, 'scripts', 'README.md'), 'utf8').includes('\n## Specifiers\n'), 'the linked section exists')
})

// A folder becomes a named drive. The printed reference pins that exact revision,
// and listing or inspecting the package shows the same reference.
test('pkg +<name> <folder> imports a folder as a named drive', async t => {
  const created = await cli('pkg', '+sample', sample)
  t.is(created.code, 0, created.err)
  code_link = drive_of(created)
  t.ok(code_link.startsWith('dat://'), 'prints a dat:// reference')
  t.is(drive_of(await cli('pkg')), code_link, 'listed')
  t.is(drive_of(await cli('pkg', 'sample', '--see')), code_link, 'inspected')
})

// Names are how everything else refers to a drive, so they must be unique and simple.
test('package names are unique and validated', async t => {
  t.is((await cli('pkg', '+sample', sample)).err, 'Package already exists: sample')
  t.is((await cli('pkg', '+bad/name', sample)).err, 'Invalid name: use letters, numbers, underscores and hyphens')
})

// Export is the way back out: every file comes back exactly as it went in.
// It never overwrites, so exporting into an existing folder is refused.
test('pkg <name> <folder> exports the files', async t => {
  const folder = await export_pkg('sample')
  t.alike(files_of(folder), files_of(sample))
  t.is((await cli('pkg', 'sample', folder)).code, 1, 'existing folder refused')
})

// The same drive can be named three ways: package name, full dat:// reference, or
// drive id. Copying through any of them gives a new drive with the same files.
test('copy specifiers: package name, dat:// reference, drive id', async t => {
  const specs = { 'by-name': 'sample', 'by-link': code_link, 'by-id': parts_of(code_link).id }
  for (const [name, spec] of Object.entries(specs)) {
    const result = await cli('pkg', '+' + name, spec)
    t.is(result.code, 0, result.err)
    t.alike(files_of(await export_pkg(name)), files_of(sample), name)
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
  t.is((await cli('pkg', '+x', './no-such-folder')).err, 'No such file or folder: ./no-such-folder')
})

// A path says so: it starts with ./, ../ or /. A bare name is a package or a drive id,
// never a folder, so the forms can't overlap. `plain` here is a folder, not a package.
test('a local path must start with ./, ../ or /', async t => {
  fs.mkdirSync(path.join(home, 'plain'))
  fs.writeFileSync(path.join(home, 'plain', 'file.txt'), 'in a folder\n')
  t.is((await cli_in(home, 'pkg', '+from-path', './plain')).code, 0, 'a path is a path')
  t.is((await cli_in(home, 'pkg', '+from-name', 'plain')).err, 'Unknown package or source: plain', 'a name is never a folder')
})

// Adding /<file> to a specifier runs that file as a generator instead of copying.
// Options after ? reach the generator, which writes whatever the app needs.
test('generator specifiers run a file from a drive', async t => {
  const specs = {
    'gen-name': 'sample/generate?ask=no',
    'gen-link': code_link + '/generate?ask=no',
    'gen-id': parts_of(code_link).id + '/generate?ask=no'
  }
  for (const [name, spec] of Object.entries(specs)) {
    const result = await cli('pkg', '+' + name, spec)
    t.is(result.code, 0, result.err)
    const folder = await export_pkg(name)
    t.alike(fs.readdirSync(folder), ['config.json'], name)
    t.alike(read_json(path.join(folder, 'config.json')), { ask: 'no' }, 'options reached the generator')
  }
})

// Generators and entries run straight from their drive: bare-module's Loader reads
// every file through the drive, so nothing is copied to disk first. A dynamic
// import() would load code around the Loader, so it is refused.
test('drive code runs straight from the drive; dynamic import() is refused', async t => {
  const code = path.join(home, 'sneaky-code')
  fs.mkdirSync(code)
  fs.writeFileSync(path.join(code, 'generate.js'), "module.exports = async function () { await import('bare-fs') }\n")
  t.is((await cli('pkg', '+sneaky-code', code)).code, 0)
  const result = await cli('pkg', '+sneaky', 'sneaky-code/generate')
  t.ok(result.err.startsWith('Dynamic import is disabled'), 'refused')
  t.absent(fs.existsSync(path.join(home, '.flamingo', 'code')), 'no code was copied to disk')
})

// The one-step way to make a bot: run the generator and register the result.
// A new bot is stopped, and its drive is also kept as a package of the same name.
test('bot +<name> <generator> creates a stopped bot', async t => {
  const created = await cli('bot', '+alice', 'sample/generate?ask=no')
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
  t.alike(fs.readdirSync(folder).sort(), ['bot.json', 'config.json'])
  t.is(read_json(path.join(folder, 'bot.json')).entry, code_link + '/main.js')
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

// --run starts a bot as a background daemon and gives the terminal back; the bot
// keeps running after this command exits. Its output goes to run/<name>.log.
// Status shows it running, a second --run is refused, and --end stops it.
test('bot <name> --run starts it in the background; --end stops it', async t => {
  const started = await cli('bot', 'alice', '--run')
  t.is(started.code, 0, started.err)
  t.ok(started.out.includes('Status: running'), 'returns with the bot running')
  const output = path.join(home, '.flamingo', 'run', 'alice.log')
  t.ok(await until(() => fs.readFileSync(output, 'utf8').includes('sample started')), 'its output goes to the log')
  t.ok((await cli('bot', 'alice')).out.includes('Status: running'), 'still running after --run exited')
  t.is((await cli('bot', 'alice', '--run')).err, 'This bot is already running')

  t.ok((await cli('bot', 'alice', '--end')).out.includes('Status: stopped'), '--end stops it')
  t.ok(fs.readFileSync(output, 'utf8').includes('sample stopping'), 'and it shut down cleanly')
})

// --run --attach runs the bot in this terminal instead, until Ctrl+C (SIGINT).
test('bot <name> --run --attach runs it in the foreground; Ctrl+C stops it', async t => {
  const attached = launch(repo, ['bot', 'alice', '--run', '--attach'])
  t.ok(await until(async () => (await cli('bot', 'alice')).out.includes('Status: running')), 'running')
  attached.child.kill('SIGINT')
  const result = await attached.exited
  t.is(result.code, 0)
  t.ok(result.out.includes('sample stopping'), 'shut down cleanly')
})

// What a running bot saves is kept: the drive moves to a new revision, and the bot
// and its package both point at it.
test('what a bot saves while running is kept', async t => {
  const folder = await export_pkg('alice')
  t.is(read_json(path.join(folder, 'bot.json')).entry, code_link + '/main.js', 'still the same code')
  t.is(fs.readFileSync(path.join(folder, 'data.txt'), 'utf8'), 'saved while running')
  t.is(drive_of(await cli('pkg', 'alice')), drive_of(await cli('bot', 'alice')), 'bot and package agree')
})

// Two bots on one drive would share one identity and one data folder, so a
// configuration drive belongs to exactly one bot, and it must contain bot.json.
// A bot must pin its code to a drive, so a local folder or local generator file
// is refused.
test('bot registration is refused when it would clash', async t => {
  const local = 'A bot needs a drive, not a local path: pass a package name, drive id or dat:// reference'
  t.is((await cli('bot', '+alice', 'sample/generate?ask=no')).err, 'Bot already exists: alice')
  t.is((await cli('bot', '+dave', 'alice')).err, 'That configuration drive is already used by bot: alice')
  t.is((await cli('bot', '+dave', 'by-link')).err, 'Configuration drive must contain bot.json')
  t.is((await cli('bot', '+dave', sample)).err, local, 'local folder refused')
  t.is((await cli('bot', '+dave', path.join(sample, 'generate.js'))).err, local, 'local generator refused')
})

// Deleting a bot removes its own drive, but never the code it was made from.
test('bot -<name> deletes the bot and its drive, keeping the code', async t => {
  t.is((await cli('bot', '-alice')).out, 'Deleted: alice')
  t.is((await cli('bot', 'alice')).err, 'Unknown bot: alice')
  t.is((await cli('pkg', 'alice')).code, 1, 'its package is gone too')
  t.is(drive_of(await cli('pkg', 'sample')), code_link, 'code package kept')
})

// Deleting a package removes it and its local data, freeing the name.
test('pkg -<name> deletes a package', async t => {
  t.is((await cli('pkg', '-by-name')).out, 'Deleted: by-name')
  t.is((await cli('pkg', 'by-name')).code, 1)
  t.is((await cli('pkg', '+by-name', 'sample')).code, 0, 'name is free again')
})

// The pkg commands are a thin layer over the packs module (packs/README.md), which
// works on its own. Here is the same import, export and delete, called as functions.
test('packs module: package operations as plain functions', async t => {
  const pkgs = packs(path.join(home, 'packs-api'))
  await pkgs.open()
  const link = await pkgs.create('code', sample, repo)
  t.is(pkgs.get('code'), link, 'registered')
  t.alike(pkgs.list(), ['code'])
  const folder = await pkgs.export_to('code', path.join(home, 'packs-api-export'), repo)
  t.alike(files_of(folder), files_of(sample), 'exported')
  await pkgs.remove(link)
  t.alike(pkgs.list(), [], 'removed')
  await pkgs.close()
})

// The bot commands are a thin layer over the tasks module (tasks/README.md), built
// on packs. A task runs in-process: start it, it saves data to its drive, stop it,
// and both the task and its package now point at the revision with that data.
test('tasks module: start a task, let it save, stop it', async t => {
  const pkgs = packs(path.join(home, 'tasks-api'))
  const bots = tasks(pkgs)
  await pkgs.open()
  await bots.open()
  await pkgs.create('code', sample, repo)
  const created = await bots.create('hello', 'code/generate', repo)

  await bots.start('hello', () => {})
  t.ok(bots.info('hello').includes('Status: running'), 'running')
  await bots.end('hello')
  t.ok(bots.info('hello').includes('Status: stopped'), 'stopped')

  t.not(bots.get('hello'), created, 'moved to a newer revision')
  t.is(pkgs.get('hello'), bots.get('hello'), 'package moved with it')
  const folder = await pkgs.export_to('hello', path.join(home, 'tasks-api-export'), repo)
  t.is(fs.readFileSync(path.join(folder, 'data.txt'), 'utf8'), 'saved while running')
  await bots.close()
  await pkgs.close()
})

unhook('remove the throwaway home folder', () => {
  fs.rmSync(home, { recursive: true, force: true })
})
