# sandbox

Runs code datashell did not write, with only what it was granted. A drive holds the code, and the
sandbox is where it is allowed to run.

Nothing outside this module names Docker, a container or an image, and nothing will name
microsandbox either. Docker is how the sandbox is built today, microsandbox is how it is built
next, and which one it is stays this module's business.

## What it is for

A drive can come from anyone. Running its code on the machine that discovered it is not an
option: it would reach the user's files, their network and their processes. So code from a
drive runs in here, and what it can touch is only what it declared and was granted. That is
the other half of [cap](../cap/README.md): caps say *what* a drive may use, the sandbox is
*where* using it is contained.

It also makes the interesting thing possible. A drive's code runs in a sandbox, its output
lands in another drive, and that drive is the input of the next one, so sandboxed runs chain
into a pipeline across machines, and running a stranger's code stops being reckless.

Only the drive's own code goes inside. Datashell's bot machinery stays out here, because
putting it in the same sandbox as untrusted code offers it up to be attacked.

## Using it

Nothing user facing. There is no `cli sandbox`, a bot is started with `cli bot <name> --run` as
before and the sandbox underneath is invisible. Datashell uses it through this api:

```js
const { run, open } = require('./sandbox/run')

const sandbox = await run({ drive, mount, output, caps, command, audit })

sandbox.id              // the audit core's id, which is also the sandbox's identity
await sandbox.done      // settles when the code inside finishes, with what it printed
sandbox.stop()          // stop it, and what it wrote so far is still collected
```

| | |
| --- | --- |
| `drive` | the drive whose code runs. Mirrored out and mounted read-only at `/app` |
| `mount` | more drives to make readable inside, each at `/mnt/<drive id>`, read-only |
| `output` | the drive that receives whatever the code writes to `/out`, so a run's result is addressable |
| `caps` | what it was granted. Nothing by default: no network at all, and nothing writable but `/out` |
| `command` | what to run inside, as the image sees it |
| `audit` | the hypercore that identifies the run, and holds what it was started with |

A one-shot `run` cannot tell a failure from a success. `done` gives what the code printed, and
`msb` reports a stopped sandbox without its exit code, so there is nowhere to read one from; a
build works around it with a marker file. Through `open` below the question does not come up,
because `msb exec` does return the real exit code.

### One image, and no option to pick another

There is no `image`. Everything datashell runs, runs in the same one.

A sandbox that takes any image means ten bots pull ten images that do the same job. There are
seven here from testing and together they are 1.4 GiB, while one shared image is 80 MiB however
many bots use it. This module could offer the choice if it were published on its own, and
anything that really needs its own base can install a container runtime inside the sandbox;
datashell does not take the option.

The image is `node:26-bookworm-slim`, stock upstream and pinned by digest, so it is the same
thing every time and not something we maintain. It carries Node because a setup script is still
run inside as JavaScript. Once that script runs outside instead, nothing in the sandbox needs a
runtime and the base can be smaller.

Carrying a runtime into a bare base was the first attempt and it does not work: Node's linux
build wants `libatomic`, which no stock debian or ubuntu image has, and a lone Bare binary
exposes `Bare` and nothing else, so a setup script would have no filesystem and no
subprocesses.

### Trying void linux as that base

It works. `ghcr.io/void-linux/void-glibc:latest` pulls under `msb` in five seconds and boots,
and the image is 24.9 MiB rather than the 60MB it is usually described as. It is minimal: 163
binaries, `xbps-install`, and no `git`, `curl`, `tar`, `gzip` or `find`.

`bubblewrap` is one package and 2.4 MB, and it works in the microVM.
`bwrap --ro-bind / / --unshare-all --die-with-parent` confines a subprocess the way it should,
so a wrapper that limits what a subprocess may reach can be built on it.

`git` costs about 135 MB. void's package depends on `perl-Authen-SASL`, `perl-MIME-tools` and
`perl-Net-SMTP-SSL`, so it pulls perl in, and perl is 77.6 MB against git's own 51.2 MB. Those
three dependencies are there for `git send-email`. There is no lighter git in the repository.

`bare` runs, v1.33.0 linux arm64, with none of the `libatomic` trouble Node's build has. The
binary is 94 MB, which is more than everything else in the image put together.

Exporting a prepared sandbox gives tar and zstd, which is the nearest thing here to a shippable
artifact:

| | exported |
| --- | --- |
| void, `git` and `bubblewrap` | 72 MB |
| the same, plus `bare` | 124 MB |
| `node:26-bookworm-slim`, what we run today | 80.1 MiB |

