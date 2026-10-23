# Flamingo Node

Bitcoin Lightning Network backend — manages bitcoind, lightningd, and a WebSocket bridge.


## Install

```bash
npm install -g flamingo-node
```

That installs two commands: `fw`, which runs the Flamingo node, and `cli`, the generic
drive and bot CLI described in [scripts/README.md](scripts/README.md). `npm link` in a
clone gives you the same two. `cli` runs on Bare, so it needs `bare` on PATH; `fw` is a
Node command and works anywhere.

The node runs in a sandbox, which needs **Docker installed**. How it is built and started
is internal, and documented in
[lib/node_modules/sandbox/README.md](lib/node_modules/sandbox/README.md).

## CLI Reference

```text
fw up                    # Start the node in the background
fw up --attach           # Start it in this terminal and stream its output
fw up --run <file.json>  # Start it and run a network scenario
fw up --shutdown         # Cleanly stop the nodes
```

`fw` runs the node as a **datashell bot**, using the same api as the generic drive and bot
CLI in [`scripts/`](scripts/README.md), so both see the same thing. The first `fw up`
registers the code package `flamingo-node` (built by `lib/build.js`) and a bot named
`flamingo`, whose own drive holds the wallet that becomes the node's identity. After that,
`cli bot flamingo` reports its status, `cli bot flamingo --log` prints everything it has
logged, and `cli bot flamingo --end` stops it exactly as `fw up --shutdown` does.

A background `fw up` returns as soon as the bot is running, and its output goes to the
bot's log core: `cli bot flamingo --log` prints it, while the node runs or after, and
`fw up --attach` watches it start in this terminal instead.

## Programmatic API

`fw` only reads the command line; the work is in `lib/flamingo.js`, which anything can
call instead of shelling out to the CLI:

```js
const { up, down, running } = require('flamingo-node')

await up()                               // same as `fw up`
await up({ attach: true })               // ... and stream its output
await up({ scenario: 'two-nodes.json' }) // ... and run a scenario
await running()                          // is the node up?
await down()                             // same as `fw up --shutdown`
```

It throws on failure rather than exiting, so the caller decides what to do.

## Runtimes

The host side runs on Bare; only the entrypoint that runs inside the sandbox stays on Node.

| File | Runtime | Job |
| --- | --- | --- |
| `lib/cli.js` | Node | What `fw` points at. Forwards the command line to Bare using the runtime npm installed, so a `#!/usr/bin/env node` shebang is enough on machines without `bare` on PATH. |
| `lib/fw.js` | Bare | The host CLI: reads the arguments and calls the api. |
| `lib/flamingo.js`, `lib/scenario-runner.js`, [`sandbox`](lib/node_modules/sandbox/README.md) | both | The api and the sandbox under it. An `imports` map points `child_process`, `fs`, `os`, `path` and `process` at the `bare-*` packages when Bare resolves them; Node ignores the map because its keys don't start with `#`. |
| `lib/start.js` | Node | What runs inside the sandbox, which `fw start` runs directly. bitcoind, lightningd and the WebSocket daemon need Node, so nothing on this path goes through Bare. |

`bare-subprocess` has no `exec`, `execFile` or `execSync`, so the shared code uses `spawn`
and `spawnSync` only, and it reads output as bytes because `spawnSync` ignores `encoding`
under Bare.

## Environment Configuration

The CLI uses an `env.json` file in your current directory. If it doesn't exist, it will be automatically created from `env.default.json` when you run `fw up`.

### Default `env.json` structure:

```json
{
  "BITCOIN_DATADIR": "/data/bitcoin",
  "BITCOIN_RPCUSER": "user",
  "BITCOIN_RPCPASSWORD": "password",
  "BITCOIN_RPCPORT": "18443",
  "BITCOIN_CLI_BIN": "/usr/local/bin/bitcoin-cli",
  "LIGHTNING_DIR_4": "/data/lightning4",
  "LIGHTNING_DIR_5": "/data/lightning5",
  "LIGHTNING_DIR_6": "/data/lightning6",
  "LIGHTNINGD_BIN": "/usr/local/bin/lightningd",
  "LIGHTNING_CLI_BIN": "/usr/local/bin/lightning-cli",
  "WS_PORT": "8080"
}
```

## WebSocket API

All node-specific interactions (getinfo, funds, newaddress, etc.) are only available via the WebSocket API on port `8080`.

### Admin Commands

