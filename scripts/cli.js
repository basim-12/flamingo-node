#!/usr/bin/env node

// DESIGN.md#the-command-line
require('bare-runtime/spawn')({
  args: [require.resolve('./commands'), ...process.argv.slice(2)],
  stdio: 'inherit',
  suppressSignals: true,
  forwardExitCode: true
})
