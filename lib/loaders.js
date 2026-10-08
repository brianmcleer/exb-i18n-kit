'use strict'
const fs = require('fs')
const vm = require('vm')

function readText (file) {
  return fs.readFileSync(file, 'utf8').replace(/^﻿/, '')
}

/**
 * Load a translations/default.ts (English messages). These are plain object literals,
 * so they are evaluated in a sandbox after turning the ES export into CommonJS.
 */
function loadDefaultTs (file) {
  return parseDefaultTs(readText(file), file)
}

function parseDefaultTs (text, file = 'default.ts') {
  let src = String(text).replace(/^\uFEFF/, '')
  src = src
    .replace(/^\s*import\s[^;]*;?\s*$/gm, '')
    .replace(/\bexport\s+default\b/, 'module.exports =')
    .replace(/\}\s*as\s+const\s*;?\s*$/m, '}')
    .replace(/\}\s*satisfies\s+[\w.<>[\], ]+\s*;?\s*$/m, '}')
  const m = { exports: {} }
  try {
    vm.runInNewContext(src, { module: m, exports: m.exports }, { filename: file, timeout: 2000 })
  } catch (e) {
    throw new Error(`Could not read ${file}: ${e.message}. default.ts must export a plain object literal.`)
  }
  // Note: never unwrap .default here; jimu-ui has a message key named "default".
  const out = m.exports
  if (!out || typeof out !== 'object') throw new Error(`${file} does not export an object`)
  return out
}

/**
 * Load a translations/<locale>.js file. Experience Builder ships these in SystemJS
 * register format; an ES "export default {}" file is also accepted so hand-made files
 * can be onboarded.
 */
function loadLocaleJs (file) {
  const src = readText(file)
  let out
  const System = {
    register: (deps, fn) => {
      const r = fn(v => { out = v }, {})
      if (r && typeof r.execute === 'function') r.execute()
    }
  }
  const m = { exports: {} }
  const code = /System\s*\.\s*register/.test(src) ? src : src.replace(/\bexport\s+default\b/, 'module.exports =')
  try {
    vm.runInNewContext(code, { System, module: m, exports: m.exports }, { filename: file, timeout: 2000 })
  } catch (e) {
    throw new Error(`Could not read ${file}: ${e.message}`)
  }
  if (!out) out = m.exports
  return out && typeof out === 'object' ? out : {}
}

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/

/**
 * Write a locale file in the SystemJS register format Experience Builder ships, one key per
 * line. One key per line matters: the EB webpack build reads _widgetLabel for the widget
 * panel by scanning lines for "_widgetLabel:" (getValueFromTranslation), so keys must be
 * unquoted identifiers and each entry must sit on its own line.
 */
function formatLocaleJs (messages, header) {
  const lines = []
  if (header) lines.push(`/* ${header} */`)
  lines.push('System.register([], function (e) {')
  lines.push('  return {')
  lines.push('    execute: function () {')
  lines.push('      e({')
  const keys = Object.keys(messages)
  keys.forEach((k, i) => {
    const key = IDENT.test(k) ? k : JSON.stringify(k)
    const val = JSON.stringify(String(messages[k])).replace(/[\u2028\u2029]/g, c => '\\u' + c.charCodeAt(0).toString(16))
    lines.push(`        ${key}: ${val}${i < keys.length - 1 ? ',' : ''}`)
  })
  lines.push('      })')
  lines.push('    }')
  lines.push('  }')
  lines.push('})')
  return lines.join('\n') + '\n'
}

function readJson (file, fallback) {
  try { return JSON.parse(readText(file)) } catch (e) { return fallback }
}

function writeJson (file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n', 'utf8')
}

/** Flatten nested Maps SDK t9n JSON into dot keys. */
function flatten (obj, prefix = '', out = {}) {
  for (const k of Object.keys(obj || {})) {
    const v = obj[k]
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, prefix + k + '.', out)
    else if (typeof v === 'string') out[prefix + k] = v
  }
  return out
}

module.exports = { readText, loadDefaultTs, parseDefaultTs, loadLocaleJs, formatLocaleJs, readJson, writeJson, flatten }
