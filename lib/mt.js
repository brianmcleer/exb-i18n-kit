'use strict'
/**
 * Optional machine translation for strings Esri does not ship.
 *
 * Built in: LibreTranslate (open source, AGPL-3.0, runs on your own server so widget text
 * never leaves your network). Anything else plugs in as a small module:
 *
 *   // my-provider.js
 *   module.exports = {
 *     name: 'my-provider',
 *     async translate (texts, targetLocale) { return texts.map(t => ...) } // same length
 *   }
 *
 * Machine output is never treated as final: it is marked "machine", listed in the review
 * CSV until a person approves it, and only shipped when shipMachine is on.
 */
const path = require('path')
const { isComplexIcu, argNames } = require('./match')

// EB locale -> LibreTranslate codes to try, in order.
const LT_CODES = {
  'zh-cn': ['zh-Hans', 'zh', 'zh-CN'],
  'zh-tw': ['zh-Hant', 'zt', 'zh-TW'],
  'zh-hk': ['zh-Hant', 'zt', 'zh-TW'],
  'pt-br': ['pt-BR', 'pt'],
  'pt-pt': ['pt'],
  no: ['nb', 'no'],
  he: ['he', 'iw']
}

const TOKEN_ARG = /\$?\{\s*([A-Za-z_][\w.]*)\s*\}/g

function protect (text) {
  const args = []
  const html = String(text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(TOKEN_ARG, (m) => { args.push(m.startsWith('$') ? m.slice(1) : m); return `<x id="${args.length - 1}"></x>` })
  return { html, args }
}

function unprotect (html, args) {
  let ok = true
  let out = String(html).replace(/<x\s+id="?(\d+)"?\s*(?:\/>|><\/x>|>)/g, (m, i) => {
    const a = args[Number(i)]
    if (a == null) { ok = false; return '' }
    return a
  })
  out = out.replace(/<\/x>/g, '')
  if (/<\/?x\b/.test(out)) ok = false
  out = out.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
  return ok ? out.replace(/\s+/g, ' ').trim() : null
}

function libreTranslate (cfg) {
  const endpoint = new URL(cfg.url || 'http://localhost:5000')
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.hash || endpoint.search)
    throw new Error('Invalid LibreTranslate endpoint')
  const host = endpoint.hostname.toLowerCase()
  const loopback = host === 'localhost' || host === '127.0.0.1' || host === '[::1]'
  if (endpoint.protocol !== 'https:' && !loopback)
    throw new Error('Non-local LibreTranslate requires HTTPS')
  const base = endpoint.href.replace(/\/+$/, '')
  // API keys are sent only to a trusted HTTPS or local translation endpoint.
  const apiKey = cfg.apiKey || (cfg.apiKeyEnv ? process.env[cfg.apiKeyEnv] : process.env.LT_API_KEY) || undefined
  let langs = null

  async function post (route, body) {
    const res = await fetch(base + route, {
      redirect: 'error',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({}, body, apiKey ? { api_key: apiKey } : {}))
    })
    const text = await res.text()
    let json
    try { json = JSON.parse(text) } catch (e) { throw new Error(`LibreTranslate ${route}: HTTP ${res.status} ${text.slice(0, 200)}`) }
    if (!res.ok || json.error) throw new Error(`LibreTranslate ${route}: ${json.error || 'HTTP ' + res.status}`)
    return json
  }

  async function languages () {
    if (langs) return langs
    const res = await fetch(base + '/languages', { redirect: 'error' })
    if (!res.ok) throw new Error(`LibreTranslate /languages: HTTP ${res.status}`)
    const list = await res.json()
    const en = list.find(l => l.code === 'en')
    const targets = new Set(en && Array.isArray(en.targets) ? en.targets : list.map(l => l.code))
    langs = targets
    return langs
  }

  async function codeFor (locale) {
    const targets = await languages()
    for (const c of LT_CODES[locale] || [locale]) if (targets.has(c)) return c
    return null
  }

  return {
    name: 'libretranslate',
    async supports (locale) { return !!(await codeFor(locale)) },
    async translate (texts, locale) {
      const target = await codeFor(locale)
      if (!target) return texts.map(() => null)
      const prepared = texts.map(protect)
      const out = new Array(texts.length).fill(null)
      const batch = Number(cfg.batchSize || 25)
      for (let i = 0; i < prepared.length; i += batch) {
        const slice = prepared.slice(i, i + batch)
        let res
        try {
          res = await post('/translate', { q: slice.map(p => p.html), source: 'en', target, format: 'html' })
        } catch (e) {
          // Older servers may not accept arrays; fall back to one call per string.
          res = { translatedText: [] }
          for (const p of slice) {
            try { res.translatedText.push((await post('/translate', { q: p.html, source: 'en', target, format: 'html' })).translatedText) } catch (e2) { res.translatedText.push(null) }
          }
        }
        const arr = Array.isArray(res.translatedText) ? res.translatedText : [res.translatedText]
        slice.forEach((p, j) => { out[i + j] = arr[j] == null ? null : unprotect(arr[j], p.args) })
      }
      return out
    }
  }
}

function loadProvider (cfg, cwd) {
  if (!cfg) return null
  const spec = typeof cfg === 'string' ? { type: cfg } : cfg
  if (!spec.type || spec.type === 'none') return null
  if (spec.type === 'libretranslate') return libreTranslate(spec)
  const mod = require(path.resolve(cwd || process.cwd(), spec.type))
  return typeof mod === 'function' ? mod(spec) : mod
}

/**
 * Translate a list of English strings for one locale. Strings that machine translation
 * cannot handle safely (ICU plural/select) come back null and stay in review as missing.
 */
async function machineTranslate (provider, englishList, locale) {
  const idx = []
  const texts = []
  englishList.forEach((en, i) => {
    if (!isComplexIcu(en) && /\p{L}/u.test(en)) { idx.push(i); texts.push(en) }
  })
  const result = englishList.map(() => null)
  if (!texts.length) return result
  if (provider.supports && !(await provider.supports(locale))) return result
  const out = await provider.translate(texts, locale)
  idx.forEach((i, j) => {
    const t = out[j]
    if (typeof t !== 'string' || !t.trim()) return
    const want = argNames(englishList[i]).sort().join('|')
    if (argNames(t).sort().join('|') !== want) return // placeholder damaged, reject
    result[i] = t.trim()
  })
  return result
}

module.exports = { loadProvider, machineTranslate, libreTranslate, protect, unprotect }
