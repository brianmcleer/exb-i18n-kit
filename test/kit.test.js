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
  assert.match(changedRuntime, /t\('_widgetLabel'\)/)
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
