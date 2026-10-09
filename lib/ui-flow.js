'use strict'

// Follow local bindings into known UI positions. Symbols (rather than names)
// keep unrelated variables and shadowed callback parameters separate.
const UI_PROPS = new Set(['children', 'title', 'label', 'text', 'heading', 'description', 'placeholder', 'alt', 'tooltip', 'helperText', 'emptyText', 'confirmText', 'cancelText', 'okText', 'aria-label', 'aria-description', 'aria-valuetext', 'aria-roledescription', 'aria-placeholder', 'ariaLabel', 'hint', 'caption', 'buttonText', 'tooltipText', 'subtitle', 'emptyMessage', 'loadingText'])
const SINKS = new Set(['announceStatus', 'announce', 'alert', 'confirm', 'setStatus', 'showMessage', 'notify', 'toast', 'setStatusMessage', 'setErrorMessage', 'setStatusMsg', 'setMessage', 'setError', 'setNotice', 'setHint', 'setWarning', 'setInfo', 'setLoadingMessage', 'setBanner', 'setToast'])
const TRANSLATORS = new Set(['nls', 't', 'translate', 'formatMessage', 'translateMessage', 'getI18nMessage', 'i18n', '__t', '__tc', 'helpT'])
const nameOf = (ts, e) => ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? e.name.text : ''

function sinkIndexes (ts, call, opts = {}) {
  const name = nameOf(ts, call.expression)
  if (opts.sinkArgs && Object.prototype.hasOwnProperty.call(opts.sinkArgs, name)) {
    const indexes = opts.sinkArgs[name]
    if (!Array.isArray(indexes) || indexes.some(i => !Number.isInteger(i) || i < 0)) throw new Error(`sinkArgs.${name} must be an array of nonnegative argument indexes`)
    return indexes
  }
  if (!SINKS.has(name) && !(opts.sinks || []).includes(name)) return []
  const first = call.arguments[0]
  // Common notification signature: showMessage(severity, message).
  if (call.arguments.length > 1 && first && ts.isStringLiteral(first) && /^(success|error|warning|info)$/.test(first.text) && /^(showMessage|notify|toast)$/.test(name)) return [1]
  return [0]
}

