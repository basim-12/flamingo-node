const path = require('bare-path')
const { spawn } = require('bare-subprocess')

const name = 'flamingo-app'
const service = require('./docker-compose.json').services.app

module.exports = { up, down }

// Build the image from this drive's Dockerfile and start the container the way
// the drive's docker-compose.json describes. `app` is the local flamingo-node
// folder the backend runs from. The drive doesn't carry env.docker.json, so the
// compose file's `./` paths come from flamingo-docker.
async function up (app) {
  if (await docker(['ps', '-q', '-f', `name=^${name}$`])) throw new Error('Flamingo is already running; stop it before starting this bot')
  if (await docker(['ps', '-aq', '-f', `name=^${name}$`])) await docker(['rm', name])
  await docker(['build', '-t', name, __dirname], { show: true })
  const shared = path.join(app, 'node_modules', 'flamingo-docker') + '/'
  const args = ['run', '-d', '--name', name]
  for (const volume of service.volumes) args.push('-v', volume.replace(/\$\{FLAMINGO_PATH\}/, app).replace(/^\.\//, shared))
  for (const port of service.ports) args.push('-p', port)
  for (const [key, value] of Object.entries(service.environment)) args.push('-e', `${key}=${value}`)
  await docker([...args, name, ...service.command])
}

// Stop the lightning nodes and bitcoind cleanly before removing the container, so
// their data isn't cut off mid-write.
async function down () {
  if (await docker(['ps', '-q', '-f', `name=^${name}$`])) {
    await retry(async () => (await docker(['logs', name])).includes('All services started.'), 'Node services did not finish starting')
    for (const node of [4, 5, 6]) {
      const cli = ['exec', name, 'lightning-cli', `--lightning-dir=/data/lightning${node}`, `--rpc-file=/tmp/lightning${node}-rpc`, '--network=regtest']
      const state = await retry(async () => {
        if (await docker([...cli, 'getinfo']).then(() => true, () => false)) return 'up'
        if (await stopped_cleanly(node)) return 'down'
      }, `lightning${node} RPC did not become ready`)
      if (state === 'up') await docker([...cli, 'stop'])
    }
    await retry(async () => !(await running('lightningd')), 'Lightning did not stop cleanly')
    const rpc = key => `"$(jq -r .${key} /config/env.docker.json)"`
    const stop_bitcoind = `bitcoin-cli -regtest -rpcuser=${rpc('BITCOIN_RPCUSER')} -rpcpassword=${rpc('BITCOIN_RPCPASSWORD')} -rpcport=${rpc('BITCOIN_RPCPORT')} stop`
    await docker(['exec', name, 'bash', '-lc', stop_bitcoind]).catch(async err => { if (await running('bitcoind')) throw err })
    await retry(async () => !(await running('bitcoind')), 'Bitcoin Core did not stop cleanly')
    await docker(['stop', name])
  }
  await docker(['rm', name])
}

async function stopped_cleanly (node) {
  const log = await docker(['exec', name, 'cat', `/data/lightning${node}/debug.log`]).catch(() => '')
  return log.lastIndexOf('JSON-RPC shutdown') > log.lastIndexOf('Server started with public key')
}

async function running (program) {
  const states = await docker(['exec', name, 'ps', '-C', program, '-o', 'stat=']).catch(() => '')
  return states.split('\n').some(state => state.trim() && !state.trim().startsWith('Z'))
}

// Wait up to a minute for `check` to return something truthy.
async function retry (check, message) {
  for (let i = 0; i < 60; i++) {
    const result = await check()
    if (result) return result
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  throw new Error(message + '; the container was left running')
}

function docker (args, { show = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, { stdio: show ? 'inherit' : ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    if (!show) {
      child.stdout.on('data', data => { out += data })
      child.stderr.on('data', data => { err += data })
    }
    child.once('error', reject)
    child.once('exit', code => code === 0 ? resolve(out.trim()) : reject(new Error(err.trim() || 'docker ' + args[0] + ' failed')))
  })
}
