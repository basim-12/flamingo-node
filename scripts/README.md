# Hyperdrive packages

Use `fw pkg` (or `npm run cli -- pkg` from this repository).

## Commands

| Command | Action |
| --- | --- |
| `fw pkg +<name> <dirpath>` | Import a folder into a named Hyperdrive. |
| `fw pkg <name> --import=<dirpath>` | Same as above. |
| `fw pkg <name>` | Show drive information, including its ID. |
| `fw pkg <name> --see` | Same as above. |
| `fw pkg` | List all named drives. |
| `fw pkg <name> <dirpath>` | Export the latest contents to a local folder. |
| `fw pkg <name> --export=<dirpath>` | Same as above. |
| `fw pkg -<name>` | Remove the registry entry and purge the drive from this device. |

## Behavior

- Import fails if the source folder does not exist or is not a directory.
- Export fails if the destination already exists.
- Import/export are one off copies, with no ongoing folder synchronization.
- Deleting a drive leaves import/export folders and other drives untouched.
- Named drives and their contents persist across CLI restarts.
- Export copies the latest files, not the drive's full history or identity.
- Import rejects existing names. Names use letters, numbers, underscores and hyphens, starting with a letter or number.
- Files, empty directories and permission bits are preserved; symlinks and special files are rejected.
- Import/export folders must be outside `~/flamingo/`; the export parent directory must exist.

## Storage

```text
~/flamingo/
├── pkgs.json       # { "name": "drive-id", ... }
└── corestore/      # Shared persistent drive storage
```

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


