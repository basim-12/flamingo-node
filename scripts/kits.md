# Kits: what a drive needs, and the sandbox that provides it

**Status: proposal, nothing here is implemented.** Written to be argued with before any code
is written. The names (`kit`, capability) are placeholders and may not match the ones in the
`kit` / `caps` discussion elsewhere.

## The problem

A drive holds the code a bot runs. That code usually needs things the machine may not have:
a JS module, a binary, a whole runtime. Today datashell solves exactly one of those cases.

| What the code needs | How it is provided today |
| --- | --- |
| A JS module (`bare-ws`, `bip39-mnemonic`) | The drive lists it in its own `package.json`, and the loader hands it over if the host has it. Implemented. |
| A binary (`bitcoind`, `lightningd`) | Not provided. Flamingo gets them because flamingo-docker's Dockerfile installs them into an image. |

The second row is the problem. Writing a Dockerfile per drive would mean every bot author
learns Docker, and then Docker can never be replaced without breaking all of them. It also
means a drive can only ever ask for what some human already baked in.

The goal is that a drive **declares** what it needs and datashell **provides** it, inside a
sandbox, without the author ever naming Docker.

## What a drive declares

The declaration goes in the drive's own `package.json`, next to `dependencies`, which
already works this way:

```json
{
  "dependencies": {
    "bare-ws": "3.1.0"
  },
  "kit": {
    "base": "ubuntu-22.04",
    "install": [
      { "fetch": "https://bitcoincore.org/bin/bitcoin-core-25.0/bitcoin-25.0-aarch64-linux-gnu.tar.gz",
        "sha256": "…", "into": "/usr/local/bin" },
      { "git": "https://github.com/ElementsProject/lightning.git", "commit": "…", "run": "./configure && make install" }
    ],
    "ports": [8080]
  }
}
```

- **`base`** is a name, not an image reference. Datashell maps it to something it can run.
  `ubuntu-22.04` today; a future linux of our own is just another name. Old names stay
  available when new ones appear, so upgrading a base is a drive's own decision, not a
  forced migration.
- **`install`** is a list of pinned steps, not a script. Every step says what it fetches and
  the hash or commit it expects, so the same kit produces the same result on any machine and
  anyone can see what a drive is about to install before running it.
- **`ports`**, and anything else the bot needs from the outside world, is declared too, so
  what a bot can reach is visible rather than discovered at runtime.

Nothing in that declaration names Docker, a Dockerfile, a container or an image.

## How datashell provides it

A kit is **realised** once and reused: datashell hashes the declaration (base plus steps) and
keeps the result under that hash. Running a bot whose kit is already realised starts
immediately; running one whose kit is new realises it first.

That hash is also the answer to a cost we would otherwise pay. Install steps are Docker layers
today, so they are cached and a container starts fast. Steps run from JS inside a sandbox are
not cached by anything, so without this every start would reinstall bitcoin and lightning.

The sandbox is an implementation detail with one job: run the install steps and then the bot,
with nothing but the declared capabilities. `docker sbx` is the likely first implementation,
and Docker-in-Docker stays available for a drive that needs a base we do not offer.

## Using it from the command line

```sh
cli kit <package>              # what its kit declares, and whether it is realised here
cli kit <package> --build      # realise it now instead of on the first run
cli kit                        # realised kits, with their sizes
cli kit -<hash>                # drop a realised kit; drives that need it realise it again
cli bot <name> --run           # realises the kit if needed, then runs the bot inside it
```

Only `cli kit` is new. `cli bot <name> --run` keeps its current meaning; the kit is realised
on the way.

## Using it from JS

The same through `runtime.js`, so `fw` and any other tool get it as well:

```js
const ds = await runtime()

await ds.kit.of('flamingo-node')     // the declaration, as the drive wrote it
await ds.kit.ready('flamingo-node')  // realise it if needed, resolves to its hash
ds.kit.list()                        // realised kits
await ds.kit.remove(hash)

await ds.bot.run('flamingo')         // unchanged
```

## Why the sandbox is the point

Without one, a datashell web api that installs what a drive asks for is a way for any drive
someone discovers to install and run anything on the host. With one, install steps only ever
touch the sandbox, and the bot only gets what its kit declared.

This is also what makes the base swappable. A drive that declares `base` plus pinned steps
has said nothing about how they are realised, so replacing the sandbox underneath, or
offering a second one, changes nothing the author wrote.

## What this means for Flamingo

Flamingo becomes the first kit, and it is already most of the way there: the confirmed work to
move the bitcoin and lightning installation out of the Dockerfile into one pinned install
script is exactly the `install` list above, and pinning them by digest and commit is exactly
what makes a kit reproducible. At that point `flamingo-docker` is a prepared base plus a kit,
and the Dockerfile only exists for people who want to use it with Docker directly.

## Open questions

- Steps as data (`fetch`, `git`, `run`) or a JS file the sandbox executes? 
- Who publishes bases, and what is the list? One name per linux we support, or a drive points
  at a base it trusts?
- Does a realised kit get shared between drives that declare the same one, or kept per drive?

