'use strict'
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const { harvest } = require('../lib/harvest')
const { syncWidget, neededKeys } = require('../lib/sync')
const { importCsv } = require('../lib/import')
const { loadLocaleJs, formatLocaleJs } = require('../lib/loaders')
const { adapt, norm } = require('../lib/match')
const { parseCsv } = require('../lib/csv')
const { loadProvider } = require('../lib/mt')
const { DEFAULTS } = require('../lib/config')

const FIX = path.join(__dirname, 'fixtures')
// A tiny fake Experience Builder client, written at test time (keeps repo paths short).
const CLIENT = fs.mkdtempSync(path.join(os.tmpdir(), 'exb-client-'))
function put (rel, text) { const f = path.join(CLIENT, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text) }
put('dist/jimu-ui/lib/translations/default.ts', fs.readFileSync(path.join(FIX, 'esri', 'jimu-ui.default.ts'), 'utf8'))
put('dist/jimu-ui/lib/translations/es.js', fs.readFileSync(path.join(FIX, 'esri', 'jimu-ui.es.js'), 'utf8'))
put('dist/widgets/common/demo/manifest.json', fs.readFileSync(path.join(FIX, 'esri', 'demo.manifest.json'), 'utf8'))
put('dist/widgets/common/demo/dist/runtime/translations/default.ts', fs.readFileSync(path.join(FIX, 'esri', 'demo.default.ts'), 'utf8'))
put('dist/widgets/common/demo/dist/runtime/translations/es.js', fs.readFileSync(path.join(FIX, 'esri', 'demo.es.js'), 'utf8'))

function freshWidget () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exb-i18n-'))
  fs.cpSync(path.join(FIX, 'widget'), dir, { recursive: true })
  // Git on Windows may check fixtures out with CRLF; the tests edit them as LF text.
  const lf = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) lf(p); else fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n')) } }
  lf(dir)
  return dir
}

async function sync (dir, extra = {}) {
  const tm = harvest(CLIENT, { needed: neededKeys(dir) })
  return syncWidget(dir, Object.assign({ cfg: Object.assign({}, DEFAULTS), tm, provider: null, locales: ['es'], writeReview: true }, extra))
}

const es = dir => loadLocaleJs(path.join(dir, 'src/runtime/translations/es.js'))
const lock = dir => JSON.parse(fs.readFileSync(path.join(dir, 'i18n/translations.lock.json'), 'utf8'))
const entry = (dir, key) => (lock(dir).parts.runtime.locales.es.entries[key] || {})

test('matching rules', () => {
  assert.strictEqual(norm('Loading...'), 'loading')
  assert.strictEqual(adapt('Kilometers', 'kilómetros', 'kilometers', 'es'), 'Kilómetros')
  assert.strictEqual(adapt('Loading:', 'Cargando...', 'Loading...', 'es'), 'Cargando:')
  assert.strictEqual(adapt('and', 'AND', 'and', 'es'), null, 'shouting SQL operator rejected')
  assert.strictEqual(adapt('Selected {n} items', '{count} elementos seleccionados', 'Selected {count} items', 'es'), '{n} elementos seleccionados')
  assert.strictEqual(adapt('Loading:', '読み込み中...', 'Loading...', 'ja'), '読み込み中:')
})

test('sync fills from Esri, falls back to English, updates manifest', async () => {
  const dir = freshWidget()
  const r = await sync(dir)
  const m = es(dir)
  assert.strictEqual(m.undo, 'Deshacer')
  assert.strictEqual(m.remove, 'Eliminar')
  assert.strictEqual(m.loadingLabel, 'Cargando:')
  assert.strictEqual(m.unitKm, 'Kilómetros')
  assert.strictEqual(m.picked, '{n} elementos seleccionados')
  assert.strictEqual(m.joiner, 'and', 'rejected candidate falls back to English')
  assert.strictEqual(m.drawPoint, 'Dibujar un punto', 'close match shipped')
  assert.ok(parseCsv(fs.readFileSync(path.join(dir, 'i18n/review/es.csv'), 'utf8')).find(x => x.key === 'drawPoint' && x.status === 'esri-check'))
  assert.strictEqual(m.helpLong, 'Click the map to start drawing.')
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'))
  assert.deepStrictEqual(manifest.translatedLocales, ['en', 'es'])
  const rows = parseCsv(fs.readFileSync(path.join(dir, 'i18n/review/es.csv'), 'utf8'))
  assert.ok(rows.find(x => x.key === 'helpLong' && x.status === 'missing'))
  assert.ok(rows.find(x => x.key === 'drawPoint' && x.status === 'esri-check'))
  assert.ok(r.written.length >= 1)
})

