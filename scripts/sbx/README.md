# sbx

Runs code datashell did not write, with only what it was granted. A drive holds the code, and the
sandbox is where it is allowed to run.

Nothing outside this module names Docker, a container or an image, and nothing will name
microsandbox either. Docker is how the sandbox is built today, microsandbox is how it is built
next, and which one it is stays this module's business.

## What it is for

A drive can come from anyone. Running its code on the machine that discovered it is not an
option: it would reach the user's files, their network and their processes. So code from a
drive runs in here, and what it can touch is only what it declared and was granted. That is
the other half of [cap](../cap/README.md): caps say *what* a drive may use, the sandbox is
*where* using it is contained.

It also makes the interesting thing possible. A drive's code runs in a sandbox, its output
lands in another drive, and that drive is the input of the next one, so sandboxed runs chain
into a pipeline across machines, and running a stranger's code stops being reckless.

Only the drive's own code goes inside. Datashell's bot machinery stays out here, because
putting it in the same sandbox as untrusted code offers it up to be attacked.

## Using it

Nothing user facing. There is no `cli sbx`, a bot is started with `cli bot <name> --run` as
before and the sandbox underneath is invisible. Datashell uses it through this api:

```js
const sbx = require('./sbx')

const run = await sbx.run({ drive, mount, output, caps })

run.id                  // the audit core, which is also the sandbox's identity
run.input               // messages in
run.output              // messages out
await run.done          // settles when the code inside finishes
run.stop()              // stop it, the sandbox is torn down either way
```

| | |
| --- | --- |
| `drive` | the drive whose code runs, at a pinned revision |
| `mount` | drives to make readable inside, by `dat://` reference, pack name or bot drive name |
| `output` | the drive that receives what the code writes, so a run's result is addressable |
| `caps` | what it was granted, which decides what is wired in at all |

Today the module is narrower than that: `up(app)` / `down()` / `logs()` / `running()`, which
start and stop one prepared image, the Flamingo node, and say whether its container is up.
The shape above is what the first `cli cap` work turns it into. It lives in flamingo-node for
the moment and moves here with that work.

## Messages in and out

Two hypercores, which are stdin and stdout. There is no third one for errors: an error is a
message on the output core with an error type, not a separate channel.

- **input** is created outside and its code reads it. Whoever spawned the sandbox, or an app
  talking to it later, appends to it.
- **output** is created and owned by the sandbox. A message on it can carry a `dat://`
  reference, or a path inside the output drive, so a large result is linked rather than
  copied into the feed.

The transport is `--vsock`. Datashell's daemon already serves its api on a unix socket, so the
same socket is handed to the sandbox and the code inside connects out to it: no port is
published, nothing of the host is reachable except that one socket, and the daemon on the other
end stays outside where malicious code cannot touch it. What it is allowed to ask for over that
socket is the capability question, not a sandbox question.

Files are the other half of it. The code inside writes into its own filesystem, that path is
watched, and what appears there lands in the **output drive**. So a run has two results: a
feed of messages and an addressable drive, and the paths in the first point into the second.

## Identity, and resuming

Every run has an **audit core**. Its first message records the parameters it was started with:
the id of the input core, and the addresses of `drive`, `mount`, `output` and `caps`. The
sandbox's id is derived from that core, so the core is both the record of what a run was
allowed and the handle to find it again.

Resuming is then one lookup. Given a sandbox id, its audit core says what it was, which
drives it had and which caps were granted, and it starts again on the same terms without
asking anyone anything. A bot is meant to be reusable that way. Deleting it and starting a
fresh one is the user's call.

## What microsandbox gives us

