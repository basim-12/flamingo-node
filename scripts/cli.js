#!/usr/bin/env node

// this forwards the command line to the Bare cli using the runtime npm installed, so
// `bare` does not have to be on PATH. `lib/cli.js` does the same for flamingo's `fw`.
require('bare-runtime/spawn')({
  args: [require.resolve('./commands'), ...process.argv.slice(2)],
  stdio: 'inherit',
  suppressSignals: true,
  forwardExitCode: true
})
