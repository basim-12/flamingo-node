#!/usr/bin/env node
const path = require('path')
const fs = require('fs')

const envPath = process.env.ENV_FILE || path.resolve(process.cwd(), 'env.json')

// Allow 'init' command to run without env.json
if (process.argv[2] !== 'init') {
  if (!fs.existsSync(envPath)) {
    console.error('❌ No env.json found in', process.cwd())
    console.error('   Run "fw init ." to create one with default values.')
    process.exit(1)
  }
  try {
    Object.assign(process.env, JSON.parse(fs.readFileSync(envPath, 'utf8')))
  } catch (e) {
    console.error('❌ Failed to parse env.json:', e.message)
    process.exit(1)
  }
}

// lib/cli.js

const bitcoind = require('bitcoind')
const lightningd = require('lightningd')
const websocketd = require('websocketd')
const { execSync } = require('child_process')
const WebSocket = require('ws')
const net = require('net')

const url = 'ws://localhost:8080'
const name = 'cli'
const to = 'backend'
let mid = 0
const wait = new Map()

const cmd = process.argv[2]
const arg1 = process.argv[3]
const arg2 = process.argv[4]
const arg3 = process.argv[5]

// --- helpers ---
function isPortInUse(port) {
  return new Promise(resolve => {
    const socket = net.createConnection(port, '127.0.0.1')
    socket.once('connect', () => { socket.end(); resolve(true) })
    socket.once('error', () => resolve(false))
  })
}

function send(ws, type, data, handler) {
  const head = [name, to, mid++]
  const msg = { head, type, data }
  const key = `backend,${name},${head[2]}`
  wait.set(key, handler)
  ws.send(JSON.stringify(msg))
}

// --- main logic ---
async function main() {
  switch (cmd) {
    case 'start':
      console.log('=== Starting all services ===')
      await bitcoind.start()
      await lightningd.start()
      // --- ADD AWAIT HERE ---
      await websocketd.start()
      console.log('✅ All services started.')
      break

    case 'stop':
      console.log('=== Stopping all services ===')
      await lightningd.stop()
      await bitcoind.stop()
      websocketd.stop()
      console.log('✅ All services stopped.')
      break

    case 'reset':
      console.log('=== ⚠️ RESETTING ALL CHIAN DATA ⚠️ ===')
      try {
        await lightningd.stop()
        await bitcoind.stop()

        await lightningd.reset()
        await bitcoind.reset()
        console.log('✅ All data wiped. Run "npm run cli start" to start fresh.')
      } catch (e) {
        console.error('Error during reset:', e.message)
      }
      break

    case 'status':
      console.log('=== Checking process status ===')
      try {
        const btc = execSync('pgrep -x bitcoind || true').toString().trim()
        const lnd = execSync('pgrep -x lightningd || true').toString().trim()
        const ws = execSync('pgrep -f lib/node_modules/websocketd/daemon.js || true').toString().trim()

        console.log(`bitcoind: ${btc ? '🟢 running' : '🔴 stopped'}`)
        console.log(`lightningd: ${lnd ? '🟢 running' : '🔴 stopped'}`)
        console.log(`websocketd: ${ws ? '🟢 running' : '🔴 stopped'}`)
      } catch (e) {
        console.error('Error checking status:', e.message)
      }
      break

    case 'init': {
      const targetDir = arg1 === '.' ? process.cwd() : (arg1 || process.cwd())
      const targetPath = path.resolve(targetDir, 'env.json')
      if (fs.existsSync(targetPath)) {
        console.log('⚠️  env.json already exists at', targetPath)
        process.exit(1)
      }
      const defaults = {
        BITCOIN_DATADIR: '/path/to/bitcoin/regtest',
        BITCOIN_RPCUSER: 'foo',
        BITCOIN_RPCPASSWORD: 'bar',
        BITCOIN_RPCPORT: '18443',
        LIGHTNING_DIR_4: '/path/to/lightning4',
        LIGHTNING_DIR_5: '/path/to/lightning5',
        LIGHTNING_DIR_6: '/path/to/lightning6',
        WS_PORT: '8080'
      }
      fs.writeFileSync(targetPath, JSON.stringify(defaults, null, 2) + '\n')
      console.log('✅ Created env.json at', targetPath)
      console.log('   Edit the values to match your local setup.')
      break
    }

    default: {
      if (!cmd) {
        console.log('Usage:')
        console.log('  fw init .           # create env.json with defaults in current dir')
        console.log('  fw start            # starts bitcoind, lightningd, backend')
        console.log('  fw stop             # stops everything')
        console.log('  fw status           # shows status of all daemons')
        console.log('  fw <funds|getinfo|newaddress|walletbalance>')
        process.exit(0)
      }

      const running = await isPortInUse(8080)
      if (!running) {
        console.log('⚠️ Backend not running. Start it with "npm run cli start" first.')
        process.exit(1)
      }

      const ws = new WebSocket(url)
      ws.on('open', () => {
        const actions = {
          funds: { type: 'lightning-listfunds', data: {} },
          getinfo: { type: 'lightning-getinfo', data: {} },
          newaddress: { type: 'bitcoin-newaddress', data: {} },
          walletbalance: { type: 'bitcoin-getbalance', data: {} }
        }

        const action = actions[cmd]
        if (!action) {
          console.log(`❌ Unknown command: ${cmd}`)
          ws.close()
          process.exit(1)
        }

        send(ws, action.type, action.data, (m) => {
          console.log('--- response received ---')
          console.log(JSON.stringify(m, null, 2))
          ws.close()
          process.exit(0)
        })
      })

      ws.on('message', (raw) => {
        const m = JSON.parse(raw.toString())
        const key = m.head ? m.head.join(',') : null
        if (key && wait.has(key)) {
          const handler = wait.get(key)
          wait.delete(key)
          handler(m)
        }
      })
    }
  }
}

// Handle graceful shutdown for Docker signals
const handleShutdown = async (signal) => {
  console.log(`\nReceived ${signal}. Shutting down gracefully...`)
  try {
    await lightningd.stop()
    await bitcoind.stop()
    if (cmd === 'start') websocketd.stop()
  } catch (e) {
    console.error('Error during shutdown:', e.message)
  }
  process.exit(0)
}

process.on('SIGINT', () => handleShutdown('SIGINT'))
process.on('SIGTERM', () => handleShutdown('SIGTERM'))

main()