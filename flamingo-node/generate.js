const process = require('bare-process')
const path = require('bare-path')
const { spawn } = require('bare-subprocess')

// Populate a Flamingo bot drive: pin the code entry and mint a wallet identity.
// The identity is a BIP39 mnemonic; each generated bot drive gets its own, and
// `fw bot <name> --run` recovers it through the existing initialize_node_wallet flow.
module.exports = async function (drive, options) {
  if (!options.code) throw new Error('Run this generator from an imported package, e.g. `flamingo-node/generate`')

  if (!(await drive.get('/bot.json', { wait: false }))) {
    await drive.put('/bot.json', Buffer.from(JSON.stringify({ entry: options.code + '/main.js' }, null, 2) + '\n'))
  }

  if (!(await drive.get('/wallet.json', { wait: false }))) {
    const node = process.env.FLAMINGO_NODE
    const cli = process.env.FLAMINGO_CLI
    if (!node || !cli) throw new Error('Run this generator through `fw pkg` or `fw bot`')
    const repo = path.dirname(path.dirname(cli))
    const mnemonic = await new Promise((resolve, reject) => {
      const child = spawn(node, ['-e', 'process.stdout.write(require("bip39").generateMnemonic())'], {
        cwd: repo, stdio: ['ignore', 'pipe', 'inherit']
      })
      let out = ''
      child.stdout.on('data', d => { out += d })
      child.once('error', reject)
      child.once('exit', code => code === 0 ? resolve(out.trim()) : reject(new Error('Could not generate a seed phrase')))
    })
    if (!mnemonic) throw new Error('Empty seed phrase from generator')
    await drive.put('/wallet.json', Buffer.from(JSON.stringify({ mnemonic }, null, 2) + '\n'))
  }
}
