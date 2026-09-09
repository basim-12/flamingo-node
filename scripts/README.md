# Hyperdrive packages and bots

Examples use `fw`, the repository's CLI name. From the repository, use
`npm run cli -- pkg ...` or `npm run cli -- bot ...`.

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

| Command | Action and behavior |
| --- | --- |
| `fw pkg +<name> <specifier>` | Create a named drive from contents or a generator. Reject existing names and missing sources. |
| `fw pkg <name> --import=<specifier>` | Same as creation above. |
| `fw pkg <name>` / `fw pkg <name> --see` | Show the package name and drive reference. |
| `fw pkg` | List named drives. |
| `fw pkg --help` / `fw bot --help` | Print usage. |
| `fw pkg <name> <dirpath>` / `fw pkg <name> --export=<dirpath>` | Export the latest stored contents to a new folder. Reject an existing destination; its parent must exist. Export files, not drive history or identity. |
| `fw pkg -<name>` | Remove the registration and purge local drive data. Preserve import/export folders and unrelated drives. Refuse if the package belongs to a running bot. |

## Specifiers

`fw pkg +<name> <specifier>` and `fw bot +<name> <specifier>` take the same
`<specifier>`:

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
latest local revision. Either way `fw` stores the full
`dat://length.fork.id.hash` reference.

## Generators

A generator exports one async function receiving the new Hyperdrive and options:

```js
module.exports = async function (drive, options) {
  // Write bot.json and any app specific initial data to drive.
}
```

Query parameters become options, for example `?ask=no`. The generator can prompt
for input or run automatically. Registration happens after it finishes filling
the drive; failed initialization is cleaned up. Values in `options` are strings.
When the generator is run from a drive URL or a package, the CLI also passes
`options.code` — the pinned reference of that source drive — so the generator can
record it (for example as the `entry` in `bot.json`). Local paths take precedence
over package names; `.js` may be omitted from a generator path within a package.

```sh
fw pkg +config "flamingo-node/generate?ask=no"
fw bot +demo config
```

Here `flamingo-node` is an existing code package. Its generator creates the
per instance configuration, including any required identity setup or reuse.

## Bots

The code drive contains the application. One bot drive holds both configuration
and generated data; each application chooses its own folder structure.

`bot.json` contains the information the CLI needs to launch the application:

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

`fw bot <name> --run` runs the entry in the foreground and holds the shared
Corestore for as long as it runs. `fw bot` / `fw bot <name> --see` and
`fw bot <name> --end` do not open the store, so they work from another terminal
while a bot runs: `--end` sends the running process a normal termination signal
(the same as Ctrl+C). Package changes (`fw pkg +`/`-`, `fw bot +`/`-`) need the
store and are refused with a clear message while a bot is running. A bot writes
`~/.flamingo/run/<name>.pid` while active. No background service is installed.

| Command | Action and behavior |
| --- | --- |
| `fw bot +<name> <specifier>` | Register a stopped bot. `<specifier>` is any of the sources above; a `dat://` reference, drive id or package name is used as the configuration drive directly (it must already contain a valid `bot.json`), a local file or `.../generate` runs a generator to produce a fresh bot drive (registered as a package under `<name>` too). Reject an existing bot name, a package-name conflict, or a configuration drive already registered to another bot (checked by drive id). |
| `fw bot <name>` / `fw bot <name> --see` | Show its drive reference, package name if available, and running/stopped status. |
| `fw bot` | List registered bots. |
| `fw bot <name> --run` | Verify and launch the entry from bot.json in the foreground. Reuse existing bot data and identity. A bot is a singleton: refuse if it, or another bot on the same drive, is already running. |
| `fw bot <name> --end` | Stop the bot cleanly and preserve its data. |
| `fw bot -<name>` | Refuse while running. Otherwise remove the bot and purge its associated bot package/data, preserving the code package and unrelated data. |

Generator shortcut and lifecycle:

```sh
fw bot +demo "flamingo-node/generate?ask=no"
fw bot demo --see
fw bot demo --run
# From another terminal while the bot is running:
fw bot demo --end
fw bot -demo
```

## Flamingo generator

Import the supplied code package before using its generator:

```sh
fw pkg +flamingo-node ./flamingo-node
fw bot +demo "flamingo-node/generate?ask=no"
fw bot demo --run
```

The generator writes two files into the bot drive:

- `bot.json` — the pinned `entry` (`<code-ref>/main.js`).
- `wallet.json` — a fresh BIP39 mnemonic. Each generated bot drive gets its own,
  so separate bots have separate identities.

On `fw bot <name> --run` the entry starts the existing Docker flow (`fw up`), then
calls the existing `initialize_node_wallet` WebSocket API with `action: "recover"`
and the stored mnemonic, so node4 always comes up with this bot's identity.
Restarting the same bot reuses the same mnemonic. On stop it runs
`fw up --shutdown`. Only one Flamingo Docker instance can run at a time; startup
refuses an already-running instance.

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
