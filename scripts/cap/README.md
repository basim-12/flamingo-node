# cap

What a drive's code may use, and how it comes to be allowed. Where it runs is
[sbx](../sbx/README.md).


## The model

- Code in a drive reaches **code and data in drives, and nothing of the host**. No files, no
  processes, no network, unless something was granted.
- A **capability is a module**, handed over by the loader. Drive code can require what it was
  given and nothing else, which is why a require is the place to ask.
- There is no difference between requiring `bare-ws` and requiring `lightningd`. Both are
  modules, both grant something: one a socket, the other a program with a network of its own.
- Two kinds, and the split is the whole point:
  - **builtins** — pure computation. `bare-path`, `bare-url`, `bare-crypto`. Nothing to grant,
    nothing to ask. The aim is for this group to shrink towards nothing.
  - **caps** — anything that touches the world. `bare-fs`, `bare-subprocess`, `bare-ws`,
    `bitcoind`. Granted, remembered, revocable, and extendable at runtime.
- Within caps, **read and write are different grants**: a drive that may read a folder has not
  earned the right to change it.
- Datashell's own modules : corestore, hyperdrive, the daemon are in **neither** group. A
  drive cannot name its way to them. (Today it can: anything datashell has installed is handed
  over if the drive lists it. That is the first thing this closes.)

## Using it

```sh
cli cap                     # what is granted, top level only
cli cap --expand            # the whole tree, including what each one pulls in
cli cap <name>              # what it is, what it needs, and who was granted it
cli cap +<name>             # grant it
cli cap -<name>             # revoke it, everywhere
```

Every command has the same thing in JS, by the mechanical mapping the readmes use:

```js
ds.cap()                    // cli cap
ds.cap({ expand: true })    // cli cap --expand
ds.cap(name)                // cli cap <name>
ds.cap`+`(name)             // cli cap +<name>
ds.cap`-`(name)             // cli cap -<name>
```

## Asking, and remembering

A drive requires something it was not granted, so the loader stops and asks. The prompt is
for the **whole tree**, not one module at a time: granting `bare-mycaps` means granting what
it needs to do its job, and seeing that list is the point of being asked.

The answer is remembered. The next drive that wants `bare-mycaps` needs no prompt, because
that question was already answered. `cli cap` then shows the top level, `--expand` shows what
each one pulled in, and `cli cap -<name>` takes it back from everything at once.

## Trees, and why they contain anything

A capability can be built out of others:

```
bare-mycaps
├── bare-fs
└── bare-subprocess
```

`bare-subprocess` is the dangerous one : it can run anything on the machine. So nothing is
granted it directly. It goes to wrappers that use it narrowly:

```
bare-npm, bare-nix, bare-flatpak, bare-apt   →  bare-subprocess
bare-mycollection                            →  bare-flatpak (a fixed set, nothing else)
```

A drive asks for `bare-flatpak` and gets package installation. It cannot ask for a shell,
because nothing hands out a shell. That is containment: the power exists once, behind
something that only spends it one way.

## What a drive declares

In its own `package.json`, next to the modules it needs:

```json
{
  "dependencies": { "bare-ws": "3.1.0" },
  "caps": { "bare-flatpak": "1.0.0" }
}
```

How it installs what it needs is **JavaScript that runs in the sandbox**, not a format we
invented, a Dockerfile is widely known and a JSON manifest of our own would be a worse
version of it. The script is ordinary code; a small `sh` tag of the author's own makes it
readable and lets an existing shell script be pasted in, but that is a convention, not
something datashell dictates.

## Realising it, and trusting the result

Integrity does not go per ecosystem. A git commit, a tarball checksum and an apt version are
three different mechanisms and there are more coming, so instead:

1. install into an **empty sandbox**, with nothing of the user's reachable
2. what comes out is a **drive**, and a drive has a root hash
3. the declared hash and the built hash are compared
4. only on a match does it get access to anything real

One mechanism, expressed in the thing datashell already has. It is also the cache: the result
is a versioned drive, so a second run mounts it instead of installing again, and an older
revision is a rollback.

`cli bot <name> --build` is how it gets built without being run, and in the easy case it is a
no-op because the drive already exists.

The base starts generic and as small as we can manage, `debian-slim` over ubuntu if it holds
up. A script that installs Docker covers anyone who needs something fuller, through Docker in Docker.

## Open

- **Who implements what a drive declares?** A drive asking for `bitcoind` is asking someone to
  have written `bitcoind` as a cap: something that starts it in a sandbox, or reconnects to one
  already running, and hands back a handle. That shape is undecided and it decides the rest.
- **Who answers a prompt when nobody is there?** Bots run in the daemon, started by a command
  that may already be gone. A first run that needs granting cannot block forever, so either
  granting happens up front, or an ungranted run fails and says what it wanted.
- **How far does read versus write go?** Per capability is easy, per path or per drive is more
  useful and more to keep track of.
- **When is a cap revoked in a running bot?** Taking a grant away from code that is mid-run
  either stops it or lies to it, and neither is free.
