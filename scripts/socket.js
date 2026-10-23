const { createConnection } = require('bare-pipe')

// How a command and the daemon talk: a unix socket, one JSON message per line.

function open (path) {
  return new Promise((resolve, reject) => {
    const socket = createConnection(path)
    socket.once('connect', () => resolve(socket))
    socket.once('error', reject)
  })
}

function send (socket, message) {
  socket.write(JSON.stringify(message) + '\n')
}

function receive (socket, onmessage) {
  let rest = ''
  socket.on('data', data => {
    const parts = (rest + data).split('\n')
    rest = parts.pop()
    for (const part of parts) onmessage(JSON.parse(part))
  })
}

module.exports = { open, send, receive }
