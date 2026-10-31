# Hyperdrive packages and bots

A generic CLI for named drives (`pkg`) and the bots that run from them (`bot`),
independent of Flamingo's own `fw` command. It is installed as the `cli` command, or
run it with Bare from the flamingo-node folder; the examples below write it as `cli`:

```sh
alias cli="npx bare scripts/cli.js"
```

`cli.js` only reads the command line and calls the two modules it is built on:
[packs](packs/README.md) for drives and their names, and [tasks](tasks/README.md)
for bots running from them.

## Drive references

```text
dat://<length>.<fork>.<id>.<hash>
```

References identify an exact drive revision. Code runs straight from that revision
(read through the drive, never copied to disk) after its hash is verified. A bot's code reference stays pinned, its
own drive reference advances as data is saved. The hash is the lowercase hex
Hypercore tree hash at the specified length; the ID is z-base-32. Referenced
drives and file data must already be available locally in this iteration.

## Packages

The `pkg` commands are a thin layer over the `packs` module; its API is in
[packs/README.md](packs/README.md).

| Command | Action and behavior |
| --- | --- |
| `cli pkg +<name> <specifier>` | Create a named drive from contents or a generator. Reject existing names and missing sources. |
| `cli pkg <name> --import=<specifier>` | Same as creation above. |
| `cli pkg <name>` / `cli pkg <name> --see` | Show the package name and drive reference. |
| `cli pkg` | List named drives. |
| `cli pkg --help` / `cli bot --help` | Print usage. |
| `cli pkg <name> <dirpath>` / `cli pkg <name> --export=<dirpath>` | Export the latest stored contents to a new folder. Reject an existing destination; its parent must exist. Export files, not drive history or identity. |
| `cli pkg -<name>` | Remove the registration and purge local drive data. Preserve import/export folders and unrelated drives. Refuse if the package belongs to a running bot. |

## Specifiers

`cli pkg +<name> <specifier>` takes any of these. `cli bot +<name> <specifier>`
takes only the drive forms (not a local folder or file), because a bot pins its
code to a drive.

| Specifier | Action |
| --- | --- |
| Local directory (`./dir`, `../dir`, `/dir`) | Copy its contents. |
| Local file (`./file`, `../file`, `/file`) | Execute it as a generator. |
| `dat://<length>.<fork>.<id>.<hash>` | Copy the referenced revision's contents. |
| `dat://<length>.<fork>.<id>.<hash>/generate?ask=no` | Execute the referenced generator. |
| Package name | Copy the package's contents. |
| `package-name/filepath` | Execute a generator from that package. |
| Drive id (`disk.id`) | Copy the contents of that locally known drive. |
| `drive-id/filepath` | Execute a generator from that locally known drive. |

Folder copies preserve files, empty directories and permission bits; symlinks and
special files are rejected. Named packages, drive ids and `dat://` revisions must
already be available locally. A known package name or the id of a registered
drive resolves to its recorded revision; an unregistered drive id resolves to its
latest local revision. Either way `cli` stores the full
`dat://length.fork.id.hash` reference.

## Generators

A generator exports one async function receiving the new Hyperdrive and options:

```js
module.exports = async function (drive, options) {
  // Write the app's initial data to drive.
}
```

Query parameters become options, for example `?ask=no`. The generator can prompt
for input or run automatically. Registration happens after it finishes filling
the drive; failed initialization is cleaned up. Values in `options` are strings.
A path is recognised by its `./`, `../` or `/` start, so a bare name is always a
package or a drive id; `.js` may be omitted from a generator path within a package.

A generator only writes the app's own data. When a bot is created from a
generator, the CLI adds `bot.json` itself (see Bots).

```sh
cli pkg +config "my-app/generate?ask=no"
```

## Bots

The `bot` commands are a thin layer over the `tasks` module, which is built on
`packs`; its API is in [tasks/README.md](tasks/README.md).

The code drive contains the application. One bot drive holds both configuration
and generated data; each application chooses its own folder structure.

`bot.json` contains the information the CLI needs to launch the application. When
a bot is created from a generator, the CLI writes it: the pinned reference of the
drive the generator came from, plus `/main.js`. So a code drive keeps its entry in
`main.js`.

```json
{
  "entry": "dat://<length>.<fork>.<id>.<hash>/main.js"
}
```

Other application settings and persistent data belong in the bot drive. The entry
exports an async function receiving the writable drive and a lifecycle context:

```js
module.exports = async function (drive, { stopped, log }) {
  log('Started')
  // Read configuration and save changes with drive.get()/drive.put().
  await stopped // Resolved by --end or Ctrl+C; finish cleanup before returning.
}
```

`drive` is the writable bot drive. `stopped` resolves on `--end` or Ctrl+C.
`log(line)` shows a line to whoever started the bot and appends it to its log core. An
entry may instead return a cleanup
function, which the CLI awaits after `stopped`.

`cli bot <name> --run` starts the bot and returns once it is running. The bot keeps
running after the command and the terminal have gone, because it runs inside the daemon
(see below), not inside the command. Everything it logs is appended to a hypercore of its
own, kept in the shared Corestore, which it reopens and adds to on every run; there is no
log file. `cli bot <name> --log` prints it, oldest first, and works while the bot is still
running. `cli bot <name> --run --attach` runs it in this terminal instead, until Ctrl+C,
printing the same lines as it appends them; Ctrl+C stops the bot. Bots only start when you
run them; nothing starts them automatically.