test('locale file format works with the EB webpack label reader', () => {
  const text = formatLocaleJs({ _widgetLabel: 'Dibujo "avanzado"', 'a-b': 'x' })
  // Same logic as getValueFromTranslation in client/webpack/webpack-extensions.common.js
  const line = text.split('\n').find(l => l.indexOf('_widgetLabel:') > -1)
  let label = line.substr(line.indexOf(':') + 1).trim()
  if (label.endsWith(',')) label = label.slice(0, -1)
  label = label.replace(/\\"/g, '"').replace(/\\'/g, "'").slice(1, -1)
  assert.strictEqual(label, 'Dibujo "avanzado"')
})

test('hand edits survive, English changes go stale, deleted keys drop', async () => {
  const dir = freshWidget()
  await sync(dir)
  const file = path.join(dir, 'src/runtime/translations/es.js')
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('"Click the map to start drawing."', '"Haga clic en el mapa para empezar a dibujar."'))
  await sync(dir)
  assert.strictEqual(es(dir).helpLong, 'Haga clic en el mapa para empezar a dibujar.')
  assert.strictEqual(entry(dir, 'helpLong').src, 'manual')

  const def = path.join(dir, 'src/runtime/translations/default.ts')
  fs.writeFileSync(def, fs.readFileSync(def, 'utf8')
    .replace('Click the map to start drawing.', 'Click the map twice to start drawing.')
    .replace("  joiner: 'and',\n", '')
    .replace(/\}\s*$/, ",\n  newTool: 'Delete'\n}\n"))
  await sync(dir)
  const m = es(dir)
  assert.strictEqual(m.helpLong, 'Click the map twice to start drawing.', 'stale text not shipped')
  assert.strictEqual(entry(dir, 'helpLong').src, 'stale')
  assert.strictEqual(m.joiner, undefined, 'deleted key removed')
  assert.strictEqual(m.newTool, 'Eliminar', 'new key picked up automatically')
  const rows = parseCsv(fs.readFileSync(path.join(dir, 'i18n/review/es.csv'), 'utf8'))
  assert.strictEqual(rows.find(x => x.key === 'helpLong').suggestion, 'Haga clic en el mapa para empezar a dibujar.')
})

test('import applies reviewed rows and protects placeholders', async () => {
  const dir = freshWidget()
  await sync(dir)
  const csv = path.join(dir, 'i18n/review/es.csv')
  const rows = parseCsv(fs.readFileSync(csv, 'utf8'))
  const lines = ['part,key,status,english,suggestion,translation,approve,notes']
  for (const r of rows) {
    if (r.key === 'helpLong') lines.push(`runtime,helpLong,missing,"${r.english}",,"Haga clic en el mapa.",,`)
    if (r.key === 'drawPoint') lines.push(`runtime,drawPoint,esri-check,"${r.english}","${r.suggestion}",,x,`)
  }
  lines.push('runtime,picked,missing,Selected {n} items,,"Seleccionados {count}",,')
  fs.writeFileSync(csv, lines.join('\n'))
  const res = importCsv(dir, csv)
  assert.strictEqual(res.applied, 2)
  assert.strictEqual(res.skipped.length, 1)
  await sync(dir)
  assert.strictEqual(es(dir).helpLong, 'Haga clic en el mapa.')
  assert.strictEqual(entry(dir, 'drawPoint').src, 'manual')
})

