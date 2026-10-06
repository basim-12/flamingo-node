const bip39 = require('bip39-mnemonic')

module.exports = async function (drive, options) {
  const mnemonic = bip39.generateMnemonic({ entropy: bip39.generateEntropy(16) }) // 16 bytes = 12 words, what the wallet expects
  await drive.put('/wallet.json', Buffer.from(JSON.stringify({ mnemonic }, null, 2)))
}
