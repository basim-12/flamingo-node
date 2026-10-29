# sbx

Runs code datashell did not write, with only what it was granted. A drive holds the code, and the
sandbox is where it is allowed to run.

Nothing outside this module names Docker, a container or an image. Docker is how the sandbox
is built today, Docker Sandboxes is how it is meant to be built next, and both are this
module's business alone.

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
start and stop one prepared image, the Flamingo node, and say whether its container is up. The shape above is what the first `cli cap` work turns
it into. It lives in flamingo-node for the moment and moves here with that work.

## Messages in and out

Two hypercores, which are stdin and stdout. There is no third one for errors: an error is a
message on the output core with an error type, not a separate channel.

- **input** is created outside and its code reads it. Whoever spawned the sandbox, or an app
  talking to it later, appends to it.
- **output** is created and owned by the sandbox. A message on it can carry a `dat://`
  reference, or a path inside the output drive, so a large result is linked rather than
  copied into the feed.

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

## What Docker Sandboxes gives us

First, a correction worth having written down: **`docker sandbox` is gone.** The cli plugin
still ships, but it reports *"docker sandbox is deprecated and has been removed"*. The product
is now **Docker Sandboxes**, a separate `sbx` cli:

```sh
brew trust docker/tap && brew install docker/tap/sbx
sbx login
```

Docker Desktop is not required, local sandboxes are free, and on mac it needs 14+ on Apple
silicon. `sbx login` is a Docker account sign-in, which is a dependency on Docker's servers
for something otherwise local, and the reason the sandbox wants to stay behind this module
rather than be assumed everywhere.

- **Isolation.** Each sandbox is a microVM with its own kernel, **its own Docker daemon** and
  its own image cache. Not a shared-kernel container. So Docker in Docker is simply there, and
  the Flamingo container can run inside a sandbox unchanged.
- **Talking to it.** `sbx exec` runs a command inside, editors attach over ssh, bare `sbx` is
  interactive. There is no message bus, so stdio through `exec` is the whole of it, which is
  why the input and output cores above are ours and not Docker's.
- **Files.** A host path given to `sbx create` or `sbx run` is mounted at the same absolute
  path by filesystem passthrough: read-write, changes flowing both ways, no sync process in
  between. Nothing of the host outside that mount is reachable. This is what makes drives in
  and out cheap — mirror a drive into a mounted folder and what the code writes comes straight
  back.
- **Network.** Deny by default. All outbound TCP goes through a proxy on the host and only an
  allowlist gets through; `sbx policy ls` lists the rules and they can be removed. UDP is
  blocked unless an experimental flag is set, ICMP always. So a bitcoin node inside has no
  network until it is granted one, and that is enforced by the sandbox rather than by us.
- **Persistence.** The VM survives stop and restart with its installed packages and images
  intact, until `sbx rm` deletes it.

Two things the docs do not answer, so they get tested before anything is built on them:
whether a policy change reaches a **running** sandbox, and whether **inbound** connections can
be published at all, which a lightning node accepting peers needs.

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
- **Docker in Docker** for a drive that needs a base we do not offer, eventually through
  something like `require('bare-docker')`. Inside a microVM this is a local Docker daemon, not
  a hole in the host's.
- **Less Docker over time.** If a base image's filesystem is itself a hyperdrive, a set of
  drives mounted into an empty base replaces the image, versioned like layers and with the
  same rollback. `localdrive` and `mirror-drive` already do the checkout, watch and copy, so
  with a passthrough mount `fuse` is not needed to get most of the effect.
