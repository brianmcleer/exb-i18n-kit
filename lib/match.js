'use strict'
/**
 * Normalizing and matching English strings against Esri's translation memory.
 *
 * A custom widget string matches an Esri string when they are the same text ignoring
 * letter case, extra spaces, trailing ":" / "..." / "…" / ".", and placeholder names
 * ({count} matches {n}). The Esri translation is then adapted back to the widget's
 * string: placeholders renamed, trailing punctuation and first-letter case carried over.
 */
const { UNCASED } = require('./locales')

// {name} and ${name} simple arguments. ICU plural/select blocks are handled separately.
const SIMPLE_ARG = /\$?\{\s*([A-Za-z_][\w.]*)\s*\}/g
const COMPLEX_ARG = /\{\s*[A-Za-z_][\w.]*\s*,\s*(plural|select|selectordinal|number|date|time)\b/

function isComplexIcu (s) { return COMPLEX_ARG.test(s) }

function argNames (s) {
  const out = []
  String(s).replace(SIMPLE_ARG, (m, name) => { out.push(name); return m })
  return out
}

// Scan backward in linear time instead of repeatedly matching nested regex suffixes.
function splitSuffix (value) {
  const s = String(value)
  let i = s.length
  while (i > 0 && /\s/u.test(s[i - 1])) i--
  const end = i
  let found = false
  while (i > 0) {
    if ('…:：.。'.includes(s[i - 1])) {
      found = true
      i--
      while (i > 0 && /\s/u.test(s[i - 1])) i--
    } else break
  }
  return found ? { core: s.slice(0, i), suffix: s.slice(i, end).trim() } : { core: s, suffix: '' }
}

/** Matching key: lower case, single spaces, no trailing punctuation, placeholders anonymized. */
function norm (s) {
  if (typeof s !== 'string') return ''
  let t = s.replace(/\s+/g, ' ').trim()
  t = splitSuffix(t).core
  t = t.replace(SIMPLE_ARG, '{}')
  return t.toLowerCase()
}

/** Looser key: also ignores the articles a / an / the ("Draw point" ~ "Draw a point"). */
function looseNorm (s) {
  const k = typeof s === 'string' ? norm(s) : ''
  return k.replace(/\b(a|an|the)\b/g, ' ').replace(/\s+/g, ' ').trim()
}

function suffixClass (suf) {
  if (!suf) return ''
  if (/[:：]/.test(suf)) return 'colon'
  if (/\.\.\.|…/.test(suf)) return 'ellipsis'
  if (/[.。]/.test(suf)) return 'period'
  return 'other'
}

/**
 * Adapt an Esri translation to the widget's English source string.
 * Returns null when the candidate is unsafe (placeholder mismatch, shouting, untranslated).
 */
function adapt (english, candidate, sourceEnglish, locale) {
  if (typeof candidate !== 'string' || !candidate.trim()) return null
  let t = candidate.replace(/\s+/g, ' ').trim()
  const en = english.replace(/\s+/g, ' ').trim()

  // Shouting: "and" -> "AND" is a SQL operator label, not the word "and".
  const letters = t.replace(/[^\p{L}]/gu, '')
  const enLetters = en.replace(/[^\p{L}]/gu, '')
  if (letters.length > 1 && letters === letters.toUpperCase() && letters !== letters.toLowerCase() &&
      enLetters !== enLetters.toUpperCase()) return null

  // Untranslated leftovers in the source locale file.
  if (t.toLowerCase() === en.toLowerCase() && en.split(' ').length >= 3) return null

  // Placeholders: same count, renamed positionally to the widget's names.
  const enArgs = argNames(en)
  const srcArgs = argNames(sourceEnglish || '')
  const candArgs = argNames(t)
  if (enArgs.length !== candArgs.length) return null
  if (enArgs.length) {
    // Map by the Esri English order when available, otherwise by appearance in the candidate.
    const order = srcArgs.length === candArgs.length ? srcArgs : candArgs
    const rename = {}
    order.forEach((name, i) => { rename[name] = enArgs[i] })
    t = t.replace(SIMPLE_ARG, (m, name) => (rename[name] ? `{${rename[name]}}` : m))
    const after = argNames(t).slice().sort().join('|')
    if (after !== enArgs.slice().sort().join('|')) return null
  }

  // Trailing punctuation follows the widget string.
  const enSuf = splitSuffix(en).suffix
  const tSplit = splitSuffix(t)
  if (suffixClass(enSuf) !== suffixClass(tSplit.suffix)) {
    t = tSplit.core + (enSuf ? (locale === 'fr' && suffixClass(enSuf) === 'colon' ? ' :' : enSuf) : '')
  }

  // First-letter case follows the widget string (Esri unit names are often lower case).
  if (!UNCASED.has(locale)) {
    const e0 = en.charAt(0)
    const t0 = t.charAt(0)
    if (e0 && e0 === e0.toUpperCase() && e0 !== e0.toLowerCase() && t0 === t0.toLowerCase() && t0 !== t0.toUpperCase()) {
      let up
      try { up = t0.toLocaleUpperCase(locale) } catch (e) { up = t0.toUpperCase() }
      t = up + t.slice(1)
    }
  }
  return t
}

module.exports = { norm, looseNorm, adapt, argNames, isComplexIcu, splitSuffix }
