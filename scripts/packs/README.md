# packs

This module keeps packages on this machine. A package is a drive (a Hyperdrive) with a
name: just data, some files in a drive. The `cli pkg` commands are this module. It never
calls into [tasks](../tasks/README.md), which is built on top of it.

```js
const path = require('bare-path')
const process = require('bare-process')
const packs = require('./packs')

const cwd = process.cwd()
const dirpath = path.join(cwd, './src')
const pkgs = await packs() // keeps everything in ~/.ds, packs.STORAGE, unless given a folder
await pkgs.create('my-app', dirpath)
console.log(pkgs.info('my-app')) // Name: my-app / Drive: dat://…
await pkgs.close()
```

Every path this module takes has to be absolute. If you have a relative path, make it
absolute yourself, against the folder you mean, because this module can run in another
process with a working directory of its own. That is what the cli does: the module runs
inside the daemon, so the cli makes each path absolute before it sends the command.

## Commands

| Command | What it does |
| --- | --- |
| `cli pkg +<name> <specifier>`, or `cli pkg <name> --import=<specifier>` | Make a new drive and fill it from the [specifier](../README.md#specifiers): copy a folder or a drive, or run a generator into it. The new drive has its own id, even when the specifier names a drive that is already here. Refused if `<name>` is taken or the specifier names nothing. |
| `cli pkg <name>`, or `--see` after it | Print `Name:` and `Drive:`. |
| `cli pkg` | Print that block for every package, or `No pkgs.` |
| `cli pkg <name> <dirpath>`, or `--export=<dirpath>` | Copy the package's latest files into `<dirpath>`, which must not exist yet; its parent must. Only the files are copied, not the drive's history or id. |
| `cli pkg -<name>` | Delete the package and its drive's data. Folders it was imported from or exported to are kept. If the package is a bot's drive, the bot is deleted with it, and this is refused while that bot runs. |

A folder is copied with its files, its empty folders and its permission bits. A symlink or
any other special file in it is refused with `Unsupported filesystem entry`.

## Generators

A generator is a js file that exports one async function. `cli pkg +<name> <generator>` makes
a new drive and calls the function with it:

```js
module.exports = async function (drive, options) {
  await drive.put('/config.json', Buffer.from(JSON.stringify(options)))
}
```

- `drive` is the new, empty drive.
- `options` holds the `?key=value` pairs from the specifier, as strings:
  `my-app/generate?ask=no` gives `{ ask: 'no' }`.
- The package is registered only once the function returns. If it throws, the new drive is
  deleted.
- What a generator may require is in [cap](../cap/README.md#which-code-gets-what).
- For a bot made from a generator in a drive, the cli adds `bot.json` once the generator
  returns ([tasks](../tasks/README.md)).

## Drive references

Every package is recorded as a full reference to one exact revision:

```text
dat://<length>.<fork>.<id>.<hash>
```

`id` is the drive's public key. It stays the same when the drive changes, so it names the
drive, not its content. `length`, `fork` and `hash` pick out one revision of it. Opening a
reference checks that revision's hash, so a reference can't quietly point at other
content.

## Storage

```text
~/.ds/            # or the root passed to packs()
├── pkgs.json    # { "<package-name>": "dat://<its drive>", ... }
└── corestore/   # the data of every drive, plus the hypercores core() returns
```

## API

`await packs(root = packs.STORAGE)` reads `pkgs.json` and returns an object with the
functions below. `list()`, `get()`, `find()` and `info()` only read `pkgs.json`. The drive
storage is opened the first time a function needs a drive, so reading names works even
while another process has the storage open; a function that needs a drive then fails with
`Drive storage is in use by another process`.

### Opening and closing

| Function | What it does |
| --- | --- |
| `close()` | Waits for `pkgs.json` to finish saving, and closes the drive storage if it was opened. |

### Names

| Function | What it does |
| --- | --- |
| `list()` | Package names, sorted. |
| `get(name)` | The package's drive reference, or `undefined`. |
| `find(link)` | The name of a package on the same drive as `link`, if any. |
| `info(name)` | `Name: …` and `Drive: …` lines. Throws for an unknown name. |

### Drives

| Function | What it does |
| --- | --- |
| `source(spec)` | Resolve a `<specifier>` ([which forms there are](../README.md#specifiers)) to what it points at: `{ local, generator }` for a local folder or file, or `{ link, file }` for a drive, plus `options` from `?query`. A local path has to be absolute; `./src` is refused with `Not an absolute path: ./src`. |
| `open_drive(link, pinned = true)` | Open the drive behind `link`, after checking the revision's hash. Returns `{ drive, view, ref, close }`. `view` is what to read from: with `pinned`, a read only copy of exactly that revision; without it, the live drive itself. `ref` is `link` parsed by `packs.reference`. |
| `disk(namespace, name)` | Returns a drive stored under `namespace` and `name`, for a drive datashell keeps without registering it as a package, such as a bot's output drive. The same two names reopen the same drive. Opens the drive storage. |
| `core(namespace, name)` | Returns a hypercore (an append only list of records) stored under `namespace` and `name`, for data kept beside a drive rather than in it, such as a log. The same two names reopen the same core. Opens the drive storage. |
| `load(from)` | Load the function a generator or a bot's `index.js` exports, from a `source()` result. The code is read straight from the drive at its pinned revision (or from its local folder); nothing is copied to disk. Returns `{ fn, code }`, where `code` is the drive's pinned reference. |
| `create(name, spec, { namespace, prepare })` | `cli pkg +<name> <specifier>`. A local path in `spec` has to be absolute. `namespace` is where in the storage the new drive is made, `pkg` unless given; tasks passes `bot`. `prepare(drive, code)` runs after that, before the package is registered, and `code` is the generator's pinned drive reference, or `null` when nothing was generated. Returns the new package's drive reference. |
| `update(drive)` | Moves every package on `drive` to the drive's latest revision in `pkgs.json`. Returns that revision's reference. |
| `drop(name)` | `cli pkg -<name>`. Deletes the package's drive data and every package name registered for that drive. Throws for an unknown name. It does not touch bots: the cli deletes a bot on that drive first, through [tasks](../tasks/README.md). |
| `export(name, dirpath)` | `cli pkg <name> <dirpath>`. `dirpath` has to be absolute, and outside the storage folder (`~/.ds`, or the root passed to `packs()`). Returns the folder's real path. |

### Helpers on the module

| Function | What it does |
| --- | --- |
| `packs.reference(link)` | Parse a reference into `{ length, fork, id, hash, file, options }`. Throws if it isn't one. |
| `packs.drive_link(drive)` | The reference for a drive's current revision. |

## Code loaded from drives

Generators and a bot's `index.js` run in this process through `bare-module`'s `Loader`
(`bare-module` 7, which needs Bare 1.32 or newer). A `Module.Protocol` reads every
file of the module graph straight from the drive, so relative requires, JSON, and
text files such as a Dockerfile (`require('./Dockerfile', { with: { type: 'text' } })`)
all come from the pinned revision.

- **Modules from outside the drive.** Every drive's code may require the builtins, which
  are `BUILTINS` in [cap/index.js](../cap/index.js): `bare-path`, `bare-url` and
  `bare-crypto`. A bot's `index.js` may also require `sandbox`, and nothing else. A
  generator may also require what its `package.json` lists and has been granted with
  `cli cap +<name>`, and a generator run from a local file anything that has been granted.
  This process loads those modules and hands them to the Loader as `builtins`. The rules
  are in [cap](../cap/README.md).
- **No dynamic `import()`.** It would load code around the Loader, so every `.js`
  file is parsed with `acorn` first and refused if it uses one.
- **Requires name their file with a plain string.** The Loader finds and reads every
  `require('./…')` before the code runs, wherever it appears. A computed one
  (`require(name)`) would need a synchronous read, which a drive can't answer, so
  it fails with `UNEXPECTED_PROMISE`.
