# Glossary

The words the datashell readmes use, in alphabetical order.

**audit core**: a hypercore every bot has. Each step its sandbox takes is written to it as a
message: how a run started, each command, each file copied in or out, and how it ended.

**bot**: code from a package that keeps running until it is stopped. `cli bot +<name>` makes
one, `cli bot <name> --run` starts it, and `cli bot <name> --end` stops it.

**bot's drive**: the drive a bot keeps its own files in, including its `bot.json`. Every bot
has its own.

**`bot.json`**: a file in a bot's drive that says which code the bot runs:
`{ "run": "dat://…/index.js" }`.

**builtin**: one of three modules, `bare-path`, `bare-url` and `bare-crypto`, that the code
in any drive may require without a grant. They only compute: they read no files and open no
connections.

**cap**: any module that is not a builtin, for example `bare-fs`. Code gets a cap only after
it has been granted.

**code drive**: the drive that holds a bot's code. The `dat://` reference in `bot.json` names
it.

**command**: a program and its arguments that a bot's `index.js` runs inside the microVM,
through `sandbox`. For example `sandbox.run('ls', ['/app'])`.

**daemon**: the background process that keeps the storage folder open and runs the bots.
Every `cli` command talks to it. It starts by itself and stops when no command and no bot
needs it.

**`dat://` reference**: `dat://<length>.<fork>.<id>.<hash>`. It names a drive and one revision
of it, and that revision's hash is checked when it is opened.

**drive**: a Hyperdrive, a set of files stored as data, with its own id.

**drive id**: a drive's public key, a long string like `8enyhokh…qfyy`. It stays the same
when the drive's files change.

**generator**: a js file that fills a new drive. A specifier names it with a file path after
it, like `demo/generate`.

**grant**: allowing code to require a cap, with `cli cap +<name>`. `cli cap -<name>` takes it
back.

**hypercore**: an append-only list of records. A drive is built from hypercores, and a log
and an audit core are each one hypercore.

**`index.js`**: the file in the code drive that a bot runs. It exports one async function,
which is called when the bot starts.

**log**: everything a bot has logged, line by line, across all of its runs.
`cli bot <name> --log` prints it.

**message**: one record on an audit core: `{ head, refs, type, data, meta }`.

**microVM**: a small virtual machine on this machine. Code inside it cannot reach this
machine's files or network.

**`msb`**: the command-line tool of microsandbox, which makes the microVMs.

**output drive**: the drive `cli bot <name> --build` saves into. Every bot has its own.

**package**: a drive with a name, made with `cli pkg +<name>`.

**sandbox api**: what a bot's `index.js` gets from `require('sandbox')`: `run`, `start`, `put`,
`get` and `logs`, on the bot's microVM.

**sandbox sdk**: what datashell uses to make a microVM: `run`, `open` and `lazy` in
`scripts/sandbox/run.js`.

**`setup.js`**: an optional file in the code drive. `cli bot <name> --build` runs it once,
inside a microVM, to prepare what the bot needs.

**specifier**: what follows the name in `cli pkg +<name>` and `cli bot +<name>`: a local path,
a `dat://` reference, or a package name or drive id. The forms are in
[README.md](README.md#specifiers).

**storage folder**: `~/.ds`, where datashell keeps everything it stores.
