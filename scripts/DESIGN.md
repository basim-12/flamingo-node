# datashell design

How the `cli` command is put together. How to use it is in [README.md](README.md).

## The command line

| File | Runs under | What it does |
| --- | --- | --- |
| [cli.js](cli.js) | Node | What the `cli` command points at. Starts Bare with `bare-runtime`, the runtime npm installed, so `bare` does not have to be on `PATH`, and hands it the command line |
| [commands.js](commands.js) | Bare | Reads the command line, makes relative paths absolute against the folder the command was typed in, calls the api through [remote.js](remote.js), and prints the result |

## The package

This folder is its own npm package, `datashell` ([package.json](package.json)). A dependent
installs it with `npm install ./scripts --save` and requires `datashell`. [index.js](index.js)
is everything it offers: `runtime`, `remote`, `foreground`, `sandbox` and `STORAGE`. Each one
is loaded the first time it is read, because the sandbox module also runs under Node and the
rest only under Bare.

## The daemon

One daemon per storage folder owns the drive storage and runs the bots. Every command talks to
it over a unix socket, `ds.sock`, instead of opening the storage itself. So two commands can
run at the same time, a package can be made while a bot runs, and a running bot's log can be
read.

| File | What it does |
| --- | --- |
| [runtime.js](runtime.js) | The api over [packs](packs/README.md), [tasks](tasks/README.md) and [cap](cap/README.md), in one process. The daemon runs this |
| [daemon.js](daemon.js) | Owns the storage, runs the bots, and serves the api on `ds.sock` |
| [remote.js](remote.js) | The same api, over the socket. `cli` and flamingo's `fw` use this. It starts the daemon if it is not up |
| [socket.js](socket.js) | How a command and the daemon talk: one JSON message per line |

Over the socket one call differs: `bot.run(name)` starts the bot inside the daemon and returns
`see(name)` as soon as it runs. `bot.attach(name, print)` is the one that stays: it returns
`{ done }` and calls `print` with each line the bot logs, from the bot's current run if it is
already running.

The first command that needs the daemon starts it. While it is up, `ds.pid` holds its pid. It
exits once no command is connected and no bot is running, and because the bots run inside it,
it stays up for as long as one of them runs. A daemon that crashed leaves `ds.sock` behind; the
next one checks whether anything still answers there before it takes over.

## Storage

```text
~/.ds/
├── pkgs.json       # { "<package-name>": "dat://...", ... }, see packs
├── bots.json       # { "<bot-name>": "dat://...", ... }, see tasks
├── grants.json     # { "<cap-name>": true, ... }, see cap
├── corestore/      # every drive and hypercore, in the namespaces below
├── ds.sock         # where the daemon listens
├── ds.pid          # the daemon's pid, while it is up
└── run/            # <bot-name>.pid while that bot runs
```

`pkgs.json`, `bots.json` and `grants.json` are each written to a temporary file and then
renamed into place ([json.js](json.js)), so a crash never leaves half a file behind.

| Namespace in `corestore/` | What is in it |
| --- | --- |
| `pkg/<name>/<random id>` | the drive of a package made with `cli pkg +<name>` |
| `bot/<name>/<random id>` | the drive of a bot whose drive was made by `cli bot +<name>` |
| `build/<name>` | a bot's output drive, which `--build` writes into |
| `log/<name>` | a bot's log |
| `audit/<name>` | a bot's audit core, see [sandbox](sandbox/README.md#identity) |
