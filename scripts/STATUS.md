# What works, and what is planned

Every `cli` command that works today, with the shortest useful example of each, and the
ones we have agreed on but not built yet. Updated at the end of each worklog; this is
worklog 5.

Longer explanations live beside the code: [packages](packs/README.md),
[bots](tasks/README.md), [caps](cap/README.md), [the sandbox](sandbox/README.md). The
[readme](README.md) is the overview.

## Works today

### Packages

A package is a name for a drive of code. The drive is content addressed, so its address
changes when its contents do, and a name saves you from carrying the address around.

| Command | What it does |
| --- | --- |
| `cli pkg` | Every package, as the same block `cli pkg <name>` prints for one |
| `cli pkg +<name> <specifier>` | Copy what the specifier points at into a new drive and name it |
| `cli pkg <name> --import=<specifier>` | The same thing, spelled for a script |
| `cli pkg <name>`, or `--see` after it | Its name and the pinned address of its drive |
| `cli pkg <name> <dirpath>` | Write the drive's files into a folder |
| `cli pkg <name> --export=<dirpath>` | The same thing, spelled for a script |
| `cli pkg -<name>` | Forget the name and delete the drive |

```sh
cli pkg +demo ./demo
# Name: demo
# Drive: dat://4.0.bzp3ygykh7uey3k11kq4mtakgxhw19k3fu7ha8pyknibnq7t7ato.5f760d39b631c2…
```

An import always copies. Naming a drive you already have gives the new name its own drive
at its own address, not a second label on the first one.

### Bots

A bot is a package that runs, and can be stopped and started again. Its own drive is where
it keeps what it produces, which is what makes two bots from one package two separate
things.

| Command | What it does |
| --- | --- |
| `cli bot` | Every bot, as the same block `cli bot <name>` prints for one |
| `cli bot +<name> <specifier>` | Make a bot. A generator fills its drive first |
| `cli bot <name>`, or `--see` after it | Name, drive, package, output drive, and running or stopped |
| `cli bot <name> --build` | Run the drive's `install.js` in a sandbox, into the output drive |
| `cli bot <name> --run` | Start it in the background |
| `cli bot <name> --run --attach` | Start it here and stream its output until it stops |
| `cli bot <name> --log` | Everything it has logged, across every run |
| `cli bot <name> --end` | Stop it |
| `cli bot -<name>` | Delete it, its drive, and its log and audit cores |

```sh
cli bot +mybot demo/generate.js
# Name: mybot
# Drive: dat://3.0.sjb8gpjrd9y9dy6dtaea958kprotr931kog9tyrfmh6pr4n6ddko.7190dbf3087…
# Package: mybot
# Output: dat://0.0.nws8km41ujgrdep6d4m8h3ypcfq4bqjhr9ipkydwkusnb3c5g4no.bb30a42c1e6…
# Status: stopped
```

The output drive is listed from the start, at length `0` until something is built into it,
because its address is the same either way and that is what a later run is handed.

`--build` says `Nothing to build` for a drive with no `install.js`, and nothing to do on a
second run, because what it built is pinned in the drive.

A bot's log is its own, not the terminal's: it outlives the run, and `--log` reads it
whether the bot is running or stopped. Its first lines are the block above, as it stood
when the bot started.

### Caps

A drive gets nothing it was not granted. Three modules are builtin because they only
compute — they read nothing and reach nowhere — so they are never asked for.

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

A drive that requires a module it never declared is told `Cannot find module '<name>'`,
because from the code's side that is what happened: it never asked, so nothing was put
there. If the cap is not granted either way, declared or not, it is told
`This drive requires <name>, which it was not granted`.

### Specifiers

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

## Planned

Agreed with you, not built. The numbers are the task numbers from the notes, so each line
can be traced back to where we settled it.

### Worklog 6, the sandbox

- one standard image instead of any image, and `void-linux/void-glibc` as the candidate,
  carrying `git`, `bare` and a bubblewrap-wrapped subprocess (15, 16)
- `install.js` becomes `setup.js`, and a drive without one is fine (14)
- `setup.js` and the entry run outside the sandbox under Bare, with `bare-module` refusing
  to resolve anything but our api (13)
- Docker installed and run *inside* a sandbox, tested (17)

### Worklog 7, caps

- caps declared in `package.json`, separately for setup and for running, with config saying
  what may never be prompted for (18)
- a module that never declared its caps gets them declared by whatever depends on it (19)
- the whole dependency tree collected before anything runs, and asked for once (20)
- a module asks for the sandbox permissions its non-JS code needs (21)
- `cli cap --expand` becomes a tree that says which module needs what, rather than today's
  two flat groups (23)
- cap names mapping one to one onto `msb`, written down (24)
- grants move out of `grants.json` into a drive datashell manages, one per app, linked from
  the audit core (25)
- internal modules like `lightningd` become real packages, so they can declare (22)

### Worklog 8, state and docs

- the audit core is the operations log and a hyperbee is the state, with tx and rx per bot
  and per app (27)
- the JS api is the same api as the CLI, so what works on the command line works in the web
  (28)
- this readme splits into `docs/BOTS.md`, `CAPS.md`, `PKGS.md`, `INFO.md` and `DEMO.md`,
  with the readme left as a short overview (29)
- `<details>` for the api in each readme, and a `DESIGN.md` for how it is implemented (30)
- every `msb` option we could build a cap on, written down (31)
- deterministic installs, and whether guix or nix earns its place (33)

## Not decided yet

- **dropping Docker entirely.** My answer is yes: prove Docker runs inside a sandbox, move
  installing it into the node's own setup, then datashell stops knowing about Docker at all
- **caps for modules that do not declare their own.** Ours can be declared for, npm ones
  still need an answer
- **how an app says where it writes.** Anything under `/out` comes back and anything else
  is lost. My thinking is the drive declares its data paths and we mount the output drive
  there, so `/out` stops being special
- **whether `setup.js` and an entry are both needed**
- **our own runtime**, and the `require.addon()` rule that waits on it
- **bubblewrap** as a lighter second option after `msb`
