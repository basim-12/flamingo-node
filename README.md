# Flamingo Node

A Bitcoin and Lightning node you can run with one command. It starts bitcoind and
lightningd and puts a WebSocket API in front of them, which is what
[flamingo-wallet](https://github.com/playproject-io/flamingo-wallet) talks to.

## Install

```bash
npm install -g flamingo-node
```

That installs one command, `fw`.

You also need **Docker** installed and running, because the node runs in a Docker container
([DESIGN.md](DESIGN.md#where-the-node-runs)).

## Run it

```text
fw up                    # start the node in the background
fw up --attach           # watch it in this terminal, starting it first if needed
fw up --run <file.json>  # start it and run a network scenario
fw up --shutdown         # stop it
```

`fw up` is the whole lifecycle. There is no separate `start`, `stop` or `down`.

**`fw up` and `fw up --attach` do not start the node.** They run it as a datashell bot, and
the bot's `lib/drive/index.js` requires `bare-fs`, which a bot's `index.js` may not require.
They stop with `A bot's index.js may require only the builtins and sandbox, so bare-fs is not
there`. In a new `~/.ds` they stop one step earlier, with
`This drive requires bare-fs, which it was not granted`, until `bare-fs`, `bare-process` and
`bip39-mnemonic` are granted with `npx cli cap +<name>`.

A background `fw up` returns as soon as the node is running, and what the node prints goes
to its log rather than to your terminal. `fw up --attach` shows that output here as it
happens. Ctrl+C stops watching and leaves the node running; `fw up --shutdown` stops it.

The log is kept per node and outlives the run, but reading it needs datashell's own `cli`,
which this package does not install — `npx cli bot flamingo --log` in a clone of this
repository. [DESIGN.md](DESIGN.md) says why the node runs as a datashell bot.

## Talking to the node

Everything a wallet does — balances, addresses, invoices, payments, channels, peers — goes
over the WebSocket API, on the port `WS_PORT` sets, `8080` by default. There is no HTTP
API and no command for it.

A request and the reply to it:

```js
ws.send(JSON.stringify({
  head: ['wallet', 'backend', 1],   // who asks, who is asked, a message id
  type: 'lightning-getinfo',        // what to do
  data: {}                          // what it needs
}))

// { head: ['backend', 'wallet', 1], type: 'lightning-getinfo:response', data: { ... } }
```

The reply carries the id it was sent with and `:response` on the type, so a caller can
match it to the request it belongs to.

What you can ask for:

| | |
| --- | --- |
| state | `lightning-getinfo`, `lightning-listfunds`, `get_btc_balance`, `get_ln_balance`, `sync_wallet_balances` |
| addresses | `bitcoin-newaddress`, `lightning_newaddress`, `validate_btc_address` |
| paying | `create_ln_invoice`, `decode_ln_invoice`, `pay_ln_invoice`, `keysend_ln_payment`, `get_ln_payment_status`, `send_btc_onchain` |
| channels and peers | `list_peers`, `connect_node`, `fund_channel`, `open_channel_flamingo`, `get_liquidity_report`, `request_inbound_liquidity` |
| history | `list_btc_transactions`, `list_ln_invoices`, `get_transaction_history`, `get_transaction_summary` |
| contacts | `contact_add`, `contact_list`, `contact_delete` |
| identity and recovery | `initialize_node_wallet`, `delete_node_wallet`, `get_node_details`, `export_scb`, `recover_funds` |
| regtest only | `admin_reset_world`, `admin_fund_node`, `btc_mine_blocks_regtest`, `simulate_incoming_payment` |

The full list is the `actions` table in
[lib/node_modules/websocketd/daemon.js](lib/node_modules/websocketd/daemon.js), which is
the one place a type is registered.

## Configuration

`fw up` reads `env.json` from the directory you run it in, and writes one from
`env.default.json` if there is none:

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

The paths are inside the node, so the defaults work as they are. `WS_PORT` is the port the
WebSocket API listens on.

## Network scenarios

`fw up --run <file.json>` brings the node up and then builds a Lightning topology on
regtest from the file: the nodes to fund and the channels to open between them.

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

`fund` is in BTC and `capacity` in satoshis. A channel is one direction, so a pair that can
pay each other both ways is two entries. Two nodes and one channel is a valid file:

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

## From JavaScript

`fw` only reads the command line. The work is in the module, so anything can call it
instead of shelling out:

```js
const { up, down, running } = require('flamingo-node')

await up()                               // same as `fw up`
await up({ attach: true })               // ... and stream its output
await up({ scenario: 'two-nodes.json' }) // ... and run a scenario
await running()                          // is the node up?
await down()                             // same as `fw up --shutdown`
```

It throws on failure rather than exiting, so the caller decides what to do about it.

## Related repositories

- [flamingo-wallet](https://github.com/playproject-io/flamingo-wallet) — main entry point & orchestration
- [flamingo-ui](https://github.com/playproject-io/flamingo-ui) — reusable UI component library
- [flamingo-docker](https://github.com/playproject-io/flamingo-docker) — Docker environment for the stack
