// DESIGN.md#the-package
module.exports = {
  get runtime () { return require('./runtime') },
  get remote () { return require('./remote') },
  get foreground () { return require('./runtime').foreground },
  get sandbox () { return require('./sandbox') },
  get STORAGE () { return require('./packs').STORAGE }
}
