const fs = require('fs')
const path = require('path')
const process = require('process')
const docker = require('./docker-run')
const { installDocker } = require('./docker-install')

// This package's folder, which Docker mounts into the container; the flamingo-docker
// dependency, which holds the Dockerfile and the compose file; and the settings file fw
// reads from the folder it runs in.
const app = path.resolve(__dirname, '..')
const docker_dir = path.join(app, 'node_modules', 'flamingo-docker')
const env_file = process.env.ENV_FILE || path.resolve(process.cwd(), 'env.json')

function load_env () {
  if (fs.existsSync(env_file)) Object.assign(process.env, JSON.parse(fs.readFileSync(env_file, 'utf8')))
}

// Start the node: build the image and run the container, with a settings file and a
// Docker to run it on. Returns once the container is up.
async function up ({ scenario = null, attach = false } = {}) {
  if (await docker.isContainerRunning() && !scenario && !attach) {
    console.log('🟢 Flamingo Node is already running.')
    console.log('')
    console.log('   WebSocket: ws://localhost:8080')
    console.log('   Status:    Online')
    console.log('')
    console.log('   To stop everything, use: fw up --shutdown')
    return
  }

  if (!fs.existsSync(env_file)) {
    fs.copyFileSync(path.join(app, 'env.default.json'), env_file)
    console.log('✅ Created env.json from defaults in ' + path.dirname(env_file))
  }
  load_env()

  console.log('=== 🦩 Flamingo Node Up ===')
  if (!await installDocker()) throw new Error('Docker is required. Please install it and try again.')
  await docker.up(docker_dir, app)

  if (scenario) {
    console.log(`\n🚀 Running scenario: ${scenario} ...`)
    const { runScenario } = require('./scenario-runner')
    await new Promise(resolve => setTimeout(resolve, 2000)) // let the backend come up
    await runScenario(path.resolve(process.cwd(), scenario))
  }
  if (attach) await docker.logs()
}

// Stop the lightning nodes and bitcoind cleanly, then remove the container.
async function down () {
  console.log('=== 🦩 Flamingo Node Shutdown ===')
  await docker.down()
}

module.exports = { up, down, running: docker.isContainerRunning, load_env }
