const fsp = require('bare-fs/promises')
const crypto = require('bare-crypto')

// The small files datashell keeps beside its drives: the package registry and the
// capability grants. Written through a temporary name so a half written file is never
// what the next read finds, which is what the id is for; drive namespaces use it too.

async function read_json (file) {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'))
  } catch (err) {
    if (err.code === 'ENOENT') return {}
    throw err
  }
}

async function write_json (file, data) {
  const temp = file + '.' + uuid()
  try {
    await fsp.writeFile(temp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
    await fsp.rename(temp, file)
  } finally { await fsp.rm(temp, { force: true }) }
}

function uuid () {
  return crypto.randomBytes(16).toString('hex')
}

module.exports = { read_json, write_json, uuid }
