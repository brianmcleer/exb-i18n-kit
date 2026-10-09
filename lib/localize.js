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

function stamp () { return new Date().toISOString().replace(/[:.]/g, '-') + '-' + require('crypto').randomBytes(4).toString('hex') }

function backupAndExtract (widgetDir, opts) {
  const dry = extractWidget(widgetDir, Object.assign({}, opts, { apply: false, autoWire: true }))
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
  const result = extractWidget(widgetDir, Object.assign({}, opts, { apply: true, autoWire: true }))
  if (backupDir && dry.created.length) fs.writeFileSync(path.join(backupDir, '.created-files.json'), JSON.stringify(dry.created.map(f => path.relative(widgetDir, f))))
  return { result, backupDir, changed: changing.length }
}

function restoreLatest (widgetDir) {
  const root = path.join(widgetDir, 'i18n', 'backup')
  if (!fs.existsSync(root)) throw new Error('No backups in i18n/backup.')
  const backupTime = name => {
    const m = name.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})(?:-(\d{3})Z)?/)
    return m ? Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5] || '000'}Z`) : fs.statSync(path.join(root, name)).mtimeMs
  }
  const latest = fs.readdirSync(root).filter(d => fs.statSync(path.join(root, d)).isDirectory()).sort((a, b) => backupTime(a) - backupTime(b) || a.localeCompare(b)).pop()
  if (!latest) throw new Error('No backups in i18n/backup.')
  const dir = path.join(root, latest)
  const restored = []
  const walk = d => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else {
        if (e.name === '.created-files.json') continue
        const rel = path.relative(dir, p)
        fs.copyFileSync(p, path.join(widgetDir, rel))
        restored.push(rel.replace(/\\/g, '/'))
      }
    }
  }
  walk(dir)
  const marker = path.join(dir, '.created-files.json')
  if (fs.existsSync(marker)) {
    for (const rel of JSON.parse(fs.readFileSync(marker, 'utf8'))) {
      const dest = path.resolve(widgetDir, rel)
      if (dest.startsWith(path.resolve(widgetDir) + path.sep) && fs.existsSync(dest)) fs.unlinkSync(dest)
    }
  }
  return { from: latest, restored }
}

module.exports = { backupAndExtract, restoreLatest }
