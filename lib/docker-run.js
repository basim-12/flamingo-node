const { exec } = require('child_process')
const path = require('path')
const fs = require('fs')

function execPromise(cmd, opts = {}) {
  return new Promise((resolve, reject) => {
    exec(cmd, { maxBuffer: 1024 * 1024 * 10, ...opts }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr || error.message))
      else resolve(stdout.trim())
    })
  })
}

function spawn(cmd, args, opts = {}) {
  const { spawn: nodeSpawn } = require('child_process')
  return new Promise((resolve, reject) => {
    const child = nodeSpawn(cmd, args, { stdio: 'inherit', ...opts })
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`Command "${cmd} ${args.join(' ')}" exited with code ${code}`))
    })
    child.on('error', reject)
  })
}

const CONTAINER_NAME = 'flamingo-app'
const IMAGE_NAME = 'flamingo-app'

function loadDockerConfig(dockerDir) {
  // Try require-based resolution first (works when flamingo-docker is an npm dependency)
  try {
    return require('flamingo-docker/docker.json')
  } catch {
    // Fall back to filesystem path (works in side by side git clone setup)
    const configPath = path.resolve(dockerDir, 'docker.json')
    if (!fs.existsSync(configPath)) {
      console.error('❌ docker.json not found at:', configPath)
      console.error('   Install flamingo-docker as a dependency or clone it side by side.')
      process.exit(1)
    }
    return JSON.parse(fs.readFileSync(configPath, 'utf8'))
  }
}

function resolveVolumePath(source, dockerDir) {
  // Resolve relative paths against the docker directory
  if (source.startsWith('./') || source.startsWith('../')) {
    return path.resolve(dockerDir, source)
  }
  return source
}

function buildRunArgs(config, dockerDir) {
  const service = config.services.app
  const args = [
    'run', '-d',
    '--name', CONTAINER_NAME
  ]

  // Volumes
  for (const vol of service.volumes) {
    if (vol.source) {
      const hostPath = resolveVolumePath(vol.source, dockerDir)
      args.push('-v', `${hostPath}:${vol.target}`)
    } else {
      // Anonymous volume (e.g. /app/node_modules)
      args.push('-v', vol.target)
    }
  }

  // Ports
  for (const port of service.ports) {
    args.push('-p', `${port.published}:${port.target}`)
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

async function isContainerRunning() {
  try {
    const result = await execPromise(`docker ps -q -f name=${CONTAINER_NAME}`)
    return result.length > 0
  } catch {
    return false
  }
}

async function doesContainerExist() {
  try {
    const result = await execPromise(`docker ps -aq -f name=${CONTAINER_NAME}`)
    return result.length > 0
  } catch {
    return false
  }
}

async function up(dockerDir) {
  const config = loadDockerConfig(dockerDir)
  const service = config.services.app

  // Check if container is already running
  if (await isContainerRunning()) {
    console.log('⚠️  Container is already running. Use "fw down" first to restart.')
    return
  }

  // Remove existing stopped container if present
  if (await doesContainerExist()) {
    console.log('🗑️  Removing existing stopped container ...')
    await execPromise(`docker rm ${CONTAINER_NAME}`)
  }

  // Build the image
  const buildContext = path.resolve(dockerDir, service.build.context)
  console.log('🔨 Building Docker image ...')
  await spawn('docker', ['build', '-t', IMAGE_NAME, buildContext])
  console.log('✅ Docker image built successfully!')

  // Run the container
  const runArgs = buildRunArgs(config, dockerDir)
  console.log('🚀 Starting container ...')
  console.log(`   docker ${runArgs.join(' ')}`)
  await spawn('docker', runArgs)

  console.log('')
  console.log('✅ Flamingo backend is running!')
  console.log('   WebSocket: ws://localhost:8080')
  console.log('')
  console.log('   Logs:     docker logs -f ' + CONTAINER_NAME)
  console.log('   Stop:     fw down')
}

async function down() {
  const running = await isContainerRunning()
  const exists = await doesContainerExist()

  if (!exists) {
    console.log('ℹ️  No flamingo container found.')
    return
  }

  if (running) {
    console.log('🛑 Stopping container ...')
    await execPromise(`docker stop ${CONTAINER_NAME}`)
  }

  console.log('🗑️  Removing container ...')
  await execPromise(`docker rm ${CONTAINER_NAME}`)
  console.log('✅ Container stopped and removed.')
}

async function logs() {
  const running = await isContainerRunning()
  if (!running) {
    console.log('ℹ️  No running flamingo container found.')
    return
  }
  await spawn('docker', ['logs', '-f', CONTAINER_NAME])
}

module.exports = { up, down, logs }
