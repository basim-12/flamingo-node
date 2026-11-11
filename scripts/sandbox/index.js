const path = require('path')
const fs = require('fs')
const { capture, inherit } = require('./exec')
const { installDocker } = require('./install')

function delay (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

const CONTAINER_NAME = 'flamingo-app'
const IMAGE_NAME = 'flamingo-app'

function resolveVolumePath (source, dockerDir, flamingoPath) {
  // Substitute ${FLAMINGO_PATH} with the resolved absolute path
  if (source.includes('${FLAMINGO_PATH}')) {
    return source.replace('${FLAMINGO_PATH}', flamingoPath)
  }
  // ./ paths resolve relative to the docker directory
  if (source.startsWith('./') || source.startsWith('../')) {
    return path.resolve(dockerDir, source)
  }
  return source
}

function buildRunArgs (config, dockerDir, flamingoPath) {
  const service = config.services.app
  const args = [
    'run', '-d',
    '--name', CONTAINER_NAME
  ]

  // Volumes (string format: "source:target" or just "target" for anonymous)
  for (const vol of service.volumes) {
    if (vol.includes(':')) {
      const [source, target] = vol.split(':')
      const hostPath = resolveVolumePath(source, dockerDir, flamingoPath)
      args.push('-v', `${hostPath}:${target}`)
    } else {
      // Anonymous volume (e.g. /app/node_modules)
      args.push('-v', vol)
    }
  }

  // Ports (string format: "published:target")
  for (const port of service.ports) {
    args.push('-p', port)
  }

  // Environment variables
  const env = service.environment || {}
  for (const [key, value] of Object.entries(env)) {
    args.push('-e', `${key}=${value}`)
  }

  // Command
  if (service.command && Array.isArray(service.command)) {
    args.push(IMAGE_NAME, ...service.command)
  }

  return args
}

async function isContainerRunning () {
  try {
    const result = await capture('docker', ['ps', '-q', '-f', 'name=' + CONTAINER_NAME])
    return result.length > 0
  } catch {
    return false
  }
}

async function doesContainerExist () {
  try {
    const result = await capture('docker', ['ps', '-aq', '-f', 'name=' + CONTAINER_NAME])
    return result.length > 0
  } catch {
    return false
  }
}

async function isNodeProcessRunning (name) {
  try {
    const states = await capture('docker', [
      'exec', CONTAINER_NAME, 'ps', '-C', name, '-o', 'stat='
    ])
    return states.split('\n').some(state => state.trim() && !state.trim().startsWith('Z'))
  } catch {
    return false
  }
}

async function waitForNodeProcessExit (name, label) {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (!(await isNodeProcessRunning(name))) return
    await delay(1000)
  }
  throw new Error(`${label} did not stop cleanly; the container was left running`)
}

async function wasCleanlyStopped (logFile, started, stopped) {
  try {
    const log = await capture('docker', ['exec', CONTAINER_NAME, 'cat', logFile])
    return log.lastIndexOf(stopped) > log.lastIndexOf(started)
  } catch {
    return false
  }
}

async function waitForServiceStartup () {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const logs = await capture('docker', ['logs', CONTAINER_NAME])
      if (logs.includes('All services started.')) return
    } catch {
      // Keep waiting while the container initializes.
    }
    await delay(1000)
  }
  throw new Error('Node services did not finish starting; the container was left running')
}

async function waitForLightningRpc (node) {
  const args = [
    'exec', CONTAINER_NAME,
    'lightning-cli',
    `--lightning-dir=/data/lightning${node}`,
    `--rpc-file=/tmp/lightning${node}-rpc`,
    '--network=regtest'
  ]
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      await capture('docker', [...args, 'getinfo'])
      return args
    } catch {
      if (await wasCleanlyStopped(
        `/data/lightning${node}/debug.log`,
        'Server started with public key',
        'JSON-RPC shutdown'
      )) return null
      await delay(1000)
    }
  }
  throw new Error(`lightning${node} RPC did not become ready; the container was left running`)
}

async function stopNodeServices () {
  await waitForServiceStartup()
  console.log(' Stopping Lightning nodes cleanly ...')
  for (const node of [4, 5, 6]) {
    const args = await waitForLightningRpc(node)
    if (args) await capture('docker', [...args, 'stop'])
  }
  await waitForNodeProcessExit('lightningd', 'Lightning')

  console.log(' Stopping Bitcoin Core cleanly ...')
  try {
    await capture('docker', [
      'exec', CONTAINER_NAME, 'bash', '-lc',
      'bitcoin-cli -regtest ' +
      '-rpcuser="$(jq -r .BITCOIN_RPCUSER /config/env.docker.json)" ' +
      '-rpcpassword="$(jq -r .BITCOIN_RPCPASSWORD /config/env.docker.json)" ' +
      '-rpcport="$(jq -r .BITCOIN_RPCPORT /config/env.docker.json)" stop'
    ])
  } catch (error) {
    if (await isNodeProcessRunning('bitcoind')) throw error
  }
  await waitForNodeProcessExit('bitcoind', 'Bitcoin Core')
}

// `app` is the flamingo-node folder: the sandbox mounts it, and the Dockerfile and compose
// file come from the flamingo-docker dependency installed inside it.
async function up (app) {
  if (!await installDocker()) throw new Error('Docker is required. Please install it and try again.')
  const dockerDir = path.join(app, 'node_modules', 'flamingo-docker')
  const config = JSON.parse(fs.readFileSync(path.join(dockerDir, 'docker-compose.json'), 'utf8'))
  const service = config.services.app

  // Check if container is already running
  if (await isContainerRunning()) {
    console.log('⚠️  The node is already running.')
    return
  }

  // Remove existing stopped container if present
  if (await doesContainerExist()) {
    console.log('🧹 Clearing the previous run ...')
    await capture('docker', ['rm', CONTAINER_NAME])
  }

  // Build the image
  const buildContext = path.resolve(dockerDir, service.build.context)
  console.log('🔨 Preparing the node ...')
  await inherit('docker', ['build', '-t', IMAGE_NAME, buildContext])

  // Run the container
  console.log('🚀 Starting the node ...')
  await inherit('docker', buildRunArgs(config, dockerDir, app))

  console.log('')
  console.log('✅ Flamingo backend is running!')
  console.log('   WebSocket: ws://localhost:8080')
  console.log('   Stop:      fw up --shutdown')
}

async function down () {
  const running = await isContainerRunning()
  const exists = await doesContainerExist()

  if (!exists) {
    console.log('ℹ️  The node is not running.')
    return
  }

  if (running) {
    await stopNodeServices()
    console.log('🛑 Stopping the node ...')
    await capture('docker', ['stop', CONTAINER_NAME])
  }

  await capture('docker', ['rm', CONTAINER_NAME])
  console.log('✅ Node stopped.')
}

async function logs () {
  const running = await isContainerRunning()
  if (!running) {
    console.log('ℹ️  The node is not running.')
    return
  }
  await inherit('docker', ['logs', '-f', CONTAINER_NAME])
}

module.exports = { up, down, logs, running: isContainerRunning }
