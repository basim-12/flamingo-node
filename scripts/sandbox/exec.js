const { spawn } = require('child_process')

// Run a command and return what it printed. Promise around spawn rather than exec,
// because bare-subprocess has no exec and this has to work under Bare too.
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
      if (code === 0) resolve(out.trim())
      else reject(new Error(err.trim() || `${cmd} exited with code ${code}`))
    })
  })
}

// The same, but the command prints straight to this terminal.
function inherit (cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(' ')} exited with code ${code}`)))
  })
}

module.exports = { capture, inherit }
