# Hyperdrive packages and bots

The current CLI supports local
folder packages. Examples use `fw`, the repository's CLI name.

## Drive references

```text
dat://<length>.<fork>.<id>.<hash>
```

References identify an exact drive revision. Code is checked out at that revision
and its hash verified before execution. A bot's code reference stays pinned, its
own drive reference advances as data is saved.

## Packages

| Command | Action and behavior |
| --- | --- |
| `fw pkg +<name> <init>` | Create a named drive from contents or a generator. Reject existing names and missing sources. |
| `fw pkg <name> --import=<init>` | Same as creation above. |
| `fw pkg <name>` / `fw pkg <name> --see` | Show the package name and drive reference. |
| `fw pkg` | List named drives. |
| `fw pkg <name> <dirpath>` / `fw pkg <name> --export=<dirpath>` | Export the latest stored contents to a new folder. Reject an existing destination; its parent must exist. Export files, not drive history or identity. |
| `fw pkg -<name>` | Remove the registration and purge local drive data. Preserve import/export folders and unrelated drives. Refuse if the package belongs to a running bot. |

Supported `<init>` sources:

| Source | Action |
| --- | --- |
| Local directory | Copy its contents. |
| Local file | Execute it as a generator. |
| `dat://…` | Copy the referenced revision's contents. |
| Generator file within a drive URL | Execute the referenced generator. |
| Existing package name | Copy the package's contents. |
| `package-name/filepath` | Execute a generator from that package. |

Folder copies preserve files, empty directories and permission bits; symlinks and
special files are rejected. Referenced named packages must already exist.

## Generators

A generator exports one async function receiving the new Hyperdrive and options:

```js
module.exports = async function (drive, options) {
  // Write bot.json and any app specific initial data to drive.
}
```

Query parameters become options, for example `?ask=no`. The generator can prompt
for input or run automatically. Registration happens after it finishes filling
the drive, failed initialization is cleaned up.

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

Other application settings and persistent data belong in the bot drive.

| Command | Action and behavior |
| --- | --- |
| `fw bot +<name> <specifier>` | Register a stopped bot using a config-drive reference or package name. Reject an existing bot name. |
| `fw bot +<name> <generator-specifier>` | Generate a bot drive, register its package under the bot's name, then register the stopped bot. Reject package name conflicts. |
| `fw bot <name>` / `fw bot <name> --see` | Show its drive reference, package name if available, and running/stopped status. |
| `fw bot` | List registered bots. |
| `fw bot <name> --run` | Verify and launch the entry from bot.json in the foreground. Reuse existing bot data and identity, refuse a duplicate instance. |
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

## Storage and shared behavior

```text
~/.flamingo/
├── pkgs.json       # { "package-name": "dat://...", ... }
├── bots.json       # { "bot-name": "dat://...", ... }
└── corestore/      # Shared persistent drive storage
```

- Use `pkg` / package-name and `bot` / bot-name Corestore namespaces.
- Persist registrations and drive contents across CLI runs; keep registry access replaceable by Datashell.
- Names use letters, numbers, underscores and hyphens, starting with a letter or number.
- Local paths resolve from the current working directory. Import/export are one off copies.
- Bot data is saved locally during operation.
