# Design

How flamingo-node is put together. The [readme](README.md) is for running the node; this
is for working on it.

## One command

`fw up` is the only command, and its flags say what to do: start in the background,
`--attach`, `--run <file.json>` or `--shutdown`. Where the node runs is not the caller's
business, so there is no command for it.

## Where the node runs

The node runs in a container that [flamingo-docker](https://github.com/playproject-io/flamingo-docker)
builds, started through datashell's sandbox module (`require('datashell').sandbox`). That
is why Docker is a prerequisite.

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

`lib/drive/index.js` reads `wallet.json`, and stops with an error if the drive has none. It
starts the node with `fw up --node` and, once the backend accepts connections, sends
`initialize_node_wallet` one `recover` request with the stored mnemonic over `bare-ws`, so
node4 comes up as this bot's identity. On stop it runs `fw up --node --shutdown`.

That file requires `bare-fs`, `bare-process`, `bare-subprocess` and `bare-ws`, and a bot's
`index.js` may require only the builtins and `sandbox`, so `cli bot flamingo --run` is refused
before any of it runs.

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
