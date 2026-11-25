# sandbox

Runs code from a drive inside a microVM, so the code reaches only what it is given. The
microVM is made with [microsandbox](https://github.com/superradcompany/microsandbox) and its
`msb` command:

```sh
curl -fsSL https://install.microsandbox.dev | sh
```

Without `msb`, anything that needs a sandbox fails with
`microsandbox is not installed. Install it with: curl -fsSL https://install.microsandbox.dev | sh`.

There is no `cli sandbox`. Two commands use this module:

- `cli bot <name> --build` runs the code drive's `setup.js` inside a sandbox, with `run`.
- `cli bot <name> --run` hands the bot's `index.js` a sandbox through `require('sandbox')`,
  with `open`.

## The image

Every sandbox uses the same image, `node:26-bookworm-slim`, pinned by its digest (`IMAGE` in
[run.js](run.js)). There is no option to choose another.

## `run`: one command

```js
const { run, open } = require('./sandbox/run')

const sandbox = await run({ drive, mount, output, caps, command, audit })

sandbox.id              // the audit core's id
await sandbox.done      // settles when the command ends, with what it printed
sandbox.stop()          // stop it early; what it wrote so far is still copied out
```

| | |
| --- | --- |
| `drive` | the drive whose files the command sees, read-only, at `/app` |
| `mount` | more drives, each read-only at `/mnt/<drive id>` |
| `output` | the drive that receives what the command writes into `/out`. Without one there is no `/out` |
| `caps` | what the sandbox may reach on the network, see below. `{}` unless given |
| `command` | what to run inside, for example `['sh', '-c', 'node /app/setup.js']` |
| `audit` | the hypercore that records the run, see Identity below |

`done` gives what the command printed, not whether it failed: `msb wait` does not return the
command's exit code. `cli bot <name> --build` therefore runs
`node /app/setup.js && touch /out/.built`, and treats a missing `/out/.built` as a failure.

## `caps`: the network

| `caps` | `msb` flags | what the sandbox may reach |
| --- | --- | --- |
| `{}` | `--no-net` | nothing, in or out |
| `{ net: ['allow@dns', 'allow@example.com:tcp:443'] }` | `--net-default deny` and one `--net-rule` each | only what the rules allow |
| `{ ports: ['8080:8080'] }` | `--net-default-egress deny -p 8080:8080` | nothing outbound; the host reaches port 8080 inside |

`cli bot <name> --build` and a bot's sandbox are both given `{}`, so neither has a network.

## `open`: a sandbox that a bot's `index.js` uses

`open` takes the same options as `run`, apart from `command`. It starts the sandbox with
nothing running in it and returns a handle:

```js
const box = await open({ drive, mount, output, caps, audit })

box.handle    // what a bot's index.js gets as require('sandbox')
box.stop()    // stops the sandbox; index.js cannot call this
```

| `box.handle` | |
| --- | --- |
| `run(command, args)` | run a command inside with `msb exec`, and return what it printed. If it fails, throws an error whose `code` is the command's exit code |
| `start(command, args)` | the same, left running in the background |
| `put(file, data)` | write bytes to a path inside |
| `get(file)` | read a path inside, as a buffer |
| `logs()` | everything the sandbox has printed |

`cli bot <name> --run` opens the sandbox with the bot's own drive at `/app`, no output drive,
no other mounts and `caps` of `{}`. The sandbox is only started the first time `index.js` calls
one of these functions, so a bot that never uses `sandbox` never starts one and does not need
`msb` installed.

## Files in and out

The drive's files are copied out into a temporary folder and mounted read-only at `/app`. If
there is an output drive, `/out` is mounted writable. What the code wrote into `/out` is copied
into the output drive when the command ends, for `run`, or when the sandbox is stopped, for
`open`.

## Identity

Each bot has one **audit core**, a hypercore that every run of that bot appends to. The sandbox
is named `ds-` followed by the first 12 characters of the core's id. Every step is a message on
the core, so it lists, in order, how each run started, each call through the handle and how it
ended.

A message is `{ head, refs, type, data, meta }`:

| | |
| --- | --- |
| `head` | `['datashell', <sandbox name>, began]`, where `began` is the core's length when the run started |
| `refs` | the ids of the drives it was given: `drive`, `mount`, `output` |
| `type` | `run` or `open` when it starts, `exec`, `start`, `put` and `get` for each call through the handle, and `end` |
| `data` | what that step was given, or how the run ended |
| `meta` | `time`, when the message was written |

## The prepared image

`require('datashell').sandbox` is a second, older module ([index.js](index.js)). It runs one
prepared image under Docker, and flamingo's `lib/flamingo.js` starts its node with it.

| | |
| --- | --- |
| `up(app)` | make sure Docker is installed, build the image and start the container. Returns once the container is started, while the services inside keep coming up. Does nothing if it is already running |
| `running()` | whether the container is up |
| `logs()` | follow its output in this terminal until Ctrl+C |
| `down()` | stop the lightning nodes and then bitcoind over their RPC, waiting for each, and only then stop and remove the container |

- **Docker.** [install.js](install.js) checks `docker --version` and installs Docker if it is
  missing: `get.docker.com` on linux and macOS, winget on Windows.
- **The image** is built from the `Dockerfile` in the
  [flamingo-docker](https://github.com/basim-12/flamingo-docker) dependency, at the commit
  flamingo-node's `package.json` pins.
- **The container** is started with `docker run`, with its volumes, ports and command read
  from that dependency's `docker-compose.json`. `${FLAMINGO_PATH}` in a volume becomes the
  `app` folder passed to `up()`.
- **[exec.js](exec.js)** wraps `spawn` and `spawnSync` in promises, because `bare-subprocess`
  has no `exec`, `execFile` or `execSync`.
- **Node and Bare.** The module loads under both. Under Bare, the `imports` map in its
  `package.json` points `child_process`, `fs`, `os` and `path` at the `bare-*` packages.
