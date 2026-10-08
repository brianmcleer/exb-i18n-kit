'use strict'
/**
 * Add a translation hook to exported React function components that contain
 * untranslated UI. Parse using TypeScript rather than rewriting by regex.
 * Do not modify class components, nested helpers, or already wired functions.
 */
const path = require('path')

const UI_ATTRS = new Set(['title', 'aria-label', 'aria-description', 'aria-valuetext',
  'aria-roledescription', 'aria-placeholder', 'placeholder', 'label', 'alt',
  'tooltip', 'helperText', 'emptyText', 'confirmText', 'cancelText', 'okText',
  'description', 'heading', 'text'])
const UI_SINKS = new Set(['announceStatus', 'announceToScreenReader', 'announce',
  'alert', 'confirm', 'setStatus', 'setStatusMessage', 'setErrorMessage',
  'showMessage', 'notify', 'toast'])

function autoWireFile (ts, file, source, widgetDir, part) {
  if (!/\.[jt]sx$/.test(file)) return { text: source, wired: 0 }
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true,
    /\.tsx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.JSX)
  const exported = new Set()
  const hasMod = (n, flag) => !!n.modifiers?.some(m => m.kind === flag)
  for (const stmt of sf.statements) {
    if (ts.isExportAssignment(stmt) && ts.isIdentifier(stmt.expression)) exported.add(stmt.expression.text)
  }

  function contains (node, predicate) {
    if (predicate(node)) return true
    let found = false
    ts.forEachChild(node, child => { if (!found && contains(child, predicate)) found = true })
    return found
  }
  const isUi = node => {
    if (ts.isJsxText(node) && /\p{L}{2,}/u.test(node.text)) return true
    if (ts.isJsxAttribute(node) && UI_ATTRS.has(node.name.getText(sf))) {
      const init = node.initializer
      return !!(init && /\p{L}{2,}/u.test(init.getText(sf)) &&
        !/^['"](?:https?:|\/|#)/i.test(init.getText(sf)))
    }
    if (ts.isJsxExpression(node) && node.expression &&
        (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))) {
      return contains(node.expression, n =>
        (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) ||
         ts.isTemplateHead(n)) && /\p{L}{2,}/u.test(n.text))
    }
    if (ts.isCallExpression(node)) {
      const callee = ts.isIdentifier(node.expression) ? node.expression.text
        : ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : ''
      return UI_SINKS.has(callee) && !!node.arguments.length &&
        contains(node.arguments[0], n => (ts.isStringLiteral(n) ||
          ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n)) && /\p{L}{2,}/u.test(n.text))
    }
    return false
  }

  const components = []
  for (const stmt of sf.statements) {
    if (ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(d.name)) continue
        if (!exported.has(d.name.text) && !hasMod(stmt, ts.SyntaxKind.ExportKeyword)) continue
        const fn = d.initializer
        if (fn && (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) && fn.body && ts.isBlock(fn.body)) components.push(fn)
      }
    }
    if (ts.isFunctionDeclaration(stmt) && stmt.body &&
        (hasMod(stmt, ts.SyntaxKind.ExportKeyword) || hasMod(stmt, ts.SyntaxKind.DefaultKeyword))) components.push(stmt)
  }

  const bodies = components.filter(fn => {
    if (!contains(fn.body, n => ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n))) return false
    if (!contains(fn.body, isUi)) return false
    const TR = ['t', 'nls', 'translate']
    // Any binding of those names already in the component (plain, destructured from props, or
    // a function) means it has a translator, or a variable a new `const t` would collide with.
    const binds = n => (ts.isIdentifier(n) && TR.includes(n.text)) ||
      ((ts.isObjectBindingPattern(n) || ts.isArrayBindingPattern(n)) && n.elements.some(e => e.name && binds(e.name)))
    if (fn.parameters.some(p => binds(p.name))) return false
    if (contains(fn.body, n => (ts.isVariableDeclaration(n) && binds(n.name)) ||
        (ts.isFunctionDeclaration(n) && n.name && TR.includes(n.name.text)))) return false
    if (contains(fn.body, n => ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'useTranslation')) return false
    return true
  })
  if (!bodies.length) return { text: source, wired: 0 }

  const imports = [...sf.statements].filter(ts.isImportDeclaration)
  const at = imports.length ? imports[imports.length - 1].getEnd() : 0
  let hookName = '__exbI18nHooks'
  let msgName = '__exbI18nMessages'
  while (new RegExp('\\b' + hookName + '\\b').test(source)) hookName += '_'
  while (new RegExp('\\b' + msgName + '\\b').test(source)) msgName += '_'
  const relative = path.relative(path.dirname(file), path.join(widgetDir, 'src', part, 'translations', 'default')).replace(/\\/g, '/')
  const importPath = relative.startsWith('.') ? relative : './' + relative
  const eol = source.includes('\r\n') ? '\r\n' : '\n'
  const newImports = (at ? eol : '') + 'import { hooks as ' + hookName + " } from 'jimu-core';" + eol +
    'import ' + msgName + " from '" + importPath + "';" + eol
  const edits = [{ pos: at, insert: newImports }]
  for (const fn of bodies) edits.push({ pos: fn.body.getStart(sf) + 1,
    insert: eol + '  const t = ' + hookName + '.useTranslation(' + msgName + ');' })
  let output = source
  for (const e of edits.sort((a, b) => b.pos - a.pos)) output = output.slice(0, e.pos) + e.insert + output.slice(e.pos)
  return { text: output, wired: bodies.length }
}

module.exports = { autoWireFile }
