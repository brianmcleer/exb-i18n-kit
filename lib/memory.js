'use strict'
/**
 * Shared translation memory, hosted in a GitHub repo and kept current by a GitHub Action.
 *
 *   memory/<locale>.json  {
 *     "Delete all drawings": { "t": "Eliminar todos los dibujos", "src": "libretranslate", "reviewed": false },
 *     ...
 *   }
 *
 * The Action (docs/memory-workflow.yml) starts a LibreTranslate container, reads the English
 * of every widget listed in memory/sources.json, translates only strings not in memory yet,
 * and commits the result. Anyone can correct an entry by pull request and set
 * "reviewed": true; the Action never overwrites an existing entry.
 *
 * sync reads the memory after Esri: reviewed entries ship as "community", the rest as
 * "machine" (listed for review, shipped unless shipMachine is off).
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { EXB_LOCALES } = require('./locales')
const { parseDefaultTs, readJson } = require('./loaders')
const { machineTranslate } = require('./mt')
const { isComplexIcu } = require('./match')
const { EXB_LOCALES: SAFE_LOCALES } = require('./locales')

// Dictionaries live on the translation-memory branch (main is protected; the Action pushes there).
const DEFAULT_MEMORY = 'https://raw.githubusercontent.com/brianmcleer/exb-i18n-kit/translation-memory/memory'

function cacheDir () { return path.join(process.env.EXB_I18N_CACHE || path.join(os.homedir(), '.exb-i18n'), 'memory') }

async function fetchText (url, timeoutMs = 15000) {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') throw new Error('Remote translation memory requires HTTPS')
    // Reject URL credentials and fragments before making remote requests.
    if (parsed.username || parsed.password || parsed.hash) throw new Error('Invalid translation memory URL')
    const res = await fetch(parsed.href, { signal: ac.signal, redirect: 'error' })
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`)
    return await res.text()
  } finally { clearTimeout(timer) }
}

/** Load memory for the given locales from a URL base or a local folder; cached for offline runs. */
async function loadMemory (source, locales, log = () => {}) {
  const src = source || DEFAULT_MEMORY
  const remote = /^https?:\/\//i.test(src)
  const dir = cacheDir()
  const data = {}
  let fromCache = 0
  const allowedLocales = new Set(['en', ...SAFE_LOCALES])
  await Promise.all(locales.map(async loc => {
    if (!allowedLocales.has(loc)) throw new Error(`Unsupported memory locale: ${loc}`)
    let text = null
    if (remote) {
      try {
        text = await fetchText(`${src.replace(/\/+$/, '')}/${loc}.json`)
        if (text != null) {
          if (Buffer.byteLength(text, 'utf8') > 5 * 1024 * 1024) throw new Error('Translation memory exceeds size limit')
          const parsed = JSON.parse(text)
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid translation memory')
          const clean = Object.create(null)
          for (const [english, entry] of Object.entries(parsed)) {
            if (english.length > 2000 || !entry || typeof entry !== 'object' || typeof entry.t !== 'string' || entry.t.length > 5000) continue
            clean[english] = { t: entry.t, reviewed: entry.reviewed === true }
          }
          text = JSON.stringify(clean)
          fs.mkdirSync(dir, { recursive: true })
          const file = path.join(dir, `${loc}.json`)
          const tmp = file + '.' + process.pid + '.' + require('crypto').randomBytes(8).toString('hex') + '.tmp'
          try { fs.writeFileSync(tmp, text, { encoding: 'utf8', flag: 'wx' }); fs.renameSync(tmp, file) }
          finally { try { fs.unlinkSync(tmp) } catch (e) { if (e.code !== 'ENOENT') throw e } }
        }
      } catch (e) {
        const f = path.join(dir, `${loc}.json`)
        if (fs.existsSync(f)) { text = fs.readFileSync(f, 'utf8'); fromCache++ }
      }
    } else {
      const f = path.resolve(src, `${loc}.json`)
      if (fs.existsSync(f)) text = fs.readFileSync(f, 'utf8')
    }
    if (text) { try { data[loc] = JSON.parse(text) } catch (e) { log(`! memory ${loc}.json is not valid JSON`) } }
  }))
  const count = Object.values(data).reduce((n, m) => n + Object.keys(m).length, 0)
  if (count) log(`Translation memory: ${count} entries for ${Object.keys(data).length} locales${fromCache ? ` (${fromCache} from cache, offline)` : ''}.`)
  return {
    count,
    lookup (english, loc) {
      const m = data[loc] && data[loc][english]
      if (!m || typeof m.t !== 'string' || !m.t.trim()) return null
      return { t: m.t, reviewed: m.reviewed === true }
    }
  }
}

/** Collect English strings from sources.json: { "widgets": [ { "name": "...", "files": ["https://.../default.ts" or "path"] } ] } */
async function collectEnglish (sourcesFile, log = () => {}) {
  const cfg = readJson(sourcesFile, null)
  if (!cfg || !Array.isArray(cfg.widgets)) throw new Error(`${sourcesFile} must look like { "widgets": [ { "name": "x", "files": ["https://.../translations/default.ts"] } ] }`)
  const strings = new Set()
  for (const w of cfg.widgets) {
    for (const f of w.files || []) {
      let text
      try {
        text = /^https?:\/\//i.test(f) ? await fetchText(f, 30000) : fs.readFileSync(path.resolve(path.dirname(sourcesFile), f), 'utf8')
      } catch (e) { log(`! ${w.name}: ${f}: ${e.message}`); continue }
      if (!text) { log(`! ${w.name}: ${f}: not found`); continue }
      let en
      try { en = parseDefaultTs(text, f) } catch (e) { log(`! ${w.name}: ${e.message}`); continue }
      let n = 0
      for (const v of Object.values(en)) if (typeof v === 'string' && /\p{L}/u.test(v) && !isComplexIcu(v)) { strings.add(v); n++ }
      log(`${w.name}: ${n} strings from ${f.split('/').slice(-3).join('/')}`)
    }
  }
  return [...strings]
}

/** Translate strings missing from memory/<locale>.json; never touches existing entries. */
async function buildMemory ({ sourcesFile, outDir, provider, locales, log = () => {}, max = Infinity }) {
  const english = await collectEnglish(sourcesFile, log)
  fs.mkdirSync(outDir, { recursive: true })
  const today = new Date().toISOString().slice(0, 10)
  let added = 0
  for (const loc of locales || EXB_LOCALES) {
    const file = path.join(outDir, `${loc}.json`)
    const mem = readJson(file, {})
    const todo = english.filter(e => !mem[e]).slice(0, max)
    if (!todo.length) continue
    if (provider.supports && !(await provider.supports(loc))) { log(`${loc}: not supported by ${provider.name}, skipped`); continue }
    const out = await machineTranslate(provider, todo, loc)
    let n = 0
    todo.forEach((e, i) => { if (out[i]) { mem[e] = { t: out[i], src: provider.name || 'machine', reviewed: false, added: today }; n++ } })
    const sorted = {}
    for (const k of Object.keys(mem).sort((a, b) => a.localeCompare(b))) sorted[k] = mem[k]
    fs.writeFileSync(file, JSON.stringify(sorted, null, 1) + '\n', 'utf8')
    added += n
    log(`${loc}: +${n} (${Object.keys(sorted).length} total)`)
  }
  log(`Memory updated: ${added} new translations.`)
  return added
}

module.exports = { loadMemory, buildMemory, collectEnglish, DEFAULT_MEMORY }
