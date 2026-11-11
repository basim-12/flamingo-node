const fsp = require('bare-fs/promises')
const path = require('bare-path')
const Localdrive = require('localdrive')
const MirrorDrive = require('mirror-drive')

// A drive and a local folder, copied either way. A package's contents come in this way and
// go out again, and it is also how a drive's files get somewhere a sandbox can mount them.

// MirrorDrive copies bytes; the metadata hooks keep empty folders and permissions.
async function import_folder (drive, folder) {
  const metadata = new Map()
  const dirs = []
  async function walk (relative = '') {
    for (const item of await fsp.readdir(path.join(folder, relative), { withFileTypes: true })) {
      const key = relative + '/' + item.name
      const stat = await fsp.lstat(path.join(folder, key))
      if (!stat.isDirectory() && !stat.isFile()) throw new Error(`Unsupported filesystem entry: ${key}`)
      metadata.set(key, { mode: stat.mode & 0o777 })
      if (stat.isDirectory()) {
        dirs.push(key)
        await walk(key)
      }
    }
  }
  await walk()
  await new MirrorDrive(new Localdrive(folder, { metadata }), drive, { prune: false, preload: false }).done()
  for (const key of dirs) await drive.put(key, Buffer.alloc(0), { metadata: { ...metadata.get(key), directory: true } })
}

async function export_folder (drive, folder) {
  await fsp.mkdir(folder, { mode: 0o700 })
  try {
    const dirs = []
    const metadata = new Map()
    for await (const { key, value } of drive.list()) {
      if (value.metadata?.directory) {
        const dest = path.join(folder, key)
        await fsp.mkdir(dest, { recursive: true })
        dirs.push([dest, value.metadata.mode])
      }
    }
    await new MirrorDrive(drive, new Localdrive(folder, { metadata }), {
      prune: false, preload: false, filter: key => !dirs.some(([dir]) => dir === path.join(folder, key))
    }).done()
    for (const [key, meta] of metadata) if (meta?.mode !== undefined) await fsp.chmod(path.join(folder, key), meta.mode)
    for (const [dir, mode] of dirs.reverse()) await fsp.chmod(dir, mode)
  } catch (err) {
    await fsp.rm(folder, { recursive: true, force: true })
    throw err
  }
}

module.exports = { import_folder, export_folder }
