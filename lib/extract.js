'use strict'
/**
 * extract: move hardcoded English out of widget source into translations/default.ts.
 *
 *   <span>Delete all</span>                    ->  <span>{this.nls('deleteAll')}</span>
 *   title="Undo"                               ->  title={t('undo')}
 *   aria-label={`Opacity ${pct}%`}             ->  aria-label={t('opacityPct', { pct: pct })}
 *   title={`Draw line${on ? ' (active)' : ''}`}->  title={on ? t('drawLineActive') : t('drawLine')}
 *   Updates opacity to {o}% for selected.      ->  {t('updatesOpacityTo', { o: o })}
 *   announceStatus('Buffer removed')           ->  announceStatus(t('bufferRemoved'))
 *
 * The translation call is picked per location from what is already in scope:
 *   class with an nls / translate / t member   -> this.nls(...)
 *   function with const t / nls = ...          -> t(...)
 *   function whose code uses props.nls(...)    -> props.nls(...)
 * Locations with no translator in scope are reported, never guessed.
 *
 * Existing keys are reused when default.ts already has the same English. Dry run by default;
 * --apply writes the files. Review the diff in git before committing.
 */
const { sinkIndexes } = require('./ui-flow')
const fs = require('fs')
const path = require('path')
const { loadDefaultTs } = require('./loaders')
const { looksLikeUiText, loadTypeScript } = require('./audit')
const { autoWireFile } = require('./auto-wire')

const UI_ATTRS = new Set(['title', 'aria-label', 'aria-description', 'aria-valuetext', 'aria-roledescription', 'aria-placeholder',
  'placeholder', 'label', 'alt', 'tooltip', 'helperText', 'emptyText', 'confirmText', 'cancelText', 'okText', 'text'])
const TRANSLATE_FNS = new Set(['nls', 't', 'translate', 'formatMessage', 'translateMessage', 'getI18nMessage'])
const SINKS = new Set(['announceStatus', 'announce', 'alert', 'confirm', 'setStatus', 'showMessage', 'notify', 'toast', 'setStatusMessage', 'setErrorMessage'])
const TRANSLATOR_NAMES = ['nls', 'translate', 't']
const SKIP_NAMES = new Set(['this', 'props', 'state', 'Math', 'Number', 'String', 'toFixed', 'round', 'floor', 'ceil', 'toLocaleString', 'toString', 'trim', 'current', 'value', 'length', 'abs', 'max', 'min', 'parseFloat', 'parseInt', 'format'])
const ENTITIES = { '&apos;': "'", '&quot;': '"', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&nbsp;': ' ', '&rsquo;': '’', '&lsquo;': '‘', '&mdash;': '—', '&ndash;': '–', '&hellip;': '…', '&times;': '×', '&deg;': '°' }

function decodeEntities (s) {
  return s.replace(/&(#x?[0-9a-fA-F]+|\w+);/g, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
    return ENTITIES[m] != null ? ENTITIES[m] : m
  })
}

/** React's JSX whitespace rule: trim lines that touch a newline, join the rest with spaces. */
function jsxTextValue (raw) {
  const lines = raw.split(/\r\n|\n|\r/)
  if (lines.length === 1) return raw
  const out = []
  lines.forEach((line, i) => {
    let l = line.replace(/\t/g, ' ')
    if (i > 0) l = l.replace(/^[ ]+/, '')
    if (i < lines.length - 1) l = l.replace(/[ ]+$/, '')
    if (l) out.push(l)
  })
  return out.join(' ')
}

function looksLikeJsxText (s) {
  const t = s.trim()
  return /\p{L}{2,}/u.test(t) && !/^[a-z]{1,3}[²³]?$/.test(t) && !/^[{}&]/.test(t)
}

function camel (words) {
  return words.map((w, i) => {
    const x = w === w.toUpperCase() ? w.toLowerCase() : w // GEOJSON -> geojson, keep drawingLabelOption
    return i === 0 ? x.charAt(0).toLowerCase() + x.slice(1) : x.charAt(0).toUpperCase() + x.slice(1)
  }).join('')
}

function makeKeyer (existing, prefix) {
  const used = new Set(Object.keys(existing))
  const byText = new Map()
  for (const [k, v] of Object.entries(existing)) if (typeof v === 'string' && !byText.has(v)) byText.set(v, k)
  const added = {}
  return {
    added,
    keyFor (text) {
      if (byText.has(text)) return { key: byText.get(text), isNew: false }
      const words = text.replace(/\{(\w+)\}/g, ' $1 ').replace(/\{[^}]*\}/g, ' ').replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 6)
      const base = (prefix ? prefix + (words.length ? camel(words).replace(/^./, c => c.toUpperCase()) : 'Text') : (words.length ? camel(words) : 'text')).replace(/^(\d)/, '_$1')
      let key = base
      let n = 2
      while (used.has(key)) key = base + n++
      used.add(key)
      byText.set(text, key)
      added[key] = text
      return { key, isNew: true }
    }
  }
}

