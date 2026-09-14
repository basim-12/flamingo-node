# Hyperdrive packages and bots

A generic CLI for named drives (`pkg`) and the bots that run from them (`bot`),
independent of Flamingo's own `fw` command. Run it with Bare from the
flamingo-node folder; the examples below write it as `cli`:

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

References identify an exact drive revision. Code is checked out at that revision
and its hash verified before execution. A bot's code reference stays pinned, its
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
| Local directory | Copy its contents. |
| Local file | Execute it as a generator. |
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
Local paths take precedence over package names; `.js` may be omitted from a
generator path within a package.

A generator only writes the app's own data. When a bot is created from a
generator, the CLI adds `bot.json` itself (see Bots).

```sh
cli pkg +config "flamingo-node/generate?ask=no"
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
`log(line)` prints a line for the operator. An entry may instead return a cleanup
function, which the CLI awaits after `stopped`.

`cli bot <name> --run` runs the entry in the foreground and holds the shared
Corestore for as long as it runs. `cli bot` / `cli bot <name> --see` and
`cli bot <name> --end` do not open the store, so they work from another terminal
while a bot runs: `--end` sends the running process a normal termination signal
(the same as Ctrl+C). Package changes (`cli pkg +`/`-`, `cli bot +`/`-`) need the
store and are refused with a clear message while a bot is running. A bot writes
`~/.flamingo/run/<name>.pid` while active. No background service is installed.

| Command | Action and behavior |
| --- | --- |
| `cli bot +<name> <specifier>` | Register a stopped bot. `<specifier>` must name a drive — package name, drive id or `dat://` reference — because a bot pins its code to a drive; local paths are refused. A drive on its own is used as the configuration drive directly (it must already contain a valid `bot.json`). `<drive>/generate` runs that drive's generator into a fresh bot drive, the CLI writes its `bot.json`, and it is registered as a package under `<name>` too. Reject an existing bot name, a package-name conflict, or a configuration drive already registered to another bot (checked by drive id). |
| `cli bot <name>` / `cli bot <name> --see` | Show its drive reference, package name if available, and running/stopped status. |
| `cli bot` | List registered bots. |
| `cli bot <name> --run` | Verify and launch the entry from bot.json in the foreground. Reuse existing bot data and identity. A bot is a singleton: refuse if it, or another bot on the same drive, is already running. |
| `cli bot <name> --end` | Stop the bot cleanly and preserve its data. |
| `cli bot -<name>` | Refuse while running. Otherwise remove the bot and purge its associated bot package/data, preserving the code package and unrelated data. |

Generator shortcut and lifecycle:

```sh
cli bot +demo "flamingo-node/generate?ask=no"
cli bot demo --see
cli bot demo --run
# From another terminal while the bot is running:
cli bot demo --end
cli bot -demo
```

## Flamingo generator

Import the supplied code package before using its generator:

```sh
cli pkg +flamingo-node ./flamingo-node
cli bot +demo "flamingo-node/generate?ask=no"
cli bot demo --run
```

The code package also carries `Dockerfile` and `docker-compose.json`, copied from
`flamingo-docker`, so the drive holds the Docker setup needed to build and start
the node. They are copies and can drift from `flamingo-docker`. The base image and
`env.docker.json` are not included.

The generator writes `wallet.json`: a fresh 12-word BIP39 mnemonic, made with
`bip39-mnemonic`. Each generated bot drive gets its own, so separate bots have
separate identities. The CLI then adds `bot.json`, pointing at this package's
pinned `main.js`.

On `cli bot <name> --run` the entry reads `wallet.json` and stops with an error if
the bot drive has none. It then builds the image from the drive's `Dockerfile` and
starts the container as the drive's `docker-compose.json` describes, calling
`docker` directly from Bare (`docker.js`). Once the backend accepts connections, it
sends the existing `initialize_node_wallet` WebSocket API one `recover` request with
the stored mnemonic (using `bare-ws`), so node4 always comes up with this bot's
identity. Restarting the same bot reuses the same mnemonic. On stop it shuts the
lightning nodes and bitcoind down cleanly and removes the container. Only one
Flamingo Docker instance can run at a time; startup refuses an already-running
instance.

The backend itself isn't in the drive yet: the container runs it from the local
`flamingo-node` folder, so run bots from that folder. `env.docker.json` comes from
`flamingo-docker`. Docker has to be installed on the machine.

The adapter uses the installed repository's startup and Docker data folder, so
per-bot on-chain / channel *data* is not preserved between runs yet — only the
node identity. The adapter code is pinned; the installed Docker application is
not. Reproducible installation of pinned Bitcoin/Lightning versions and peer
replication remain deferred.

## Storage and shared behavior

```text
~/.flamingo/
├── pkgs.json       # { "package-name": "dat://...", ... }
├── bots.json       # { "bot-name": "dat://...", ... }
├── corestore/      # Shared persistent drive storage
├── code/           # Transient verified code checkouts, removed after each run
└── run/            # <bot-name>.pid while that bot is running
```

- Use `pkg` / package-name and `bot` / bot-name Corestore namespaces.
- Persist registrations and drive contents across CLI runs; keep registry access replaceable by Datashell.
- Names use letters, numbers, underscores and hyphens, starting with a letter or number.
- Local paths resolve from the current working directory. Import/export are one off copies.
- Data written through the bot Hyperdrive is saved locally during operation.
