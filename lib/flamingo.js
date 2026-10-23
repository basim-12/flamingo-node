const fs = require('fs')
const path = require('path')
const process = require('process')
const sandbox = require('sandbox')

// This package's folder, which the sandbox runs the node from, and the settings file fw
// reads from the folder it runs in.
const app = path.resolve(__dirname, '..')
const env_file = process.env.ENV_FILE || path.resolve(process.cwd(), 'env.json')

function load_env () {
  if (fs.existsSync(env_file)) Object.assign(process.env, JSON.parse(fs.readFileSync(env_file, 'utf8')))
}

// Start the node, with a settings file and a sandbox to run it in. Returns once it is up.
async function up ({ scenario = null, attach = false } = {}) {
  if (await sandbox.running() && !scenario && !attach) {
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
  await sandbox.up(app)

  if (scenario) {
    console.log(`\n🚀 Running scenario: ${scenario} ...`)
    const { runScenario } = require('./scenario-runner')
    await new Promise(resolve => setTimeout(resolve, 2000)) // let the backend come up
    await runScenario(path.resolve(process.cwd(), scenario))
  }
  if (attach) await sandbox.logs()
}

// Stop the lightning nodes and bitcoind cleanly, then take the node down.
async function down () {
  console.log('=== 🦩 Flamingo Node Shutdown ===')
  await sandbox.down()
}

module.exports = { up, down, running: sandbox.running, load_env }
