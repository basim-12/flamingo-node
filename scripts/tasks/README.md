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
const { done } = await bots.run('alice', console.log) // console.log gets the cli bot <name> block, then each line it logs
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

`index.js` exports one async function, called when the bot runs:

```js
module.exports = async function (drive, { on, log }) {
  // drive: the bot's own drive, which index.js can write to
  // on('exit'): resolves when the bot is asked to stop, by cli bot <name> --end
  // log(line): prints the line in every terminal attached with --run --attach,
  //   and stores it in the bot's log, which `cli bot <name> --log` prints
  await on('exit')
}
```

Instead of waiting, the function can call `on('exit', listener)` and return straight away.
The bot keeps running, and `listener` is called and awaited once the bot is asked to stop. If
it does both, the code after `await on('exit')` runs first and the listener after it. If it
does neither, the bot ends as soon as the function returns. `exit` is the only event.

Rules:

- **One drive, one bot.** Two bots on one drive would write their data into the same
  drive, so registering a second bot on a drive that already has one is refused.
- **One run at a time.** A bot that is already running can't be started again.
- **Code is pinned.** The `run` reference names one exact revision of the code drive, and
  that revision's hash is checked before anything runs.

## Commands

| Command | What it does |
| --- | --- |
| `cli bot +<name> <specifier>` | Make a new bot, stopped. A drive (package name, drive id or `dat://` reference) becomes the bot's drive as it is, and must already contain `bot.json`. A generator in a drive (`<drive>/generate`) fills a new drive, and the cli writes its `bot.json`, which points at `index.js` in `<drive>`: `<drive>` is the code drive, and the new drive is the bot's drive. A local folder is copied into a new drive, and must contain `bot.json`. A local generator file fills a new drive, and must write `bot.json`. A new drive is also kept as a package named `<name>`. Refused if `<name>` is already a bot, or already a package when a new drive is made; if there is no valid `bot.json`; or if the drive already belongs to another bot. |
| `cli bot <name>`, or `--see` after it | Print `Name`, `Drive`, `Package` (or `(unnamed)`), `Output`, `Log` and `Status`. `Output` is the drive `--build` writes into; it has an address before the first build. |
| `cli bot` | Print that block for every bot, or `No bots.` |
| `cli bot <name> --build` | If the code drive has a `setup.js`, run it inside a microVM ([sandbox](../sandbox/README.md)) and save what it writes into `/out` into the output drive. Prints what `setup.js` printed, then `Built: <reference>`. A second build prints `Already built: <reference>`, and a code drive without `setup.js` prints `Nothing to build`. The microVM has no network. Refused while the bot runs. |
| `cli bot <name> --run` | Start the bot inside the daemon, and return once it runs. The bot keeps running after the command and the terminal close. Refused if it is already running. |
| `cli bot <name> --run --attach` | Print the `cli bot <name>` block, then each line the bot logs, in this terminal, until the bot stops. If the bot is already running, watch that run instead of starting another. Ctrl+C stops watching and leaves the bot running. Several terminals can watch one bot. |
| `cli bot <name> --end` | Stop the bot, keep its data, and print the `cli bot <name>` block. The only command that stops a bot. |
| `cli bot <name> --log` | Print every line the bot has logged, across every run, oldest first. If `index.js` threw, the log also holds `Error: <message>`. Works while it runs. The log is a hypercore in the drive storage, not a file. |
| `cli bot <name> --log=<count>` | Print only the newest `<count>` lines. |
| `cli bot -<name>` | Delete the bot, its log and audit cores, and the package its drive is registered as, with that drive's data. The code package is kept. Refused while it runs. |

A bot only starts when one of these commands starts it.

## Storage

In the same folder as the packs storage, `~/.ds` unless another root is passed:

```text
~/.ds/
├── bots.json     # { "<bot-name>": "dat://<the bot's drive>", ... }
└── run/          # <bot-name>.pid while that bot is running
```

## API

`await tasks(pkgs)` reads `bots.json` and returns an object with the functions below. Each
one does what its command in the table above does; this table only says what is particular
to calling it. `list()` only reads `bots.json` and does not open the drive storage, so it
works even while another process has that open.

| Function | Command | Takes and returns |
| --- | --- | --- |
| `list()` | `cli bot` | Bot names, sorted. |
| `see(name)` | `cli bot <name>` | Returns `{ name, drive, package, output, logged, running }`. `package` is `null` when the drive is no package. Throws for an unknown name. |
| `create(name, spec)` | `cli bot +<name> <specifier>` | A local path in `spec` has to be absolute. Returns the bot's drive reference. |
| `build(name)` | `cli bot <name> --build` | Returns the text `--build` prints. |
| `run(name, print)` | `cli bot <name> --run` | Runs the bot in this process, not in a daemon. Calls `print` with the `cli bot <name>` block once it runs, then with each line the bot logs, and writes `run/<name>.pid`. Each time the bot writes to its drive, the reference in `bots.json` and in the packages list moves to the new revision. Returns `{ done, stop }`: `stop()` asks the bot to stop, and `done` settles with `see(name)` once it has. |
| `end(name)` | `cli bot <name> --end` | Stops a bot this process runs directly. Otherwise it sends SIGTERM to the process in `run/<name>.pid` and waits up to 30 seconds for it to stop. Does nothing if the bot is not running. |
| `log(name, count)` | `cli bot <name> --log`, `--log=<count>` | Returns the lines as one string. It opens the drive storage, so from the cli it is read by the daemon, which already has the storage open; that is why it works while the bot runs. |
| `drop(name)` | `cli bot -<name>` | Returns nothing. |
| `close()` | none | Waits for `bots.json` to finish saving. It closes this module, not a bot, so no command calls it. |

`tasks.describe(seen)` turns what `see` returns into the lines `cli bot <name>` prints.
