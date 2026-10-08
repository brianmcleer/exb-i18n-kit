'use strict'
/**
 * Unicode CLDR unit names (https://cldr.unicode.org), the locale data behind every major
 * OS and browser. Fills unit labels Esri does not ship in a given wording:
 * "Square Yards", "Nautical Miles", "Hectares", "Acres" and the rest, in all 38 locales.
 *
 * Source: the official cldr-units-full package (Unicode License v3) on the npm registry.
 * Downloaded once, reduced to the 39 locales Experience Builder uses, and cached as one
 * small JSON file. No runtime code is added to widgets.
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const zlib = require('zlib')
const { EXB_LOCALES } = require('./locales')

const CLDR_ID = {
  no: 'nb', 'pt-br': 'pt', 'pt-pt': 'pt-PT', sr: 'sr-Latn', 'zh-cn': 'zh', 'zh-tw': 'zh-Hant', 'zh-hk': 'zh-Hant-HK'
}
const cldrId = loc => CLDR_ID[loc] || loc

function defaultCacheDir () {
  return process.env.EXB_I18N_CACHE || path.join(os.homedir(), '.exb-i18n')
}

/** Minimal tar reader: yields { name, data } for regular files. */
function * tarEntries (buf) {
  let off = 0
  let longName = null
  while (off + 512 <= buf.length) {
    const header = buf.subarray(off, off + 512)
    if (header.every(b => b === 0)) break
    const str = (a, b) => header.subarray(a, b).toString('utf8').replace(/\0.*$/s, '')
    let name = str(0, 100)
    const prefix = str(345, 500)
    if (prefix) name = prefix + '/' + name
    const size = parseInt(str(124, 136).trim() || '0', 8)
    const type = String.fromCharCode(header[156] || 48)
    const dataStart = off + 512
    const data = buf.subarray(dataStart, dataStart + size)
    off = dataStart + Math.ceil(size / 512) * 512
    if (type === 'L') { longName = data.toString('utf8').replace(/\0.*$/s, ''); continue }
    if (longName) { name = longName; longName = null }
    if (type === '0' || type === '\0') yield { name, data }
  }
}

function reduceUnits (json) {
  const loc = Object.keys(json.main || {})[0]
  const long = json.main[loc].units && json.main[loc].units.long
  const out = {}
  for (const k of Object.keys(long || {})) {
    const u = long[k]
    if (!u || typeof u !== 'object') continue
    const names = []
    if (typeof u.displayName === 'string') names.push(u.displayName)
    const other = u['unitPattern-count-other']
    if (typeof other === 'string') names.push(other.replace(/\{0\}/, '').replace(/\s+/g, ' ').trim())
    if (names.length) out[k] = names
  }
  return out
}

/** Build the reduced cache from a cldr-units-full .tgz buffer. */
function buildCacheFromTarball (tgz, version) {
  const tar = zlib.gunzipSync(tgz)
  const want = new Map([['en', 'en'], ...EXB_LOCALES.map(l => [cldrId(l), l])])
  const cache = { source: 'cldr-units-full', version, license: 'Unicode-3.0', en: {}, locales: {} }
  for (const { name, data } of tarEntries(tar)) {
    const m = name.match(/^package\/main\/([^/]+)\/units\.json$/)
    if (!m || !want.has(m[1])) continue
    const units = reduceUnits(JSON.parse(data.toString('utf8')))
    const exb = want.get(m[1])
    if (exb === 'en') cache.en = units
    else cache.locales[exb] = units
  }
  return cache
}

async function downloadTarball (log) {
  const metaResponse = await fetch('https://registry.npmjs.org/cldr-units-full/latest', { redirect: 'error' })
  if (!metaResponse.ok) throw new Error('Could not retrieve CLDR package metadata')
  const meta = await metaResponse.json()
  log(`Downloading Unicode CLDR unit names ${meta.version} (one time)...`)
  const tarballUrl = new URL(meta.dist.tarball)
  if (tarballUrl.protocol !== 'https:' || tarballUrl.hostname !== 'registry.npmjs.org' || tarballUrl.username || tarballUrl.password)
    throw new Error('Untrusted CLDR tarball URL')
  const res = await fetch(tarballUrl.href, { redirect: 'error' })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${meta.dist.tarball}`)
  return { buf: Buffer.from(await res.arrayBuffer()), version: meta.version }
}

/**
 * Load the CLDR cache, building it on first use. opts.tarball: a local cldr-units-full .tgz
 * (from `npm pack cldr-units-full`) for machines without direct internet access.
 */
async function loadCldr (opts = {}) {
  const log = opts.log || (() => {})
  const dir = opts.cacheDir || defaultCacheDir()
  const file = path.join(dir, 'cldr-units.json')
  if (!opts.refresh && fs.existsSync(file)) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch (e) { /* rebuild */ }
  }
  let buf, version
  if (opts.tarball) {
    buf = fs.readFileSync(opts.tarball)
    version = (path.basename(opts.tarball).match(/(\d+\.\d+\.\d+)/) || [null, 'local'])[1]
  } else {
    ({ buf, version } = await downloadTarball(log))
  }
  const cache = buildCacheFromTarball(buf, version)
  fs.mkdirSync(dir, { recursive: true })
  const temp = file + '.' + process.pid + '.' + require('crypto').randomBytes(8).toString('hex') + '.tmp'
  try { fs.writeFileSync(temp, JSON.stringify(cache), { encoding: 'utf8', flag: 'wx' }); fs.renameSync(temp, file) }
  finally { try { fs.unlinkSync(temp) } catch (e) { if (e.code !== 'ENOENT') throw e } }
  log(`CLDR unit names cached: ${file}`)
  return cache
}

/** Feed CLDR unit names into a translation memory. */
function addCldrToTm (tm, cache) {
  let n = 0
  for (const [loc, units] of Object.entries(cache.locales || {})) {
    for (const [k, enNames] of Object.entries(cache.en || {})) {
      const tr = units[k]
      if (!tr) continue
      enNames.forEach((en, i) => { const t = tr[i] || tr[0]; if (t) { tm.add(en, loc, t, 2, 'cldr'); n++ } })
    }
  }
  if (n) { tm.stats.sources++; tm.stats.files += Object.keys(cache.locales || {}).length }
  return n
}

module.exports = { loadCldr, addCldrToTm, buildCacheFromTarball, tarEntries, cldrId }