function tsString (s) { return "'" + s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, '\\n') + "'" }

function appendKeys (defaultFile, added) {
  const keys = Object.keys(added)
  if (!keys.length) return false
  let src = fs.readFileSync(defaultFile, 'utf8')
  const end = src.lastIndexOf('}')
  let head = src.slice(0, end).replace(/\s+$/, '')
  const indent = (head.match(/\n([ \t]+)[\w'"$]+\s*:/) || [null, '  '])[1]
  const eol = src.includes('\r\n') ? '\r\n' : '\n'
  if (!/[{,]$/.test(head)) head += ','
  const body = keys.map((k, i) => `${indent}${/^[A-Za-z_$][\w$]*$/.test(k) ? k : tsString(k)}: ${tsString(added[k])}${i < keys.length - 1 ? ',' : ''}`).join(eol)
  src = head + eol + body + eol + src.slice(end)
  fs.writeFileSync(defaultFile, src, 'utf8')
  return true
}

function extractFile (ts, file, ctx) {
  const text = ctx.sourceText == null ? fs.readFileSync(file, 'utf8') : ctx.sourceText
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, /x$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const edits = []
  const skipped = []
  const rel = path.relative(ctx.widgetDir, file).replace(/\\/g, '/')
  const lineOf = pos => sf.getLineAndCharacterOfPosition(pos).line + 1
  const fileUsesPropsNls = /\bprops\.nls\s*\(/.test(text)

  // ---- translator detection -------------------------------------------------------------
  function classMembers (cls) {
    return new Set(cls.members.map(m => m.name && ts.isIdentifier(m.name) ? m.name.text : null).filter(Boolean))
  }
  // What a function-scoped name refers to at `node`: a translator, something else (which shadows
  // any translator of the same name further out), or nothing. Block scopes are respected, so a
  // `const t = el.textContent` in one branch does not hide the component's translator elsewhere.
  const within = (inner, outer) => inner.getStart(sf) >= outer.getStart(sf) && inner.getEnd() <= outer.getEnd()
  const isCallbackArg = fn => (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) && fn.parent && ts.isCallExpression(fn.parent) && fn.parent.arguments.includes(fn)
  function fnInfo (f) {
    // Parameter count, and whether values must be strings, for a translator's definition.
    f = f && unparen(f)
    if (!f) return { arity: null, custom: false }
    if (ts.isAsExpression(f) || ts.isNonNullExpression(f)) return fnInfo(f.expression)
    if (ts.isArrowFunction(f) || ts.isFunctionExpression(f) || ts.isMethodDeclaration(f) || ts.isFunctionDeclaration(f)) {
      const vt = f.parameters[1] && f.parameters[1].type ? f.parameters[1].type.getText(sf).replace(/\s+/g, '') : ''
      return { arity: f.parameters.length, custom: /^(Record<string,string>|\{\[\w+:string\]:string;?\})$/.test(vt) }
    }
    if (ts.isCallExpression(f) && /\buse(Callback|Memo)$/.test(f.expression.getText(sf)) && f.arguments[0]) {
      const inner = unparen(f.arguments[0])
      if (ts.isArrowFunction(inner) || ts.isFunctionExpression(inner)) {
        if (/^useMemo$/.test(f.expression.getText(sf).split('.').pop())) return { arity: null, custom: false }
        return fnInfo(inner)
      }
    }
    return { arity: null, custom: false }
  }
  function translatorLikeInit (init) {
    init = init && unparen(init)
    if (!init) return true
    if (ts.isAsExpression(init) || ts.isNonNullExpression(init)) return translatorLikeInit(init.expression)
    if (ts.isArrowFunction(init) || ts.isFunctionExpression(init) || ts.isIdentifier(init) || ts.isPropertyAccessExpression(init)) return true
    if (ts.isCallExpression(init)) return /(useTranslation|useCallback|useMemo|useIntl|createIntl|bind|getI18nMessage|translat|nls|Message)/i.test(init.expression.getText(sf))
    return false
  }
  function bindingAt (fn, node, name) {
    let best = null
    const consider = (scope, translator, info) => {
      if (!within(node, scope) && scope !== fn) return
      if (!best || scope.getStart(sf) >= best.scope.getStart(sf)) best = { scope, translator, info: info || { arity: null, custom: false } }
    }
    for (const p of fn.parameters || []) {
      if (ts.isIdentifier(p.name) && p.name.text === name) {
        const typed = p.type ? (ts.isFunctionTypeNode(p.type) || /=>|Translat|Intl|nls|Message/i.test(p.type.getText(sf))) : !isCallbackArg(fn)
        consider(fn, typed)
      } else if (ts.isObjectBindingPattern(p.name)) {
        if (p.name.elements.some(e => ts.isIdentifier(e.name) && e.name.text === name)) consider(fn, true)
      } else if (ts.isArrayBindingPattern(p.name)) {
        if (p.name.elements.some(e => e.name && ts.isIdentifier(e.name) && e.name.text === name)) consider(fn, false)
      }
    }
    const body = fn.body
    const scopeOf = decl => {
      const list = decl.parent
      const blockScoped = list && ts.isVariableDeclarationList(list) && (list.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const))
      for (let n = list; n; n = n.parent) {
        if (n === fn) return fn
        if (blockScoped && (ts.isBlock(n) || ts.isCaseBlock(n) || ts.isForStatement(n) || ts.isForOfStatement(n) || ts.isForInStatement(n)) && n !== body) return n
      }
      return fn
    }
    const scan = n => {
      if (n !== body && ts.isFunctionLike(n)) {
        if (ts.isFunctionDeclaration(n) && n.name && n.name.text === name && n.parent === body) consider(fn, true, fnInfo(n))
        return
      }
      if (ts.isVariableDeclaration(n)) {
        if (ts.isIdentifier(n.name) && n.name.text === name) consider(scopeOf(n), translatorLikeInit(n.initializer), fnInfo(n.initializer))
        else if (ts.isObjectBindingPattern(n.name) && n.name.elements.some(e => ts.isIdentifier(e.name) && e.name.text === name)) consider(scopeOf(n), true)
        else if (ts.isArrayBindingPattern(n.name) && n.name.elements.some(e => e.name && ts.isIdentifier(e.name) && e.name.text === name)) consider(scopeOf(n), false)
      }
      ts.forEachChild(n, scan)
    }
    if (body) scan(body)
    return best
  }
  // Facts about the translator chosen by the last translatorAt() call, read by call().
  let trInfo = { arity: null, custom: false }
  function translatorAt (node) {
    trInfo = { arity: null, custom: false }
    let crossedPlainFunction = false // `this` inside function () {} is not the component
    const shadowed = new Set()
    for (let n = node.parent; n; n = n.parent) {
      if (ts.isFunctionLike(n) && !ts.isArrowFunction(n) && !ts.isFunctionExpression(n) && !ts.isFunctionDeclaration(n) && ts.isClassLike(n.parent)) {
        if (n.modifiers && n.modifiers.some(m => m.kind === ts.SyntaxKind.StaticKeyword)) return null
      }
      if (ts.isFunctionLike(n)) {
        for (const t of TRANSLATOR_NAMES) {
          if (shadowed.has(t)) continue
          const b = bindingAt(n, node, t)
          if (!b) continue
          if (b.translator) { trInfo = b.info; return t }
          shadowed.add(t)
        }
        if (fileUsesPropsNls && !shadowed.has('props')) { const b = bindingAt(n, node, 'props'); if (b) return 'props.nls' }
        if (ts.isFunctionExpression(n) || ts.isFunctionDeclaration(n)) crossedPlainFunction = true
      }
      if (ts.isClassLike(n)) {
        if (crossedPlainFunction) return null
        for (const t of TRANSLATOR_NAMES) {
          const m = n.members.find(x => x.name && ts.isIdentifier(x.name) && x.name.text === t)
          if (!m) continue
          trInfo = ts.isMethodDeclaration(m) ? fnInfo(m) : fnInfo(m.initializer)
          return 'this.' + t
        }
        return null
      }
    }
    return null
  }

  // ---- message building -------------------------------------------------------------------
  function nameOf (e) {
    e = unparen(e)
    if (!e) return null
    if (ts.isNonNullExpression(e) || ts.isAsExpression(e) || (ts.isTypeAssertionExpression && ts.isTypeAssertionExpression(e))) return nameOf(e.expression)
    if (ts.isIdentifier(e)) return SKIP_NAMES.has(e.text) ? null : e.text
    if (ts.isPropertyAccessExpression(e)) {
      if (/^(length|size)$/.test(e.name.text)) { const base = nameOf(e.expression); return base ? base + 'Count' : 'count' }
      return SKIP_NAMES.has(e.name.text) ? nameOf(e.expression) : e.name.text
    }
    if (ts.isElementAccessExpression(e)) return nameOf(e.expression)
    if (ts.isBinaryExpression(e)) return nameOf(e.left) || nameOf(e.right)
    if (ts.isConditionalExpression(e)) return nameOf(e.whenTrue) || nameOf(e.condition)
    if (ts.isCallExpression(e)) {
      const callee = ts.isPropertyAccessExpression(e.expression) ? e.expression : null
      if (callee && !SKIP_NAMES.has(callee.name.text) && !/^(get|format|to)[A-Z]?/.test(callee.name.text)) return callee.name.text
      if (callee) return nameOf(callee.expression) || (e.arguments[0] && nameOf(e.arguments[0]))
      return e.arguments[0] ? nameOf(e.arguments[0]) : null
    }
    if (ts.isPrefixUnaryExpression(e) || ts.isPostfixUnaryExpression(e)) return nameOf(e.operand)
    return null
  }

  function argName (expr, taken) {
    let name = nameOf(expr) || 'value'
    if (!/^[A-Za-z_]\w*$/.test(name)) name = 'value'
    const exprText = expr.getText(sf)
    if (taken.has(name) && taken.get(name) !== exprText) { let i = 2; while (taken.has(name + i) && taken.get(name + i) !== exprText) i++; name = name + i }
    taken.set(name, exprText)
    return name
  }

  const isStr = n => n && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n))
  const unparen = n => { while (n && ts.isParenthesizedExpression(n)) n = n.expression; return n }
  const isStrLeafTree = n => { n = unparen(n); return !!n && (isStr(n) || (ts.isConditionalExpression(n) && isStrLeafTree(n.whenTrue) && isStrLeafTree(n.whenFalse))) }
  const leafCount = n => { n = unparen(n); return ts.isConditionalExpression(n) ? leafCount(n.whenTrue) + leafCount(n.whenFalse) : 1 }
  const isStrCond = n => { n = unparen(n); return !!n && ts.isConditionalExpression(n) && isStrLeafTree(n) }

  // A local translator typed (id, values?: Record<string, string>) rejects numbers, and the
  // template literal it replaces turned every value into a string anyway, so wrap values for
  // those. Other translators keep raw values (jimu's ICU formatting handles numbers per locale).
  const stringy = e => /^(['"`]|String\(|t\(|nls\(|this\.nls\(|props\.nls\(|translate\()/.test(e) || /\.(toString|toFixed|toLocaleString|toLocaleDateString|toLocaleTimeString|join|trim|toLowerCase|toUpperCase)\([^()]*\)$/.test(e)
  function call (tr, key, values) {
    if (values && values.length && trInfo.arity != null && trInfo.arity < 2) return null
    const val = (k, e) => trInfo.custom && !stringy(e) ? `${k}: String(${e})` : (k === e ? k : `${k}: ${e}`)
    const v = values && values.length ? `, { ${values.map(([k, e]) => val(k, e)).join(', ')} }` : ''
    return `${tr}('${key}'${v})`
  }

  /** Source text of an expression with any UI literals inside it translated. */
  function exprWithCalls (expr, tr) {
    const inner = []
    collectLiterals(expr, inner)
    if (!inner.length) return expr.getText(sf)
    const start = expr.getStart(sf)
    let s = expr.getText(sf)
    inner.sort((a, b) => b.node.getStart(sf) - a.node.getStart(sf))
    for (const it of inner) {
      const rep = messageCall(it.node, tr)
      if (!rep) continue
      const a = it.node.getStart(sf) - start
      const b = it.node.getEnd() - start
      s = s.slice(0, a) + rep + s.slice(b)
    }
    return s
  }

  /**
   * Turn a sequence of segments into one translation call.
   *   { text: 'Draw line' } plain text
   *   { expr: node }        a value, becomes an ICU {placeholder}
   * Expressions that are string conditionals (cond ? ' (active)' : '') are expanded so each
   * combination becomes its own whole sentence, which translators can word naturally.
   */
  function buildCall (segments, tr, lenient) {
    const choiceIdx = []
    segments.forEach((sg, i) => { if (sg.expr && isStrCond(sg.expr)) choiceIdx.push(i) })
    const combos = choiceIdx.reduce((n, i) => n * leafCount(segments[i].expr), 1)
    if (combos > 8) return null
    // One whole sentence for a fixed pick of every choice segment.
    const build = (picked) => {
      const taken = new Map()
      const values = []
      let msg = ''
      segments.forEach((sg, i) => {
        if (sg.text != null) { msg += sg.text; return }
        if (picked.has(i)) { msg += picked.get(i); return }
        const name = argName(sg.expr, taken)
        if (!values.some(v => v[0] === name)) values.push([name, exprWithCalls(sg.expr, tr)])
        msg += `{${name}}`
      })
      msg = msg.replace(/\s+/g, ' ').trim()
      const bare = msg.replace(/\{\w+\}/g, ' ').trim()
      if (/[{}]/.test(bare)) return null // literal braces would break ICU message syntax
      // JSX text and sentences with placeholders are UI by position; bare literals must look like prose.
      if (!msg || !(lenient || values.length ? looksLikeJsxText(bare) : looksLikeUiText(bare))) return null
      return call(tr, ctx.keyer.keyFor(msg).key, values.filter(([n]) => msg.includes(`{${n}}`)))
    }
    let failed = false
    // Mirror each choice's ternary tree in the output so the same conditions pick the sentence.
    const gen = (k, picked) => {
      if (k === choiceIdx.length) { const c = build(picked); if (!c) failed = true; return c || "''" }
      const walk = (node) => {
        node = unparen(node)
        if (ts.isConditionalExpression(node)) return `(${node.condition.getText(sf)} ? ${walk(node.whenTrue)} : ${walk(node.whenFalse)})`
        const next = new Map(picked); next.set(choiceIdx[k], node.text)
        return gen(k + 1, next)
      }
      return walk(segments[choiceIdx[k]].expr)
    }
    const out = gen(0, new Map())
    return failed ? null : out
  }

  /** A translation call replacing a string literal or template literal node, or null. */
  function messageCall (node, tr) {
    if (isStr(node)) {
      if (!looksLikeUiText(node.text) || /[{}]/.test(node.text)) return null
      return call(tr, ctx.keyer.keyFor(node.text.replace(/\s+/g, ' ').trim()).key)
    }
    if (ts.isTemplateExpression(node)) {
      const segs = [{ text: node.head.text }]
      for (const sp of node.templateSpans) { segs.push({ expr: sp.expression }); segs.push({ text: sp.literal.text }) }
      return buildCall(segs, tr)
    }
    return null
  }

  /** UI literals inside an expression (not inside translation calls, comparisons or fallbacks). */
  function collectLiterals (node, acc) {
    node = node || null
    if (!node) return acc
    if (ts.isCallExpression(node)) {
      const nm = ts.isIdentifier(node.expression) ? node.expression.text : ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : ''
      if (TRANSLATE_FNS.has(nm) || /^(console|require|import)$/.test(nm) || /^(includes|indexOf|startsWith|endsWith|split|replace|join|querySelector|getElementById|setAttribute|getAttribute|addEventListener|removeEventListener|toFixed|padStart)$/.test(nm)) return acc
    }
    if (ts.isBinaryExpression(node)) {
      const k = node.operatorToken.kind
      if (k === ts.SyntaxKind.EqualsEqualsEqualsToken || k === ts.SyntaxKind.ExclamationEqualsEqualsToken || k === ts.SyntaxKind.EqualsEqualsToken || k === ts.SyntaxKind.ExclamationEqualsToken) return acc
      if ((k === ts.SyntaxKind.BarBarToken || k === ts.SyntaxKind.QuestionQuestionToken) && containsTranslate(node.left)) { collectLiterals(node.left, acc); return acc }
      if (k === ts.SyntaxKind.PlusToken) {
        const hasUi = n => { n = unparen(n); return isStr(n) ? looksLikeUiText(n.text) : (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken && (hasUi(n.left) || hasUi(n.right))) }
        if (hasUi(node)) acc.push({ node, concat: true })
        return acc
      }
    }
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node) || ts.isJsxAttribute(node)) return acc
    if (ts.isElementAccessExpression(node) || ts.isPropertyAssignment(node) && /^(className|key|id|type|name|value|icon|style)$/.test(node.name.getText(sf))) return acc
    if (isStr(node) || ts.isTemplateExpression(node)) { if (isStr(node) ? looksLikeUiText(node.text) : true) acc.push({ node }); return acc }
    ts.forEachChild(node, c => { collectLiterals(c, acc) })
    return acc
  }
  function containsTranslate (n) {
    let found = false
    const v = x => { if (found) return; if (ts.isCallExpression(x)) { const nm = ts.isIdentifier(x.expression) ? x.expression.text : ts.isPropertyAccessExpression(x.expression) ? x.expression.name.text : ''; if (TRANSLATE_FNS.has(nm)) { found = true; return } } ts.forEachChild(x, v) }
    v(n)
    return found
  }

  function addEdit (start, end, replacement, what, node) {
    if (edits.some(e => start < e.end && end > e.start)) return
    edits.push({ start, end, replacement, what, line: lineOf(start) })
  }

  function handleLiteralNodes (list, tr, what) {
    for (const it of list) {
      const node = it.node
      if (it.concat) { skipped.push({ file: rel, line: lineOf(node.getStart(sf)), why: 'string concatenation, convert by hand', text: node.getText(sf).slice(0, 80) }); continue }
      const rep = messageCall(node, tr)
      if (rep) addEdit(node.getStart(sf), node.getEnd(), rep, what, node)
      else if (trInfo.arity != null && trInfo.arity < 2 && ts.isTemplateExpression(node)) skipped.push({ file: rel, line: lineOf(node.getStart(sf)), why: `${tr}() takes no values, give it a second parameter`, text: node.getText(sf).slice(0, 80) })
    }
  }

  // ---- JSX children runs: text + simple expressions -> one message ---------------------------
  function simpleValueExpr (e) {
    if (!e) return false
    let bad = false
    const v = n => { if (bad) return; if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n) || ts.isArrowFunction(n) || ts.isFunctionExpression(n)) { bad = true; return } if (isStr(n) && looksLikeUiText(n.text)) { bad = true; return } ts.forEachChild(n, v) }
    v(e)
    return !bad && !ts.isConditionalExpression(unparen(e)) && !(ts.isBinaryExpression(e) && (e.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken))
  }

  function handleChildren (children, tr) {
    let run = []
    const flush = () => {
      const hasText = run.some(n => ts.isJsxText(n) && looksLikeJsxText(jsxTextValue(n.text)))
      if (hasText) {
        const first = run[0]
        const last = run[run.length - 1]
        const lead = ts.isJsxText(first) ? (first.getFullText(sf).match(/^\s*/) || [''])[0] : ''
        const trail = ts.isJsxText(last) ? (last.getFullText(sf).match(/\s*$/) || [''])[0] : ''
        const segs = run.map((n, i) => {
          if (!ts.isJsxText(n)) return isStr(n.expression) ? { text: n.expression.text } : { expr: n.expression }
          let raw = n.getFullText(sf)
          if (i === 0) raw = raw.slice(lead.length)
          if (i === run.length - 1) raw = raw.slice(0, raw.length - trail.length)
          return { text: decodeEntities(jsxTextValue(raw)) }
        })
        const rep = buildCall(segs, tr, true)
        if (rep) addEdit(first.pos + lead.length, last.end - trail.length, '{' + rep + '}', 'text', first)
      }
      run = []
    }
    for (const c of children) {
      if (ts.isJsxText(c)) run.push(c)
      else if (ts.isJsxExpression(c) && c.expression && isStr(c.expression) && !looksLikeUiText(c.expression.text)) run.push(c)
      else if (ts.isJsxExpression(c) && c.expression && run.length && (isStrCond(c.expression) || simpleValueExpr(c.expression))) run.push(c)
      else if (ts.isJsxExpression(c) && c.expression && !run.length && simpleValueExpr(c.expression)) run.push(c)
      else if (ts.isJsxExpression(c) && !c.expression) { /* comment */ } else flush()
    }
    flush()
  }

  // ---- walk -------------------------------------------------------------------------------
  const visit = (node) => {
    if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
      const tag = ts.isJsxElement(node) ? node.openingElement.tagName.getText(sf) : ''
      if (!/^(style|script|code|pre|kbd|samp)$/.test(tag)) {
        const tr = translatorAt(node)
        const hasText = node.children.some(c => ts.isJsxText(c) && looksLikeJsxText(jsxTextValue(c.text)))
        if (hasText) {
          if (tr) handleChildren(node.children, tr)
          else node.children.filter(c => ts.isJsxText(c) && looksLikeJsxText(jsxTextValue(c.text))).forEach(c => skipped.push({ file: rel, line: lineOf(c.getStart(sf)), why: 'no translator in scope', text: jsxTextValue(c.text).trim().slice(0, 80) }))
        }
      }
    }
    if (ts.isJsxAttribute(node) && UI_ATTRS.has(node.name.getText(sf)) && node.initializer) {
      const tr = translatorAt(node)
      const init = node.initializer
      if (ts.isStringLiteral(init)) {
        if (looksLikeUiText(init.text)) {
          if (!tr) skipped.push({ file: rel, line: lineOf(init.getStart(sf)), why: 'no translator in scope', text: init.text.slice(0, 80) })
          else addEdit(init.getStart(sf), init.getEnd(), '{' + call(tr, ctx.keyer.keyFor(init.text.replace(/\s+/g, ' ').trim()).key) + '}', 'attr', init)
        }
      } else if (ts.isJsxExpression(init) && init.expression) {
        const lits = collectLiterals(init.expression, [])
        if (lits.length) {
          if (!tr) lits.forEach(l => skipped.push({ file: rel, line: lineOf(l.node.getStart(sf)), why: 'no translator in scope', text: l.node.getText(sf).slice(0, 80) }))
          else handleLiteralNodes(lits, tr, 'attr')
        }
      }
    }
    // {cond ? 'Label A' : 'Label B'} or {'Text'} as a JSX child
    if (ts.isJsxExpression(node) && node.expression && node.parent && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent)) &&
        !(ts.isJsxElement(node.parent) && /^(style|script|code|pre|kbd|samp)$/.test(node.parent.openingElement.tagName.getText(sf)))) {
      const lits = collectLiterals(node.expression, [])
      if (lits.length) {
        const tr = translatorAt(node)
        if (!tr) lits.forEach(l => skipped.push({ file: rel, line: lineOf(l.node.getStart(sf)), why: 'no translator in scope', text: l.node.getText(sf).slice(0, 80) }))
        else handleLiteralNodes(lits, tr, 'text')
      }
    }
    if (ts.isCallExpression(node)) {
      const nm = ts.isIdentifier(node.expression) ? node.expression.text : ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : ''
      for (const i of sinkIndexes(ts, node, ctx)) {
        if (!node.arguments[i]) continue
        const lits = collectLiterals(node.arguments[i], [])
        if (lits.length) {
          const tr = translatorAt(node)
          if (!tr) lits.forEach(l => skipped.push({ file: rel, line: lineOf(l.node.getStart(sf)), why: 'no translator in scope', text: l.node.getText(sf).slice(0, 80) }))
          else handleLiteralNodes(lits, tr, 'call')
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)

  edits.sort((a, b) => b.start - a.start)
  let out = text
  for (const e of edits) out = out.slice(0, e.start) + e.replacement + out.slice(e.end)
  return { file: rel, abs: file, edits, skipped, output: out, changed: out !== text }
}

function extractWidget (widgetDir, opts = {}) {
  const ts = loadTypeScript(opts.client)
  if (!ts) throw new Error('TypeScript not found. Pass --client <EB client folder> (it ships typescript).')
  const results = []
  const keyers = {}
  for (const part of ['runtime', 'setting']) {
    const def = path.join(widgetDir, 'src', part, 'translations', 'default.ts')
    const exists = fs.existsSync(def)
    // New widgets often have runtime messages but no settings translation folder.
    // Plan the settings file on dry runs, create only if strings were extracted.
    if (!exists && !(opts.autoWire && part === 'setting' &&
        fs.existsSync(path.join(widgetDir, 'src', 'setting')))) continue
    const prefix = typeof opts.prefix === 'object' && opts.prefix ? (opts.prefix[part] || '') : (opts.prefix || '')
    keyers[part] = { file: def, existed: exists,
      keyer: makeKeyer(exists ? loadDefaultTs(def) : {}, prefix) }
  }
  const walk = (dir, out = []) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === 'vendor' || e.name === 'translations' || e.name.startsWith('.')) continue
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p, out)
      else if (/\.(tsx|ts|jsx|js)$/.test(e.name) && !/\.d\.ts$/.test(e.name) && !/\.test\./.test(e.name)) out.push(p)
    }
    return out
  }
  const only = opts.files ? new Set(opts.files.map(f => path.resolve(widgetDir, f))) : null
  for (const file of walk(path.join(widgetDir, 'src'))) {
    if (only && !only.has(path.resolve(file))) continue
    const rel = path.relative(path.join(widgetDir, 'src'), file).replace(/\\/g, '/')
    const part = rel.startsWith('setting/') ? 'setting' : 'runtime'
    const k = keyers[part] || keyers.runtime
    if (!k) continue
    const source = fs.readFileSync(file, 'utf8')
    const wired = opts.autoWire ? autoWireFile(ts, file, source, widgetDir, part) : { text: source, wired: 0 }
    let r = extractFile(ts, file, { widgetDir, keyer: k.keyer, sinks: opts.sinks, sinkArgs: opts.sinkArgs, sourceText: wired.text })
    // A hook nothing uses is dead code (and an import some editor shims cannot resolve): keep the file as it was.
    if (wired.wired && !r.edits.length) { r = extractFile(ts, file, { widgetDir, keyer: k.keyer, sinks: opts.sinks, sinkArgs: opts.sinkArgs, sourceText: source }); wired.wired = 0 }
    r.autoWired = wired.wired
    r.changed = r.output !== source
    results.push(r)
    if (opts.apply && r.changed) fs.writeFileSync(file, r.output, 'utf8')
  }
  const added = {}
  const created = []
  for (const [part, k] of Object.entries(keyers)) {
    added[part] = k.keyer.added
    if (!k.existed && Object.keys(k.keyer.added).length) {
      created.push(k.file)
      if (opts.apply) {
        fs.mkdirSync(path.dirname(k.file), { recursive: true })
        fs.writeFileSync(k.file, 'export default {}\n', 'utf8')
      }
    }
    if (opts.apply && fs.existsSync(k.file)) appendKeys(k.file, k.keyer.added)
  }
  return { results, added, created }
}

function formatExtract (r, apply) {
  const lines = []
  let n = 0
  for (const f of r.results) {
    if (!f.edits.length && !f.skipped.length) continue
    lines.push(`${f.file}: ${f.edits.length} change(s)${f.skipped.length ? `, ${f.skipped.length} left for hand edit` : ''}`)
    for (const e of f.edits.slice().reverse()) lines.push(`  ${e.line}  ${e.what}  ${e.replacement.slice(0, 140)}`)
    for (const s of f.skipped) lines.push(`  ${s.line}  SKIP (${s.why})  ${s.text}`)
    n += f.edits.length
  }
  for (const [part, keys] of Object.entries(r.added)) {
    const ks = Object.keys(keys)
    if (ks.length) lines.push('', `New keys in src/${part}/translations/default.ts (${ks.length}):`, ...ks.map(k => `  ${k}: ${JSON.stringify(keys[k])}`))
  }
  lines.push('', `${n} change(s) ${apply ? 'written' : 'planned (dry run; add --apply to write)'}.`)
  return lines.join('\n')
}

module.exports = { extractWidget, formatExtract, jsxTextValue, decodeEntities, makeKeyer, appendKeys }
