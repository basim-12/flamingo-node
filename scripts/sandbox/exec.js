const { spawn } = require('child_process')

function capture (cmd, args, { timeout = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    const timer = timeout ? setTimeout(() => child.kill(), timeout) : null
    let out = ''
    let err = ''
    child.stdout.on('data', data => { out += data })
    child.stderr.on('data', data => { err += data })
    child.once('error', reject)
    child.once('exit', code => {
      if (timer) clearTimeout(timer)
      if (code === 0) return resolve(out.trim())
      // the exit code is kept, so index.js can tell how a command inside the sandbox failed
      const failed = new Error(err.trim() || `${cmd} exited with code ${code}`)
      failed.code = code
      reject(failed)
    })
  })
}

function inherit (cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(' ')} exited with code ${code}`)))
  })
}

module.exports = { capture, inherit }
