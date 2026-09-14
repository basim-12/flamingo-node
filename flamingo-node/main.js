const fs = require('bare-fs')
const path = require('bare-path')
const process = require('bare-process')
const ws = require('bare-ws')
const docker = require('./docker')

// Start Flamingo in Docker from this drive's Docker files and bind node4 to this
// bot's identity from wallet.json.
module.exports = async function (drive, { stopped, log }) {
  const wallet = await drive.get('/wallet.json')
  if (!wallet) throw new Error('This bot has no wallet.json')
  const { mnemonic } = JSON.parse(wallet)

  // The backend isn't in the drive yet; it runs from the local flamingo-node folder.
  const app = process.cwd()
  if (!fs.existsSync(path.join(app, 'lib', 'cli.js'))) throw new Error('Run this bot from the flamingo-node folder')

  log('Starting Flamingo in Docker ...')
  await docker.up(app)
  try {
    const { nodeId } = await initialize_node_wallet(mnemonic)
    log('Node identity: ' + nodeId)
    log('Flamingo is running. Stop it with `cli bot <name> --end`.')
    await stopped
  } finally {
    log('Stopping Flamingo ...')
    await docker.down()
  }
}

// docker.up returns once the container starts; the backend inside needs a while
// longer before it accepts connections, so retry until it does.
async function connect (url) {
  const until = Date.now() + 3 * 60 * 1000
  while (true) {
    const socket = new ws.Socket(url)
    try {
      await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject) })
      return socket
    } catch (err) {
      if (err.code !== 'NETWORK_ERROR') throw err
      if (Date.now() > until) throw new Error('Flamingo backend did not accept connections on ' + url)
      await new Promise(resolve => setTimeout(resolve, 2000))
    }
  }
}

// One request and its reply over the backend's WebSocket.
async function initialize_node_wallet (mnemonic) {
  const id = Date.now()
  const socket = await connect('ws://127.0.0.1:8080')
  return new Promise((resolve, reject) => {
    socket.on('error', reject)
    socket.on('data', data => {
      const message = JSON.parse(data)
      if (String(message.head) !== String(['backend', 'flamingo-bot', id])) return
      socket.end()
      if (message.data.status === 'success') resolve(message.data.data)
      else reject(new Error('initialize_node_wallet failed: ' + message.data.error))
    })
    socket.write(JSON.stringify({
      head: ['flamingo-bot', 'backend', id],
      type: 'initialize_node_wallet',
      data: { action: 'recover', mnemonic }
    }))
  })
}
