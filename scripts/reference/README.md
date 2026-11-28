# reference

A `dat://` reference names one exact revision of a drive, as a string. This module turns one
into its parts and back, and opens the drive it names.

```text
dat://<length>.<fork>.<id>.<hash>
```

`id` is the drive's public key. It stays the same when the drive changes, so it names the
drive, not its content. `length` and `fork` pick out one revision of it, and `hash` is that
revision's hash. Opening a reference checks the hash, so a reference can't quietly point at
other content.

A reference can also name a file in the drive, with options after it, the way a
[specifier](../README.md#specifiers) does:

```text
dat://<length>.<fork>.<id>.<hash>/generate.js?ask=no&n=2
```

```js
const reference = require('./reference')

const parts = reference.decode('dat://3.0.8enyhokh….b81d8037…/generate.js?ask=no&n=2')
// { length: 3, fork: 0, id: '8enyhokh…', hash: 'b81d8037…', file: '/generate.js', options: { ask: 'no', n: '2' } }

reference.encode(parts) // the same string again
```

## API

### `decode(link)`

Splits a `dat://` reference into its parts. Throws `Invalid dat:// reference: <link>` if it
isn't one.

| | |
| --- | --- |
| `link` | a `dat://` reference |

Returns `{ length, fork, id, hash, file, options }`. `file` is the path after the drive, or `''`
if there is none, and `options` holds the `?key=value` pairs as strings, `{}` if there are none.

### `encode(parts)`

The opposite of `decode`: builds the string from its parts.

| | |
| --- | --- |
| `parts` | `{ length, fork, id, hash }`, and optionally `file` and `options` |

Returns the `dat://` reference.

### `open(store, link, { pinned })`

Opens the drive `link` names and returns it. First it checks that the drive is on this machine,
that it has the revision `link` names, and that the revision's hash matches, so a reference can't
open different content than it names. The caller closes the drive when done.

| | |
| --- | --- |
| `store` | the Corestore the drive is kept in |
| `link` | a `dat://` reference. A file and options after it are ignored |
| `pinned` | `true`, unless given, to read the drive exactly as it was at that revision, even if it has changed since. `false` to get the drive as it is now |

Throws `Drive is not available locally: <id>`, `Referenced drive revision is unavailable`, or
`Drive hash mismatch`.

### `known(store, id)`

Returns whether a drive's data is on this machine, without creating anything.

| | |
| --- | --- |
| `store` | the Corestore to look in |
| `id` | a drive id |

### `of(drive)`

Returns the `dat://` reference of a drive's current revision, so it changes every time the
drive is written to.

| | |
| --- | --- |
| `drive` | an open drive |
