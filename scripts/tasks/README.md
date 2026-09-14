# tasks

Things that run from a pack's drive and can be stopped and started again, such as
a bot. Tasks are built on a `packs()` instance: packs hold the data, tasks run it.
Packs know nothing about tasks. The CLI's `bot` commands are tasks.

```js
const process = require('bare-process')
const packs = require('./packs')
const tasks = require('./tasks')

const pkgs = packs()
const bots = tasks(pkgs)
await pkgs.open()
await bots.registries()
await bots.create('alice', 'flamingo-node/generate?ask=no', process.cwd())
const { done } = await bots.start('alice', console.log)
// … later, from this process:
await bots.end('alice')
await bots.close()
await pkgs.close()
```

## What a task is

A task is a name registered against one drive. That drive holds:

- `bot.json`: what to run, as `{ "entry": "dat://<pinned code drive>/main.js" }`
- whatever else the task saves while it runs

The entry is a function the code drive exports:

```js
module.exports = async function (drive, { stopped, log }) {
  // drive: the task's own writable drive
  // stopped: resolves when the task is asked to stop
  // log(line): print a line for the operator
  await stopped
}
```

The entry may instead return a cleanup function, which runs after `stopped`.

Rules:

- **One drive, one task.** Two tasks on one drive would share one identity and one
  data folder, so registering a second one is refused.
- **One run at a time.** A task that is already running can't be started again,
  and neither can another task on the same drive.
- **Code is pinned.** The entry reference names an exact revision of the code
  drive, and its hash is checked before anything runs.

## Storage

Next to the packs' storage under the same root:

```text
<root>/
├── bots.json     # { "name": "dat://…" }
└── run/          # <name>.pid while that task is running
```

## API

`tasks(pkgs)` returns an object with the functions below.

| Function | What it does |
| --- | --- |
| `registries()` | Read `bots.json`. Needs no store, so it works while a running task holds it. |
| `close()` | Wait for pending saves. |
| `list()` | Task names, sorted. |
| `get(name)` | The task's drive reference, or `undefined`. |
| `info(name)` | `Name`, `Drive`, `Package` and `Status` (running/stopped) lines. Throws for an unknown name. |
| `busy(link)` | Whether any task on the drive behind `link` is running. |
| `create(name, spec, cwd)` | Register a task. `spec` names a drive that already holds `bot.json`, or a generator in a drive (`<drive>/generate`). A generator fills a fresh drive, which is also registered as a pack under `name`, and `bot.json` is written for it. Refused if the drive already belongs to another task. Returns the drive's reference. |
| `start(name, log)` | Run the task's entry in this process. Writes `run/<name>.pid` and keeps the task's and its packs' references on the latest revision as it saves data. Returns `{ done, stop }`: `done` settles once the task has finished. |
| `end(name)` | Stop a running task: directly if this process runs it, otherwise by signalling the process that does and waiting for it to exit. |
| `remove(link)` | Delete a drive with every pack and task registered on it. Refused while a task on that drive runs. |
