const fs = require('bare-fs')
const path = require('bare-path')
const process = require('bare-process')

// Build Flamingo's code drive: the generator and entry from lib/drive, plus the
// flamingo-docker dependency read from node_modules at the commit package.json pins,
// so the drive carries the Docker setup without this repo keeping copies of it.
module.exports = async function (drive) {
  const app = process.cwd()
  await copy(drive, path.join(app, 'lib', 'drive'), '')
  await copy(drive, path.join(app, 'node_modules', 'flamingo-docker'), '/flamingo-docker')
}

async function copy (drive, folder, prefix) {
  for (const name of fs.readdirSync(folder)) {
    await drive.put(prefix + '/' + name, fs.readFileSync(path.join(folder, name)))
  }
}
