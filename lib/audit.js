'use strict'
/**
 * audit: find English that never reaches a translation file.
 *
 * Uses the TypeScript compiler that ships with the Experience Builder client
 * (client/node_modules/typescript), so the scan understands JSX and template strings.
 *
 * Reports
 *   text      JSX text nodes:                 <span>Delete all</span>
 *   attr      UI attributes:                  title="Undo" aria-label={`Draw ${n}`}
 *   call      user-facing calls:              announceStatus('Saved')
 *   missing   keys used in code but absent from default.ts
 *   unused    keys in default.ts never referenced literally (may be built dynamically)
 */
const { uiExpressions, sinkIndexes } = require('./ui-flow')
const fs = require('fs')
const path = require('path')
const { loadDefaultTs } = require('./loaders')
const { discoverParts } = require('./sync')

const UI_ATTRS = new Set(['title', 'aria-label', 'aria-description', 'aria-valuetext', 'aria-roledescription', 'aria-placeholder',
  'placeholder', 'label', 'alt', 'tooltip', 'helperText', 'emptyText', 'confirmText', 'cancelText', 'okText', 'description', 'heading', 'text'])
const TRANSLATE_FNS = new Set(['nls', 't', 'translate', 'formatMessage', 'translateMessage', 'getI18nMessage', 'i18n', '__t', '__tc', 'helpT'])
const DEFAULT_SINKS = ['announceStatus', 'announce', 'alert', 'confirm', 'setStatus', 'showMessage', 'notify', 'toast', 'setStatusMessage', 'setErrorMessage']
const MESSAGE_OBJECTS = /^(defaultMessages|defMessages|messages|nlsMessages|i18nMessages|__m)$/

function loadTypeScript (client) {
  const tries = []
  if (client) tries.push(path.join(client, 'node_modules', 'typescript'))
  tries.push('typescript')
  for (const t of tries) { try { return require(t) } catch (e) { /* next */ } }
  return null
}

