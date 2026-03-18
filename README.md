# Flamingo Node

Bitcoin Lightning Network backend — manages bitcoind, lightningd, and a WebSocket bridge.

## Prerequisites (bare metal only)

- bitcoind & bitcoin-cli (Bitcoin Core) on PATH
- lightningd & lightning-cli (Core Lightning) on PATH
- Node.js >= 16

> **Tip:** Using Docker? Skip prerequisites — `fw up` handles everything.

## Install

```bash
npm install -g flamingo-node
```

## CLI Reference

```
fw init .                # create env.json with defaults in current dir
fw start                 # start bitcoind, lightningd, websocket backend
fw stop                  # stop everything
fw status                # show status of all daemons
fw up [ui-mode]          # install docker if needed + build & run container
fw down                  # stop & remove docker container
fw logs                  # tail docker container logs
fw run <scenario.json>   # run a network scenario from a JSON file
fw funds                 # list lightning funds
fw getinfo               # get node info
fw newaddress            # generate a new bitcoin address
fw walletbalance         # get wallet balance
```

## Quick Start

### Option A: Docker (easiest)

```bash
fw init .
fw up
```

### Option B: Bare Metal

```bash
fw init .
# Edit env.json with your local paths
fw start
```

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