| Command | Action and behavior |
| --- | --- |
| `cli bot +<name> <specifier>` | Register a stopped bot. `<specifier>` must name a drive — package name, drive id or `dat://` reference — because a bot pins its code to a drive; local paths are refused. A drive on its own is used as the configuration drive directly (it must already contain a valid `bot.json`). `<drive>/generate` runs that drive's generator into a fresh bot drive, the CLI writes its `bot.json`, and it is registered as a package under `<name>` too. Reject an existing bot name, a package-name conflict, or a configuration drive already registered to another bot (checked by drive id). |
| `cli bot <name>` / `cli bot <name> --see` | Show its drive reference, package name if available, and running/stopped status. |
| `cli bot` | List registered bots. |
| `cli bot <name> --run` | Verify and launch the entry from bot.json in the background, and return once it runs. Reuse existing bot data and identity. A bot is a singleton: refuse if it, or another bot on the same drive, is already running. |
| `cli bot <name> --run --attach` | The same, but in this terminal; Ctrl+C stops it. |
| `cli bot <name> --end` | Stop the bot cleanly and preserve its data. |
| `cli bot <name> --log` | Print everything the bot has logged, across every run. Refused while it runs, because it holds the store. |
| `cli bot <name> --build` | Prepare what the bot needs without running it. A drive says how by holding an `install.js`, so a drive without one has nothing to build. The script runs in a sandbox and what it writes becomes a drive of its own, whose reference the bot's drive keeps, so building again has nothing left to do. Refused while the bot runs. |
| `cli bot -<name>` | Refuse while running. Otherwise remove the bot and purge its associated bot package/data, preserving the code package and unrelated data. |

## Capabilities

What a drive's code may require. A builtin computes and touches nothing, so it is never asked
for. Anything else is refused until it is granted, and declaring it in the drive's
`package.json` is not the same as being granted it. The model is [cap](cap/README.md).

| Command | Behavior |
| --- | --- |
| `cli cap` | List what is granted. |
| `cli cap --expand` | The builtins as well, which need no grant. |
| `cli cap <name>` | Whether it is a builtin or a cap, and whether it is granted. |
| `cli cap +<name>` | Grant it, and remember the answer. |
| `cli cap -<name>` | Revoke it everywhere. |

Generator shortcut and lifecycle:

```sh
cli bot +demo "my-app/generate?ask=no"
cli bot demo --see
cli bot demo --run      # returns once the bot is running in the background
cli bot demo            # Status: running
cli bot demo --end
cli bot demo --log      # what it logged, this run and every earlier one
cli bot -demo
```

## For example

Flamingo's own generator, entry and bot live in `lib/drive` and are described in
[Running Flamingo as a bot](../README.md#running-flamingo-as-a-bot). Useful as a
worked example of what a real generator and entry look like.

## Sandboxing and capabilities

A drive can say which JS modules its code needs, and the loader provides them (see
Generators). Where that code is allowed to run, and what else it may be granted, is the
subject of two modules:

| | |
| --- | --- |
| [`sbx`](sbx/README.md) | where code from a drive runs, so it reaches only what it was granted. Docker today, microsandbox next. |
| [`cap`](cap/README.md) | what a drive may ask for, how it is granted and remembered, and `cli cap`. |

Both are written down before they are built, so the model can be argued with first. What
exists today is the module in `sbx/` that starts and stops the Flamingo node, which
flamingo-node calls into; the rest is design.

## The daemon

One daemon per storage root owns the drive storage and runs the bots in it. Every command
talks to it over a unix socket (`ds.sock`) rather than opening the storage itself, so two
commands can work at the same time and a running bot locks nothing out: a package can be
made while a bot runs, and a running bot's log can be read.

The first command that needs it starts it, and it exits once nothing is left to do, meaning
no command connected and no bot running. While it is up, `ds.pid` holds its pid. A daemon
that crashed leaves its socket behind; the next one checks whether anything still answers
there before taking over.

Three files, one api:

| File | What it is |
| --- | --- |
| [`runtime.js`](runtime.js) | The api over `packs` and `tasks`, in one process. What the daemon runs. |
| [`daemon.js`](daemon.js) | Owns the storage, runs the bots, serves that api on the socket. |
| [`remote.js`](remote.js) | The same api, over the daemon. What `cli` and `fw` use. |

Because the bots run inside the daemon, they stop when it does. It stays up for as long as
any of them is running.

## Storage and shared behavior

```text
~/.ds/
├── pkgs.json       # { "<package-name>": "dat://...", ... }
├── bots.json       # { "<bot-name>": "dat://...", ... }
├── grants.json     # { "<capability-name>": true, ... } what drive code may require
├── corestore/      # Shared persistent drive storage, and each bot's log core
├── ds.sock         # where the daemon listens
├── ds.pid          # the daemon's pid, while it is up
└── run/            # <bot-name>.pid while it runs
```

- Use `pkg` / package-name and `bot` / bot-name Corestore namespaces.
- Persist registrations and drive contents across CLI runs; keep registry access replaceable by Datashell.
- Names use letters, numbers, underscores and hyphens, starting with a letter or number.
- Local paths resolve from the current working directory. Import/export are one off copies.
- Data written through the bot Hyperdrive is saved locally during operation.
