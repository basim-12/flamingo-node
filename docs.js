// Executable documentation for Flamingo as a bot: the code package in lib/drive.
//
// Each test runs the real CLI the way a user types it, and its comment says what it
// shows. The generic drive and bot behaviour is tested in scripts/docs.js; this file
// only covers what is particular to Flamingo. Run with `npm run docs:flamingo`.
//
// The tests point HOME at a throwaway folder, so real packages and bots are never
// touched. Nothing here starts Docker.

const { test, hook } = require('brittle')
const fs = require('bare-fs')
const os = require('bare-os')
const path = require('bare-path')
const process = require('bare-process')
const { spawn } = require('bare-subprocess')
const bip39 = require('bip39-mnemonic')

const repo = __dirname
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'flamingo-docs-'))
let export_count = 0
let code_link = ''

function cli (...args) {
  return run(process.execPath, [path.join(repo, 'scripts', 'cli.js'), ...args], repo)
}

function cli_in (cwd, ...args) {
  return run(process.execPath, [path.join(repo, 'scripts', 'cli.js'), ...args], cwd)
}

function run (program, args, cwd) {
  return new Promise(resolve => {
    const child = spawn(program, args, { cwd, env: { ...process.env, HOME: home }, stdio: ['ignore', 'pipe', 'pipe'] })
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

async function export_pkg (name) {
  const folder = path.join(home, 'export-' + ++export_count)
  await cli('pkg', name, folder)
  return folder
}

function read_json (file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

const unhook = hook('use a throwaway home folder')

// `fw` runs the Flamingo node and nothing else. Drives and bots are a separate CLI.
test('fw has no pkg or bot commands', async t => {
  const result = await run('node', [path.join(repo, 'lib', 'cli.js'), 'pkg'], repo)
  t.ok(result.out.startsWith('Usage: fw up'), 'prints fw usage')
  t.absent(result.out.includes('pkg'), 'no mention of pkg')
})

// lib/drive is Flamingo's code package for the bot cli: a generator that makes an
// identity, and an entry that runs the node with it. lib/build.js assembles the drive,
// so the Docker setup comes from the pinned flamingo-docker dependency as installed,
// never from copies kept in this repo.
test('the flamingo drive carries the code and the pinned docker dependency', async t => {
  const created = await cli('pkg', '+flamingo-node', './lib/build.js')
  t.is(created.code, 0, created.err)
  code_link = drive_of(created)
  const folder = await export_pkg('flamingo-node')
  t.alike(fs.readdirSync(folder).sort(), ['flamingo-docker', 'generate.js', 'main.js'])
  t.alike(fs.readdirSync(path.join(folder, 'flamingo-docker')).sort(),
    fs.readdirSync(path.join(repo, 'node_modules', 'flamingo-docker')).sort(), 'as installed')
})

// The generator writes only the app's own data: one fresh 12-word BIP39 phrase.
// bip39 can't run under Bare, so it uses Holepunch's bip39-mnemonic, asked for the
// 12 words the wallet backend expects.
test('the generator writes a 12-word wallet.json', async t => {
  t.is((await cli('pkg', '+config', 'flamingo-node/generate?ask=no')).code, 0)
  const folder = await export_pkg('config')
  t.alike(fs.readdirSync(folder), ['wallet.json'])
  const { mnemonic } = read_json(path.join(folder, 'wallet.json'))
  t.is(mnemonic.split(' ').length, 12)
  t.ok(bip39.validateMnemonic(mnemonic), 'a valid BIP39 phrase')
})

// Every bot gets its own wallet, so two bots are two separate Lightning identities,
// each pinned to the same code.
test('each bot gets its own identity', async t => {
  t.is((await cli('bot', '+alice', 'flamingo-node/generate?ask=no')).code, 0)
  t.is((await cli('bot', '+bob', 'flamingo-node/generate?ask=no')).code, 0)
  const alice = await export_pkg('alice')
  const bob = await export_pkg('bob')
  t.alike(fs.readdirSync(alice).sort(), ['bot.json', 'wallet.json'])
  t.is(read_json(path.join(alice, 'bot.json')).entry, code_link + '/main.js', 'pinned to this code')
  t.not(read_json(path.join(alice, 'wallet.json')).mnemonic, read_json(path.join(bob, 'wallet.json')).mnemonic)
})

// The entry's job is to run the node, not to make an identity. A bot drive without
// wallet.json stops with an error before anything touches Docker.
// (--attach runs it in this terminal, so the error shows up right here.)
test('a flamingo bot stops when it has no wallet.json', async t => {
  const folder = path.join(home, 'empty-config')
  fs.mkdirSync(folder)
  fs.writeFileSync(path.join(folder, 'bot.json'), JSON.stringify({ entry: code_link + '/main.js' }))
  t.is((await cli('pkg', '+empty-config', folder)).code, 0)
  t.is((await cli('bot', '+carol', 'empty-config')).code, 0)

  const result = await cli('bot', 'carol', '--run', '--attach')
  t.is(result.code, 1)
  t.ok(result.err.includes('This bot has no wallet.json'), 'says why')
  t.ok((await cli('bot', 'carol')).out.includes('Status: stopped'), 'not left running')
})

// The backend itself isn't in the drive yet: Docker runs it from this repository.
// So a bot started anywhere else stops with an error before touching Docker.
test('a flamingo bot must start from the repository folder', async t => {
  const result = await cli_in(home, 'bot', 'alice', '--run', '--attach')
  t.is(result.code, 1)
  t.ok(result.err.includes('Run this bot from the flamingo-node folder'), 'says why')
})

unhook('remove the throwaway home folder', () => {
  fs.rmSync(home, { recursive: true, force: true })
})