test('machine translation provider (LibreTranslate protocol) with placeholder guard', async () => {
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', c => { body += c })
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json')
      if (req.url === '/languages') return res.end(JSON.stringify([{ code: 'en', targets: ['es', 'fr'] }, { code: 'es', targets: ['en'] }]))
      const q = JSON.parse(body).q
      const tr = s => 'MT ' + s
      res.end(JSON.stringify({ translatedText: Array.isArray(q) ? q.map(tr) : tr(q) }))
    })
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${server.address().port}`
  try {
    const dir = freshWidget()
    const provider = loadProvider({ type: 'libretranslate', url })
    await sync(dir, { provider })
        assert.strictEqual(entry(dir, 'helpLong').src, 'machine')
    assert.strictEqual(es(dir).helpLong, 'MT Click the map to start drawing.')
    assert.strictEqual(es(dir).undo, 'Deshacer', 'Esri wins over machine')
    const rows = parseCsv(fs.readFileSync(path.join(dir, 'i18n/review/es.csv'), 'utf8'))
    assert.ok(rows.find(x => x.key === 'helpLong' && x.status === 'machine'), 'machine output stays in review')
  } finally { server.close() }
})

test('extract moves hardcoded English into default.ts (needs typescript)', (t) => {
  let ts
  try { ts = require('typescript') } catch (e) { return t.skip('typescript not installed') }
  void ts
  const { extractWidget } = require('../lib/extract')
  const dir = freshWidget()
  fs.writeFileSync(path.join(dir, 'src/runtime/widget.tsx'), [
    "export class W extends React.Component<any, any> {",
    "  nls = (id: string, v?: any) => id",
    "  render () {",
    "    const items = []",
    "    return <div title=\"Zoom to selection\">",
    "      <span>",
    "        {items.length} item{items.length !== 1 ? 's' : ''}",
    "      </span>",
    "      <button aria-label={`Draw line${this.state.on ? ' (active)' : ''}`}>Undo</button>",
    "      <code>{'{{length}}'}</code>",
    "    </div>",
    "  }",
    "}",
    "export const F = () => {",
    "  const t = (id: string, v?: any) => id",
    "  announceStatus(`Removed ${3} buffers`)",
    "  return <p>Opacity is {this.op}% now</p>",
    "}",
    ""
  ].join('\n'))
  const r = extractWidget(dir, { apply: true })
  const out = fs.readFileSync(path.join(dir, 'src/runtime/widget.tsx'), 'utf8')
  assert.match(out, /title=\{this\.nls\('zoomToSelection'\)\}/)
  assert.match(out, /items\.length !== 1 \? this\.nls\('itemsCountItems', \{ itemsCount: items\.length \}\) : this\.nls\('itemsCountItem'/)
  assert.match(out, /\{this\.nls\('undo'\)\}/, 'existing key reused')
  assert.match(out, /this\.state\.on \? this\.nls\('drawLineActive'\) : this\.nls\('drawLine'\)/)
  assert.match(out, /<code>\{'\{\{length\}\}'\}<\/code>/, 'code samples untouched')
  assert.match(out, /announceStatus\(t\('removedValueBuffers', \{ value: 3 \}\)\)/)
  const added = r.added.runtime
  assert.strictEqual(added.itemsCountItems, '{itemsCount} items')
  assert.strictEqual(added.itemsCountItem, '{itemsCount} item')
  const { loadDefaultTs } = require('../lib/loaders')
  const en = loadDefaultTs(path.join(dir, 'src/runtime/translations/default.ts'))
  assert.strictEqual(en.drawLineActive, 'Draw line (active)')
})

test('shared memory: build with a provider, then sync ships it (reviewed = community)', async () => {
  const { buildMemory, loadMemory } = require('../lib/memory')
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'exb-mem-'))
  fs.writeFileSync(path.join(work, 'sources.json'), JSON.stringify({ widgets: [{ name: 'w', files: [path.join(FIX, 'widget/src/runtime/translations/default.ts')] }] }))
  const provider = { name: 'fake', async translate (texts) { return texts.map(t => 'ES ' + t) } }
  await buildMemory({ sourcesFile: path.join(work, 'sources.json'), outDir: path.join(work, 'memory'), provider, locales: ['es'] })
  const memFile = path.join(work, 'memory/es.json')
  const mem = JSON.parse(fs.readFileSync(memFile, 'utf8'))
  assert.strictEqual(mem['Click the map to start drawing.'].t, 'ES Click the map to start drawing.')
  mem['Click the map to start drawing.'] = { t: 'Haga clic en el mapa.', reviewed: true }
  fs.writeFileSync(memFile, JSON.stringify(mem))
  // a second build never overwrites existing entries
  await buildMemory({ sourcesFile: path.join(work, 'sources.json'), outDir: path.join(work, 'memory'), provider, locales: ['es'] })
  assert.strictEqual(JSON.parse(fs.readFileSync(memFile, 'utf8'))['Click the map to start drawing.'].t, 'Haga clic en el mapa.')

  const dir = freshWidget()
  const memory = await loadMemory(path.join(work, 'memory'), ['es'])
  await sync(dir, { memory })
  assert.strictEqual(es(dir).helpLong, 'Haga clic en el mapa.')
  assert.strictEqual(es(dir).undo, 'Deshacer', 'Esri still wins over memory')
  const rows = parseCsv(fs.readFileSync(path.join(dir, 'i18n/review/es.csv'), 'utf8'))
  assert.ok(!rows.find(r => r.key === 'helpLong'), 'reviewed community entry not in review')
  assert.ok(rows.find(r => r.key === 'joiner' && r.status === 'machine'), 'unreviewed memory entry flagged')
})

test('sync without an Esri install (CI) keeps earlier Esri translations', async () => {
  const dir = freshWidget()
  await sync(dir)
  assert.strictEqual(es(dir).undo, 'Deshacer')
  await syncWidget(dir, { cfg: Object.assign({}, DEFAULTS), tm: null, provider: null, locales: ['es'] })
  assert.strictEqual(es(dir).undo, 'Deshacer', 'kept without TM')
  const def = path.join(dir, 'src/runtime/translations/default.ts')
  fs.writeFileSync(def, fs.readFileSync(def, 'utf8').replace("undo: 'Undo'", "undo: 'Undo last step'"))
  await syncWidget(dir, { cfg: Object.assign({}, DEFAULTS), tm: null, provider: null, locales: ['es'] })
  assert.strictEqual(es(dir).undo, 'Undo last step', 'changed English is not kept')
})


test('localize automatically wires runtime and creates settings translations', async (t) => {
  let ts
  try { ts = require('typescript') } catch (e) { return t.skip('typescript not installed') }
  const { backupAndExtract, restoreLatest } = require('../lib/localize')
  const dir = freshWidget()
  const runtime = path.join(dir, 'src/runtime/widget.tsx')
  const settings = path.join(dir, 'src/setting/setting.tsx')
  const settingDefault = path.join(dir, 'src/setting/translations/default.ts')
  const source = [
    "import { React } from 'jimu-core'",
    'const Widget = (props: any) => {',
    "  return <div title=\"Map Switcher\" aria-label={\`Choose from \${props.count} available maps\`}>",
    '    No sites configured.',
    '  </div>',
    '}',
    'export default Widget',
    ''
  ].join('\n')
  fs.writeFileSync(runtime, source)
  fs.mkdirSync(path.dirname(settings), { recursive: true })
  const settingSource = [
    "import { React } from 'jimu-core'",
    'const Setting = (props: any) => <div title="Carry basemap to next map">Add Site</div>',
    'export default Setting',
    ''
  ].join('\n')
  // Block-body components can be wired. Concise expressions are left alone.
  fs.writeFileSync(settings, settingSource.replace(
    'const Setting = (props: any) => <div title="Carry basemap to next map">Add Site</div>',
    'const Setting = (props: any) => { return <div title="Carry basemap to next map">Add Site</div> }'
  ))
  assert.ok(!fs.existsSync(settingDefault))
  const first = backupAndExtract(dir, {})
  assert.ok(first.backupDir)
  assert.ok(first.changed >= 2)
  const changedRuntime = fs.readFileSync(runtime, 'utf8')
  const changedSetting = fs.readFileSync(settings, 'utf8')
  assert.match(changedRuntime, /hooks as __exbI18nHooks/)
  assert.match(changedRuntime, /t\('mapSwitcher'\)/)
  assert.match(changedRuntime, /t\('noSitesConfigured'\)/)
  assert.match(changedSetting, /useTranslation\(__exbI18nMessages\)/)
  assert.ok(fs.existsSync(settingDefault))
  const settingsMessages = require('../lib/loaders').loadDefaultTs(settingDefault)
  assert.ok(Object.values(settingsMessages).includes('Add Site'))
  assert.strictEqual(ts.createSourceFile(runtime, changedRuntime, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX).parseDiagnostics.length, 0)
  assert.strictEqual(ts.createSourceFile(settings, changedSetting, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX).parseDiagnostics.length, 0)
  const second = backupAndExtract(dir, {})
  assert.strictEqual(second.changed, 0, 'repeat run must not rewrite already localized code')
  const restored = restoreLatest(dir)
  assert.ok(restored.restored.includes('src/runtime/widget.tsx'))
  assert.strictEqual(fs.readFileSync(runtime, 'utf8'), source)
  assert.strictEqual(fs.readFileSync(settings, 'utf8'), settingSource.replace(
    'const Setting = (props: any) => <div title="Carry basemap to next map">Add Site</div>',
    'const Setting = (props: any) => { return <div title="Carry basemap to next map">Add Site</div> }'
  ))
  assert.ok(!fs.existsSync(settingDefault), 'restore removes newly generated settings default')
})

test('extract respects the real translator in scope (rollout regressions, Oct 2026)', (t) => {
  let ts
  try { ts = require('typescript') } catch (e) { return t.skip('typescript not installed') }
  void ts
  const { extractWidget } = require('../lib/extract')
  const dir = freshWidget()
  const file = path.join(dir, 'src/runtime/widget.tsx')
  fs.writeFileSync(file, [
    "import { React } from 'jimu-core'",
    'export class W extends React.Component<any, any> {',
    '  nls = (id: string) => id',
    '  getTheme () { return {} }',
    '  render () {',
    '    const t = this.getTheme()',
    '    const n = 2',
    '    return <div title="Zoom to selection" aria-label={`Showing ${n} maps`}>{t ? 1 : 0}</div>',
    '  }',
    '}',
    'export const F = (props: any) => {',
    '  const t = React.useCallback((id: string, values?: Record<string, string>): string => id, [])',
    '  const count = 3',
    '  const list: string[] = []',
    '  return <ul aria-label={`Found ${count} matches`}>{list.map((t, i) => <li key={i} title={`Search again for ${t}`}>{t}</li>)}</ul>',
    '}',
    'export const H = ({ t, open }: any) => {',
    '  return <button title="Open help">{open}</button>',
    '}',
    'export const Quiet = () => {',
    '  return <span title="https://example.com">x</span>',
    '}',
    ''
  ].join('\n'))
  extractWidget(dir, { apply: true, autoWire: true })
  const out = fs.readFileSync(file, 'utf8')
  // A theme object called t is not a translator; this.nls is, but it takes no values.
  assert.match(out, /title=\{this\.nls\('zoomToSelection'\)\}/)
  assert.match(out, /aria-label=\{`Showing \$\{n\} maps`\}/, 'one-argument translator: sentence with a value left for a hand edit')
  // A translator typed Record<string, string> gets string values.
  assert.match(out, /t\('foundCountMatches', \{ count: String\(count\) \}\)/)
  // The .map((t, i) => ...) parameter shadows the translator: never call a string.
  assert.match(out, /title=\{`Search again for \$\{t\}`\}/)
  // Destructured t from props: no second `const t` wired in.
  assert.doesNotMatch(out, /const t = __exbI18nHooks/)
  assert.match(out, /title=\{t\('openHelp'\)\}/)
})

test('wire: English outside a translator, config defaults, jsx() props, messages reads (Oct 2026)', (t) => {
  let ts
  try { ts = require('typescript') } catch (e) { return t.skip('typescript not installed') }
  const { wireWidget } = require('../lib/wire')
  const dir = freshWidget()
  const file = path.join(dir, 'src/runtime/widget.tsx')
  fs.writeFileSync(file, [
    "import { React, jsx } from 'jimu-core'",
    "import defaultMessages from './translations/default'",
    'export default class Widget extends React.PureComponent<any, any> {',
    '  private t = (id: string, values?: Record<string, string>): string => {',
    '    let text: string = (defaultMessages as any)[id] ?? id',
    '    return text',
    '  }',
    '  getToolHint (tool: string): string {',
    '    switch (tool) {',
    "      case 'point': return 'Click on the map to place a point'",
    "      default: return ''",
    '    }',
    '  }',
    '  getToolLabel (tool: string): string {',
    "    return this.props.config.freehandText || 'Freehand Area'",
    '  }',
    '  render () {',
    "    const label = this.props.label || 'Freehand Line'",
    "    const isFreehand = label.includes('Freehand Line')",
    "    const tools = [{ tool: 'point', label: 'Point tool' }]",
    "    return jsx('div', { title: 'Mailing Labels', children: [defaultMessages.undo, 'Select features first', this.getToolHint('point')] })",
    '  }',
    '}',
    ''
  ].join('\n'))
  const helper = path.join(dir, 'src/runtime/components/Hint.tsx')
  fs.mkdirSync(path.dirname(helper), { recursive: true })
  fs.writeFileSync(helper, "import { React } from 'jimu-core'\nexport const Hint = () => <p title=\"Dismiss hint\">New here?</p>\n")
  wireWidget(dir, { apply: true })
  const out = fs.readFileSync(file, 'utf8')
  const hint = fs.readFileSync(helper, 'utf8')
  const def = fs.readFileSync(path.join(dir, 'src/runtime/translations/default.ts'), 'utf8')
  assert.ok(fs.existsSync(path.join(dir, 'src/runtime/i18n-t.ts')), 'helper written next to translations')
  assert.match(out, /import \{ [^}]*__setIntl[^}]* \} from '\.\/i18n-t'/)
  assert.match(out, /render \(\) \{\n {4}__setIntl\(\(this\.props as any\)\.intl\)/, 'entry hands its intl to the helper')
  assert.match(out, /return __t\("clickOnTheMapToPlace"\)/, 'label/hint helper returns, including inside switch cases')
  assert.match(out, /__tc\(this\.props\.config\.freehandText, "freehandArea"\)/, 'config default stays overridable')
  assert.match(out, /'Freehand Line'/, 'a string the file compares against is left alone')
  assert.match(out, /title: __t\("mailingLabels"\)/, 'jsx() props')
  assert.match(out, /__t\("selectFeaturesFirst"\)/, 'jsx() children arrays')
  assert.match(out, /__m\.undo/, 'direct messages read follows the app language')
  assert.match(out, /\{ const __i = __tryIntl\(id, values\); if \(__i !== undefined\) return __i \}/, 'translator asks intl first')
  assert.match(out, /label: __t\("pointTool"\)/)
  assert.match(hint, /import \{ __t \} from '\.\.\/i18n-t'/, 'child modules import the shared helper')
  assert.match(hint, /\{__t\("newHere"\)\}/)
  assert.match(def, /freehandArea: 'Freehand Area'/)
  for (const f of [file, helper, path.join(dir, 'src/runtime/i18n-t.ts')]) {
    const d = ts.transpileModule(fs.readFileSync(f, 'utf8'), { reportDiagnostics: true, fileName: f, compilerOptions: { jsx: ts.JsxEmit.React } }).diagnostics
    assert.strictEqual(d.length, 0, f + ' parses')
  }
  // Second run: nothing left, nothing doubled.
  const again = wireWidget(dir, { apply: true })
  assert.strictEqual(again.results.filter(r => r.changed).length, 0)
  // restore puts the originals back
  const { restoreLatest } = require('../lib/localize')
  restoreLatest(dir)
  assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /__t\(/)
  assert.ok(!fs.existsSync(path.join(dir, 'src/runtime/i18n-t.ts')))
})

test('UI flow follows local helper parameters, aliases and notification arguments safely', () => {
  const ts = require('typescript')
  const { wireWidget } = require('../lib/wire')
  const { auditWidget } = require('../lib/audit')
  const dir = freshWidget()
  const file = path.join(dir, 'src/runtime/widget.tsx')
  fs.writeFileSync(file, `import { jsx } from 'jimu-core'
