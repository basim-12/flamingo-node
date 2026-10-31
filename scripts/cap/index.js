const path = require('bare-path')
const { read_json, write_json } = require('../json')

// Pure computation, so there is nothing to grant and nothing to ask: every drive has these.
// Anything else a drive requires reaches outside itself, and has to be granted first.
const BUILTINS = ['bare-path', 'bare-url', 'bare-crypto']

module.exports = caps
caps.BUILTINS = BUILTINS

// What a drive's code is allowed to require. Granting writes the name into grants.json, so
// the answer is remembered and the next drive that wants the same thing is not asked again.
// Revoking removes it, and takes it back from everything at once. What a drive declares
// under `caps` is the other side of this: what it asks for, not what it was given.
async function caps (root) {
  const file = path.join(root, 'grants.json')
  const granted = Object.assign(Object.create(null), await read_json(file))

  return { list, info, expand, grant, revoke, allows }

  function list () {
    return Object.keys(granted).sort()
  }

  function allows (name) {
    return BUILTINS.includes(name) || name in granted
  }

  function info (name) {
    if (BUILTINS.includes(name)) return `Name: ${name}\nKind: builtin\nGranted: not needed`
    return `Name: ${name}\nKind: cap\nGranted: ${name in granted ? 'yes' : 'no'}`
  }

  // Both groups at once: what every drive has, and what has been granted on top.
  function expand () {
    const names = list()
    const indent = name => '  ' + name
    return [
      'Builtins, every drive has these:',
      ...BUILTINS.map(indent),
      '',
      'Granted:',
      ...(names.length ? names.map(indent) : ['  nothing'])
    ].join('\n')
  }

  async function grant (name) {
    granted[name] = true
    await write_json(file, granted)
  }

  async function revoke (name) {
    delete granted[name]
    await write_json(file, granted)
  }
}
