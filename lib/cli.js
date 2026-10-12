#!/usr/bin/env node

// this forwards the command line to the Bare cli using the runtime npm installed.
// `fw start` is the one exception: it is the container entrypoint and stays on Node,
// because bitcoind, lightningd and the WebSocket daemon need it.
if (process.argv[2] === 'start') {
  require('./start')
} else {
  require('bare-runtime/spawn')({
    args: [require.resolve('./fw'), ...process.argv.slice(2)],
    stdio: 'inherit',
    suppressSignals: true,
    forwardExitCode: true
  })
}
