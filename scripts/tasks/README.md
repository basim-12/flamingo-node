# tasks

This module runs bots. A bot is code from a drive that you start with
`cli bot <name> --run` and stop with `cli bot <name> --end`, and it keeps its data in a
drive of its own. The folder is called `tasks`, but what it runs is called a bot, the same
word the `cli bot` commands use.

It is built on [packs](../packs/README.md), which stores the drives and their names. packs
never calls into this module.

```js
const packs = require('./packs')
const tasks = require('./tasks')

const pkgs = await packs()
const bots = await tasks(pkgs)
await bots.create('alice', 'my-app/generate?ask=no')
const { done } = await bots.run('alice', console.log) // console.log gets each line it logs
// … later, from this process:
await bots.end('alice')
await bots.close()
await pkgs.close()
```

## What a bot is

A bot is a name registered against one drive, the bot's drive. It holds:

- `bot.json`, which says what to run:
  `{ "run": "dat://<length>.<fork>.<id>.<hash>/index.js" }`.
  The `dat://` reference is the **code drive**: the drive that holds the bot's code, pinned
  to one revision. `/index.js` is the file in it to run.
- whatever else the bot saves while it runs

`index.js` exports one async function, the **entry**:

```js
module.exports = async function (drive, { stopped, log }) {
  // drive: the bot's own writable drive
  // stopped: resolves when the bot is asked to stop, by cli bot <name> --end
  // log(line): prints the line in every terminal attached with --run --attach,
  //   and stores it in the bot's log, which `cli bot <name> --log` prints
  await stopped
}
```

Instead of waiting for `stopped`, the entry can return a function. It is called once the bot
is asked to stop.

Rules:

- **One drive, one bot.** Two bots on one drive would write their data into the same
  drive, so registering a second bot on a drive that already has one is refused.
- **One run at a time.** A bot that is already running can't be started again.
- **Code is pinned.** The `run` reference names one exact revision of the code drive, and
  that revision's hash is checked before anything runs.

## Storage

In the same folder as the packs storage, `~/.ds` unless another root is passed:

```text
~/.ds/
├── bots.json     # { "<bot-name>": "dat://<the bot's drive>", ... }
└── run/          # <bot-name>.pid while that bot is running
```

## API

`await tasks(pkgs)` reads `bots.json` and returns an object with the functions below. Each
one is named after the `cli bot` command that calls it. `list()` only reads `bots.json` and
does not open the drive storage, so it works even while another process has that open.

| Function | Command | What it does |
| --- | --- | --- |
| `list()` | `cli bot` | Bot names, sorted. |
| `see(name)` | `cli bot <name>` | Returns `{ name, drive, package, output, running }`: the bot's drive reference, the package name its drive is registered under (or `null`), the address of the output drive that `--build` writes into (it has an address before the first build), and whether the bot is running. Throws for an unknown name. |
| `create(name, spec)` | `cli bot +<name> <specifier>` | Register a bot. `spec` names a drive that already holds `bot.json`, or a generator in a drive (`<drive>/generate`). A generator fills a new drive, which is also registered as a package under the same name, and the cli writes its `bot.json`. Refused if the name is taken, if `spec` is a local path, or if the drive already belongs to another bot. Returns the bot's drive reference. |
| `build(name)` | `cli bot <name> --build` | If the code drive has a `setup.js`, runs it inside a microVM and saves what it writes into the output drive. Returns the text to print: what `setup.js` printed followed by `Built: <reference>`, or `Already built: <reference>` on a second build, or `Nothing to build` without a `setup.js`. Refused while the bot runs. |
| `run(name, print)` | `cli bot <name> --run` | Loads the entry and calls it, in this process. Writes `run/<name>.pid`, calls `print` with each line the bot logs and stores that line in its log. Each time the bot writes to its drive, the reference in `bots.json` and in the packages list moves to the new revision. Returns `{ done, stop }`: `stop()` asks the bot to stop, and `done` settles with `see(name)` once it has. Refused if the bot is already running. |
| `end(name)` | `cli bot <name> --end` | Stops the bot. If this process runs it, it is stopped directly; otherwise the process in `run/<name>.pid` is sent SIGTERM, and `end` waits up to 30 seconds for it to stop. Does nothing if the bot is not running. |
| `log(name)` | `cli bot <name> --log` | Everything the bot has logged, oldest first, across every run, one line each. It opens the drive storage, so from the cli it is read by the daemon, which already has the storage open; that is why it works while the bot runs. |
| `drop(name)` | `cli bot -<name>` | Deletes the bot, its log and audit cores, and the package its drive is registered as, if there is one, with that drive's data. The code drive is kept. Refused while the bot runs. |
| `close()` | none | Waits for `bots.json` to finish saving. It closes this module, not a bot, so no command calls it. |

`tasks.describe(seen)` turns what `see` returns into the lines `cli bot <name>` prints.
