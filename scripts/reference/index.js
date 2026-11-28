const { URLSearchParams } = require('bare-url')

const LINK = /^dat:\/\/(\d+)\.(\d+)\.([a-z0-9]+)\.([a-f0-9]{64})(\/[^?]*)?(?:\?(.*))?$/

module.exports = { decode, encode, of }

function decode (link) {
  const m = LINK.exec(link)
  if (!m) throw new Error(`Invalid dat:// reference: ${link}`)
  return { length: Number(m[1]), fork: Number(m[2]), id: m[3], hash: m[4], file: m[5] || '', options: Object.fromEntries(new URLSearchParams(m[6] || '')) }
}

function encode ({ length, fork, id, hash, file = '', options = {} }) {
  const query = new URLSearchParams(options).toString()
  return `dat://${length}.${fork}.${id}.${hash}${file}${query ? '?' + query : ''}`
}

async function of (drive) {
  const hash = await drive.core.treeHash(drive.core.length)
  return encode({ length: drive.core.length, fork: drive.core.fork, id: drive.id, hash: hash.toString('hex') })
}
