# Design

How flamingo-node is put together. The [readme](README.md) is for running the node; this
is for working on it.

## One command

`fw up` is the only command. `start`/`stop` used to manage bitcoind and lightningd as local
processes while `up`/`down` managed the sandbox they ran in, and keeping both meant the
caller had to know which one it wanted. Where the node runs is not the caller's business,
so there is nothing left to choose between.

## Where the node runs

The node runs in a container that [flamingo-docker](https://github.com/playproject-io/flamingo-docker)
builds, started through datashell's sandbox module. That is why Docker is a prerequisite,
and it is the one thing flamingo knows about how it is run.

It should not know even that. datashell is growing a generic runner — a microVM per
sandbox, no image of ours in it — and when the node moves onto it, installing whatever the
node needs becomes the node's own setup step and datashell stops carrying a Docker
module at all. Whether Docker survives that as something the node installs for itself, or
goes entirely, is still open.

## Runtimes

The host side runs on Bare. Only the entrypoint that runs inside the sandbox stays on Node.

| File | Runtime | Job |
| --- | --- | --- |
| `lib/cli.js` | Node | What `fw` points at. Forwards the command line to Bare using the runtime npm installed, so a `#!/usr/bin/env node` shebang is enough on machines without `bare` on PATH. |
| `lib/fw.js` | Bare | The host CLI: reads the arguments and calls the api. |
| `lib/flamingo.js`, `lib/scenario-runner.js` | both | The api. An `imports` map points `child_process`, `fs`, `os`, `path` and `process` at the `bare-*` packages when Bare resolves them; Node ignores the map because its keys don't start with `#`. |
| `lib/env.js` | both | Where `env.json` is and how it is read. Its own module so the entrypoint inside the sandbox can have the settings without requiring the api, which would pull the sandbox in with it. |
| `lib/start.js` | Node | What runs inside the sandbox. bitcoind, lightningd and the WebSocket daemon need Node, so nothing on this path goes through Bare. |

`bare-subprocess` has no `exec`, `execFile` or `execSync`, so the shared code uses `spawn`
and `spawnSync` only, and it reads output as bytes because `spawnSync` ignores `encoding`
under Bare.

## The node is a bot

`fw up` does not start the node itself. It registers the node with
[`datashell`](scripts/README.md) and runs it as a bot there, so `cli pkg` and `cli bot` see
the same node `fw` does: `cli bot flamingo` reports its status, `cli bot flamingo --log`
prints what it has logged, and `cli bot flamingo --end` stops it exactly as
`fw up --shutdown` does. `cli` is datashell's own command and not one this package
installs, so it is `npx cli` in a clone of this repository.

The first `fw up` makes two things and keeps them, because both are pinned once made:

- the code package `flamingo-node`, assembled by `lib/build.js`
- a bot named `flamingo`, generated from that package

`lib/build.js` copies `lib/drive` — `generate.js`, `index.js` and their `package.json` —
plus the installed `flamingo-docker` dependency, read out of `node_modules` at the commit
`package.json` pins. The drive carries what the node needs without this repository keeping
copies of it.

The generator writes `wallet.json`: a fresh 12-word BIP39 mnemonic from `bip39-mnemonic`.
Every generated bot drive gets its own, so two bots are two identities. The CLI then adds
`bot.json` pointing at the package's pinned `index.js`.

On `--run` the bot's `index.js` reads `wallet.json`, and stops with an error if the drive has none. It
starts the node with `fw up` and, once the backend accepts connections, sends
`initialize_node_wallet` one `recover` request with the stored mnemonic over `bare-ws`, so
node4 always comes up as this bot's identity. On stop it runs `fw up --shutdown`. The bot
only asks for the node to start and stop; how it runs is flamingo-node's business.

Making one by hand rather than letting `fw up` do it is three commands:

```sh
cli pkg +flamingo-node ./lib/build.js
cli bot +demo "flamingo-node/generate?ask=no"
cli bot demo --run
```

## What is pinned

- the code drive, by hash, once built
- `flamingo-docker`, by commit in `package.json`
- the base image, by digest
- Bitcoin Core, by the published checksum of its release
- Core Lightning, by commit
- Node, by checksum, for the architecture `uname -m` reports
- the Python packages, by Core Lightning's own requirements file at that commit, with Mako
  pinned after it so it resolves MarkupSafe to what is already installed

## Not there yet

- **The node is not in the drive.** The bot runs `fw` from this repository, so bots have to
  be run from the repository folder. Nothing reads `lib/drive`'s files from the drive yet
  either: the bot asks `fw up`, and `fw` loads them from its own `node_modules`.
- **Only the identity survives a restart.** The node runs from the installed repository and
  its data folder, so on-chain and channel data is shared rather than per bot.
- **No peer replication.** Deferred.
