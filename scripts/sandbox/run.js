const fsp = require('bare-fs/promises')
const os = require('bare-os')
const path = require('bare-path')
const { capture } = require('./exec')
const { import_folder, export_folder } = require('../mirror')

// The installer puts msb here and does not touch PATH, so this is where we look for it.
const MSB = path.join(os.homedir(), '.microsandbox', 'bin', 'msb')

// The one image datashell runs anything in. Not an option, because a sandbox that takes any
// image means ten bots pull ten images that do the same job: there are seven here from
// testing and they come to 1.4 GiB, while one shared image is 80 MiB however many bots use
// it. The module could offer the choice if it were published on its own; datashell does not
// take it.
//
// Pinned by digest, so it is the same thing every time and not something
// we maintain. It carries Node because a setup script is still run inside as JavaScript. Once
// that script runs outside instead, nothing in here needs a runtime and this can be a smaller
// base.
const IMAGE = 'node:26-bookworm-slim@sha256:bc0a2afd3b74ce12222fc8bab99271e66257f021078f5f4a5d687a77d280c1d9'

// Run a drive's code in a microVM that reaches only what it was granted. The drive's files
// go in through a read-only mount, and whatever the code writes to the output mount comes
// back out into the output drive, so the result of a run has an address.
//
// Without an output drive there is no writable mount at all, because a run that produces
// nothing has no use for one.
//
// The audit core is the run's identity, and one core serves a task across its runs: a run
// and an end are both entries, so the core reads as when it started, when it stopped, and
// what it was given in between. The sandbox is named after the core, so a run can be found
// again from it.
async function run(opts) {
  const box = await provision(opts)
  const { command } = opts
  await box.entry('run', { caps: opts.caps || {}, command, image: IMAGE })
  await capture(MSB, ['run', '-d', '--no-tty', ...box.flags, '--', ...command])

  return {
    id: box.id,
    done: wait(),
    stop: () => box.stop()
  }

  // Settles when the code inside finishes, whether it stopped on its own or stop was
  // called. What it printed is the result, and what it wrote is in the output drive by
  // then. The sandbox and its folder are removed even if collecting that fails.
  async function wait() {
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

// The same sandbox, booted with nothing running in it, and the handle a drive's own script
// drives it with. The script runs out here under Bare where it can resolve nothing, so the
// handle is the only thing it can do anything through, and the sandbox it names was already
// built from what was granted: the script chooses what to run inside, never what the
// sandbox is allowed to reach.
async function open(opts) {
  const box = await provision(opts)
  await box.entry('open', { caps: opts.caps || {}, image: IMAGE })
  await capture(MSB, ['create', ...box.flags])

  return {
    id: box.id,
    stop,
    handle: {
      // What the command printed. It throws with the code the command exited with, so a
      // script can tell a failure from an empty result.
      async run(command, args = []) {
        await box.entry('exec', { command, args })
        return capture(MSB, ['exec', '--no-tty', box.name, '--', command, ...args])
      },
      // Left running, so the script can get on with something else and stop later.
      async start(command, args = []) {
        await box.entry('start', { command, args })
        return capture(MSB, ['exec', '-d', '--no-tty', box.name, '--', command, ...args])
      },
      async put(file, data) {
        await box.entry('put', { file, bytes: data.length })
        const temp = path.join(box.work, 'put')
        await fsp.writeFile(temp, data)
        try {
          await capture(MSB, ['copy', '-q', temp, `${box.name}:${file}`])
        } finally { await fsp.rm(temp, { force: true }) }
      },
      async get(file) {
        await box.entry('get', { file })
        const temp = path.join(box.work, 'get')
        await capture(MSB, ['copy', '-q', `${box.name}:${file}`, temp])
        try {
          return await fsp.readFile(temp)
        } finally { await fsp.rm(temp, { force: true }) }
      },
      logs() {
        return capture(MSB, ['logs', box.name])
      }
    }
  }

  async function stop() {
    try {
      await box.stop()
      await box.collect()
    } finally {
      await box.done()
    }
  }
}

// Everything both of them need: msb present, the audit core open, a work folder with the
// drive and its mounts exported into it, and the create arguments that follow from the
// caps. Nothing here starts anything.
async function provision({ drive, mount = [], output, caps = {}, audit }) {
  await need_msb()
  await audit.ready()
  // Cut short because the mount paths are built from it, and still unique to this core.
  const name = 'ds-' + audit.id.slice(0, 12)
  // Where this run's entries start, so its end can be paired with its beginning.
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
  await export_folder(drive, app)

  // Each drive it may read, under the id of the drive it came from, so code inside can tell
  // them apart.
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
      IMAGE
    ],
    entry(type, data) {
      return audit.append(Buffer.from(JSON.stringify({
        head: ['datashell', name, began],
        refs: { drive: drive.id, mount: mount.map(each => each.id), output: output ? output.id : null },
        type,
        data,
        meta: { time: Date.now() }
      })))
    },
    // Only ever called because something asked for it: nothing else stops a sandbox
    // early, so the end entry records it as asked for.
    stop() {
      stopped = true
      return capture(MSB, ['stop', name])
    },
    collect() {
      return output ? import_folder(output, out) : Promise.resolve()
    },
    async done() {
      await this.entry('end', { stopped })
      await capture(MSB, ['rm', name])
      await fsp.rm(work, { recursive: true, force: true })
    }
  }
}

// Nothing is allowed unless a cap says so. A published port needs ingress and --no-net
// closes ingress as well as egress, so a port with no outbound access denies egress only.
function network({ net, ports = [] }) {
  const published = ports.flatMap(port => ['-p', port])
  if (net) return ['--net-default', 'deny', ...net.flatMap(rule => ['--net-rule', rule]), ...published]
  if (ports.length) return ['--net-default-egress', 'deny', ...published]
  return ['--no-net']
}

// Nothing here works without it, and a failed spawn would not say what to install.
async function need_msb() {
  try {
    await fsp.stat(MSB)
  } catch {
    throw new Error('microsandbox is not installed. Install it with: curl -fsSL https://install.microsandbox.dev | sh')
  }
}

module.exports = { run, open }
