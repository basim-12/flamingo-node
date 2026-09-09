const process = require('bare-process')
const path = require('bare-path')
const { spawn } = require('bare-subprocess')

// Bind this bot's stored identity to node4, then delegate the runtime to the
// existing Docker CLI (`fw up` / `fw up --shutdown`). Application-specific setup
// lives here, not in the generic CLI.
module.exports = async function (drive, { stopped, log }) {
  const cli = process.env.FLAMINGO_CLI
  const node = process.env.FLAMINGO_NODE
  if (!cli || !node) throw new Error('Launch this bot through `fw bot <name> --run`')
  const repo = path.dirname(path.dirname(cli))

  const run = (args, opts = {}) => new Promise((resolve, reject) => {
    const child = spawn(node, args, {
      cwd: repo,
      stdio: opts.capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
      env: { ...process.env, FLAMINGO_BOT: '1', ...opts.env }
    })
    let out = ''
    if (opts.capture) child.stdout.on('data', d => { out += d })
    child.once('error', reject)
    child.once('exit', (code, signal) => { code === 0 ? resolve(out) : reject(new Error(`command failed (${code ?? signal})`)) })
  })

  await run([cli, 'up'])
  try {
    const saved = await drive.get('/wallet.json', { wait: false })
    const prior = saved ? (JSON.parse(saved.toString()).mnemonic || '') : ''
    const raw = await run([path.join(__dirname, 'wallet-init.js')], {
      capture: true,
      env: { NODE_PATH: path.join(repo, 'node_modules'), BOT_MNEMONIC: prior }
    })
    const identity = JSON.parse(raw)
    if (!prior && identity.mnemonic) {
      await drive.put('/wallet.json', Buffer.from(JSON.stringify({ mnemonic: identity.mnemonic }, null, 2) + '\n'))
    }
    log(`${prior ? 'Restored' : 'Created'} bot identity ${identity.nodeId || ''}`.trim())
    log('Flamingo is running via Docker. Stop it with `fw bot <name> --end` or Ctrl+C.')
    await stopped
  } finally {
    await run([cli, 'up', '--shutdown'])
  }
}
