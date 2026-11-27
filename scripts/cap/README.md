# cap

Which modules the code in a drive may `require`, and the `cli cap` commands that grant them.
Where that code runs is [sandbox](../sandbox/README.md).

## Builtins and caps

Every module a drive's code can ask for is one of two kinds:

- **builtins**: `bare-path`, `bare-url` and `bare-crypto` (`BUILTINS` in [index.js](index.js)).
  They only compute: they read no files, start no programs and open no connections. Every
  drive's code may require them, and they are never granted.
- **caps**: every other module, for example `bare-fs` or `bare-ws`. A cap is only handed to
  code after it has been granted with `cli cap +<name>`.

## Which code gets what

The loader in [packs](../packs/README.md#code-loaded-from-drives) hands each kind of code a
different set of modules:

| code | may require |
| --- | --- |
| a bot's `index.js` | the builtins and `sandbox`, and nothing else, whatever is granted |
| a generator in a drive | the builtins, plus each module its `package.json` lists under `dependencies` that has also been granted |
| a generator run from a local file | the builtins, plus every granted cap |

`sandbox` is a handle on a microVM, described in [sandbox](../sandbox/README.md). `setup.js`
is not loaded here at all: `cli bot <name> --build` runs it inside the microVM.
Everything else each one has, with an example, is in [CODE.md](../CODE.md).

## Commands

| Command | What it does |
| --- | --- |
| `cli cap` | List what is granted, or print `Nothing granted.` |
| `cli cap --expand` | List the builtins and what is granted, as two groups |
| `cli cap <name>` | Say whether `<name>` is a builtin or a cap, and whether it is granted |
| `cli cap +<name>` | Grant `<name>` |
| `cli cap -<name>` | Revoke `<name>`. Every drive loses it, because there is one list |

```sh
cli cap +bare-fs
# Name: bare-fs
# Kind: cap
# Granted: yes

cli cap bare-path
# Name: bare-path
# Kind: builtin
# Granted: not needed
```

## What a refused require says

The check runs while the code is parsed, before any of it runs, so the message names the
module:

| situation | message |
| --- | --- |
| a generator requires a cap that is not granted | `This drive requires bare-ws, which it was not granted` |
| a generator requires a granted cap that its `package.json` does not list | `Cannot find module 'bare-ws'` |
| a listed and granted module is not installed where datashell runs | `This drive needs bare-ws, which is not installed here` |
| a bot's `index.js` requires anything but the builtins and `sandbox` | `A bot's index.js may require only the builtins and sandbox, so bare-ws is not there` |

## Storage

```text
~/.ds/
└── grants.json   # { "<name>": true, ... } every granted cap
```

## API

`await caps(root)` reads `grants.json` from `root` and returns these functions. The `cli cap`
commands call them through the daemon.

| Function | Command | What it does |
| --- | --- | --- |
| `list()` | `cli cap` | Granted names, sorted |
| `expand()` | `cli cap --expand` | The text `cli cap --expand` prints |
| `info(name)` | `cli cap <name>` | The `Name`, `Kind` and `Granted` lines |
| `grant(name)` | `cli cap +<name>` | Add `name` to `grants.json` |
| `revoke(name)` | `cli cap -<name>` | Remove `name` from `grants.json` |
| `allows(name)` | none | Whether `name` is a builtin or granted. The loader calls it |