function uiExpressions (ts, sf, opts = {}) {
  const host = ts.createCompilerHost({ noResolve: true, noLib: true })
  // A tiny analysis-only array model resolves metadata in .find()/.map() UI
  // callbacks without importing or executing the widget's dependencies.
  const arrays = ts.createSourceFile('__ui_arrays.d.ts', 'interface Array<T> { find(predicate: (value: T, index: number) => unknown): T | undefined; map<U>(callback: (value: T, index: number) => U): U[]; filter(predicate: (value: T) => unknown): T[]; } interface ReadonlyArray<T> extends Array<T> {}', ts.ScriptTarget.Latest, true)
  host.getSourceFile = file => file === sf.fileName ? sf : file === arrays.fileName ? arrays : undefined
  const checker = ts.createProgram([sf.fileName, arrays.fileName], { noResolve: true, noLib: true }, host).getTypeChecker()
  const symbol = node => checker.getSymbolAtLocation(node)
  const roots = new Set()
  const calls = []
  const wantedParams = new Set()
  const seen = new Set()
  function follow (n) {
    if (!n || seen.has(n)) return
    seen.add(n)
    if (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isNonNullExpression(n)) return follow(n.expression)
    if (ts.isIdentifier(n) || ts.isPropertyAccessExpression(n)) {
      const sym = symbol(ts.isPropertyAccessExpression(n) ? n.name : n)
      for (const d of sym && sym.declarations || []) {
        if (ts.isParameter(d)) wantedParams.add(d)
        else if (ts.isVariableDeclaration(d) || ts.isPropertyAssignment(d) || ts.isPropertyDeclaration(d)) follow(d.initializer)
        else if (ts.isBindingElement(d) && ts.isObjectBindingPattern(d.parent)) {
          const key = d.propertyName ? d.propertyName.text : d.name.text
          const property = checker.getPropertyOfType(checker.getTypeAtLocation(d.parent), key)
          for (const dec of property && property.declarations || []) follow(dec.initializer)
          follow(d.initializer)
        }
        else if (ts.isShorthandPropertyAssignment(d)) {
          const v = checker.getShorthandAssignmentValueSymbol(d)
          for (const dec of v && v.declarations || []) follow(dec.initializer)
        }
      }
      return
    }
    if (ts.isElementAccessExpression(n)) {
      const type = checker.getTypeAtLocation(n.expression)
      const key = n.argumentExpression && (ts.isStringLiteral(n.argumentExpression) || ts.isNumericLiteral(n.argumentExpression)) ? n.argumentExpression.text : null
      const properties = key == null ? checker.getPropertiesOfType(type) : [checker.getPropertyOfType(type, key)]
      for (const property of properties) for (const d of property && property.declarations || []) if (d.getSourceFile() === sf) follow(d.initializer)
      return
    }
    if (ts.isConditionalExpression(n)) { follow(n.whenTrue); follow(n.whenFalse); return }
    if (ts.isBinaryExpression(n)) {
      if (n.operatorToken.kind === ts.SyntaxKind.PlusToken && checker.typeToString(checker.getTypeAtLocation(n)) === 'string') roots.add(n)
      if ([ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.PlusToken, ts.SyntaxKind.AmpersandAmpersandToken].includes(n.operatorToken.kind)) { follow(n.left); follow(n.right) }
      return
    }
    if (ts.isArrayLiteralExpression(n)) { n.elements.forEach(follow); return }
    if (ts.isCallExpression(n)) {
      if (TRANSLATORS.has(nameOf(ts, n.expression))) return
      const signature = checker.getResolvedSignature(n)
      let fn = signature && signature.declaration
      if (nameOf(ts, n.expression) === 'useMemo' && n.arguments[0] && ts.isArrowFunction(n.arguments[0])) fn = n.arguments[0]
      if (!fn || fn.getSourceFile() !== sf || !fn.body) return // Imported APIs are opaque.
      if (!ts.isBlock(fn.body)) follow(fn.body)
      else {
        const returns = node => {
          if (ts.isReturnStatement(node)) follow(node.expression)
          else if (!ts.isFunctionLike(node)) ts.forEachChild(node, returns)
        }
        ts.forEachChild(fn.body, returns)
      }
      return
    }
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateExpression(n)) roots.add(n)
  }
  function visit (n) {
    if (ts.isPropertyAssignment(n) && UI_PROPS.has(n.name.text)) follow(n.initializer)
    if (ts.isShorthandPropertyAssignment(n) && UI_PROPS.has(n.name.text)) follow(n.name)
    if (ts.isJsxExpression(n) && n.expression && (ts.isJsxElement(n.parent) || ts.isJsxFragment(n.parent) || (ts.isJsxAttribute(n.parent) && UI_PROPS.has(n.parent.name.getText(sf))))) follow(n.expression)
    if (ts.isCallExpression(n)) { calls.push(n); sinkIndexes(ts, n, opts).forEach(i => follow(n.arguments[i])) }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  // Propagate UI-bound parameters through any number of local helper wrappers.
  let previous = -1
  while (previous !== wantedParams.size) {
    previous = wantedParams.size
    for (const call of calls) {
      if (TRANSLATORS.has(nameOf(ts, call.expression))) continue
      const signature = checker.getResolvedSignature(call)
      const fn = signature && signature.declaration
      if (!fn || fn.getSourceFile() !== sf || !fn.parameters) continue
      fn.parameters.forEach((p, i) => { if (wantedParams.has(p)) follow(call.arguments[i]) })
    }
  }
  return [...roots]
}

function fixedLocaleArgument (ts, call) {
  if (!ts.isCallExpression(call) || !ts.isPropertyAccessExpression(call.expression)) return null
  if (!/^toLocale(DateString|TimeString|String)$/.test(call.expression.name.text)) return null
  const arg = call.arguments[0]
  if (!arg) return call
  if (ts.isIdentifier(arg) && arg.text === 'undefined') return arg
  if (ts.isArrayLiteralExpression(arg) && !arg.elements.length) return arg
  return ts.isStringLiteral(arg) && /^en(?:[-_][a-z0-9]+)*$/i.test(arg.text) ? arg : null
}

module.exports = { uiExpressions, sinkIndexes, fixedLocaleArgument, UI_PROPS, TRANSLATORS }
