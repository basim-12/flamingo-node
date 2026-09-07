# Hyperdrive packages

Use `fw pkg` (or `npm run cli -- pkg` from this repository).

## Commands

| Command | Action and behavior |
| --- | --- |
| `fw pkg +<name> <dirpath>` | Import a folder into a named Hyperdrive. Fail if the source is missing, is not a directory, or the name already exists. Preserve files, empty directories and permission bits; reject symlinks and special files. |
| `fw pkg <name> --import=<dirpath>` | Alias for the import command above, with the same behavior. |
| `fw pkg <name>` | Show drive information, including its ID. |
| `fw pkg <name> --see` | Alias for the inspection command above. |
| `fw pkg` | List all named drives. |
| `fw pkg <name> <dirpath>` | Export the latest files to a local folder, preserving empty directories and permission bits. Fail if the destination already exists. This does not export the drive's full history or identity. |
| `fw pkg <name> --export=<dirpath>` | Alias for the export command above, with the same behavior. |
| `fw pkg -<name>` | Remove the registry entry and purge the drive from this device. Leave import/export folders and other drives untouched. |

## Behavior

- Import/export are one-off copies, with no ongoing folder synchronization.
- Named drives and their contents persist across CLI restarts.
- Names use letters, numbers, underscores and hyphens, starting with a letter or number.

## Storage

```text
flamingo-node/storage/
├── pkgs.json       # { "name": "drive-id", ... }
└── corestore/      # Shared persistent drive storage
```

Storage lives inside this repository, regardless of the terminal's working directory,
and is excluded from Git. `pkgs.json` is created after the first successful import.

Package namespace: `store.namespace('pkg').namespace(name)`, with a fresh generation
namespace per import so recreating a deleted name gets a new drive ID.
Keep registry access separate so Datashell can replace `pkgs.json` later.

## Example

```sh
fw pkg +config ./flamingo-config
fw pkg config --see
fw pkg
fw pkg config ./flamingo-config-copy
fw pkg -config
```

Both local folders remain after deletion.
