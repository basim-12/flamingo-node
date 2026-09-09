// Node-side helper: create or recover the Flamingo wallet identity through the
// existing initialize_node_wallet WebSocket API. Prints { mnemonic, nodeId } JSON.
const WebSocket = require('ws')

const port = process.env.WS_PORT || 8080
const prior = process.env.BOT_MNEMONIC || ''

function request (ws, type, data, timeout = 180000) {
  return new Promise((resolve, reject) => {
    const mid = Date.now()
    const key = ['backend', 'flamingo-bot', mid].join(',')
    const timer = setTimeout(() => { ws.off('message', onMessage); reject(new Error(type + ' timed out')) }, timeout)
    function onMessage (raw) {
      let m
      try { m = JSON.parse(raw) } catch { return }
      if (!m || !Array.isArray(m.head) || m.head.join(',') !== key) return
      clearTimeout(timer)
      ws.off('message', onMessage)
      resolve(m.data)
    }
    ws.on('message', onMessage)
    ws.send(JSON.stringify({ head: ['flamingo-bot', 'backend', mid], type, data }))
  })
}

async function main () {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`)
  await new Promise((resolve, reject) => {
    ws.once('open', resolve)
    ws.once('error', reject)
  })
  try {
    const req = prior ? { action: 'recover', mnemonic: prior } : { action: 'create' }
    const payload = await request(ws, 'initialize_node_wallet', req)
    if (!payload || payload.status !== 'success') {
      throw new Error('initialize_node_wallet failed: ' + (payload && payload.error ? payload.error : 'unknown error'))
    }
    process.stdout.write(JSON.stringify({
      mnemonic: payload.data && payload.data.mnemonic,
      nodeId: payload.data && payload.data.nodeId
    }))
  } finally {
    ws.close()
  }
}

main().catch(error => { console.error(error.message); process.exit(1) })
