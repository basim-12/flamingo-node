# Commands, in short

Every `cli` command, with the shortest useful example of each.

Longer explanations live beside the code: [packages](packs/README.md),
[bots](tasks/README.md), [caps](cap/README.md), [the sandbox](sandbox/README.md). The
[readme](README.md) is the overview.

## Packages

A package is a name for a drive. A drive is addressed by its public key, which stays the
same when its files change; only the `dat://` reference, which also names one revision, moves
on. The key is a long string that nobody can remember, so the name is what you type.

| Command | What it does |
| --- | --- |
| `cli pkg` | Every package, as the same block `cli pkg <name>` prints for one |
| `cli pkg +<name> <specifier>` | Copy what the specifier points at into a new drive and name it |
| `cli pkg <name> --import=<specifier>` | The same thing, written as one flag |
| `cli pkg <name>`, or `--see` after it | Its name and the pinned address of its drive |
| `cli pkg <name> <dirpath>` | Write the drive's files into a folder |
| `cli pkg <name> --export=<dirpath>` | The same thing, written as one flag |
| `cli pkg -<name>` | Forget the name and delete the drive |

```sh
cli pkg +demo ./demo
# Name: demo
# Drive: dat://4.0.bzp3ygykh7uey3k11kq4mtakgxhw19k3fu7ha8pyknibnq7t7ato.5f760d39b631c2…
```

An import always copies. Naming a drive you already have gives the new name its own drive
at its own address, not a second label on the first one.

## Bots

A bot runs code from a package, and can be stopped and started again. It keeps what it
produces in a drive of its own, so two bots made from one package are two separate things.

| Command | What it does |
| --- | --- |
| `cli bot` | Every bot, as the same block `cli bot <name>` prints for one |
| `cli bot +<name> <specifier>` | Make a bot. A generator fills its drive first. A local folder or generator must bring its own `bot.json` |
| `cli bot <name>`, or `--see` after it | Name, drive, package, output drive, how many lines its log holds, and running or stopped |
| `cli bot <name> --build` | Run the drive's `setup.js` in a sandbox, into the output drive |
| `cli bot <name> --run` | Start it in the background |
| `cli bot <name> --run --attach` | Watch it here, starting it first if it is not running. Ctrl+C stops watching, not the bot |
| `cli bot <name> --log` | Everything it has logged, across every run |
| `cli bot <name> --log=<count>` | Only its newest `<count>` lines |
| `cli bot <name> --end` | Stop it. Nothing else stops a bot |
| `cli bot -<name>` | Delete it, its drive, and its log and audit cores |

```sh
cli bot +mybot demo/generate.js
# Name: mybot
# Drive: dat://3.0.sjb8gpjrd9y9dy6dtaea958kprotr931kog9tyrfmh6pr4n6ddko.7190dbf3087…
# Package: mybot
# Output: dat://0.0.nws8km41ujgrdep6d4m8h3ypcfq4bqjhr9ipkydwkusnb3c5g4no.bb30a42c1e6…
# Log: 0 lines
# Status: stopped
```

The output drive is listed from the start, at length `0` until `--build` writes into it.
Its id stays the same after a build; only the length and the hash change.

`setup.js` is optional. `--build` says `Nothing to build` for a drive without one, and that
bot's sandbox uses the base image unchanged. A second build says `Already built:` with the
reference of what the first one built, which the bot's drive keeps in `build.json`.

A bot's log is its own, not the terminal's: it outlives the run, and `--log` reads it
whether the bot is running or stopped. Its first lines are the block above, as it stood
when the bot started.

## Caps

Three modules, the builtins, only compute, so any drive's code may require them without a
grant. Every other module is a cap, and code gets it only once it is granted.

| Command | What it does |
| --- | --- |
| `cli cap` | What has been granted |
| `cli cap --expand` | The builtins and the grants, both groups at once |
| `cli cap <name>` | Whether it is a builtin, and whether it is granted |
| `cli cap +<name>` | Grant it |
| `cli cap -<name>` | Revoke it, everywhere |

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

A generator that requires a cap which is not granted is told
`This drive requires <name>, which it was not granted`. If the cap is granted but the
generator's `package.json` does not list it, it is told `Cannot find module '<name>'`.

A bot's `index.js` may require only the builtins and `sandbox`, a handle on a microVM with no
network. Nothing else is handed to it, whatever is granted or declared, and it is told
`A bot's index.js may require only the builtins and sandbox, so <name> is not there`. The
microVM is only started the first time `index.js` uses `sandbox`.

## Specifiers

Anywhere a command takes a `<specifier>`:

| Form | Example |
| --- | --- |
| a folder | `./demo` |
| a file | `./lib/build.js` |
| a package name | `demo` |
| a drive id | `bzp3ygykh7uey3k11kq4mtakgxhw19k3fu7ha8pyknibnq7t7ato` |
| a `dat://` reference | `dat://4.0.bzp3….5f76…` |
| a generator in a drive | `demo/generate.js` |

The table in [the readme](README.md#specifiers) says what each one resolves to.


