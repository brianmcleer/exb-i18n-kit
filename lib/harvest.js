'use strict'
/**
 * Build a translation memory (TM) from the translations Esri already ships inside an
 * Experience Builder Developer Edition install. Nothing is downloaded and nothing from
 * Esri is redistributed: every developer harvests from their own licensed install.
 *
 * Sources, best first:
 *   3  EB framework packages   client/dist/jimu-*\/lib/translations
 *   3  Esri OOTB widgets       client/dist/widgets/**\/dist/{runtime,setting,guide}/translations
 *   2  ArcGIS Maps SDK t9n     client/node_modules/@arcgis/core/assets/esri/**\/t9n
 *   2  Calcite / map comps     client/node_modules/@esri/calcite-components, @arcgis/map-components
 *   1  extra --tm folders      any folder of EB-style or t9n-style translations you trust
 */
const fs = require('fs')
const path = require('path')
const { loadDefaultTs, loadLocaleJs, readJson, flatten } = require('./loaders')
const { toExbLocale, EXB_LOCALES } = require('./locales')
const { norm, looseNorm, isComplexIcu } = require('./match')

const LOCALE_SET = new Set(EXB_LOCALES)

function exists (p) { try { fs.accessSync(p); return true } catch (e) { return false } }
function isDir (p) { try { return fs.statSync(p).isDirectory() } catch (e) { return false } }

function listDirs (dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory() || d.isSymbolicLink()).map(d => path.join(dir, d.name)) } catch (e) { return [] }
}

/** Find folders named `name` under root, up to maxDepth, following symlinks once. */
function findDirsNamed (root, name, maxDepth, out = [], depth = 0, seen = new Set()) {
  if (depth > maxDepth || !isDir(root)) return out
  let real
  try { real = fs.realpathSync(root) } catch (e) { return out }
  if (seen.has(real)) return out
  seen.add(real)
  for (const d of listDirs(root)) {
    const base = path.basename(d)
    if (base === 'node_modules' && depth > 0) continue
    if (base === name) out.push(d)
    else findDirsNamed(d, name, maxDepth, out, depth + 1, seen)
  }
  return out
}

class TM {
  constructor (needed) {
    this.needed = needed || null // Set of norm keys, or null for everything
    this.entries = new Map() // norm -> Map(locale -> Map(text -> {count, prio, src:Set, en}))
    this.loose = new Map() // looseNorm -> Set(norm)
    this.stats = { sources: 0, files: 0, pairs: 0 }
  }

  add (english, locale, text, prio, src) {
    if (typeof english !== 'string' || typeof text !== 'string') return
    if (!english.trim() || !text.trim()) return
    if (isComplexIcu(english)) return
    const k = norm(english)
    if (!k) return
    const lk = looseNorm(english)
    if (this.needed && !this.needed.has(k) && !this.needed.has('L:' + lk)) return
    if (lk && lk !== k) {
      let set = this.loose.get(lk)
      if (!set) { set = new Set(); this.loose.set(lk, set) }
      set.add(k)
    }
    const loc = toExbLocale(locale)
    if (!LOCALE_SET.has(loc)) return
    let byLoc = this.entries.get(k)
    if (!byLoc) { byLoc = new Map(); this.entries.set(k, byLoc) }
    let cands = byLoc.get(loc)
    if (!cands) { cands = new Map(); byLoc.set(loc, cands) }
    const key = text.replace(/\s+/g, ' ').trim()
    const c = cands.get(key) || { count: 0, prio: 0, src: new Set(), en: english }
    c.count++
    if (prio > c.prio) { c.prio = prio; c.en = english }
    if (english.trim() === c.en.trim()) c.exact = true
    c.src.add(src)
    cands.set(key, c)
    this.stats.pairs++
  }

  /**
   * Close matches that differ only by a / an / the. Returned separately so callers can
   * flag them for review instead of trusting them outright.
   */
  lookupLoose (english, locale) {
    const k = norm(english)
    const lk = looseNorm(english)
    const keys = new Set(this.loose.get(lk) || [])
    if (lk !== k && this.entries.has(lk)) keys.add(lk)
    keys.delete(k)
    const out = []
    for (const key of keys) out.push(...this._cands(key, english, locale))
    return out.sort((a, b) => (b.prio - a.prio) || (b.count - a.count))
  }

  /** Candidates for an English string in a locale, best first. */
  lookup (english, locale) {
    return this._cands(norm(english), english, locale)
  }

  _cands (key, english, locale) {
    const byLoc = this.entries.get(key)
    const cands = byLoc && byLoc.get(locale)
    if (!cands) return []
    const enTrim = english.replace(/\s+/g, ' ').trim()
    return [...cands.entries()].map(([text, c]) => ({
      text,
      count: c.count,
      prio: c.prio,
      en: c.en,
      sameCase: c.en.replace(/\s+/g, ' ').trim() === enTrim,
      sources: [...c.src]
    })).sort((a, b) => (b.prio - a.prio) || (b.count - a.count) || (Number(b.sameCase) - Number(a.sameCase)))
  }
}

