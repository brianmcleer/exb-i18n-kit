'use strict'
/**
 * localize: the one-command path for a widget.
 *   1. back up every source file that will change (i18n/backup/<time>/)
 *   2. extract hardcoded English into translations/default.ts
 *   3. (sync runs next, from the CLI)
 *   4. report what still needs a hand edit
 * restore: put the most recent backup back. localizeWidget gives extract, wire and sync one backup
 *   folder, so one restore undoes the whole run: source changes, language files, manifest.json and
 *   the translation state in i18n/.
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
    backupDir = opts.backupDir || path.join(widgetDir, 'i18n', 'backup', stamp() + '-localize')
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

/** Files sync may write: language files, manifest.json, and i18n/ (lock, STATUS.md, review sheets); never i18n/backup. */
function syncOutputs (widgetDir) {
  const out = []
  const add = f => { try { if (fs.statSync(f).isFile()) out.push(path.relative(widgetDir, f)) } catch (e) { if (e.code !== 'ENOENT') throw e } }
  add(path.join(widgetDir, 'manifest.json'))
  for (const part of ['runtime', 'setting']) {
    const dir = path.join(widgetDir, 'src', part, 'translations')
    let names = []
    try { names = fs.readdirSync(dir) } catch (e) { if (e.code !== 'ENOENT') throw e }
    for (const n of names) if (/\.js$/.test(n)) add(path.join(dir, n))
  }
  const walk = d => {
    let entries = []
    try { entries = fs.readdirSync(d, { withFileTypes: true }) } catch (e) { if (e.code !== 'ENOENT') throw e }
    for (const e of entries) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) { if (path.relative(widgetDir, p).replace(/\\/g, '/') !== 'i18n/backup') walk(p) } else add(p)
    }
  }
  walk(path.join(widgetDir, 'i18n'))
  return out
}

function readCreated (backupDir) {
  try { return JSON.parse(fs.readFileSync(path.join(backupDir, '.created-files.json'), 'utf8')) } catch (e) { if (e.code === 'ENOENT') return []; throw e }
}

/** Copies f into the backup unless an earlier step of the run already saved (or created) it. */
function saveOnce (widgetDir, backupDir, rel) {
  if (readCreated(backupDir).includes(rel)) return
  const d = path.join(backupDir, rel)
  fs.mkdirSync(path.dirname(d), { recursive: true })
  try { fs.copyFileSync(path.join(widgetDir, rel), d, fs.constants.COPYFILE_EXCL) } catch (e) { if (e.code !== 'EEXIST') throw e }
}

/**
 * The localize command as one unit: extract, wire, then sync (a callback, so the CLI and the tests run
 * the same sequence), all into one backup folder. restore then undoes everything this run changed.
 */
async function localizeWidget (widgetDir, opts = {}) {
  const runBackup = opts.backupDir || path.join(widgetDir, 'i18n', 'backup', stamp() + '-localize')
  const step = typeof opts.onStep === 'function' ? opts.onStep : () => {}
  const extract = backupAndExtract(widgetDir, Object.assign({}, opts.extract, { backupDir: runBackup }))
  step('extract', extract)
  let wire = null
  if (opts.wire !== false) {
    const { wireWidget } = require('./wire')
    wire = wireWidget(widgetDir, Object.assign({}, opts.wireOpts, { apply: true, backupDir: runBackup }))
    step('wire', wire)
  }
  let sync = null
  if (typeof opts.sync === 'function') {
    const before = new Set(syncOutputs(widgetDir))
    fs.mkdirSync(runBackup, { recursive: true })
    for (const rel of before) saveOnce(widgetDir, runBackup, rel)
    sync = await opts.sync(widgetDir)
    const created = syncOutputs(widgetDir).filter(rel => !before.has(rel))
    if (created.length) {
      const all = readCreated(runBackup)
      for (const rel of created) if (!all.includes(rel)) all.push(rel)
      fs.writeFileSync(path.join(runBackup, '.created-files.json'), JSON.stringify(all))
    }
  }
  return { backupDir: runBackup, extract, wire, sync }
}

module.exports = { backupAndExtract, restoreLatest, stamp, localizeWidget, syncOutputs }
