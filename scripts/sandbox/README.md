# sandbox

Runs code from a drive inside a microVM, so the code reaches only what it is given. The
microVM is made with [microsandbox](https://github.com/superradcompany/microsandbox) and its
`msb` command:

```sh
curl -fsSL https://install.microsandbox.dev | sh
```

Without `msb`, anything that needs a sandbox fails with
`microsandbox is not installed. Install it with: curl -fsSL https://install.microsandbox.dev | sh`.

There is no `cli sandbox`. The module has two parts:

| | what | who uses it |
| --- | --- | --- |
| the **api** | `run`, `start`, `put`, `get`, `logs` | a bot's `index.js`, through `require('sandbox')` |
| the **sdk** | `run`, `open`, `lazy` in [run.js](run.js) | datashell: `cli bot <name> --build` and `cli bot <name> --run` |

## Box packs

A box pack is a dependency that runs in a microVM, made with `msb`. We use one in two ways:

| | used by | what it does |
| --- | --- | --- |
| a **builder** (`mix`) | `cli bot <name> --build` | installs or builds software once, and saves the result into the bot's output drive |
| a **driver** (`run`) | `cli bot <name> --run` | runs software in a microVM while the bot runs, and the bot's `index.js` uses that software |

We have one box pack, built in: this module. As a builder it runs the code drive's `setup.js`
with `run`, as `node /app/setup.js`. As a driver it gives `index.js` the api through `lazy`, and
`index.js` reaches the software inside by running commands with it.

Our box pack does not make a build reproducible. `setup.js` can do anything, so two bots built
from the same code drive can end up with different files, and a build from one machine may not
work on a machine of another architecture. What we do fix is the image: every sandbox starts
from the same image, pinned by its digest ([The image](#the-image)). A box pack that promises
reproducible builds has to do that itself, for example with nix or guix.

## The api: `require('sandbox')`

What a bot's `index.js` gets when it calls `require('sandbox')`:

| | |
| --- | --- |
| `run(command, args)` | run a command inside and return what it printed, trimmed. If the command fails, throws an error whose `message` is what it printed to stderr and whose `code` is its exit code: `127` for a command that is not there |
| `start(command, args)` | start a command inside and return at once, with the id `msb` gives it, for example `job_2433c690…` |
| `put(file, data)` | write a buffer or a string to a path inside. A path under `/app` throws, because `/app` is read only |
| `get(file)` | read a path inside, as a buffer |
| `logs()` | what the commands run in the sandbox have printed |

`args` is a list of strings, `[]` unless given.

These five are all a bot's `index.js` can do with its sandbox. It cannot stop the sandbox, give
it a network or mount another drive.

The bot's sandbox has the bot's own drive at `/app` and what `cli bot <name> --build` saved at
`/out`, both read only, and no network. `/out` is empty if the bot was never built. It is
started the first time `index.js` calls one of the five, so a bot that never uses `sandbox`
never starts one and does not need `msb` installed. It is stopped when the bot stops.

```js
const sandbox = require('sandbox')

module.exports = async function (drive, { on, log }) {
  await sandbox.put('/tmp/hello.sh', 'echo hello from the sandbox')
  log(await sandbox.run('sh', ['/tmp/hello.sh']))
  try {
    await sandbox.run('sh', ['-c', 'exit 3'])
  } catch (err) {
    log('failed with ' + err.code)
  }
  await on('exit')
}
```

`cli bot <name> --log` then shows `hello from the sandbox` and `failed with 3`.

## The sdk: `run`, `open`, `lazy`

What datashell uses, from [run.js](run.js). `cli bot <name> --build` uses `run`, and
`cli bot <name> --run` uses `lazy`, which calls `open`.

### `run`: one command

```js
const { run, open, lazy } = require('./sandbox/run')

const sandbox = await run({ drive, mount, output, caps, command, audit })

sandbox.id              // the audit core's id
await sandbox.done      // settles when the command ends, with what it printed
sandbox.stop()          // stop it early; what it wrote so far is still copied out
```

| | |
| --- | --- |
| `drive` | the drive whose files the command sees, read only, at `/app` |
| `mount` | more drives, each read only at `/mnt/<drive id>` |
| `output` | the drive that receives what the command writes into `/out`. Without one there is no `/out` |
| `built` | for `open` and `lazy`: a drive whose files are at `/out`, read only, instead of `output` |
| `caps` | what the sandbox may reach on the network, see below. `{}` unless given |
| `command` | what to run inside, for example `['sh', '-c', 'node /app/setup.js']` |
| `audit` | the hypercore that records the run, see Identity below |

`done` gives what the command printed, not whether it failed: `msb wait` does not return the
command's exit code. `cli bot <name> --build` therefore runs
`node /app/setup.js && touch /out/.built`, and treats a missing `/out/.built` as a failure
([tasks/index.js](../tasks/index.js#L108-L116)).

### `open`: a sandbox with nothing running

`open` takes the same options as `run`, apart from `command`. It starts the sandbox with
nothing running in it:

```js
const box = await open({ drive, mount, output, caps, audit })

box.id        // the audit core's id
box.handle    // the api
box.stop()    // stops the sandbox, and copies /out into the output drive
```

### `lazy`: open on first use

`lazy` takes the same options as `open` and returns at once, without starting anything:

```js
const box = lazy({ drive, built, audit })

box.handle    // the api; the first call opens the sandbox
box.stop()    // stops it, if it was opened
```

`cli bot <name> --run` calls `lazy` with the bot's own drive, its output drive as `built` and its
audit core, gives `box.handle` to `index.js` as `require('sandbox')`
([tasks/index.js](../tasks/index.js#L137-L138)), and calls `box.stop()` when the bot stops
([tasks/index.js](../tasks/index.js#L195)).

### `caps`: the network

| `caps` | `msb` flags | what the sandbox may reach |
| --- | --- | --- |
| `{}` | `--no-net` | nothing, in or out |
| `{ net: ['allow@dns', 'allow@example.com:tcp:443'] }` | `--net-default deny` and one `--net-rule` each | only what the rules allow |
| `{ ports: ['8080:8080'] }` | `--net-default-egress deny -p 8080:8080` | nothing outbound; the host reaches port 8080 inside |

`cli bot <name> --build` and a bot's sandbox are both given `{}`, so neither has a network.

Every `msb` option we can build caps on is in [msb.md](msb.md), and what `crun` can restrict
inside a microVM is in [crun.md](crun.md).

## The image

Every sandbox uses the same image, `node:26-bookworm-slim`, pinned by its digest (`IMAGE` in
[run.js](run.js)). There is no option to choose another.

## Files in and out

The drive's files are copied out into a temporary folder and mounted read only at `/app`. If
there is an output drive, `/out` is mounted writable. What the code wrote into `/out` is copied
into the output drive when the command ends, for `run`, or when the sandbox is stopped, for
`open`.

## Identity

Each bot has one **audit core**, a hypercore that every run of that bot appends to. The sandbox
is named `ds-` followed by the first 12 characters of the core's id. Every step is a message on
the core, so it lists, in order, how each run started, each api call and how it ended.

A message is `{ head, refs, type, data, meta }`:

| | |
| --- | --- |
| `head` | `['datashell', <sandbox name>, began]`, where `began` is the core's length when the run started |
| `refs` | the ids of the drives it was given: `drive`, `mount`, `output`, `built` |
| `type` | `run` or `open` when it starts, `exec` for each api `run`, `start`, `put` and `get` for the others, and `end`. `logs()` is not recorded |
| `data` | what that step was given, or how the run ended |
| `meta` | `time`, when the message was written |

## The prepared image

`require('datashell').sandbox` is a second, older module ([index.js](index.js)). It runs one
prepared image under Docker. flamingo's `lib/flamingo.js` uses it to start its Docker
container.

| | |
| --- | --- |
| `up(app)` | make sure Docker is installed, build the image and start the container. Returns once the container is started, while the services inside keep coming up. Does nothing if it is already running |
| `running()` | whether the container is up |
| `logs()` | follow its output in this terminal until Ctrl+C |
| `down()` | stop the lightning nodes and then bitcoind over their RPC, waiting for each, and only then stop and remove the container |

- **Docker.** [install.js](install.js) checks `docker --version` and installs Docker if it is
  missing: `get.docker.com` on linux and macOS, winget on Windows.
- **The image** is built from the `Dockerfile` in the
  [`flamingo-docker`](https://github.com/basim-12/flamingo-docker) dependency, at the commit
  `flamingo-node`'s `package.json` pins.
- **The container** is started with `docker run`, with its volumes, ports and command read
  from that dependency's `docker-compose.json`. `${FLAMINGO_PATH}` in a volume becomes the
  `app` folder passed to `up()`.
- **[exec.js](exec.js)** wraps `spawn` and `spawnSync` in promises, because `bare-subprocess`
  has no `exec`, `execFile` or `execSync`.
- **Node and Bare.** The module loads under both. Under Bare, the `imports` map in its
  `package.json` points `child_process`, `fs`, `os` and `path` at the `bare-*` packages.
