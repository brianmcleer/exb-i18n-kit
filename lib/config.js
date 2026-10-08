'use strict'
const fs = require('fs')
const path = require('path')
const { readJson } = require('./loaders')

const CONFIG_NAME = 'exb-i18n.config.json'

const DEFAULTS = {
  locales: 'all',
  client: null,
  provider: null, // { "type": "libretranslate", "url": "http://localhost:5000", "apiKeyEnv": "LT_API_KEY" }
  shipMachine: true, // write machine translations into locale files (still listed for review)
  fillMissingWithEnglish: true, // untranslated keys are written as English so every key resolves
  reviewFiles: false, // true: every sync also writes i18n/review/<locale>.csv
  cldr: true,
  memory: true, // shared translation memory on GitHub; false to skip, or a URL / folder // Unicode CLDR unit names (downloaded once, cached in ~/.exb-i18n)
  extraTm: [], // extra folders of translations you trust
  exclude: [] // widget folder names to skip in --all mode
}

/**
 * Config is merged from the nearest exb-i18n.config.json files, outermost first:
 * your-extensions/ -> widgets/ -> <widget>/. CLI flags win over all of them.
 */
function loadConfig (startDir, cli = {}) {
  const chain = []
  let dir = path.resolve(startDir)
  for (let i = 0; i < 4; i++) {
    const f = path.join(dir, CONFIG_NAME)
    if (fs.existsSync(f)) chain.unshift({ file: f, data: readJson(f, {}) })
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  const cfg = Object.assign({}, DEFAULTS)
  for (const c of chain) {
    Object.assign(cfg, c.data)
    // Relative paths in a config file are relative to that file.
    if (c.data.client) cfg.client = path.resolve(path.dirname(c.file), c.data.client)
    if (Array.isArray(c.data.extraTm)) cfg.extraTm = c.data.extraTm.map(p => path.resolve(path.dirname(c.file), p))
    if (c.data.provider && typeof c.data.provider === 'object' && c.data.provider.type && /^[.\\/]/.test(c.data.provider.type)) {
      cfg.provider = Object.assign({}, c.data.provider, { type: path.resolve(path.dirname(c.file), c.data.provider.type) })
    }
  }
  for (const k of Object.keys(cli)) if (cli[k] !== undefined) cfg[k] = cli[k]
  cfg.files = chain.map(c => c.file)
  return cfg
}

module.exports = { loadConfig, CONFIG_NAME, DEFAULTS }