So the answer depends on `bare`. Without it we are a little under what we run now, with it half
again as much. A drive's script runs outside the sandbox and issues commands into it, so nothing
inside needs a runtime, and the version without `bare` is the one to take.

How a prepared base is produced and shipped is not solved. `msb snapshot` is a 4 GiB sparse disk
and its export is a `.msb` archive rather than an OCI image, so adopting this means shipping
that archive or building the image some other way.

### Docker inside a sandbox

That works too. `apt-get install docker.io` in the standard image takes about 50 seconds and
gives debian's 20.10.24. A sandbox has no systemd, so `dockerd` is started directly, and after
that containers run and share the microVM's kernel.

The microVM has what a container runtime needs: kernel 6.12, cgroup v2, overlayfs, netfilter,
`/dev/net/tun`, and root. Volume mounts work in both directions and a container reaches the
internet.

The published port is the part worth proving, because it has two hops to make. A container
publishing into the sandbox, with the sandbox itself created with `-p`, answers `curl` on the
host. So a node running under Docker inside a sandbox can still serve something outside it.

The storage driver needs a hand. Docker chooses `vfs` by itself, because `overlay2` cannot stack
on the sandbox's own overlay root and gives `failed to mount overlay: invalid argument`. `vfs`
copies whole layers rather than sharing them, so it runs but wastes disk. Installing
`fuse-overlayfs` and starting `dockerd --storage-driver fuse-overlayfs` gives a layered driver,
and containers behave the same.

Two things to know when writing that setup: these images have no `pkill`, and a `dockerd` that
was killed leaves `/var/run/docker.pid` behind, which stops the next one starting.

Which means dropping Docker from datashell is possible. Whatever still wants it can install it
into its own sandbox as part of its setup, and the host's Docker stops being something we
require.

`caps` here is what the sandbox is allowed to reach. The modules a drive may require are
granted separately, in [cap](../cap/README.md):

```js
{}                                                   // no network, nothing published
{ net: ['allow@dns', 'allow@example.com:tcp:443'] }  // deny by default, allow those two
{ ports: ['8080:8080'] }                             // no egress, reachable on one port
```

Separate from all of that is what is reached as `require('datashell').sandbox`:
one prepared image under Docker, started and stopped.

| | |
| --- | --- |
| `up(app)` | make sure the sandbox runtime is installed, prepare the node and start it. Returns once it is started, while the services inside it keep coming up. Refuses if it is already running |
| `running()` | whether the node is up |
| `logs()` | follow its output in this terminal until Ctrl+C |
| `down()` | stop bitcoind and the lightning nodes cleanly, then take the node down, waiting for each so nothing is killed mid write |

So there are two sandboxes for now, because the prepared image still has a user. `run` is the
one that takes any drive, and `open` below is what a bot's entry gets: `cli bot <name> --run`
hands the entry a handle and nothing else, so the entry can only act through the sandbox.

### A sandbox a drive's own script drives

`run` decides everything up front: one command, and the sandbox is gone once it finishes.
`open` boots the same sandbox with nothing running in it and hands back a handle.

```js
const box = await open({ drive, mount, output, caps, audit })

box.handle    // what a drive's own script gets
box.stop()    // ours, not the script's
```

| | |
| --- | --- |
| `run(command, args)` | run it inside, and return what it printed. Throws with the code it exited with |
| `start(command, args)` | the same, left running, returning the job's id |
| `put(file, data)` | write bytes to a path inside |
| `get(file)` | read a path inside, as a buffer |
| `logs()` | everything the sandbox has printed, the left-running jobs included |

The handle is the whole of what a drive's script can do. The sandbox it names was built from
what was granted before the script ran, so the script chooses what runs inside and never what
the sandbox may reach, and it has no way to ask for a second one. Stopping is ours: a script
does not end the thing it is running in.

This is what makes a JS runtime inside unnecessary. The script runs out here under Bare where
it resolves nothing, and anything it wants done inside is an `msb` command. `bare` is not in
the base image and does not need to be.

Every call is an entry on the audit core, so the core reads as the sandbox opening, each
command and file in order, and the end.

The sandbox is not booted until the handle is used, so a bot that never touches it never starts
one and does not need msb installed at all. That is the same reasoning as the output drive: a
run that has no use for something should not pay for it.