/** Pairs an EB-style translations folder (default.ts + <locale>.js) into the TM. */
function addExbFolder (tm, dir, prio, label) {
  const def = path.join(dir, 'default.ts')
  if (!exists(def)) return 0
  let en
  try { en = loadDefaultTs(def) } catch (e) { return 0 }
  let n = 0
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.js')) continue
    const loc = f.slice(0, -3)
    if (!LOCALE_SET.has(toExbLocale(loc))) continue
    let msgs
    try { msgs = loadLocaleJs(path.join(dir, f)) } catch (e) { continue }
    for (const k of Object.keys(en)) if (typeof msgs[k] === 'string') tm.add(en[k], loc, msgs[k], prio, label)
    n++
  }
  tm.stats.files += n
  if (n) tm.stats.sources++
  return n
}

/** Pairs a Maps SDK style t9n folder (Name.json + Name_<locale>.json) into the TM. */
function addT9nFolder (tm, dir, prio, label) {
  let files
  try { files = fs.readdirSync(dir).filter(f => f.endsWith('.json')) } catch (e) { return 0 }
  const groups = {}
  for (const f of files) {
    const m = f.match(/^(.+?)(?:_([a-z]{2}(?:-[A-Za-z]{2,4})?))?\.json$/)
    if (!m) continue
    const g = (groups[m[1]] = groups[m[1]] || {})
    g[m[2] || 'en'] = path.join(dir, f)
  }
  let n = 0
  for (const name of Object.keys(groups)) {
    const g = groups[name]
    if (!g.en) continue
    const en = flatten(readJson(g.en, {}))
    for (const loc of Object.keys(g)) {
      if (loc === 'en') continue
      const msgs = flatten(readJson(g[loc], {}))
      for (const k of Object.keys(en)) if (typeof msgs[k] === 'string') tm.add(en[k], loc, msgs[k], prio, label)
      n++
    }
  }
  tm.stats.files += n
  if (n) tm.stats.sources++
  return n
}

function isEsriWidget (widgetRoot) {
  const m = readJson(path.join(widgetRoot, 'manifest.json'), null)
  return !!(m && typeof m.author === 'string' && /esri/i.test(m.author))
}

/** Locate the EB client folder from a widget folder or any folder inside the install. */
function findClient (start) {
  let dir = path.resolve(start)
  for (let i = 0; i < 8; i++) {
    if (isDir(path.join(dir, 'dist', 'jimu-ui'))) return dir
    if (isDir(path.join(dir, 'client', 'dist', 'jimu-ui'))) return path.join(dir, 'client')
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  return null
}

function harvest (client, opts = {}) {
  const tm = new TM(opts.needed)
  const log = opts.log || (() => {})
  if (!client || !isDir(path.join(client, 'dist'))) {
    throw new Error(`Experience Builder client not found${client ? ` at ${client}` : ''}. Pass --client <path to ...\\client>. It must contain dist\\jimu-ui (run the client once with pnpm start so dist is built).`)
  }
  const dist = path.join(client, 'dist')

  // 1. Framework packages
  for (const pkg of listDirs(dist).filter(d => /^jimu-/.test(path.basename(d)))) {
    addExbFolder(tm, path.join(pkg, 'lib', 'translations'), 3, path.basename(pkg))
  }

  // 2. Esri out-of-the-box widgets (author contains "Esri"); custom widgets are skipped
  const widgetsRoot = path.join(dist, 'widgets')
  const widgetRoots = []
  for (const d of listDirs(widgetsRoot)) {
    if (exists(path.join(d, 'manifest.json'))) widgetRoots.push(d)
    else for (const w of listDirs(d)) if (exists(path.join(w, 'manifest.json'))) widgetRoots.push(w)
  }
  for (const w of widgetRoots) {
    if (!isEsriWidget(w)) continue
    for (const part of ['runtime', 'setting', 'guide']) {
      addExbFolder(tm, path.join(w, 'dist', part, 'translations'), 3, 'widget:' + path.basename(w))
    }
  }

  // 3. Maps SDK, Calcite and map components t9n bundles
  const nm = path.join(client, 'node_modules')
  const sdkRoots = [
    [path.join(nm, '@arcgis', 'core', 'assets'), 'maps-sdk', 8],
    [path.join(nm, '@arcgis', 'map-components', 'dist'), 'map-components', 8],
    [path.join(nm, '@esri', 'calcite-components', 'dist'), 'calcite', 8]
  ]
  for (const [root, label, depth] of sdkRoots) {
    if (!isDir(root)) continue
    for (const t9n of findDirsNamed(root, 't9n', depth)) addT9nFolder(tm, t9n, 2, label)
  }

  // 4. Extra trusted folders
  for (const extra of opts.extra || []) {
    for (const t of findDirsNamed(extra, 'translations', 8)) addExbFolder(tm, t, 1, 'extra')
    for (const t of findDirsNamed(extra, 't9n', 8)) addT9nFolder(tm, t, 1, 'extra')
  }

  log(`Harvested ${tm.stats.files} Esri translation files from ${tm.stats.sources} sources.`)
  return tm
}

module.exports = { harvest, findClient, TM, addExbFolder, addT9nFolder }
