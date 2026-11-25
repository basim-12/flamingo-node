const path = require('bare-path')
const { read_json, write_json } = require('../json')

// README.md#builtins-and-caps
const BUILTINS = ['bare-path', 'bare-url', 'bare-crypto']

module.exports = caps
caps.BUILTINS = BUILTINS

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
