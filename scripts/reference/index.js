const { URLSearchParams } = require('bare-url')
const Hyperdrive = require('hyperdrive')
const id_encoding = require('hypercore-id-encoding')

const LINK = /^dat:\/\/(\d+)\.(\d+)\.([a-z0-9]+)\.([a-f0-9]{64})(\/[^?]*)?(?:\?(.*))?$/

module.exports = { decode, encode, of, open, known }

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

// README.md#openstore-link--pinned-
async function open (store, link, { pinned = true } = {}) {
  const ref = decode(link)
  if (!(await known(store, ref.id))) throw new Error(`Drive is not available locally: ${ref.id}`)
  const drive = new Hyperdrive(store.session(), ref.id)
  await drive.ready()
  try {
    if (drive.core.fork !== ref.fork || drive.core.length < ref.length) throw new Error('Referenced drive revision is unavailable')
    if ((await drive.core.treeHash(ref.length)).toString('hex') !== ref.hash) throw new Error('Drive hash mismatch')
    if (!pinned) return drive
    const revision = drive.checkout(ref.length)
    await revision.ready()
    // a revision reads through the drive it came from, so closing it closes that drive too
    const close = revision.close.bind(revision)
    revision.close = async () => { await close(); await drive.close() }
    return revision
  } catch (err) { await drive.close(); throw err }
}

// Corestore has no "do you have this?" call, so open the core without letting it be created:
// a missing one says so on ready()
async function known (store, id) {
  const core = store.get({ key: id_encoding.decode(id), createIfMissing: false })
  try {
    await core.ready()
  } catch (err) {
    if (err.code !== 'STORAGE_EMPTY') throw err
    return false
  }
  await core.close()
  return true
}