For testing scenarios, several `admin_` commands are available:
- `admin_reset_world`: Closes all channels and clears state for a fresh start.
- `admin_fund_node`: Funds a specific node with BTC from the miner reward (regtest).
- `initialize_node_wallet`: Provisions a fresh wallet/identity for a node.


## How is `fw start/stop` different from `fw up/down`?

`start/stop` used to manage bitcoind and lightningd as local processes, while `up/down`
managed the sandbox they run in. They are one command now, `fw up`: where the node runs is
an internal detail, so there is nothing to choose between.


## Network Scenarios

Use `fw run <scenario.json>` to initialize a Lightning Network topology from a JSON file.

### Scenario JSON Format

```json
{
  "name": "Default 3-Node Ring",
  "description": "User <-> Hub <-> Merchant with bidirectional channels",
  "bitcoin": {
    "rpcuser": "user",
    "rpcpassword": "password",
    "rpcport": "18443",
    "wallet": "regtestwallet"
  },
  "nodes": [
    { "name": "User",     "dir": "/data/lightning4", "fund": 5 },
    { "name": "Hub",      "dir": "/data/lightning5", "fund": 5 },
    { "name": "Merchant", "dir": "/data/lightning6", "fund": 5 }
  ],
  "channels": [
    { "from": "User",     "to": "Hub",      "capacity": 1000000 },
    { "from": "Hub",      "to": "Merchant", "capacity": 1000000 },
    { "from": "Merchant", "to": "Hub",      "capacity": 1000000 },
    { "from": "Hub",      "to": "User",     "capacity": 1000000 }
  ]
}
```

### Example: Simple 2-Node

```json
{
  "name": "Simple 2-Node",
  "description": "Basic sender-receiver setup",
  "bitcoin": {
    "rpcuser": "user",
    "rpcpassword": "password",
    "rpcport": "18443",
    "wallet": "regtestwallet"
  },
  "nodes": [
    { "name": "Alice", "dir": "/data/lightning4", "fund": 5 },
    { "name": "Bob",   "dir": "/data/lightning5", "fund": 5 }
  ],
  "channels": [
    { "from": "Alice", "to": "Bob", "capacity": 500000 }
  ]
}
```

## Running Flamingo as a bot

The drive and bot CLI in [`scripts/`](scripts/README.md) is generic. `lib/drive` is
Flamingo's code package for it: a generator and an entry. `lib/build.js` assembles the
code drive, so build it, then create a bot from its generator:

```sh
cli pkg +flamingo-node ./lib/build.js
cli bot +demo "flamingo-node/generate?ask=no"
cli bot demo --run
```

`lib/build.js` writes `lib/drive`'s two files plus the installed `flamingo-docker`
dependency, read from `node_modules` at the commit `package.json` pins, so the drive
carries what the node needs without this repository keeping copies of it. Nothing reads
those files from the drive yet: the bot asks `fw up`, and `fw` loads them from its own
`node_modules`.

The generator writes `wallet.json`: a fresh 12-word BIP39 mnemonic, made with
`bip39-mnemonic`. Each generated bot drive gets its own, so separate bots have
separate identities. The CLI then adds `bot.json`, pointing at this package's
pinned `main.js`.

On `cli bot <name> --run` the entry reads `wallet.json` and stops with an error if
the bot drive has none. It then starts the node with `fw up` and, once the backend
accepts connections, sends the `initialize_node_wallet` WebSocket API one `recover`
request with the stored mnemonic (using `bare-ws`), so node4 always comes up with
this bot's identity. Restarting the same bot restores its previous state. On stop it
runs `fw up --shutdown`. How the node runs is flamingo-node's business; the bot only
asks for it to start and stop.

The node itself isn't in the drive yet: the bot runs `fw` from this repository, so
run bots from the repository folder.

The node runs from the installed repository and its data folder, so per-bot on-chain /
channel *data* is not preserved between runs yet, only the node identity. The drive's code
is pinned, and so is what the sandbox installs: Bitcoin Core by the published checksum of
its release and Core Lightning by commit. Peer replication remains deferred.

## Related Repositories

- [flamingo-node](https://github.com/playproject-io/flamingo-node) — Backend: bitcoind, lightningd, WebSocket bridge
- [flamingo-docker](https://github.com/playproject-io/flamingo-docker) — Docker environment for the stack
- [flamingo-wallet](https://github.com/playproject-io/flamingo-wallet) — Main entry point & orchestration
- [flamingo-ui](https://github.com/playproject-io/flamingo-ui) — Reusable UI component library