export default function Widget(props: any) {
  const panel = (key: string, title: string, body: any) => jsx('div', {key, children: [title, body]})
  const wrapper = (key: string, heading: string) => panel(key, heading, null)
  const heading = 'Draw selection'
  const alias = heading
  const showMessage = (severity: string, message: string) => console.log(severity, message)
  const customNotice = (code: string, text: string) => console.log(code, text)
  showMessage('success', 'Features selected')
  customNotice('Saved ID', 'Selection saved')
  console.log('Debug output')
  return wrapper('Panel ID', alias)
}
`)
  const opts = {sinkArgs: {customNotice: [1]}}
  const before = auditWidget(dir, opts)
  for (const text of ['Draw selection', 'Features selected', 'Selection saved']) assert.ok(before.findings.some(f => f.text === text), text)
  for (const text of ['Panel ID', 'Saved ID', 'Debug output']) assert.ok(!before.findings.some(f => f.text === text), text)
  wireWidget(dir, {...opts, apply: true})
  const out = fs.readFileSync(file, 'utf8')
  assert.match(out, /const heading = __t\("drawSelection"\)/)
  assert.match(out, /showMessage\('success', __t\("featuresSelected"\)\)/)
  assert.match(out, /customNotice\('Saved ID', __t\("selectionSaved"\)\)/)
  assert.match(out, /wrapper\('Panel ID', alias\)/)
  assert.strictEqual(auditWidget(dir, opts).findings.length, 0)
  assert.strictEqual(auditWidget(dir, opts).missing.length, 0)
  assert.strictEqual(wireWidget(dir, {...opts, apply: true}).results.filter(r => r.changed).length, 0)
  assert.strictEqual(ts.transpileModule(out, {fileName: file, reportDiagnostics: true}).diagnostics.length, 0)
})

test('UI metadata in array callbacks and complete concatenated sentences', () => {
  const {wireWidget} = require('../lib/wire')
  const {auditWidget} = require('../lib/audit')
  const dir=freshWidget(), file=path.join(dir,'src/runtime/widget.tsx')
  fs.writeFileSync(file, `import {jsx} from 'jimu-core'