Docker Sandboxes is out. It needs a Docker account and is not open source all the way down,
and that is a dealbreaker. The replacement is
[microsandbox](https://github.com/superradcompany/microsandbox): Apache-2.0, open source, and
it runs locally with **no account at all**. An api key exists only for their optional hosted
backend, which we do not use — local is the default and needs no credential.

```sh
curl -fsSL https://install.microsandbox.dev | sh
```

macOS on Apple silicon, linux with KVM, windows with WHP, so it reaches further than Docker
Sandboxes did. It is still beta, which is worth saying out loud.

We drive the `msb` command line tool and write our own small wrapper around it, rather than
pulling their npm SDK and its TypeScript conventions into our code. Everything below is an
`msb` flag, so nothing is given up by staying on the cli.

- **Isolation.** A microVM per sandbox, booted as a child process. No daemon and no
  long-running service to depend on.
- **Permissions are deny-first and fine grained.** `--no-net` for nothing at all, or
  `--net-default deny` with `--net-rule` for exactly what is needed. A rule reads
  `<action>[:<direction>]@<target>[:<proto>[:<ports>]]`, so ingress and egress are separate,
  tcp/udp/icmp are separate, and a target can be a domain, a domain suffix, an ip, a CIDR or a
  group like `private` or `meta`. `-p` publishes a port, which settles the question Docker
  Sandboxes left open: a lightning node can accept peers.
- **Mounts, four kinds.** `--mount-dir` and `--mount-file` for host paths, `--mount-named` for
  persistent named storage, `--mount-disk` for a disk image, `--tmpfs` for memory only, and
  `--mount-owned` for storage that dies with the sandbox. Each takes options, `:ro` among them.
- **A host socket straight into the guest.** `--vsock /path/on/host.sock:PORT` wires a unix
  socket on the host to the sandbox over virtio-vsock, with no TCP port opened. Code inside
  connects to CID 2 on that port. This is the one that matters most to us, and the next
  section says why.
- **Resources.** `--cpus` and `--memory`, with `--max-cpus` / `--max-memory` reserving room for
  `msb modify` to resize a sandbox while it runs.
- **Lifecycle.** `msb create` / `start` / `stop` / `rm`, plus `fork` and `snap create` /
  `snap restore`, so a bot can be reused, forked or thrown away, which is what he asked for.

Still open: whether **network rules** can be changed on a running sandbox. `msb modify`
documents cpus and memory only, so a cap granted or revoked mid-run may mean a restart. It
gets tested rather than assumed.

## How it works today

- **Docker.** The module checks `docker --version` and installs Docker if it is missing
  (`get.docker.com` on linux and macOS, winget on Windows). Docker has to be available.
- **The image** is built from a `Dockerfile` pinned by commit, so the same commit always
  produces the same image. What goes into it is installed by one script, with its ubuntu base
  pinned by digest and each program pinned by checksum or commit.
- **The container** is started with `docker run`, with its arguments read from a
  `docker-compose.json`: the volumes it mounts, the ports it publishes and the command it
  runs. We read the compose file ourselves rather than calling `docker compose`, so there is
  one way things start and no second tool in the middle.
- **Stopping** is deliberate rather than a `docker stop`: a program that is mid write can
  lose state, so each one is asked to stop over its own interface and waited for before the
  container is removed.
- **Both runtimes.** The module loads under Node and under Bare. Its `package.json` `imports`
  map points `child_process`, `fs`, `os` and `path` at the `bare-*` packages when Bare
  resolves them, and Node ignores the map because its keys do not start with `#`.
  `bare-subprocess` has no `exec`, `execFile` or `execSync`, so everything here is spawn
  based and reads output as bytes.

## Where it is going

- **A generic base** instead of a prepared image per app: one small base, a drive's code
  mounted in, and whatever it installs done inside the sandbox rather than baked by us.
- **Drives in, drives out,** over the passthrough mount described above, so nothing is copied
  by hand and a run's result has an address.
- **Custom code inside, bot logic outside.** Today a bot runs in the daemon and only the node
  it starts is sandboxed. What moves inside is the drive's own code; the generic machinery
  that manages it stays where it is.
- **Docker inside the sandbox** for a drive that needs a base we do not offer: install
  `docker.io` in the microVM and run containers there, which is a Docker daemon of its own and
  not a hole in the host's. Eventually through something like `require('bare-docker')`.
- **Less Docker over time.** If a base image's filesystem is itself a hyperdrive, a set of
  drives mounted into an empty base replaces the image, versioned like layers and with the
  same rollback. `localdrive` and `mirror-drive` already do the checkout, watch and copy, so
  with a passthrough mount `fuse` is not needed to get most of the effect.
