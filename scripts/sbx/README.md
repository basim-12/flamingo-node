# sbx

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

Nothing user facing. There is no `cli sbx`, a bot is started with `cli bot <name> --run` as
before and the sandbox underneath is invisible. Datashell uses it through this api:

```js
const run = require('./sbx/run')

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
| `image` | what to run it in. A stock `debian:bookworm-slim` unless something needs more |
| `audit` | the hypercore that identifies the run, and holds what it was started with |

A failed run still looks like a successful one. `done` gives what the code printed, and `msb`
reports a stopped sandbox without its exit code, so there is nowhere to read one from. The
error message type on the output core is the answer to that, once the cores exist.

A build passes an `image` of its own, because an install script is JavaScript and the default
base has no runtime to run it with. It is the stock upstream Node image pinned by digest, not
one we prepare. Carrying a runtime into the stock base was the first attempt and it does not
work: Node's linux build wants `libatomic`, which no stock debian or ubuntu image has, and a
lone Bare binary exposes `Bare` and nothing else, so an install script would have no
filesystem and no subprocesses.

`caps` here is what the sandbox is allowed to reach. The modules a drive may require are
granted separately, in [cap](../cap/README.md):

```js
{}                                                   // no network, nothing published
{ net: ['allow@dns', 'allow@example.com:tcp:443'] }  // deny by default, allow those two
{ ports: ['8080:8080'] }                             // no egress, reachable on one port
```

Separate from all of that is what flamingo-node calls through `require('../scripts/sbx')`:
one prepared image under Docker, started and stopped.

| | |
| --- | --- |
| `up(app)` | make sure the sandbox runtime is installed, prepare the node and start it. Returns once it is started, while the services inside it keep coming up. Refuses if it is already running |
| `running()` | whether the node is up |
| `logs()` | follow its output in this terminal until Ctrl+C |
| `down()` | stop bitcoind and the lightning nodes cleanly, then take the node down, waiting for each so nothing is killed mid write |

So there are two sandboxes for now, because flamingo's node still needs its prepared image.
`run` is the one that takes any drive, but it does not run a *bot* yet: `cli bot <name> --run`
still runs drive code in the daemon. Moving that across is what makes the sandbox invisible,
and it is the next step.

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

Every run has an **audit core**. Its first message records the parameters it was started with:
the id of the input core, and the addresses of `drive`, `mount`, `output` and `caps`. The
sandbox's id is derived from that core, so the core is both the record of what a run was
allowed and the handle to find it again.

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
- **Our Docker image goes in unchanged.** `docker save flamingo-app:latest` followed by
  `msb image load -i <tar> -t flamingo-app:latest` imported the 322MB image in two seconds,
  with no registry and no rebuild. Whatever Docker builds today can run in a sandbox tomorrow.
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

- **Docker.** `install.js` checks `docker --version` and installs Docker if it is missing
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
- **Custom code inside, bot logic outside.** Today a bot runs in the daemon and only the node
  it starts is sandboxed. What moves inside is the drive's own code; the generic machinery
  that manages it stays where it is.
- **Docker inside the sandbox** for a drive that needs a base we do not offer: install
  `docker.io` in the microVM and run containers there, which is a Docker daemon of its own and
  not a hole in the host's. Eventually through something like `require('bare-docker')`.
- **Less Docker over time.** If a base image's filesystem is itself a hyperdrive, a set of
  drives mounted into an empty base replaces the image, versioned like layers and with the
  same rollback. `localdrive` and `mirror-drive` already do the checkout, watch and copy, so
  with a passthrough mount `fuse` is not needed to get most of the effect.
