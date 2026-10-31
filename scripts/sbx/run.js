const fsp = require('bare-fs/promises')
const os = require('bare-os')
const path = require('bare-path')
const { capture } = require('./exec')
const { import_folder, export_folder } = require('../folder')

// The installer puts msb here and does not touch PATH, so this is where we look for it.
const MSB = path.join(os.homedir(), '.microsandbox', 'bin', 'msb')
const IMAGE = 'debian:bookworm-slim'

// Run a drive's code in a microVM that reaches only what it was granted. The drive's files
// go in through a read-only mount, and whatever the code writes to the output mount comes
// back out into the output drive, so the result of a run has an address.
//
// The audit core is the run's identity. Its first message says what the run was started
// with, and the sandbox is named after the core, so a run can be found again from it.
async function run ({ drive, mount = [], output, caps = {}, command, audit }) {
  await need_msb()
  await audit.ready()
  // Cut short because the mount paths are built from it, and still unique to this core.
  const name = 'ds-' + audit.id.slice(0, 12)
  await audit.append(Buffer.from(JSON.stringify({
    sandbox: name, drive: drive.id, mount: mount.map(each => each.id), output: output.id, caps, command
  })))

  // Resolved, because a mount path that goes through a symlink is refused, and on macOS
  // the temporary folder is behind one.
  const work = path.join(await fsp.realpath(os.tmpdir()), name)
  const app = path.join(work, 'app')
  const out = path.join(work, 'out')
  await fsp.rm(work, { recursive: true, force: true }) // a crashed run can leave this behind
  await fsp.mkdir(work, { recursive: true, mode: 0o700 })
  await fsp.mkdir(out, { mode: 0o700 })
  await export_folder(drive, app)

  // Each drive it may read, under the id of the drive it came from, so code inside can tell
  // them apart.
  const mounted = []
  for (const [index, each] of mount.entries()) {
    const folder = path.join(work, String(index))
    await export_folder(each, folder)
    mounted.push('--mount-dir', `${folder}:/mnt/${each.id}:ro`)
  }

  await capture(MSB, ['run', '-d', '--no-tty', '--name', name,
    ...network(caps),
    '--mount-dir', `${app}:/app:ro`,
    ...mounted,
    '--mount-dir', `${out}:/out`,
    IMAGE, '--', ...command
  ])

  return { id: audit.id, done: wait(), stop: () => capture(MSB, ['stop', name]) }

  // Settles when the code inside finishes, whether it stopped on its own or stop was
  // called. What it printed is the result, and what it wrote is in the output drive by
  // then. The sandbox and its folder are removed even if collecting that fails.
  async function wait () {
    await capture(MSB, ['wait', name])
    try {
      const printed = await capture(MSB, ['logs', name])
      await import_folder(output, out)
      return printed
    } finally {
      await capture(MSB, ['rm', name])
      await fsp.rm(work, { recursive: true, force: true })
    }
  }
}

// Nothing is allowed unless a cap says so. A published port needs ingress and --no-net
// closes ingress as well as egress, so a port with no outbound access denies egress only.
function network ({ net, ports = [] }) {
  const published = ports.flatMap(port => ['-p', port])
  if (net) return ['--net-default', 'deny', ...net.flatMap(rule => ['--net-rule', rule]), ...published]
  if (ports.length) return ['--net-default-egress', 'deny', ...published]
  return ['--no-net']
}

// Nothing here works without it, and a failed spawn would not say what to install.
async function need_msb () {
  try {
    await fsp.stat(MSB)
  } catch {
    throw new Error('microsandbox is not installed. Install it with: curl -fsSL https://install.microsandbox.dev | sh')
  }
}

module.exports = run
