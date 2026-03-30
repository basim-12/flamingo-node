#!/usr/bin/env node
const path = require('path')
const fs = require('fs')
function getDockerDir() {
  // Try npm dependency first (node_modules/flamingo-docker)
  try {
    const dockerJson = require.resolve('flamingo-docker/docker-compose.json')
    return path.dirname(dockerJson)
  } catch { }
  // Fall back to sibling clone (../../flamingo-docker)
  return path.resolve(__dirname, '../../flamingo-docker')
}
const DOCKER_DIR = getDockerDir()

const envPath = process.env.ENV_FILE || path.resolve(process.cwd(), 'env.json')

function loadEnv() {
  if (fs.existsSync(envPath)) {
    try {
      Object.assign(process.env, JSON.parse(fs.readFileSync(envPath, 'utf8')))
    } catch (e) {
      console.error('❌ Failed to parse env.json:', e.message)
      process.exit(1)
    }
  }
}

// lib/cli.js

const { execSync } = require('child_process')

const cmd = process.argv[2]

async function main() {
  const args = process.argv.slice(2)
  const isShutdown = args.includes('--shutdown')
  const scenarioArg = args.indexOf('--run')
  const scenarioPath = scenarioArg !== -1 ? args[scenarioArg + 1] : null
  const isAttach = args.includes('--attach')

  // Handle help/usage
  if (cmd !== 'up' || args.includes('--help') || args.includes('-h')) {
    console.log('Usage: fw up [options]')
    console.log('')
    console.log('Options:')
    console.log('  --run <file.json>  Start node and run a network scenario')
    console.log('  --attach           Start node and stream logs to terminal')
    console.log('  --shutdown         Stop and remove the node container')
    console.log('')
    console.log('Note: fw up auto-creates env.json if missing and installs Docker if needed.')
    console.log('      All node interactions (getinfo, funds, etc.) are available via WebSocket API.')
    process.exit(0)
  }

  const dockerRun = require('./docker-run')
  const { installDocker } = require('./docker-install')
  const FLAMINGO_PATH = path.resolve(__dirname, '..')

  if (isShutdown) {
    console.log('=== 🦩 Flamingo Node Shutdown ===')
    await dockerRun.down()
    process.exit(0)
  }

  // Auto-init: create env.json if it doesn't exist
  if (!fs.existsSync(envPath)) {
    const defaultPath = path.resolve(__dirname, '../env.default.json')
    if (fs.existsSync(defaultPath)) {
      fs.copyFileSync(defaultPath, envPath)
      console.log('✅ Created env.json from defaults in current directory.')
    } else {
      console.error('❌ Could not find env.default.json to initialize configuration.')
      process.exit(1)
    }
  }

  // Load environment after potential init
  loadEnv()

  // Check if already running
  const running = await dockerRun.isContainerRunning()
  if (running && !scenarioPath && !isAttach) {
    console.log('🟢 Flamingo Node is already running.')
    console.log('')
    console.log('   WebSocket: ws://localhost:8080')
    console.log('   Status:    Online')
    console.log('')
    console.log('   To stop everything, use: fw up --shutdown')
    process.exit(0)
  }

  console.log('=== 🦩 Flamingo Node Up ===')
  const installed = await installDocker()
  if (!installed) {
    console.error('❌ Docker is required. Please install it and try again.')
    process.exit(1)
  }

  await dockerRun.up(DOCKER_DIR, FLAMINGO_PATH)

  if (scenarioPath) {
    console.log(`\n🚀 Running scenario: ${scenarioPath} ...`)
    const fullScenarioPath = path.resolve(process.cwd(), scenarioPath)
    const { runScenario } = require('./scenario-runner')
    // Wait a moment for the backend to be ready
    await new Promise(r => setTimeout(r, 2000))
    await runScenario(fullScenarioPath)
  }

  if (isAttach) {
    await dockerRun.logs()
  }
}

// Handle graceful shutdown for Docker signals
const handleShutdown = async (signal) => {
  console.log(`\nReceived ${signal}. Shutting down gracefully...`)
  // Docker container shutdown is managed by docker compose down / fw up --shutdown
  process.exit(0)
}

process.on('SIGINT', () => handleShutdown('SIGINT'))
process.on('SIGTERM', () => handleShutdown('SIGTERM'))

main()