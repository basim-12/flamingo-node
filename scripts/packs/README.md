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
| `cli pkg +<name> <specifier>`, or `cli pkg <name> --import=<specifier>` | Make a new drive and fill it from the [specifier](../README.md#specifiers): copy a folder or a drive, or run a [generator](../GENERATORS.md) into it. The new drive has its own id, even when the specifier names a drive that is already here. Refused if `<name>` is taken or the specifier names nothing. |
| `cli pkg <name>`, or `--see` after it | Print `Name:` and `Drive:`. |
| `cli pkg` | Print that block for every package, or `No pkgs.` |
| `cli pkg <name> <dirpath>`, or `--export=<dirpath>` | Copy the package's latest files into `<dirpath>`, which must not exist yet; its parent must. Only the files are copied, not the drive's history or id. |
| `cli pkg -<name>` | Delete the package and its drive's data. Folders it was imported from or exported to are kept. If the package is a bot's drive, the bot is deleted with it, and this is refused while that bot runs. |

A folder is copied with its files, its empty folders and its permission bits. A symlink or
any other special file in it is refused with `Unsupported filesystem entry`.

## Generators

A generator is a js file that fills a new drive. How to write and run one, with an example,
is in [GENERATORS.md](../GENERATORS.md).

## Drive references

Every package is recorded as a full reference to one exact revision:

```text
dat://<length>.<fork>.<id>.<hash>
```

`id` is the drive's public key. It stays the same when the drive changes, so it names the
drive, not its content. `length`, `fork` and `hash` pick out one revision of it. Opening a
reference checks that revision's hash, so a reference can't quietly point at other
content.

## API

```js
const pkgs = await packs(root)
```

| | |
| --- | --- |
| `root` | the folder to keep everything in, an absolute path. `packs.STORAGE`, which is `~/.ds`, unless given |

`packs` returns the functions below, plus `root` and `caps`, the [cap](../cap/README.md#api)
api for the same folder.

Names are read from `pkgs.json` straight away, but the drive storage is only opened the first
time a function needs a drive. So `list`, `get`, `find` and `info` still work while another
process has the storage open. A function that needs a drive then fails with
`Drive storage is in use by another process, such as a running bot`. How the folder is laid
out is in [DESIGN.md](DESIGN.md).

Each package name points at one exact revision of its drive, written as a
[drive reference](#drive-references). Most functions below take or return one.

### `create(name, spec, { namespace, prepare })`

What `cli pkg +<name> <specifier>` calls. It makes a new, empty drive and fills it from `spec`:
a folder's files are copied in, another drive's files are copied in, or a generator is run
into it. Then it calls `prepare`, saves `name` in `pkgs.json`, and returns the new drive
reference. If any step throws, the new drive is deleted, so `name` stays free.

| | |
| --- | --- |
| `name` | the new package's name |
| `spec` | a [specifier](../README.md#specifiers). A local path has to be absolute |
| `namespace` | a group in the storage that the new drive is kept under, `pkg` unless given. A module built on `packs` passes its own, so its drives are kept apart: [tasks](../tasks/README.md) passes `bot` |
| `prepare(drive, code)` | called once the drive is filled, before `name` is saved, so the caller can add files of its own. `code` is the drive reference of the generator's drive, or `null` when no generator ran |

Throws `Package already exists: <name>`, or what [`source`](#sourcespec) throws.

### `list()`

What `cli pkg` calls. Returns every package name, sorted.

### `info(name)`

What `cli pkg <name>` calls. Returns the two lines it prints, `Name: <name>` and
`Drive: <reference>`. Throws `Unknown package: <name>`.

| | |
| --- | --- |
| `name` | a package name |

### `export(name, dirpath)`

What `cli pkg <name> <dirpath>` calls. Copies the package's latest files into a new folder,
and returns the folder's real path.

| | |
| --- | --- |
| `name` | a package name |
| `dirpath` | where to make the folder: an absolute path that doesn't exist yet, whose parent does, and that is outside `root` |

Throws `Unknown package: <name>`, `Not an absolute path: <dirpath>`,
`Export must be outside managed storage`, or `EEXIST` if `dirpath` already exists.

### `drop(name)`

What `cli pkg -<name>` calls. Deletes the package's drive, and every other name that points at
the same drive. Throws `Unknown package: <name>`.

| | |
| --- | --- |
| `name` | a package name |

### `get(name)`

Returns the drive reference `name` points at, or `undefined` if there is no such package.

| | |
| --- | --- |
| `name` | a package name |

### `find(link)`

The opposite of `get`: returns the name of the package whose drive `link` belongs to, or
`undefined`. Any revision of that drive matches.

| | |
| --- | --- |
| `link` | a drive reference |

### `source(spec)`

Works out what a specifier points at. `create` calls it first, to know how to fill the new
drive.

| | |
| --- | --- |
| `spec` | a [specifier](../README.md#specifiers). A local path has to be absolute |

What it returns depends on what `spec` names:

| `spec` | returns |
| --- | --- |
| a local folder or file | `{ local, generator, options }`: the real path, and `generator: true` if it is a file |
| a `dat://` reference | `{ link, length, fork, id, hash, file, options }`: the reference and its parts |
| a package name or drive id | `{ link, file, options }`: the drive reference it stands for |

`file` is the path after the drive, like `/generate.js`, or `''` if there is none. `options`
holds the `?key=value` pairs. Throws `Not an absolute path: <path>`,
`No such file or folder: <path>`, `Source must not overlap managed storage`, or
`Unknown package or source: <spec>`.

### `open_drive(link, pinned = true)`

Opens the drive `link` points at, after checking that the revision's hash matches, so a
reference can't open different content than it names.

| | |
| --- | --- |
| `link` | a drive reference |
| `pinned` | `true` to read the drive exactly as it was at that revision, even if it has changed since. `false` to read it as it is now |

Returns `{ drive, view, ref, close }`:

| | |
| --- | --- |
| `drive` | the drive itself |
| `view` | what to read from: the revision when `pinned`, otherwise `drive` |
| `ref` | `link` split into its parts, by [`packs.reference`](#packsreferencelink) |
| `close()` | closes `view` and `drive` |

Throws `Drive is not available locally: <id>`, `Referenced drive revision is unavailable`, or
`Drive hash mismatch`.

### `load(from, sandbox)`

Loads the function that a js file in a drive exports, without copying anything to disk. A
generator is loaded this way, and so is a bot's `index.js`. What that code can `require` is in
[CODE.md](../CODE.md).

| | |
| --- | --- |
| `from` | what `source` returned for the file |
| `sandbox` | what the code gets as `require('sandbox')`, the [sandbox api](../sandbox/README.md#the-api-requiresandbox). Left out for a generator |

Returns `{ fn, code }`: the exported function, and the drive reference of the drive it came
from, or `null` for a file on this machine. Throws `File not found in the drive: <file>`,
`<file> must export a function`, or a refused `require`
([cap](../cap/README.md#what-a-refused-require-says)).

### `core(namespace, name)`

Returns a hypercore, an append only list of records, kept in the storage under `namespace`
and `name`. It suits data that grows line by line, like a log. Asking again with the same two
names gives the same core.

| | |
| --- | --- |
| `namespace` | a group in the storage, like `log` |
| `name` | a name inside that group |

### `disk(namespace, name)`

Returns a drive kept in the storage under `namespace` and `name`. Unlike a package, it has no
name in `pkgs.json`, so `cli pkg` doesn't list it. Asking again with the same two names gives
the same drive.

| | |
| --- | --- |
| `namespace` | a group in the storage, like `build` |
| `name` | a name inside that group |

### `update(drive)`

A drive that is written to gets a new revision, but its package names still point at the old
one. `update` points every name for `drive` at its newest revision, saves `pkgs.json`, and
returns the new drive reference.

| | |
| --- | --- |
| `drive` | an open drive |

### `close()`

Waits for `pkgs.json` to finish saving, then closes the drive storage if it was opened.

### `packs.reference(link)`

Splits a drive reference into `{ length, fork, id, hash, file, options }`. Throws
`Invalid pinned drive reference: <link>`.

### `packs.drive_link(drive)`

Returns the drive reference of a drive's current revision.
