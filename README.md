# Flamingo Node

Bitcoin Lightning Network backend — manages bitcoind, lightningd, and a WebSocket bridge.


## Install

```bash
npm install -g flamingo-node
```

## CLI Reference

```text
fw up                    # Auto-creates env.json, installs docker, builds & runs
fw up --attach           # Start and steam logs to terminal
fw up --run <file.json>  # Start and run a network scenario
fw up --shutdown         # Cleanly stop nodes and remove the container
```

## How is `fw start/stop` different from `fw up/down`?

Previously, `start/stop` managed local/bare-metal processes while `up/down` managed the Docker environment. These have been unified into `fw up` to simplify the API surface and hide implementation details. Docker is now considered an internal implementation detail that the CLI manages automatically.

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

Previously, `start/stop` managed local/bare-metal processes (bitcoind, lightningd) while `up/down` managed the Docker environment. 

To simplify the API surface and hide implementation details, these have been unified into `fw up`. Whether it's running locally or in Docker is now an internal detail, allowing for a more consistent developer experience.


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
Flamingo's code package for it: a generator, an entry and the Docker files. Import it,
then create a bot from its generator:

```sh
cli pkg +flamingo-node ./lib/drive
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
identity. Restarting the same bot restores its previous state. On stop it shuts the
lightning nodes and bitcoind down cleanly and removes the container. Only one
Flamingo Docker instance can run at a time; startup refuses an already-running
instance.

The backend itself isn't in the drive yet: the container runs it from this
repository, so run bots from the repository folder. `env.docker.json` comes from
`flamingo-docker`. Docker has to be installed on the machine.

The adapter uses the installed repository's startup and Docker data folder, so
per-bot on-chain / channel *data* is not preserved between runs yet — only the
node identity. The adapter code is pinned; the installed Docker application is
not. Reproducible installation of pinned Bitcoin/Lightning versions and peer
replication remain deferred.

## Related Repositories

- [flamingo-node](https://github.com/playproject-io/flamingo-node) — Backend: bitcoind, lightningd, WebSocket bridge
- [flamingo-docker](https://github.com/playproject-io/flamingo-docker) — Docker environment for the stack
- [flamingo-wallet](https://github.com/playproject-io/flamingo-wallet) — Main entry point & orchestration
- [flamingo-ui](https://github.com/playproject-io/flamingo-ui) — Reusable UI component library
