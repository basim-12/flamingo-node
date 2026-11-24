# tasks

Bots: things that run from a pack's drive and can be stopped and started again. The
module is called `tasks` and what it runs is a bot; the CLI's `bot` commands are this
module. It is built on a `packs()` instance: packs hold the data, this runs it, and
packs know nothing about bots.

```js
const process = require('bare-process')
const packs = require('./packs')
const tasks = require('./tasks')

const pkgs = await packs()
const bots = await tasks(pkgs)
await bots.create('alice', 'my-app/generate?ask=no', process.cwd())
const { done } = await bots.start('alice', console.log) // and into the bot's log core
// … later, from this process:
await bots.end('alice')
await bots.close()
await pkgs.close()
```

## What a bot is

A bot is a name registered against one drive. That drive holds:

- `bot.json`: what to run, as `{ "run": "dat://<pinned code drive>/index.js" }`
- whatever else the bot saves while it runs

The entry is a function the code drive exports:

```js
module.exports = async function (drive, { stopped, log }) {
  // drive: the bot's own writable drive
  // stopped: resolves when the bot is asked to stop
  // log(line): show a line to whoever started it, and append it to the log core
  await stopped
}
```

The entry may instead return a cleanup function, which runs after `stopped`.

Rules:

- **One drive, one bot.** Two bots on one drive would share one identity and one
  data folder, so registering a second one is refused.
- **One run at a time.** A bot that is already running can't be started again,
  and neither can another bot on the same drive.
- **Code is pinned.** The `run` reference names an exact revision of the code
  drive, and its hash is checked before anything runs.

## Storage

Next to the packs' storage under the same root:

```text
<root>/
├── bots.json     # { "name": "dat://…" }
└── run/          # <name>.pid while that bot is running
```

## API

`await tasks(pkgs)` reads `bots.json` and returns an object with the functions below.
Reading the names needs no store, so it works while a running bot holds one.

| Function | What it does |
| --- | --- |
| `close()` | Wait for pending saves. |
| `list()` | Bot names, sorted. |
| `get(name)` | The bot's drive reference, or `undefined`. |
| `info(name)` | `Name`, `Drive`, `Package`, `Output` (the drive its builds land in) and `Status` (running/stopped) lines. Async, because the output address comes from that drive. Throws for an unknown name. |
| `busy(link)` | Whether any bot on the drive behind `link` is running. |
| `create(name, spec, cwd)` | Register a bot. `spec` names a drive that already holds `bot.json`, or a generator in a drive (`<drive>/generate`). A generator fills a fresh drive, which is also registered as a pack under `name`, and `bot.json` is written for it. Refused if the drive already belongs to another bot. Returns the drive's reference. |
| `start(name, print)` | Run the bot's entry in this process. Writes `run/<name>.pid`, appends everything the bot logs to its log core, and keeps the bot's and its packs' references on the latest revision as it saves data. Returns `{ done, stop }`: `done` settles once the bot has finished. |
| `read_log(name)` | Everything the bot has logged, oldest first, across every run. Needs the store, so it is read by whoever holds it, which is the daemon. |
| `end(name)` | Stop a running bot: directly if this process runs it, otherwise by signalling the process that does and waiting for it to exit. |
| `remove(link)` | Delete a drive with every pack and bot registered on it. Refused while a bot on that drive runs. |
