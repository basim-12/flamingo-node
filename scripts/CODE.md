# Code in a drive

What a drive's code can use, for each of the three files datashell runs from a drive. Which
modules each one may `require` is decided by [cap](cap/README.md#which-code-gets-what).

| file | runs when | runs in | may require |
| --- | --- | --- | --- |
| a bot's `index.js` | `cli bot <name> --run` | the daemon, on Bare | the builtins and `sandbox` |
| a generator | `cli pkg +<name> <specifier>` or `cli bot +<name> <specifier>`, when the specifier names a file | the daemon, on Bare | the builtins, and what its drive's `package.json` lists and is granted |
| `setup.js` | `cli bot <name> --build` | a microVM, on Node | every Node module |

The builtins are `bare-path`, `bare-url` and `bare-crypto`.

## A bot's `index.js`

`index.js` is in the code drive that `bot.json` points at
([tasks](tasks/README.md#what-a-bot-is)). It exports one async function, which datashell calls
with the bot's own drive and `{ on, log }`.

| | |
| --- | --- |
| `require('bare-path')`, `require('bare-url')`, `require('bare-crypto')` | the builtins |
| `require('sandbox')` | a microVM: `run`, `start`, `put`, `get`, `logs` ([sandbox](sandbox/README.md#the-api-requiresandbox)) |
| `require('./other.js')` | another file in the code drive, at the top of the file or inside a function |
| `module`, `exports` | CommonJS, as in Node |
| `__filename` | the file's path in the drive, `/index.js` |
| `__dirname` | the folder's path in the drive; `''` for a file at the drive's root |
| `Buffer`, `console`, `URL`, `URLSearchParams`, `setTimeout`, `setInterval`, `setImmediate`, `queueMicrotask`, `structuredClone`, `atob`, `btoa` | globals, as in Node |
| `Bare` | the daemon's own `Bare` object |

Not there: `process`, `fetch`, `TextEncoder`, and any module other than the four above, whatever
is granted. `require` takes a plain string only, and dynamic `import()` is refused
([packs](packs/README.md#code-loaded-from-drives)). `require.resolve()` and `require.addon()`
throw `UNEXPECTED_PROMISE`.

`console.log` prints into the daemon, which no terminal shows. `log(line)` is what the bot's log
and `cli bot <name> --run --attach` show.

```js
const path = require('bare-path')
const sandbox = require('sandbox')

module.exports = async function (drive, { on, log }) {
  log(await sandbox.run('ls', ['/app']))
  await drive.put(path.join('/notes', 'started.txt'), Buffer.from('started'))
  await on('exit')
}
```

## A generator

A generator is a file that fills a new drive. `cli pkg +<name> demo/generate` runs
`/generate.js` from the package `demo`, and `cli pkg +<name> ./generate.js` runs a file on this
machine ([packs](packs/README.md#generators)). It exports one async function, which datashell
calls with the new drive and the options from the specifier.

| | |
| --- | --- |
| a builtin | always |
| another module | when the generator's drive lists it under `dependencies` in `/package.json` and it is granted. A local generator file gets every granted module |
| `require('./other.js')` | another file in the same drive |
| `module`, `exports`, `__filename`, `__dirname`, the globals, `Bare` | the same as `index.js` |

Not there: `process`, `fetch`, `TextEncoder`, `sandbox`. `console.log` prints into the daemon,
which no terminal shows.

`?key=value` after the file becomes the options, as strings:
`cli pkg +out 'demo/generate?ask=no&n=2'` calls the function with `{ ask: 'no', n: '2' }`.

```js
module.exports = async function (drive, options) {
  await drive.put('/index.js', Buffer.from("module.exports = async function (drive, { log }) { log('hi') }\n"))
  await drive.put('/settings.json', Buffer.from(JSON.stringify(options)))
}
```

## `setup.js`

`setup.js` is an optional file in the code drive. `cli bot <name> --build` runs it once with
`node /app/setup.js`, inside a microVM made from the image `node:26-bookworm-slim`
([sandbox](sandbox/README.md#the-image)).

| | |
| --- | --- |
| every Node module | `fs`, `child_process` and the rest, with no grant |
| `/app` | the code drive's files, read only |
| `/out` | writable. What `setup.js` writes there is copied into the bot's output drive |
| `process`, `__dirname`, `__filename` | as in Node: `__filename` is `/app/setup.js` |
| the user | `root`, with `HOME` at `/root` |

Not there: the network, so a name lookup fails with `ENOTFOUND`. What `setup.js` prints is
printed by `--build`, and the build fails if `setup.js` exits with an error.

```js
const fs = require('fs')

fs.writeFileSync('/out/config.json', JSON.stringify({ built: true }))
console.log('wrote /out/config.json')
```
