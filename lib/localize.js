'use strict'
/**
 * localize: the one-command path for a widget.
 *   1. back up every source file that will change (i18n/backup/<time>/)
 *   2. extract hardcoded English into translations/default.ts
 *   3. (sync runs next, from the CLI)
 *   4. report what still needs a hand edit
 * restore: put the most recent backup back.
 */
const fs = require('fs')
const path = require('path')
const { extractWidget } = require('./extract')

function stamp () { return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) }

function backupAndExtract (widgetDir, opts) {
  const dry = extractWidget(widgetDir, Object.assign({}, opts, { apply: false }))
  const changing = dry.results.filter(r => r.changed).map(r => r.abs)
  for (const part of ['runtime', 'setting']) {
    const def = path.join(widgetDir, 'src', part, 'translations', 'default.ts')
    if (Object.keys(dry.added[part] || {}).length && fs.existsSync(def)) changing.push(def)
  }
  let backupDir = null
  if (changing.length) {
    backupDir = path.join(widgetDir, 'i18n', 'backup', stamp())
    for (const f of changing) {
      const dest = path.join(backupDir, path.relative(widgetDir, f))
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.copyFileSync(f, dest)
    }
  }
  const result = extractWidget(widgetDir, Object.assign({}, opts, { apply: true }))
  return { result, backupDir, changed: changing.length }
}

function restoreLatest (widgetDir) {
  const root = path.join(widgetDir, 'i18n', 'backup')
  if (!fs.existsSync(root)) throw new Error('No backups in i18n/backup.')
  const latest = fs.readdirSync(root).filter(d => fs.statSync(path.join(root, d)).isDirectory()).sort().pop()
  if (!latest) throw new Error('No backups in i18n/backup.')
  const dir = path.join(root, latest)
  const restored = []
  const walk = d => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else {
        const rel = path.relative(dir, p)
        fs.copyFileSync(p, path.join(widgetDir, rel))
        restored.push(rel.replace(/\\/g, '/'))
      }
    }
  }
  walk(dir)
  return { from: latest, restored }
}

module.exports = { backupAndExtract, restoreLatest }
