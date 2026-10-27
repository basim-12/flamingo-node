# sbx

Runs code datashell did not write, with only what it was granted. A drive holds the code, and the
sandbox is where it is allowed to run.

Nothing outside this module names Docker, a container or an image. Docker is how the sandbox
is built today, `docker sbx` is how it is meant to be built next, and both are this module's
business alone.

## What it is for

A drive can come from anyone. Running its code on the machine that discovered it is not an
option: it would reach the user's files, their network and their processes. So code from a
drive runs in here, and what it can touch is only what it declared and was granted. That is
the other half of [cap](../cap/README.md): caps say *what* a drive may use, the sandbox is
*where* using it is contained.

It also makes the interesting thing possible. A drive's code runs in a sandbox, its output
lands in another drive, and that drive is the input of the next one, so sandboxed runs chain
into a pipeline across machines, and running a stranger's code stops being reckless.

## Using it

Nothing user facing. There is no `cli sbx`, a bot is started with `cli bot <name> --run` as
before and the sandbox underneath is invisible. Datashell uses it through this api:

```js
const sbx = require('./sbx')

const run = await sbx.run({ drive, mount, output, caps })

await run.done          // settles when the code inside finishes
run.stop()              // stop it, the sandbox is torn down either way
await sbx.running(name)
```

| | |
| --- | --- |
| `drive` | the drive whose code runs, at a pinned revision |
| `mount` | drives to make readable inside, by `dat://` reference, pack name or bot drive name |
| `output` | the drive that receives what the code writes, so a run's result is addressable |
| `caps` | what it was granted, which decides what is wired in at all |

Today the module is narrower than that: `up(app)` / `down()` / `running()` / `logs()`, which
start and stop one prepared image, the Flamingo node. The shape above is what the first
`cli cap` work turns it into. It lives in flamingo-node for the moment and moves here with
that work.

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

- **`docker sbx`** instead of a prepared image per app: one generic base, a drive's code
  mounted in, and whatever it installs done inside the sandbox rather than baked by us.
- **Drives in, drives out.** A watched drive is mirrored into the sandbox, and a volume is
  watched the other way so everything the code writes lands in an output drive. Nothing has
  to be copied by hand and a run's result has an address.
- **Bots run inside.** Today a bot runs in the daemon and only the node it starts is
  sandboxed. The bot itself belongs inside too.
- **Docker in Docker** stays available for a drive that needs a base we do not offer,
  eventually through something like `require('bare-docker')`.
- **Less Docker over time.** If a base image's filesystem is itself a hyperdrive, a set of
  drives mounted into an empty base replaces the image, versioned like layers and with the
  same rollback. `fuse` is one route; `localdrive` and `mirror-drive` already do the
  checkout, watch and copy that gets most of the effect.

## Open

- Where the boundary sits when a drive needs a program installed: inside the sandbox at first
  run, or into a drive once and mounted from then on.
- How a run is identified and found again: by the output drive, by the sandbox, or both.
- Whether a sandbox is reused between runs of the same drive, or always fresh.