export default function Widget(props: any) {
  const options = [{value: 'sheet-id', detail: 'Full sheet label'}]
  const current = options.find(o => o.value === props.value)?.detail
  const setError = (value: string) => console.log(value)
  setError('Importing "' + props.filename + '" replaces the current settings. Continue?')
  return jsx('div', {title: current, children: options.map(o => jsx('span', {children: o.detail}))})
}
`)
  assert.ok(auditWidget(dir).findings.some(f=>f.text==='Full sheet label'))
  wireWidget(dir,{apply:true})
  const out=fs.readFileSync(file,'utf8')
  assert.match(out,/detail: __t\("fullSheetLabel"\)/)
  assert.match(out,/setError\(__t\([^\n]+value1: props.filename/)
  assert.match(out,/value: 'sheet-id'/)
  assert.strictEqual(auditWidget(dir).findings.length,0)
  assert.strictEqual(wireWidget(dir,{apply:true}).results.filter(r=>r.changed).length,0)
})

test('module UI metadata uses getters and follows locale changes after import', () => {
  const vm = require('vm'), ts = require('typescript')
  const {wireWidget,helperSource}=require('../lib/wire')
  const {auditWidget}=require('../lib/audit')
  const dir=freshWidget(), file=path.join(dir,'src/runtime/metadata.ts')
  fs.writeFileSync(file,"export const formats = [{value: 'format-id', description: 'Full sheet label'}]\n")
  wireWidget(dir,{apply:true})
  const source=fs.readFileSync(file,'utf8')
  assert.match(source,/get description \(\) \{ return __t\("fullSheetLabel"\) \}/)
  const helperContext={exports:{},require:()=>({default:{fullSheetLabel:'Full sheet label'}})}
  vm.runInNewContext(ts.transpileModule(helperSource('./translations/default'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,helperContext)
  const ctx={exports:{},require:()=>helperContext.exports}
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,ctx)
  assert.equal(ctx.exports.formats[0].description,'Full sheet label')
  helperContext.exports.__setIntl({formatMessage:()=> 'Étiquette pleine page'})
  assert.equal(ctx.exports.formats[0].description,'Étiquette pleine page')
  helperContext.exports.__setIntl({formatMessage:()=> 'Etiqueta de página completa'})
  assert.equal(ctx.exports.formats[0].description,'Etiqueta de página completa')
  assert.equal(auditWidget(dir).findings.length,0)
  assert.equal(wireWidget(dir,{apply:true}).results.filter(r=>r.changed).length,0)
})

test('destructured metadata bindings preserve IDs and translate displayed details', () => {
  const {wireWidget}=require('../lib/wire'), {auditWidget}=require('../lib/audit')
  const dir=freshWidget(),file=path.join(dir,'src/runtime/widget.tsx')
  fs.writeFileSync(file,`import {jsx} from 'jimu-core'
