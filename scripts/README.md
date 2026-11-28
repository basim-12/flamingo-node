# datashell

The `cli` command: named drives (`cli pkg`), bots that run from them (`cli bot`), and the
modules drive code may require (`cli cap`). In a clone of this repository it is `npx cli`.

Each section lists every command in one line, and links to the module readme that explains
it in full. 📦 marks a command that works. The words these readmes use are explained in
[GLOSSARY.md](GLOSSARY.md).

## Packages

A package is a name for a drive. A drive is addressed by its public key, which stays the
same when its files change; only the `dat://` reference, which also names one revision,
moves on. The key is a long string, so the name is what you type. In full:
[packs/README.md](packs/README.md).

| Command | What it does | |
| --- | --- | --- |
| `cli pkg` | List every package | 📦 |
| `cli pkg +<name> <specifier>` | Make a new package from a folder, a drive, or a generator | 📦 |
| `cli pkg <name> --import=<specifier>` | The same, written as one flag | 📦 |
| `cli pkg <name>`, or `--see` after it | Its name and its drive's `dat://` reference | 📦 |
| `cli pkg <name> <dirpath>` | Copy its files into a new folder | 📦 |
| `cli pkg <name> --export=<dirpath>` | The same, written as one flag | 📦 |
| `cli pkg -<name>` | Delete it and its drive's data | 📦 |

```sh
cli pkg +demo ./demo
# Name: demo
# Drive: dat://3.0.8enyhokhcquxofnzbr1n7dgkktbmmzy5i8x7go1x4gjb8f58qfyy.b81d8037…
```

## Bots

A bot runs code from a package, and can be stopped and started again. It keeps what it
saves in a drive of its own, so two bots made from one package are two separate things. In
full: [tasks/README.md](tasks/README.md).

| Command | What it does | |
| --- | --- | --- |
| `cli bot` | List every bot | 📦 |
| `cli bot +<name> <specifier>` | Make a new bot. Its drive must end up with a `bot.json` | 📦 |
| `cli bot <name>`, or `--see` after it | Its drive, output drive, log length, and whether it runs | 📦 |
| `cli bot <name> <dirpath>` | Copy its drive's files into a new folder | 📦 |
| `cli bot <name> --build` | Run the code drive's `setup.js` in a sandbox, into the output drive | 📦 |
| `cli bot <name> --run` | Start it in the background | 📦 |
| `cli bot <name> --run --attach` | Watch it in this terminal, starting it first if needed. Ctrl+C stops watching, not the bot | 📦 |
| `cli bot <name> --log` | Everything it has logged, across every run | 📦 |
| `cli bot <name> --log=<count>` | Only its newest `<count>` lines | 📦 |
| `cli bot <name> --end` | Stop it. Nothing else stops a bot | 📦 |
| `cli bot -<name>` | Delete it, its drive, and its log and audit cores | 📦 |

```sh
cli bot +mybot demo/generate
# Name: mybot
# Drive: dat://2.0.wrueczrc91su5jpaaa58sh98x1dqy6ogam4s98nssxaj59qt7ioo.df2721aa…
# Output: dat://0.0.y4qhrwwa75m3rtixyjuwcmfenoytep1kuej8fnqc18rr641swpsy.bb30a42c…
# Log: 0 lines
# Status: stopped

cli bot mybot --run
# … the same block, with Status: running
# Running in the background. Its log: cli bot mybot --log
```

## Caps

Three modules, the builtins, only compute, so any drive's code may require them without a
grant. Every other module is a cap, and code gets it only once it is granted. In full:
[cap/README.md](cap/README.md).

| Command | What it does | |
| --- | --- | --- |
| `cli cap` | List what is granted | 📦 |
| `cli cap --expand` | List the builtins and what is granted | 📦 |
| `cli cap <name>` | Whether it is a builtin or a cap, and whether it is granted | 📦 |
| `cli cap +<name>` | Grant it | 📦 |
| `cli cap -<name>` | Revoke it, for every drive | 📦 |

```sh
cli cap --expand
# Builtins, every drive has these:
#   bare-path
#   bare-url
#   bare-crypto
#
# Granted:
#   bare-fs
```

## Specifiers

`cli pkg +<name> <specifier>` and `cli bot +<name> <specifier>` take three kinds of
specifier. Each kind either copies, or, with a file path after it, runs that file as a
[generator](GENERATORS.md) into the new drive:

| Kind | Copies | Runs a generator |
| --- | --- | --- |
| a local path | a folder: `./demo` | a file: `./lib/build.js` |
| a `dat://` reference | `dat://3.0.8eny….b81d…` | `dat://3.0.8eny….b81d…/generate` |
| a name: a package name or a drive id | `demo`, or `8enyhokh…qfyy` | `demo/generate`, or `8enyhokh…qfyy/generate` |

- **A local path** starts with `./`, `../` or `/`, so a plain name is never a folder.
- **A `dat://` reference** names one exact revision, and its hash is checked.
- **A package name** stands for the revision the package records. **A drive id** of a
  registered package does the same; the id of any other drive here stands for that drive's
  latest revision on this machine.
- Every drive named must already be on this machine.
- `?key=value` after a generator path becomes its options, for example
  `demo/generate?ask=no`, and `.js` may be left off the file name.

A bot also needs a `bot.json`, the file that says what code it runs. For a generator in a
drive, the cli writes it, pointing at `index.js` in that same drive. A local folder must
already contain one, and a local generator file must write one.

## Names and paths

- A name uses letters, numbers, underscores and hyphens, and starts with a letter or a number.
- A relative path is resolved against the folder the command was typed in.

What the code in a drive can use (`index.js`, a generator, `setup.js`) is in [CODE.md](CODE.md),
and how to write a generator is in [GENERATORS.md](GENERATORS.md).
How the cli, the daemon and the storage fit together is in [DESIGN.md](DESIGN.md).
