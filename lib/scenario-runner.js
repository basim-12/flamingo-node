#!/usr/bin/env node
const { execSync } = require('child_process')
const path = require('path')
const fs = require('fs')

// --- Helpers ---

function run(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8' }).trim()
  } catch (e) {
    return ''
  }
}

function lcli(dir, command) {
  const dirBase = path.basename(dir)
  const rpcFile = `/tmp/${dirBase}-rpc`
  return run(`lightning-cli --network=regtest --lightning-dir=${dir} --rpc-file=${rpcFile} ${command}`)
}

function bcli(scenario, command) {
  const { rpcuser, rpcpassword, rpcport, wallet } = scenario.bitcoin
  const walletArg = wallet ? `-rpcwallet=${wallet}` : ''
  return run(`bitcoin-cli -regtest -rpcuser=${rpcuser} -rpcpassword=${rpcpassword} -rpcport=${rpcport} ${walletArg} ${command}`)
}

function mineBlocks(scenario, n) {
  const addr = bcli(scenario, 'getnewaddress')
  bcli(scenario, `generatetoaddress ${n} ${addr}`)
}

function waitForStartup(dir, name) {
  console.log(`>> ⏳ Waiting for ${name} to start...`)
  for (let i = 0; i < 30; i++) {
    try {
      execSync(`lightning-cli --network=regtest --lightning-dir=${dir} getinfo`, { stdio: 'ignore' })
      console.log(`   ✅ ${name} is ready.`)
      return true
    } catch (e) {
      execSync('sleep 2')
    }
  }
  console.error(`   ❌ ${name} failed to start.`)
  console.error('      Hint: If you see "bitcoind has gone backwards" in logs, delete the data folder: rm -rf data')
  process.exit(1)
}

function waitForFunds(dir, name) {
  console.log(`>> ⏳ Waiting for ${name} to see funds...`)
  for (let i = 0; i < 60; i++) {
    const result = lcli(dir, 'listfunds')
    try {
      const funds = JSON.parse(result)
      const confirmed = funds.outputs && funds.outputs.find(o => o.status === 'confirmed')
      if (confirmed) {
        console.log(`   ✅ Funds confirmed for ${name}`)
        return true
      }
    } catch (e) { }

    if ((i + 1) % 5 === 0) {
      console.log(`   ... waiting (${i + 1}/60)`)
    }
    execSync('sleep 2')
  }
  console.error(`   ❌ Timeout waiting for funds for ${name}`)
  return false
}

function fundNode(scenario, dir, name, amount) {
  console.log(`>> 💰 Funding ${name} (${amount} BTC)...`)
  const result = lcli(dir, 'newaddr')
  const addr = JSON.parse(result).bech32
  bcli(scenario, `sendtoaddress ${addr} ${amount}`)
}

function connectAndOpen(fromDir, toDir, fromName, toName, amountSats) {
  console.log(`>> 🔗 Connecting ${fromName} -> ${toName}...`)

  const toInfo = JSON.parse(lcli(toDir, 'getinfo'))
  const toId = toInfo.id
  const toPort = toInfo.binding[0].port

  // Connect (ignore errors if already connected)
  lcli(fromDir, `connect ${toId}@127.0.0.1:${toPort}`)

  console.log(`>> ⚡ Opening Channel (${amountSats} sats)...`)
  const result = lcli(fromDir, `fundchannel ${toId} ${amountSats}`)
  if (!result) {
    console.log('   ⚠️ Channel open failed (maybe already exists?)')
  }
}

// --- Main ---

async function runScenario(scenarioPath) {
  if (!fs.existsSync(scenarioPath)) {
    console.error('❌ Scenario file not found:', scenarioPath)
    process.exit(1)
  }

  const scenario = JSON.parse(fs.readFileSync(scenarioPath, 'utf8'))

  console.log(`=== 🚀 Running Scenario: ${scenario.name} ===`)
  if (scenario.description) {
    console.log(`   ${scenario.description}`)
  }
  console.log('')

  // Build a lookup map: node name -> node config
  const nodeMap = {}
  for (const node of scenario.nodes) {
    nodeMap[node.name] = node
  }

  // 1. Wait for all nodes to start
  for (const node of scenario.nodes) {
    waitForStartup(node.dir, node.name)
  }

  // 2. Fund all nodes
  for (const node of scenario.nodes) {
    if (node.fund) {
      fundNode(scenario, node.dir, node.name, node.fund)
    }
  }

  console.log('>> ⛏️  Mining 10 blocks to confirm funding...')
  mineBlocks(scenario, 10)

  // 3. Wait for funds to confirm
  for (const node of scenario.nodes) {
    if (node.fund) {
      waitForFunds(node.dir, node.name)
    }
  }

  // 4. Open channels
  if (scenario.channels && scenario.channels.length > 0) {
    console.log('>> 🌐 Establishing peer connections...')

    for (let i = 0; i < scenario.channels.length; i++) {
      const ch = scenario.channels[i]
      const fromNode = nodeMap[ch.from]
      const toNode = nodeMap[ch.to]

      if (!fromNode || !toNode) {
        console.error(`❌ Unknown node in channel: ${ch.from} -> ${ch.to}`)
        console.error('   Available nodes:', Object.keys(nodeMap).join(', '))
        process.exit(1)
      }

      connectAndOpen(fromNode.dir, toNode.dir, ch.from, ch.to, ch.capacity)

      // Mine a block between channel opens to confirm change outputs
      if (i < scenario.channels.length - 1) {
        console.log(">> ⛏️  Mining 1 block to confirm change output...")
        mineBlocks(scenario, 1)
        execSync('sleep 2')
      }
    }

    console.log('>> ⛏️  Mining 6 blocks to confirm channels...')
    mineBlocks(scenario, 6)
  }

  console.log('')
  console.log('✅ Scenario Complete!')
  console.log(`   - ${scenario.nodes.length} nodes initialized.`)
  console.log(`   - ${(scenario.channels || []).length} channels established.`)
}

module.exports = { runScenario }