export default function Widget(props: any) {
 const options=[{id: 'Option ID', detail: 'Return address labels'}]
 return jsx('div', {children: options.map(({id, detail: caption}) => jsx('span', {key:id, children:caption}))})
}`)
  assert.ok(auditWidget(dir).findings.some(f=>f.text==='Return address labels'))
  wireWidget(dir,{apply:true})
  assert.match(fs.readFileSync(file,'utf8'),/detail: __t\("returnAddressLabels"\)/)
  assert.match(fs.readFileSync(file,'utf8'),/id: 'Option ID'/)
  assert.equal(auditWidget(dir).findings.length,0)
})

test('fixed English number/date locales are flagged and can opt into app locale', () => {
 const {wireWidget}=require('../lib/wire'),{auditWidget}=require('../lib/audit')
 const dir=freshWidget(),file=path.join(dir,'src/runtime/widget.tsx')
 fs.writeFileSync(file,`import {jsx} from 'jimu-core'
export default function Widget(props: any) {
 const amount=props.amount.toLocaleString('en-US', {style:'currency', currency:'USD'})
 const date=new Date(props.date).toLocaleDateString('en-US', {month:'long'})
 return jsx('div', {children:[date,amount]})
}`)
 assert.equal(auditWidget(dir).findings.filter(f=>f.kind==='locale').length,2)
 wireWidget(dir,{apply:true})
 assert.match(fs.readFileSync(file,'utf8'),/'en-US'/,'fixed format remains unless opted in')
 wireWidget(dir,{apply:true,localizeFormats:true})
 const out=fs.readFileSync(file,'utf8')
 assert.doesNotMatch(out,/'en-US'/)
 assert.match(out,/currency:'USD'/)
 assert.match(out,/month:'long'/)
 assert.match(out,/toLocaleDateString\(__locale\(\)/)
 assert.match(fs.readFileSync(path.join(dir,'src/runtime/i18n-t.ts'),'utf8'),/export function __locale/)
 assert.equal(auditWidget(dir).findings.length,0)
 assert.equal(wireWidget(dir,{apply:true,localizeFormats:true}).results.filter(r=>r.changed).length,0)
})

test('local UI return helpers and dynamically indexed labels are discovered', () => {
 const {wireWidget}=require('../lib/wire'),{auditWidget}=require('../lib/audit')
 const dir=freshWidget(),file=path.join(dir,'src/runtime/widget.tsx')
 fs.writeFileSync(file,`import {jsx} from 'jimu-core'
