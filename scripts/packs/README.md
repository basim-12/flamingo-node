# packs

Named, versioned Hyperdrives on this machine. A pack is just data: a drive with
some files in it. Packs know nothing about bots or anything that runs; `tasks`
builds on top of them.

```js
const process = require('bare-process')
const packs = require('./packs')

const pkgs = packs() // root defaults to ~/.flamingo
await pkgs.open()
await pkgs.create('flamingo-node', './flamingo-node', process.cwd())
console.log(pkgs.info('flamingo-node')) // Name: flamingo-node / Drive: dat://…
await pkgs.close()
```

## Drive references

Every pack is recorded as a full reference to one exact revision:

```text
dat://<length>.<fork>.<id>.<hash>
```

`id` names the drive; `length`, `fork` and `hash` pin its content. Opening a
reference checks the hash, so a reference can't silently point at other content.

## Storage

```text
<root>/
├── pkgs.json    # { "name": "dat://…" }
└── corestore/   # every drive's data, shared
```

## API

`packs(root = ~/.flamingo)` returns an object with the functions below.

### Opening and closing

| Function | What it does |
| --- | --- |
| `registries()` | Read `pkgs.json` only, without opening the store. Enough for `list`, `get`, `find` and `info`, and works while a running bot holds the store. |
| `open()` | `registries()`, then open the shared store. Needed for everything that touches drives. |
| `close()` | Wait for pending saves and close the store. |

### Names

| Function | What it does |
| --- | --- |
| `list()` | Pack names, sorted. |
| `get(name)` | The pack's reference, or `undefined`. |
| `find(link)` | The name of a pack on the same drive as `link`, if any. |
| `info(name)` | `Name: …` and `Drive: …` lines. Throws for an unknown name. |

### Drives

| Function | What it does |
| --- | --- |
| `source(spec, cwd)` | Resolve a `<specifier>` (see `../README.md`) to what it points at: `{ local, generator }` for a local folder or file, or `{ link, file }` for a drive, plus `options` from `?query`. |
| `open_drive(link, pinned = true)` | Open the drive behind `link`. Pinned: a read-only view at exactly that revision, hash checked, content present locally. Not pinned: the live drive. Returns `{ drive, view, ref, close }`. |
| `load(from)` | Load the function a generator or entry file exports, from a `source()` result. The code is read straight from the drive at its pinned revision (or from its local folder); nothing is copied to disk. Returns `{ fn, code }`, where `code` is the drive's pinned reference. |
| `create(name, spec, cwd, { namespace, prepare })` | Make a new pack from a `<specifier>`: copy a folder or drive, or run a generator into a fresh drive. `prepare(drive, code)` runs afterwards, before the pack is registered. `code` is the generator's pinned drive reference, or `null`. Returns the new reference. |
| `update(drive)` | Point every pack on this drive at its latest saved revision. Returns that reference. |
| `remove(link)` | Delete the drive's data and every pack name registered for it. |
| `export_to(name, folder, cwd)` | Copy a pack's latest files into a new folder outside managed storage. Returns the folder's path. |

### Helpers on the module

| Function | What it does |
| --- | --- |
| `packs.reference(link)` | Parse a reference into `{ length, fork, id, hash, file, options }`. Throws if it isn't one. |
| `packs.drive_link(drive)` | The reference for a drive's current revision. |

## Code loaded from drives

Generators and entries run in this process through `bare-module`'s `Loader`
(bare-module 7, which needs Bare 1.32 or newer). A `Module.Protocol` reads every
file of the module graph straight from the drive, so relative requires, JSON, and
text files such as a Dockerfile (`require('./Dockerfile', { with: { type: 'text' } })`)
all come from the pinned revision.

- **Packages from outside the drive.** Code can require only a fixed list of
  modules (`RUNTIME` in `index.js`). This process loads them and hands them to the
  Loader as `builtins`. Giving each drive its own dependencies comes later.
- **No dynamic `import()`.** It would load code around the Loader, so every `.js`
  file is parsed with `acorn` first and refused if it uses one.
- **Requires name their file with a plain string.** The Loader finds and reads every
  `require('./…')` before the code runs, wherever it appears. A computed one
  (`require(name)`) would need a synchronous read, which a drive can't answer, so
  it fails with `UNEXPECTED_PROMISE`.
