const process = require('bare-process')
const path = require('bare-path')
const { spawn } = require('bare-subprocess')
const ws = require('bare-ws')

// Start Flamingo with the existing Docker CLI (`fw up` / `fw up --shutdown`) and
// bind node4 to this bot's identity from wallet.json.
module.exports = async function (drive, { stopped, log }) {
  const wallet = await drive.get('/wallet.json')
  if (!wallet) throw new Error('This bot has no wallet.json')
  const { mnemonic } = JSON.parse(wallet)

  await fw('up')
  try {
    const { nodeId } = await initialize_node_wallet(mnemonic)
    log('Node identity: ' + nodeId)
    log('Flamingo is running via Docker. Stop it with `fw bot <name> --end` or Ctrl+C.')
    await stopped
  } finally {
    await fw('up', '--shutdown')
  }
}

function fw (...args) {
  const cli = process.env.FLAMINGO_CLI
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.FLAMINGO_NODE, [cli, ...args], {
      cwd: path.dirname(path.dirname(cli)),
      stdio: 'inherit',
      env: { ...process.env, FLAMINGO_BOT: '1' }
    })
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`fw ${args.join(' ')} failed`)))
  })
}

// `fw up` returns once the container starts; the backend inside needs a while
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
