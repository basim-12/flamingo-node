const fs = require('fs')
const path = require('path')
const process = require('process')

// The settings file `fw` reads from the folder it runs in. Its own module because the
// container entrypoint needs the settings and nothing else of the api: requiring the api
// for them would pull the sandbox into the container it is running inside.
const file = process.env.ENV_FILE || path.resolve(process.cwd(), 'env.json')

function load () {
  if (fs.existsSync(file)) Object.assign(process.env, JSON.parse(fs.readFileSync(file, 'utf8')))
}

module.exports = { file, load }
