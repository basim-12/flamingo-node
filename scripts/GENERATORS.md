# Generators

A generator is a js file that fills a new drive. It exports one async function. We make a new,
empty drive, call the function once with it, and the function writes the drive's first files.

## Running one

We name the file after the package it is in: `cli pkg +home site/generate` runs `/generate.js`
from the package `site` into a new package `home`. `.js` can be left off. A file on this machine
is named by its path: `cli pkg +home ./generate.js`.

`cli bot +<name> site/generate` makes a bot the same way. When the generator is done, we also
write the bot's `bot.json`, pointing at `index.js` in the generator's drive
([tasks](tasks/README.md#what-a-bot-is)).

## The function

```js
module.exports = async function (drive, options) {
  await drive.put('/options.json', Buffer.from(JSON.stringify(options)))
}
```

`drive` is the new drive. `options` holds the `?key=value` pairs after the file name, as
strings: `site/generate?title=Hello&n=2` gives `{ title: 'Hello', n: '2' }`, and no pairs give
`{}`.

We save the package or bot only once the function returns, and ignore what it returns. If it
throws, we print the error and delete the new drive, so the name can be used again.

What a generator can `require` is in [CODE.md](CODE.md#a-generator).

## Example

A package `site` whose generator writes a page, with the html in a helper file:

```text
site/
├── package.json        { "name": "site" }
├── generate.js
└── lib/page.js
```

`lib/page.js`:

```js
module.exports = title => `<h1>${title}</h1>\n`
```

`generate.js`:

```js
const path = require('bare-path')

module.exports = async function (drive, options) {
  const page = require('./lib/page.js')
  await drive.put('/options.json', Buffer.from(JSON.stringify(options)))
  await drive.put(path.join('/site', 'index.html'), Buffer.from(page(options.title || 'untitled')))
}
```

```sh
cli pkg +site ./site
cli pkg +home 'site/generate?title=Hello'
cli pkg home ./home
```

```text
Name: site
Drive: dat://5.0.mczw3k5k…
Name: home
Drive: dat://3.0.6uferjja…
Name: home
Drive: dat://3.0.6uferjja…
Exported to: /…/home
```

`./home` has `options.json`, which is `{"title":"Hello"}`, and `site/index.html`, which is
`<h1>Hello</h1>`.