const labels={ok:'Address matched',missing:'No address found'}
function formatWhen(date: Date) { return 'Yesterday, ' + date.toLocaleTimeString() }
export default function Widget(props: any) {
 return jsx('div', {children:[labels[props.status],formatWhen(props.date)]})
}`)
 const before=auditWidget(dir)
 assert.ok(before.findings.some(f=>f.text==='Address matched'))
 assert.ok(before.findings.some(f=>f.text.includes('Yesterday')))
 wireWidget(dir,{apply:true,localizeFormats:true})
 // A containing sentence rewrite can cover a child formatting edit; repeat is
 // deliberately supported and must converge without duplicate captures.
 wireWidget(dir,{apply:true,localizeFormats:true})
 const out=fs.readFileSync(file,'utf8')
 assert.match(out,/get ok \(\)/)
 assert.match(out,/toLocaleTimeString\(__locale\(\)\)/)
 assert.equal(auditWidget(dir).findings.length,0)
 assert.equal(wireWidget(dir,{apply:true,localizeFormats:true}).results.filter(r=>r.changed).length,0)
})

test('runtime and settings catalogs stay separate and backups sort by timestamp', () => {
 const {auditWidget}=require('../lib/audit'),{restoreLatest}=require('../lib/localize')
 const dir=freshWidget(),setting=path.join(dir,'src/setting/translations')
 fs.mkdirSync(setting,{recursive:true});fs.writeFileSync(path.join(setting,'default.ts'),"export default {settingOnly: 'Settings only'}\n")
 fs.writeFileSync(path.join(dir,'src/runtime/widget.tsx'),"import {__t} from './i18n-t'\nexport const text=__t('settingOnly')\n")
 const a=auditWidget(dir)
 assert.ok(a.missing.includes('settingOnly'))
 assert.ok(a.findings.some(f=>f.kind==='timing'))
 const root=path.join(dir,'i18n/backup')
 for(const[name,text]of [['2030-01-01T01-01-01-wire','older'],['2030-01-01T01-01-01-100Z-abcd-wire','newer']]) {
  const d=path.join(root,name,'src/runtime');fs.mkdirSync(d,{recursive:true});fs.writeFileSync(path.join(d,'widget.tsx'),text)
 }
 restoreLatest(dir)
 assert.equal(fs.readFileSync(path.join(dir,'src/runtime/widget.tsx'),'utf8'),'newer')
})
