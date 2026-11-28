# crun

`crun` runs a container, a set of processes kept apart from the rest of the system by the Linux
kernel. Inside one microVM, it can keep several processes apart from each other, each with its
own root folder and its own limits. datashell does not use it, and it is not in our image.

The official reference is the [crun man page](https://github.com/containers/crun/blob/main/crun.1.md).
A container is described by a `config.json`, whose fields are defined by the
[OCI runtime spec](https://github.com/opencontainers/runtime-spec/blob/main/config.md), with the
Linux fields in [`config-linux.md`](https://github.com/opencontainers/runtime-spec/blob/main/config-linux.md).

## Running it in our microVM

In a microVM made from our image, `apt-get install crun` gives version 1.8.1. `crun spec` writes a default `config.json`, and `crun run` starts a container from
it. Inside that container, `touch /x` fails with `Read-only file system`, and the process has
only 3 capabilities.

## What `config.json` can restrict

These are the fields caps can be built on.
| field | default | what it does |
| --- | --- | --- |
| [`process.user`](https://github.com/opencontainers/runtime-spec/blob/main/config.md#posix-platform-user) | `{ uid: 0, gid: 0 }` | which user the process runs as |
| [`process.capabilities`](https://github.com/opencontainers/runtime-spec/blob/main/config.md#linux-process) | `CAP_AUDIT_WRITE`, `CAP_KILL`, `CAP_NET_BIND_SERVICE` | which root rights the process keeps |
| [`process.noNewPrivileges`](https://github.com/opencontainers/runtime-spec/blob/main/config.md#linux-process) | `true` | the process cannot gain more rights than it starts with |
| [`process.rlimits`](https://github.com/opencontainers/runtime-spec/blob/main/config.md#posix-process) | `RLIMIT_NOFILE` 1024 | limits per process, like how many files it can have open |
| [`root.readonly`](https://github.com/opencontainers/runtime-spec/blob/main/config.md#root) | `true` | the root folder cannot be written |
| [`mounts`](https://github.com/opencontainers/runtime-spec/blob/main/config.md#mounts) | `/proc`, `/dev`, `/dev/pts`, `/dev/shm`, `/dev/mqueue`, `/sys`, `/sys/fs/cgroup` | which folders the container sees, and how |
| [`linux.namespaces`](https://github.com/opencontainers/runtime-spec/blob/main/config-linux.md#namespaces) | `pid`, `network`, `ipc`, `uts`, `cgroup`, `mount` | what the container gets its own copy of: its own processes, network, hostname and mounts |
| [`linux.resources`](https://github.com/opencontainers/runtime-spec/blob/main/config-linux.md#control-groups) | no devices allowed, no other limits | memory, cpu, process count and device limits |
| [`linux.seccomp`](https://github.com/opencontainers/runtime-spec/blob/main/config-linux.md#seccomp) | none | which system calls the process may make |
| [`linux.maskedPaths`](https://github.com/opencontainers/runtime-spec/blob/main/config-linux.md#masked-paths), [`linux.readonlyPaths`](https://github.com/opencontainers/runtime-spec/blob/main/config-linux.md#readonly-paths) | 10 and 5 paths under `/proc` and `/sys` | what the process cannot see, or cannot write |

## Commands

From the [man page](https://github.com/containers/crun/blob/main/crun.1.md#commands):
`create`, `start`, `run`, `exec`, `kill`, `delete`, `list`, `ps`, `state`, `spec`, `pause`,
`resume`, `update`, `checkpoint` and `restore`.
