'use strict'
/**
 * import: apply a reviewed CSV to the lock file. Rows count when
 *   - "translation" has text (used as is), or
 *   - "approve" is x / yes / y / 1 / true and "suggestion" has text (first suggestion is used).
 * The row's English must still match default.ts; otherwise it is skipped as stale.
 * Run sync afterwards (the CLI does this for you) to rewrite the locale files.
 */
const fs = require('fs')
const path = require('path')
const { parseCsv } = require('./csv')
const { readText, loadDefaultTs, writeJson } = require('./loaders')
const { readLock, lockPath, discoverParts, hash } = require('./sync')
const { argNames } = require('./match')
const { toExbLocale } = require('./locales')

const YES = new Set(['x', 'yes', 'y', '1', 'true', 'ok'])

function importCsv (widgetDir, csvFile, localeArg) {
  const locale = toExbLocale(localeArg || path.basename(csvFile).replace(/\.csv$/i, ''))
  const rows = parseCsv(readText(csvFile))
  const lock = readLock(widgetDir)
  const en = {}
  for (const p of discoverParts(widgetDir)) en[p.part] = loadDefaultTs(path.join(p.dir, 'default.ts'))
  const result = { locale, applied: 0, skipped: [] }

  for (const r of rows) {
    const part = (r.part || 'runtime').trim()
    const key = (r.key || '').trim()
    if (!key) continue
    let text = (r.translation || '').trim()
    if (!text && YES.has(String(r.approve || '').trim().toLowerCase())) text = String(r.suggestion || '').split(' | ')[0].trim()
    if (!text) continue
    const current = en[part] && en[part][key]
    if (typeof current !== 'string') { result.skipped.push(`${part}.${key}: key no longer exists`); continue }
    if (r.english != null && r.english !== '' && r.english !== current) { result.skipped.push(`${part}.${key}: English changed since export, re-run sync and review again`); continue }
    if (argNames(text).sort().join('|') !== argNames(current).sort().join('|')) {
      result.skipped.push(`${part}.${key}: placeholders must match the English {${argNames(current).join('}, {')}}`)
      continue
    }
    const lp = lock.parts[part] = lock.parts[part] || { locales: {} }
    lp.locales = lp.locales || {}
    const ll = lp.locales[locale] = lp.locales[locale] || {}
    ll.entries = ll.entries || {}
    ll.entries[key] = { t: text, src: 'manual', h: hash(current), fresh: true }
    result.applied++
  }
  if (result.applied) {
    fs.mkdirSync(path.dirname(lockPath(widgetDir)), { recursive: true })
    writeJson(lockPath(widgetDir), lock)
  }
  return result
}

module.exports = { importCsv }