flamingo's own entry has not been ported to this yet. It still requires `bare-fs` and spawns
flamingo's CLI on the host, which the rule above refuses, so its bot does not run. The node
image does build inside a sandbox, so the port is possible; what it needs first is the build
moved into `setup.js` with the image landing in the output drive, because a sandbox is fresh
every run and rebuilding a 951MB image on each start is not an option.

## Messages in and out

Two hypercores, which are stdin and stdout. There is no third one for errors: an error is a
message on the output core with an error type, not a separate channel.

- **input** is created outside and its code reads it. Whoever spawned the sandbox, or an app
  talking to it later, appends to it.
- **output** is created and owned by the sandbox. A message on it can carry a `dat://`
  reference, or a path inside the output drive, so a large result is linked rather than
  copied into the feed.

The transport is `--vsock`. Datashell's daemon already serves its api on a unix socket, so the
same socket is handed to the sandbox and the code inside connects out to it: no port is
published, nothing of the host is reachable except that one socket, and the daemon on the other
end stays outside where malicious code cannot touch it. What it is allowed to ask for over that
socket is the capability question, not a sandbox question.

The cores are not built yet. `run` carries files in and out, which is the other half of it,
and `--vsock` is proven to work, but the two are not joined up.

Files are the other half of it. The code inside writes into its own filesystem, that path is
watched, and what appears there lands in the **output drive**. So a run has two results: a
feed of messages and an addressable drive, and the paths in the first point into the second.

## Identity, and resuming

Every task has an **audit core**, one across all of its runs rather than one per run. A run
and an end are both entries in it, so the core reads as when the task started, when it
stopped, and what it was given in between. The sandbox's id is derived from the core, so the
core is both the record of what a run was allowed and the handle to find it again.

An entry is `{ head, refs, type, data, meta }`:

| | |
| --- | --- |
| `head` | `['datashell', sandbox, began]`, where `began` is the index of the run entry, so an end pairs with its own beginning |
| `refs` | the addresses it was given: `drive`, `mount`, `output` |
| `type` | `run` or `end` |
| `data` | what the run was started with, or how it ended |
| `meta` | `time`, so the core says when |

Resuming is then one lookup. Given a sandbox id, its audit core says what it was, which
drives it had and which caps were granted, and it starts again on the same terms without
asking anyone anything. A bot is meant to be reusable that way. Deleting it and starting a
fresh one is the user's call.

## What microsandbox gives us

