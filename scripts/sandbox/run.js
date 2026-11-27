const fsp = require('bare-fs/promises')
const os = require('bare-os')
const path = require('bare-path')
const { capture } = require('./exec')
const { import_folder, export_folder } = require('../mirror')

// the installer puts msb here and does not add it to PATH
const MSB = path.join(os.homedir(), '.microsandbox', 'bin', 'msb')

// every sandbox uses this one image, pinned by digest so it is the same image every time
const IMAGE = 'node:26-bookworm-slim@sha256:bc0a2afd3b74ce12222fc8bab99271e66257f021078f5f4a5d687a77d280c1d9'

async function run (opts) {
  const box = await provision(opts)
  const { command } = opts
  await box.message('run', { caps: opts.caps || {}, command, image: IMAGE })
  await capture(MSB, ['run', '-d', '--no-tty', ...box.flags, '--', ...command])

  return {
    id: box.id,
    done: wait(),
    stop: () => box.stop()
  }

  // the sandbox and its folder are removed even if copying /out fails
  async function wait () {
    await capture(MSB, ['wait', box.name])
    try {
      const printed = await capture(MSB, ['logs', box.name])
      await box.collect()
      return printed
    } finally {
      await box.done()
    }
  }
}

async function open (opts) {
  const box = await provision(opts)
  await box.message('open', { caps: opts.caps || {}, image: IMAGE })
  await capture(MSB, ['create', ...box.flags])

  return {
    id: box.id,
    stop,
    handle: {
      // throws with the exit code, so index.js can tell a failure from an empty result
      async run (command, args = []) {
        await box.message('exec', { command, args })
        return capture(MSB, ['exec', '--no-tty', box.name, '--', command, ...args])
      },
      async start (command, args = []) {
        await box.message('start', { command, args })
        return capture(MSB, ['exec', '-d', '--no-tty', box.name, '--', command, ...args])
      },
      async put (file, data) {
        await box.message('put', { file, bytes: data.length })
        const temp = path.join(box.work, 'put')
        await fsp.writeFile(temp, data)
        try {
          await capture(MSB, ['copy', '-q', temp, `${box.name}:${file}`])
        } finally { await fsp.rm(temp, { force: true }) }
      },
      async get (file) {
        await box.message('get', { file })
        const temp = path.join(box.work, 'get')
        await capture(MSB, ['copy', '-q', `${box.name}:${file}`, temp])
        try {
          return await fsp.readFile(temp)
        } finally { await fsp.rm(temp, { force: true }) }
      },
      logs () {
        return capture(MSB, ['logs', box.name])
      }
    }
  }

  async function stop () {
    try {
      await box.stop()
      await box.collect()
    } finally {
      await box.done()
    }
  }
}

// README.md#lazy-open-on-first-use. The promise is kept, not the box, so two
// calls at once share one sandbox.
function lazy (opts) {
  let booting = null
  const ready = () => (booting = booting || open(opts)).then(box => box.handle)
  const call = name => (...args) => ready().then(handle => handle[name](...args))
  return {
    handle: { run: call('run'), start: call('start'), put: call('put'), get: call('get'), logs: call('logs') },
    stop: () => booting ? booting.then(box => box.stop()) : Promise.resolve()
  }
}

async function provision ({ drive, mount = [], output, built, caps = {}, audit }) {
  await need_msb()
  await audit.ready()
  // Cut short because the mount paths are built from it, and still unique to this core.
  const name = 'ds-' + audit.id.slice(0, 12)
  // Where this run's messages start, so its end can be paired with its beginning.
  const began = audit.length
  let stopped = false

  // Resolved, because a mount path that goes through a symlink is refused, and on macOS
  // the temporary folder is behind one.
  const work = path.join(await fsp.realpath(os.tmpdir()), name)
  const app = path.join(work, 'app')
  const out = path.join(work, 'out')
  await fsp.rm(work, { recursive: true, force: true }) // a crashed run can leave this behind
  await fsp.mkdir(work, { recursive: true, mode: 0o700 })
  if (output) await fsp.mkdir(out, { mode: 0o700 })
  if (built) await export_folder(built, out)
  await export_folder(drive, app)

  // under each drive's id, so code inside can tell them apart
  const mounted = []
  for (const [index, each] of mount.entries()) {
    const folder = path.join(work, String(index))
    await export_folder(each, folder)
    mounted.push('--mount-dir', `${folder}:/mnt/${each.id}:ro`)
  }

  return {
    name,
    work,
    id: audit.id,
    flags: ['--name', name,
      ...network(caps),
      '--mount-dir', `${app}:/app:ro`,
      ...mounted,
      ...(output ? ['--mount-dir', `${out}:/out`] : []),
      ...(built ? ['--mount-dir', `${out}:/out:ro`] : []),
      IMAGE
    ],
    message (type, data) {
      return audit.append(Buffer.from(JSON.stringify({
        head: ['datashell', name, began],
        refs: { drive: drive.id, mount: mount.map(each => each.id), output: output ? output.id : null, built: built ? built.id : null },
        type,
        data,
        meta: { time: Date.now() }
      })))
    },
    // nothing else stops a sandbox early, so the end message records that it was asked to
    stop () {
      stopped = true
      return capture(MSB, ['stop', name])
    },
    collect () {
      return output ? import_folder(output, out) : Promise.resolve()
    },
    async done () {
      await this.message('end', { stopped })
      await capture(MSB, ['rm', name])
      await fsp.rm(work, { recursive: true, force: true })
    }
  }
}

// README.md#caps-the-network. --no-net also closes ingress, so a published port denies egress only
function network ({ net, ports = [] }) {
  const published = ports.flatMap(port => ['-p', port])
  if (net) return ['--net-default', 'deny', ...net.flatMap(rule => ['--net-rule', rule]), ...published]
  if (ports.length) return ['--net-default-egress', 'deny', ...published]
  return ['--no-net']
}

// a failed spawn would not say what to install
async function need_msb () {
  try {
    await fsp.stat(MSB)
  } catch {
    throw new Error('microsandbox is not installed. Install it with: curl -fsSL https://install.microsandbox.dev | sh')
  }
}

module.exports = { run, open, lazy }
