'use strict'
/**
 * The locales Experience Builder itself ships (client/webpack/webpack-extensions.common.js,
 * EB 1.21). 'en' is the default and lives in default.ts, so it is never generated.
 */
const EXB_LOCALES = [
  'ar', 'bg', 'bs', 'ca', 'cs', 'da', 'de', 'el', 'es', 'et', 'fi', 'fr', 'he', 'hr', 'hu',
  'id', 'it', 'ja', 'ko', 'lt', 'lv', 'no', 'nl', 'pl', 'pt-br', 'pt-pt', 'ro', 'ru', 'sk',
  'sl', 'sr', 'sv', 'th', 'tr', 'zh-cn', 'uk', 'vi', 'zh-hk', 'zh-tw'
]

/** Scripts without upper/lower case: never apply first-letter capitalization. */
const UNCASED = new Set(['ar', 'he', 'ja', 'ko', 'th', 'zh-cn', 'zh-hk', 'zh-tw'])

/**
 * Normalize a locale tag from any Esri source to the EB folder spelling.
 * Maps SDK t9n uses pt-BR / zh-CN and sometimes nb; EB uses pt-br / zh-cn / no.
 */
function toExbLocale (tag) {
  if (!tag) return null
  let t = String(tag).trim().toLowerCase().replace('_', '-')
  if (t === 'nb' || t === 'nn') t = 'no'
  if (t === 'pt') t = 'pt-br'
  if (t === 'zh') t = 'zh-cn'
  return t
}

function parseLocaleList (value) {
  if (!value || value === 'all') return EXB_LOCALES.slice()
  const list = String(value).split(',').map(s => toExbLocale(s)).filter(Boolean)
  const bad = list.filter(l => !EXB_LOCALES.includes(l))
  if (bad.length) throw new Error(`Unknown locale(s): ${bad.join(', ')}. Valid: ${EXB_LOCALES.join(', ')}`)
  return list
}

module.exports = { EXB_LOCALES, UNCASED, toExbLocale, parseLocaleList }