function looksLikeUiText (s) {
  const t = String(s).replace(/\s+/g, ' ').trim()
  if (!/\p{L}{2,}/u.test(t)) return false
  if (/^(https?:|mailto:|data:|#|\.\/|\/)/i.test(t)) return false
  if (/\{\{|\}\}|^\s*</.test(t)) return false // template tokens like {{length}}, markup samples
  if (!/\s/.test(t)) {
    // single token: skip ids, css classes, keys, enums ("esri-icon", "fooBar", "FEET", "px")
    if (/[-_./:#]/.test(t) || /^[a-z]/.test(t) || /^[A-Z0-9_]+$/.test(t)) return false
  }
  if (/^[\w-]+(\s[\w-]+)*$/.test(t) && /^(?:[a-z0-9]+-)+[a-z0-9]+(\s(?:[a-z0-9]+-)*[a-z0-9]+)*$/.test(t)) return false // "btn btn-primary"
  return true
}

function walkFiles (dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'vendor' || e.name === 'translations' || e.name.startsWith('.')) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walkFiles(p, out)
    else if (/\.(tsx?|jsx?)$/.test(e.name) && !/\.d\.ts$/.test(e.name) && !/\.test\./.test(e.name)) out.push(p)
  }
  return out
}

function calleeName (ts, expr) {
  if (ts.isIdentifier(expr)) return expr.text
  if (ts.isPropertyAccessExpression(expr)) return expr.name.text
  return ''
}

function auditWidget (widgetDir, opts = {}) {
  const ts = loadTypeScript(opts.client)
  if (!ts) throw new Error('TypeScript not found. Pass --client <EB client folder> (it ships typescript) or run npm i -D typescript.')
  const sinks = new Set([...(DEFAULT_SINKS), ...(opts.sinks || [])])
  const parts = discoverParts(widgetDir)
  const keys = new Map() // key -> part
  for (const p of parts) for (const k of Object.keys(loadDefaultTs(path.join(p.dir, 'default.ts')))) keys.set(k, p.part)

  const findings = []
  const used = new Set()
  const files = walkFiles(path.join(widgetDir, 'src'))

  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8')
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
    const rel = path.relative(widgetDir, file).replace(/\\/g, '/')
    const line = n => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1
    const add = (kind, node, value, extra) => findings.push(Object.assign({ kind, file: rel, line: line(node), text: String(value).replace(/\s+/g, ' ').trim().slice(0, 160) }, extra))

    // Literal English inside an attribute expression, not inside a translation call.
    const literalsIn = (node, acc = []) => {
      if (ts.isCallExpression(node) && TRANSLATE_FNS.has(calleeName(ts, node.expression))) return acc
      if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node) || ts.isJsxAttribute(node)) return acc
      if (ts.isBinaryExpression(node) && (node.operatorToken.kind === ts.SyntaxKind.BarBarToken || node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) && literalsIn(node.left).length === 0 && /\b(nls|t|translate|formatMessage)\s*\(/.test(node.left.getText(sf))) return acc
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) { if (looksLikeUiText(node.text)) acc.push(node.text) } else if (ts.isTemplateExpression(node)) {
        const raw = [node.head.text, ...node.templateSpans.map(s => s.literal.text)].join('${}')
        if (looksLikeUiText(raw.replace(/\$\{\}/g, ' '))) acc.push(raw)
        node.templateSpans.forEach(s => literalsIn(s.expression, acc))
        return acc
      } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken) {
        return acc // comparisons: x === 'radius'
      } else ts.forEachChild(node, c => literalsIn(c, acc))
      return acc
    }

    const ignored = node => {
      for (let p = node; p; p = p.parent) {
        if (ts.isNewExpression(p) || ts.isTaggedTemplateExpression(p)) return true
        if (ts.isJsxElement(p) && /^(style|script|code|pre|kbd)$/.test(p.openingElement.tagName.getText(sf))) return true
        if (ts.isCallExpression(p) && /^console\./.test(p.expression.getText(sf))) return true
      }
      return false
    }
    const visit = (node) => {
      if (ignored(node)) return
      // keys referenced
      if (ts.isCallExpression(node)) {
        const name = calleeName(ts, node.expression)
        const a0 = node.arguments[0]
        if (name === '__t' || name === '__tc') {
          let deferred = false
          for (let p = node.parent; p; p = p.parent) if (ts.isFunctionLike(p)) deferred = true
          if (!deferred) add('timing', node, node.getText(sf), { fn: name })
        }
        if (TRANSLATE_FNS.has(name) && a0) {
          if (name === '__tc' && node.arguments[1] && ts.isStringLiteral(node.arguments[1])) used.add(node.arguments[1].text)
          else if (ts.isStringLiteral(a0)) used.add(a0.text)
          else if (ts.isObjectLiteralExpression(a0)) {
            for (const pr of a0.properties) if (ts.isPropertyAssignment(pr) && pr.name.getText(sf) === 'id' && ts.isStringLiteral(pr.initializer)) used.add(pr.initializer.text)
          }
        } else for (const i of sinkIndexes(ts, node, opts)) {
          if (node.arguments[i]) for (const s of literalsIn(node.arguments[i])) add('call', node.arguments[i], s, { fn: name })
        }
      }
      if (ts.isPropertyAccessExpression(node) && MESSAGE_OBJECTS.test(node.expression.getText(sf).replace(/^.*\./, ''))) used.add(node.name.text)
      if (ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression) && MESSAGE_OBJECTS.test(node.expression.getText(sf).replace(/^\(|\s+as\s+any\)$/g, '').replace(/^.*\./, ''))) used.add(node.argumentExpression.text)

      // hardcoded UI text
      if (ts.isJsxText(node)) {
        const t = node.text.replace(/\s+/g, ' ').trim()
        if (t && /\p{L}{2,}/u.test(t) && !/^[&{}]/.test(t)) add('text', node, t)
      }
      if (ts.isJsxExpression(node) && node.expression && node.parent && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))) {
        for (const s of literalsIn(node.expression)) add('text', node, s)
      }
      if (ts.isJsxAttribute(node)) {
        const name = node.name.getText(sf)
        if (UI_ATTRS.has(name) && node.initializer) {
          if (ts.isStringLiteral(node.initializer)) { if (looksLikeUiText(node.initializer.text)) add('attr', node, node.initializer.text, { attr: name }) } else if (ts.isJsxExpression(node.initializer) && node.initializer.expression) {
            for (const s of literalsIn(node.initializer.expression)) add('attr', node, s, { attr: name })
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
    for (const e of uiExpressions(ts, sf, opts)) {
      let translated = false
      for (let p = e.parent; p; p = p.parent) if (ts.isCallExpression(p) && TRANSLATE_FNS.has(calleeName(ts, p.expression))) translated = true
      if (!translated && !ignored(e)) for (const value of literalsIn(e)) {
        if (!findings.some(f => f.file === rel && f.line === line(e) && f.text === String(value).replace(/\s+/g, ' ').trim().slice(0, 160))) add('flow', e, value)
      }
    }
  }

  // Strings in comments or nls fallbacks like nls('x') || 'X' are legitimate; drop fallbacks.
  const missing = [...used].filter(k => !keys.has(k) && /^[A-Za-z_][\w]*$/.test(k)).sort()
  const unused = [...keys.keys()].filter(k => !used.has(k) && !k.startsWith('_')).sort()
  return { widget: path.basename(widgetDir), files: files.length, findings, missing, unused, keyCount: keys.size }
}

function formatAudit (r) {
  const lines = [`Audit: ${r.widget} (${r.files} source files, ${r.keyCount} keys)`]
  const byKind = k => r.findings.filter(f => f.kind === k)
  for (const [kind, title] of [['attr', 'Hardcoded UI attributes'], ['text', 'Hardcoded JSX text'], ['call', 'Hardcoded messages passed to UI calls'], ['flow', 'Hardcoded text flowing through local UI bindings'], ['timing', 'Translations evaluated before render (may freeze English)']]) {
    const list = byKind(kind)
    if (!list.length) continue
    lines.push('', `${title} (${list.length}):`)
    for (const f of list) lines.push(`  ${f.file}:${f.line}  ${f.attr ? f.attr + '=' : f.fn ? f.fn + '(' : ''}"${f.text}"`)
  }
  if (r.missing.length) lines.push('', `Keys used in code but missing from default.ts (${r.missing.length}):`, '  ' + r.missing.join(', '))
  if (r.unused.length) lines.push('', `Keys never referenced literally (${r.unused.length}; fine if built dynamically, e.g. nls(unit)):`, '  ' + r.unused.slice(0, 60).join(', ') + (r.unused.length > 60 ? ` ... +${r.unused.length - 60} more` : ''))
  if (!r.findings.length && !r.missing.length) lines.push('', 'No hardcoded text found in the supported static UI patterns. Runtime checks and translation review are still needed.')
  return lines.join('\n')
}

module.exports = { auditWidget, formatAudit, looksLikeUiText, loadTypeScript }