Docker Sandboxes is out. It needs a Docker account and is not open source all the way down,
and that is a dealbreaker. The replacement is
[microsandbox](https://github.com/superradcompany/microsandbox): Apache-2.0, open source, and
it runs locally with **no account at all**. An api key exists only for their optional hosted
backend, which we do not use — local is the default and needs no credential.

```sh
curl -fsSL https://install.microsandbox.dev | sh
```

macOS on Apple silicon, linux with KVM, windows with WHP, so it reaches further than Docker
Sandboxes did. It is still beta, which is worth saying out loud.

We drive the `msb` command line tool and write our own small wrapper around it, rather than
pulling their npm SDK and its TypeScript conventions into our code. Everything below is an
`msb` flag, so nothing is given up by staying on the cli.

Everything below was run on this machine, not read off their docs.

- **Isolation.** A microVM per sandbox with its own kernel, booted as a child process, no
  daemon and no long-running service. A sandbox boots in about twelve seconds including an
  image pull.
- **An existing Docker image goes in unchanged.** `docker save <image>` followed by
  `msb image load -i <tar> -t <image>` imported a 322MB one in two seconds, with no registry
  and no rebuild. Whatever Docker builds today can run in a sandbox tomorrow.
- **The network is not denied by default.** A plain `msb run` reached the public internet. The
  default egress action is deny *with an implicit `allow@public` rule when no other rules are
  present*, which amounts to the same thing. Denying is something you have to ask for:
  `--no-net`, or `--net-default deny` with the rules you want.
- **Rules work, with one trap.** `--net-default deny --net-rule "allow@example.com:tcp:443"`
  blocked example.com until `--net-strict=false` was added. Strict mode is the default and
  wants inspectable authority for a hostname allow. With it off, example.com was allowed and
  github.com stayed blocked, so the rule itself is sound. A rule reads
  `<action>[:<direction>]@<target>[:<proto>[:<ports>]]`, and a target can be a domain, a domain
  suffix, an ip, a CIDR or a group.
- **`--no-net` closes ingress too.** `-p 8080:8080` under `--no-net` was unreachable from the
  host; the same port under `--net-default-egress deny` answered. So "nothing outbound, but
  reachable on one port" is `--net-default-egress deny` plus `-p`, and the port format is
  `HOST:GUEST`, not a bare number.
- **Mounts, four kinds.** `--mount-dir` and `--mount-file` for host paths, `--mount-named` for
  persistent named storage, `--mount-disk` for a disk image, `--tmpfs PATH:SIZE` for memory
  only, and `--mount-owned` for storage that dies with the sandbox. Each takes options, `:ro`
  among them.
- **A host socket into the guest, working with no network at all.** `--vsock
  /path/on/host.sock:5000`, and `AF_VSOCK` to CID 2 on port 5000 from inside, carried a request
  and its reply between a sandbox started with `--no-net` and a unix socket server on the host.
  Datashell's daemon already listens on a unix socket, so this is the channel, and the next
  section is about what rides on it.
- **Resources.** `--cpus` and `--memory`, with `--max-cpus` / `--max-memory` reserving room for
  `msb modify` to resize a sandbox while it runs.
- **Lifecycle.** `msb create` / `start` / `stop` / `rm`, plus `fork` and `snap create` /
  `snap restore`, so a bot can be reused, forked or thrown away, which is what he asked for.

Two things still unresolved. Whether **network rules can change on a running sandbox**:
`msb modify` documents cpus and memory only, so a cap granted or revoked mid-run may mean a
restart. And what **`--security restricted`** actually restricts: it is a documented profile,
but uid, a writable root filesystem and `dmesg_restrict` all looked identical under both
profiles here, so it needs a closer look before it is relied on.

## How it works today

Everything in this section is the older module, and it is the one part of datashell that is
not generic: it names one container and one image, and reads the compose file of one
dependency. That is why a particular node shows up in datashell at all. It goes when `run`
takes over, and until then saying so is better than writing around it.

- **Docker.** This module's own `install.js` checks `docker --version` and installs Docker if it is missing
  (`get.docker.com` on linux and macOS, winget on Windows). Docker has to be available for
  any of this to work, and this module is the only place that checks.
- **The image** is built from the `Dockerfile` in the
  [flamingo-docker](https://github.com/basim-12/flamingo-docker) dependency, pinned to a commit
  in flamingo-node's `package.json`, so the same commit always produces the same image. What
  goes into it is installed by that dependency's `install.js`, with the ubuntu base pinned by
  digest, Bitcoin Core by the checksum of its release tarball and Core Lightning by commit.
- **The container** is started with `docker run`, with its arguments read from that
  dependency's `docker-compose.json`: the volumes it mounts, the ports it publishes and the
  command it runs. We read the compose file ourselves rather than calling `docker compose`, so
  there is one way things start and no second tool in the middle. `${FLAMINGO_PATH}` in a
  volume resolves to the `app` folder passed to `up()`.
- **Stopping** is deliberate rather than a `docker stop`: each lightning node is stopped over
  its RPC and waited for, then bitcoind the same way, and only then is the container removed.
  A lightning node killed mid write can lose channel state.
- **`exec.js`** wraps `spawn` and `spawnSync` in promises. `bare-subprocess` has no `exec`,
  `execFile` or `execSync`, so everything here is spawn based and reads output as bytes.
- **Both runtimes.** The module loads under Node and under Bare. Its `package.json` `imports`
  map points `child_process`, `fs`, `os` and `path` at the `bare-*` packages when Bare
  resolves them, and Node ignores the map because its keys do not start with `#`.

## Where it is going

- **A generic base** instead of a prepared image per app: one small base, a drive's code
  mounted in, and whatever it installs done inside the sandbox rather than baked by us.
- **Drives in, drives out,** over the passthrough mount described above, so nothing is copied
  by hand and a run's result has an address.
- **Bot code outside, commands inside.** Today a bot runs in the daemon with the modules it
  was granted. What replaces that is the handle above: the drive's own code runs out here
  under Bare resolving nothing else, so it has no power of its own, and everything it wants
  done becomes a command in the sandbox.
- **Docker inside the sandbox** for a drive that needs a base we do not offer, which is tested
  above: a Docker daemon of its own in the microVM, not a hole in the host's. Eventually through
  something like `require('bare-docker')`.
- **Less Docker over time.** If a base image's filesystem is itself a hyperdrive, a set of
  drives mounted into an empty base replaces the image, versioned like layers and with the
  same rollback. `localdrive` and `mirror-drive` already do the checkout, watch and copy, so
  with a passthrough mount `fuse` is not needed to get most of the effect.
