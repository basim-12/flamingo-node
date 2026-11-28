# packs design

How `packs` is put together. How to use it is in [README.md](README.md).

## Storage

```text
<root>/              # ~/.ds unless packs() is given a folder
├── pkgs.json        # { "<package name>": "dat://<its drive>", ... }
└── corestore/       # the data of every drive and hypercore
```

`pkgs.json` holds every name and the reference it points at. We write it to a temporary file
and rename it into place ([json.js](../json.js)), so a crash never leaves half a file.

Everything else is in one Corestore, `corestore/`, the store that holds every hypercore, and
so every drive. It is split into namespaces, groups that keep one kind of data apart from
another. `create` makes each
package's drive under `<namespace>/<name>/<random id>`, so a name used again after `drop` gets a
new drive. `core` and `disk` keep theirs under `<namespace>/<name>`. Which namespaces datashell
uses is in the [datashell design](../DESIGN.md#storage).

## Opening the storage

We open the Corestore only the first time a function needs a drive ([index.js](index.js)), so a
command that only reads names never touches it. Only one process can have it open: a second one
gets `ELOCKED` from Corestore, which we turn into
`Drive storage is in use by another process, such as a running bot`.

## Code loaded from drives

`load` runs a generator or a bot's `index.js` in this process, through `bare-module`'s `Loader`
(`bare-module` 7, which needs Bare 1.32 or newer). A `Module.Protocol` reads every file of the
module graph straight from the drive, at its pinned revision, so nothing is copied to disk.
Relative requires, JSON, and text files such as a Dockerfile
(`require('./Dockerfile', { with: { type: 'text' } })`) all come from the drive.

Modules from outside the drive are loaded by this process and handed to the Loader as
`builtins`. Which ones each kind of code gets is decided by [cap](../cap/README.md#which-code-gets-what),
and how `require` and `import()` behave for the code is in [CODE.md](../CODE.md#require). Before
each `.js` file runs, we parse it with `acorn` to refuse a dynamic `import()` and a `require` of
a module the code isn't given.
