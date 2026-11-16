// What datashell offers anything that depends on it. Nothing outside needs to know which
// file a thing lives in, so nothing outside should reach for one.
//
// Each is fetched when it is read rather than up front, because most of datashell runs
// under Bare only while the sandbox runs under Node too, and a dependent that wants just
// the sandbox should not be made to load the rest.
module.exports = {
  get runtime () { return require('./runtime') },
  get remote () { return require('./remote') },
  get foreground () { return require('./runtime').foreground },
  get sandbox () { return require('./sandbox') },
  get STORAGE () { return require('./packs').STORAGE }
}
