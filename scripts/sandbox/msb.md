# msb

`msb` is the command line tool of [microsandbox](https://docs.microsandbox.dev). We use it to
make every microVM. This lists the `msb create` options that decide what a microVM can reach,
which are the ones caps can be built on. They come from `msb create --help` of `msb` 0.7.11, the
version we run. The official reference is
[sandbox commands](https://docs.microsandbox.dev/cli/sandbox-commands#msb-run), which describes
`msb run` and says `msb create` takes the same flags.

## Network

Details: [networking](https://docs.microsandbox.dev/networking/overview) and
[rule syntax](https://docs.microsandbox.dev/cli/sandbox-commands#network-rule-syntax).

| option | what it does | we use |
| --- | --- | --- |
| `--no-net` | no network in or out, unless a `--net-rule` allows it | yes, for `caps` of `{}` |
| `--net <profile>` | a ready made policy: `public`, `private`, `host`, `all` or `none` | no |
| `--net-rule <rule>` | allow or deny one target, as `<action>[:<direction>]@<target>[:<proto>[:<ports>]]`, for example `allow@example.com:tcp:443` | yes, for `caps.net` |
| `--net-default <action>` | what happens to traffic no rule matches, both ways | yes, `deny` with `caps.net` |
| `--net-default-egress`, `--net-default-ingress` | the same, one direction only | `--net-default-egress deny` with `caps.ports` |
| `-p`, `--port <host:guest>` | lets this machine reach a port inside | yes, for `caps.ports` |
| `--max-tcp-connections`, `--max-udp-connections`, `--max-inbound-tcp-connections` | limits on open connections | no |
| `--net-egress-bandwidth`, `--net-ingress-bandwidth`, `--net-egress-ops`, `--net-ingress-ops` | limits on bytes or packets per second | no |
| `--dns-nameserver <addr>` | which DNS server the microVM asks | no |
| `--no-dns-rebind-protection` | lets a DNS answer point at a private address | no |
| `--proxy <url>` | sends every outbound connection through a proxy | no |
| `--tls-intercept` | inspects the microVM's HTTPS traffic, through a proxy in `msb` | no |
| `--secret <ENV@HOST>` | a value from this machine's environment. The microVM only sees a placeholder, which `msb` swaps for the value on requests to the named hosts ([secrets](https://docs.microsandbox.dev/sandboxes/secrets)) | no |

## Files

| option | what it does | we use |
| --- | --- | --- |
| `--mount-dir <src:dest[:ro]>` | a folder on this machine, inside the microVM | yes, `/app`, `/out` and `/mnt/<drive id>` |
| `--mount-file <src:dest>` | one file on this machine | no |
| `--mount-disk <src:dest>` | a disk image | no |
| `-v`, `--volume <src:dest>` | a folder on this machine or a named volume | no |
| `--mount-named <name:dest>` | a named volume, kept by `msb` between microVMs | no |
| `--mount-owned <dest>` | a volume removed with the microVM | no |
| `--tmpfs <path[:size]>` | a folder in memory | no |
| `--copy`, `--copy-file`, `--copy-dir <src:dest>` | copies from this machine into the microVM before it starts | no |
| `--rm <path>` | hides a path of the image | no |
| `--root-disk <size>` | the size of the microVM's own disk | no |
| `--vsock <path:port>` | a local socket on this machine that the microVM can reach | no |

## Resources and lifetime

| option | what it does | we use |
| --- | --- | --- |
| `-c`, `--cpus` | how many cpus | no, `msb` gives 1 |
| `-m`, `--memory` | how much memory | no, `msb` gives 512 MiB |
| `--max-duration <time>` | stops the microVM after that long | no |
| `--idle-timeout <time>` | stops it after that long with nothing happening | no |

## User and security

| option | what it does | we use |
| --- | --- | --- |
| `-u`, `--user <user>` | which user runs commands | no, so commands run as `root` |
| `--security <profile>` | `default` or `restricted`, see below | no, so `default` |
| `-e`, `--env <KEY=value>` | an environment variable | no |
| `-w`, `--workdir <path>` | the folder commands start in | no |

### `default` and `restricted`

Ran the same commands under both profiles. Both run as `root` with `/` writable. The
difference is one capability and one flag:

| | `default` | `restricted` |
| --- | --- | --- |
| capabilities (`CapEff`) | all, `000001ffffffffff` | all but `CAP_SYS_ADMIN`, `000001ffffdfffff` |
| `NoNewPrivs` | 0 | 1, so a program cannot gain more rights than its parent |
| `mount -t tmpfs` | works | `permission denied` |
| writing to `/proc/sys` | works | refused |

## Changing a running microVM

`msb modify` has no option for the network: `--net-rule` and `--net-default` are refused as
unknown. It can add a port, or change memory and cpus, but each says `requires restart`. So
to change what a microVM can reach, we stop it and make it again.
