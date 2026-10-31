# cap

What a drive's code may use, and how it comes to be allowed. Where it runs is
[sbx](../sbx/README.md).


## Two boundaries

A capability is enforced in two different places, and keeping them apart is what makes the
rest of this readable.

| | what it controls | who enforces it |
| --- | --- | --- |
| **the module boundary** | which modules a drive's JS can require | datashell's loader |
| **the sandbox boundary** | what *anything* inside may touch, in any language | the sandbox |

The module boundary only covers code that goes through the loader. A lightning node is not
written in JS and does not use Bare; it is a binary on the linux inside the sandbox, and no
`require` of ours stands between it and the network. What stands there is the sandbox's own
policy. With microsandbox that policy is detailed enough to be useful: egress and ingress
separately, per protocol, per port, per domain or ip, nothing allowed unless a rule says so,
and only the paths that were mounted. The flags are in
[sbx](../sbx/README.md#what-microsandbox-gives-us).

So a capability is one of two things, or both:

- **a module**, handed over by the loader. `bare-fs`, `bare-ws`. Granting it is choosing what
  the drive's code can require.
- **a sandbox allowance**, applied by the sandbox. A network rule, a mounted path. Granting it
  is changing what the sandbox permits.

`bitcoind` is both halves at once: a module whose implementation starts the program inside a
sandbox and hands back a handle, plus the network rule without which that program sits there
unable to reach a peer. Asking for `bitcoind` asks for both, and the prompt says so.

## The model

- Code in a drive reaches **code and data in drives, and nothing of the host**. No files, no
  processes, no network, unless something was granted.
- Two kinds, and the split is the whole point:
  - **builtins** — pure computation. `bare-path`, `bare-url`, `bare-crypto`. Nothing to grant,
    nothing to ask. The aim is for this group to shrink towards nothing.
  - **caps** — anything that touches the world. `bare-fs`, `bare-subprocess`, `bare-ws`,
    `bitcoind`. Granted, remembered, revocable, and extendable at runtime.
- **The default is nothing.** No network, no mounts, no native api. Everything below is
  something that was handed back on purpose.
- **Read and write are per capability.** Not per path and not per drive: a capability that
  reads and one that writes are two capabilities with two names. Wanting one folder readable
  and another writable means writing capabilities that say exactly that, which keeps the
  grant something a person can read in a prompt.
- Datashell's own modules — corestore, hyperdrive, the daemon — are in **neither** group. A
  drive cannot name its way to them. (Today it can: anything datashell has installed is handed
  over if the drive lists it. That is the first thing this closes.)

## What there can be asked for

The categories, named datashell-side. What enforces each one is the sandbox's business, and the
flags that do it are in [sbx](../sbx/README.md#what-microsandbox-gives-us).

| | |
| --- | --- |
| **modules** | what the drive's JS may require, and which native api comes back with it |
| **network** | per direction, per protocol, per port, and per domain, ip or range. Nothing by default |
| **paths** | which host paths are visible inside, and whether each is readable or writable |
| **storage** | persistent, throwaway, or memory only, which decides what survives a restart |
| **resources** | cpu and memory, which are a capability too: a bot that can take the machine down has been granted something |
| **lifecycle** | whether it may be reused, forked or snapshotted, or is always fresh |

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

**Granting happens up front.** A sandbox is started by someone who confirms or rejects what it
declared, and the prompt is for the **whole tree**, not one module at a time: granting
`bare-mycaps` means granting what it needs to do its job, and seeing that list is the point of
being asked.

- A run that was not granted something it needs **fails, and says what it wanted**. It does not
  wait.
- A running sandbox can **ask for more at runtime**, and gets it only if the user confirms. No
  answer is a no.
- **Nobody there means rejected.** An unanswered prompt grants nothing. Somebody has to be
  there for a first run.
- Grants are **remembered per sandbox**. When it resumes later as a daemon it asks nothing: what
  was allowed is granted again, and what was revoked in the meantime stays gone.

`cli cap` shows the top level, `--expand` shows what each one pulled in, and `cli cap -<name>`
takes it back from everything at once.

## Trees, and why they contain anything

A capability can be built out of others:

```
bare-mycaps
├── bare-fs
└── bare-subprocess
```

`bare-subprocess` is the dangerous one — it can run anything on the machine. So nothing is
granted it directly. It goes to wrappers that use it narrowly:

```
bare-npm, bare-nix, bare-flatpak, bare-apt   →  bare-subprocess
bare-mycollection                            →  bare-flatpak (a fixed set, nothing else)
```

A drive asks for `bare-flatpak` and gets package installation. It cannot ask for a shell,
because nothing hands out a shell.

That is containment at the module boundary, and it is worth being exact about what it buys. A
malicious package from npm or apt, or a malicious dependency of an honest one, can make
everything inside that sandbox malicious — installing packages is running code, and a wrapper
around `bare-subprocess` does not change that. What it buys is that the damage stays inside:
the sandbox still has no network it was not granted and no host filesystem outside its mount,
so a compromised install is a compromised sandbox and not a compromised machine. The narrow
wrapper is there so the *prompt* is honest about what is being allowed, not because installing
is safe.

## Finding out what is needed

The format is not designed up front, because guessing it produces a format nobody needs. It is
found by taking everything away and seeing what breaks.

- **In JS**, real sandboxing removes the native api. A module that quietly relied on it throws,
  and the throw names what it wanted. The developer runs their own module, collects those
  failures, and declares exactly those.
- **In the sandbox**, start with `--no-net` and nothing mounted. bitcoind and lightningd will
  not work. What they need becomes visible as they fail, and goes in one rule at a time until
  the thing runs on the minimum rather than on everything.

The same method both sides, and it is how flamingo-node earns its own capability list before
any other bot is attempted.

## What a drive declares

Two fields, and the split is not what it was in the first draft of this readme. `dependencies`
is modules, as always. `caps` is **permissions** — what the code needs *done for it* once
everything has been taken away:

```json
{
  "dependencies": { "bare-ws": "3.1.0" },
  "caps": {
    "net": ["allow@seed.bitcoin.sipa.be:tcp:8333"],
    "fs": { "read": ["/mnt/chain"] }
  }
}
```

A module always goes under `dependencies`, so there is never a question of which field it
belongs in. A permission always goes under `caps`, and `caps` can live in `package.json` or in
its own `caps.json` when it grows.

That shape is provisional on purpose. It starts as whatever flamingo-node actually turns out to
need, and grows only as real bots need more, because the point is a config a developer can read
and write without a manual.

How it installs what it needs is **JavaScript that runs in the sandbox**, not a format we
invented — a Dockerfile is widely known and a JSON manifest of our own would be a worse version
of it. The script is ordinary code; a small `sh` tag of the author's own makes it readable and
lets an existing shell script be pasted in, but that is a convention, not something datashell
dictates. That script is also the answer to where a program comes from: the author declares it
and the author installs it, inside the sandbox, at first run.

## Realising it, and trusting the result

Integrity does not go per ecosystem. A git commit, a tarball checksum and an apt version are
three different mechanisms and there are more coming, so instead:

1. install into an **empty sandbox**, with nothing of the user's reachable
2. what comes out is a **drive**, and a drive has a root hash
3. that hash is what the result is published and referred to by

One mechanism, expressed in the thing datashell already has. It is also the cache: the result
is a versioned drive, so a second run mounts it instead of installing again, and an older
revision is a rollback.

`cli bot <name> --build` is how it gets built without being run, and in the easy case it is a
no-op because the drive already exists.

**Reproducibility is the hard part, and we should not pretend otherwise.** An `install.js` that
produces the same drive hash twice in a row on a fresh sandbox is achievable and worth checking
for; the same script a week later usually is not. Anything not pinned pulls in whatever is
current, timestamps and build dates land in files, and generated keys and caches differ. Bit
identical rebuilds across time are a research problem, not a feature we can promise.

So the design does not need them. **The built drive is the artifact.** It is content addressed,
so it is published by its hash and everyone else mounts that drive instead of building their
own — the hash identifies what was actually built, which is what a reference needs to mean.
Determinism only buys *independent* verification, that a second party rebuilding from the same
script lands on the same hash, and that can be wanted later without blocking any of this now.
A first install can warn when a repeat on the same machine does not match, which catches the
careless cases cheaply.

The base starts generic and as small as we can manage, `debian-slim` over ubuntu if it holds
up. A script that installs Docker covers anyone who needs something fuller, through Docker in
Docker.
