#!/usr/bin/env node
'use strict'
const fs = require('fs')
const path = require('path')
const { loadConfig } = require('../lib/config')
const { parseLocaleList } = require('../lib/locales')
const { harvest, findClient } = require('../lib/harvest')
const { syncWidget, neededKeys, isWidgetFolder, readLock, discoverParts } = require('../lib/sync')
const { importCsv } = require('../lib/import')
const { auditWidget, formatAudit } = require('../lib/audit')
const { loadProvider } = require('../lib/mt')
const { loadDefaultTs } = require('../lib/loaders')
const { loadCldr, addCldrToTm } = require('../lib/cldr')
const { loadMemory, buildMemory } = require('../lib/memory')
const pkg = require('../package.json')

const HELP = `exb-i18n ${pkg.version}  Localization for ArcGIS Experience Builder custom widgets

Usage
  exb-i18n localize <widget>                             do it all: extract + sync + report (backs up first)
  exb-i18n restore  <widget>                             undo the last localize/extract/wire
  exb-i18n wire   <widget-or-widgets-folder> [--apply]   second pass: English outside any translator, config
                                                         defaults, jsx() props, direct messages reads (then sync)
  exb-i18n sync   <widget-or-widgets-folder> [options]   create/update locale files
  exb-i18n watch  <widget-or-widgets-folder> [options]   sync again whenever a default.ts changes
  exb-i18n review <widget-or-widgets-folder> [--locales es]  sync, then write i18n/review/<locale>.csv sheets
  exb-i18n audit  <widget-or-widgets-folder> [--strict]  list English that is not in default.ts
  exb-i18n extract <widget-folder> [--apply] [--prefix x]  move hardcoded English into default.ts
  exb-i18n import <widget-folder> <review.csv> [--locale es]  apply a reviewed sheet, then sync
  exb-i18n check  <widget-or-widgets-folder>             CI: fail when locale files are out of date
  exb-i18n status <widget-or-widgets-folder>             coverage per locale
  exb-i18n lookup "<English text>" [--locale es]          what Esri ships for a string
  exb-i18n memory-build --sources memory/sources.json --provider libretranslate   (GitHub Action)

A path that holds a manifest.json is one widget. Any other folder (for example
client\\your-extensions\\widgets) is scanned for widgets; Esri widgets are skipped.

Options
  --client <path>        EB client folder (auto-detected from the widget path)
  --locales <list>       all (default) or e.g. es,fr,de,pt-br
  --provider <name|file> libretranslate, or a .js provider module (default: none)
  --lt-url <url>         LibreTranslate server (default http://localhost:5000)
  --no-ship-machine      keep machine translations out of locale files (review only)
  --tm <folder>          extra folder of trusted translations (repeatable)
  --memory <url|folder>  shared translation memory (default: the exb-i18n-kit repo on GitHub)
  --no-memory            skip the shared translation memory
  --no-cldr              skip Unicode CLDR unit names (downloaded once, cached in ~/.exb-i18n)
  --cldr-tarball <tgz>   use a local cldr-units-full .tgz (offline machines)
  --dry-run              report only, write nothing
  --localize-formats     wire/localize: replace fixed English date/number locales with the app locale
  --no-wire              localize: skip the wire pass
  --json                 machine-readable output (audit, status)
  --strict               audit/check exit with code 1 when anything is found

Config: exb-i18n.config.json in the widget, widgets or your-extensions folder.`

function parseArgs (argv) {
  const out = { _: [], tm: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) { out._.push(a); continue }
    const [k, inline] = a.slice(2).split('=')
    const flag = k.replace(/-([a-z])/g, (m, c) => c.toUpperCase())
    if (['dryRun', 'json', 'strict', 'noShipMachine', 'noCldr', 'noMemory', 'refreshCldr', 'apply', 'help', 'version', 'noWire', 'localizeFormats'].includes(flag)) { out[flag] = true; continue }
    const v = inline !== undefined ? inline : argv[++i]
    if (flag === 'tm') out.tm.push(v)
    else out[flag] = v
  }
  return out
}

function widgetTargets (target, cfg) {
  const abs = path.resolve(target || '.')
  if (!fs.existsSync(abs)) throw new Error(`Not found: ${abs}`)
  if (fs.existsSync(path.join(abs, 'manifest.json'))) return [abs]
  const out = []
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'node_modules' || e.name.startsWith('_')) continue
    const d = path.join(abs, e.name)
    if (!isWidgetFolder(d) || (cfg.exclude || []).includes(e.name)) continue
    const m = JSON.parse(fs.readFileSync(path.join(d, 'manifest.json'), 'utf8').replace(/^﻿/, ''))
    // Esri's own widgets are skipped, but a customized fork with Esri in the author line
    // (map-layers-custom: "Esri R&D Center Beijing (customized)") is ours once it has a lock.
    if (typeof m.author === 'string' && /^esri\b/i.test(m.author.trim()) && !fs.existsSync(path.join(d, 'i18n', 'translations.lock.json'))) continue
    if (discoverParts(d).length) out.push(d)
  }
  return out
}

function buildCfg (args, target) {
  const cli = {}
  if (args.client) cli.client = path.resolve(args.client)
  if (args.locales) cli.locales = args.locales
  if (args.noShipMachine) cli.shipMachine = false
  if (args.noCldr) cli.cldr = false
  if (args.noMemory) cli.memory = false
  else if (args.memory) cli.memory = /^https?:/i.test(args.memory) ? args.memory : path.resolve(args.memory)
  if (args.provider) cli.provider = args.provider === 'libretranslate' ? { type: 'libretranslate', url: args.ltUrl } : { type: path.resolve(args.provider) }
  else if (args.ltUrl) cli.provider = { type: 'libretranslate', url: args.ltUrl }
  const cfg = loadConfig(path.resolve(target || '.'), cli)
  if (args.tm.length) cfg.extraTm = [...(cfg.extraTm || []), ...args.tm.map(p => path.resolve(p))]
  if (!cfg.client) cfg.client = findClient(path.resolve(target || '.'))
  return cfg
}

async function runSync (targets, cfg, args, log, writeReview) {
  const locales = parseLocaleList(cfg.locales)
  const needed = new Set()
  for (const w of targets) for (const k of neededKeys(w)) needed.add(k)
  let tm = null
  try {
    tm = harvest(cfg.client, { needed, extra: cfg.extraTm, log })
  } catch (e) {
    log(cfg.client ? `! ${e.message}` : 'No Experience Builder install here: keeping the Esri translations already in the locale files; new strings come from the shared memory.')
  }
  if (tm) await addCldr(tm, cfg, args, log)
  let memory = null
  if (cfg.memory !== false) {
    try { memory = await loadMemory(typeof cfg.memory === 'string' ? cfg.memory : null, locales, log) } catch (e) { log(`! translation memory unavailable (${e.message})`) }
  }
  const provider = loadProvider(cfg.provider, process.cwd())
  if (provider) log(`Machine translation: ${provider.name || 'custom provider'}${cfg.shipMachine ? '' : ' (review only)'}`)
  const reports = []
  for (const w of targets) {
    const r = await syncWidget(w, { cfg, tm, provider, memory, locales, log, dryRun: !!args.dryRun, writeReview: writeReview || cfg.reviewFiles === true })
    reports.push(r)
    const t = r.totals
    const total = Object.values(t).reduce((a, b) => a + b, 0)
    const done = (t.esri || 0) + (t['esri-check'] || 0) + (t.community || 0) + (t.manual || 0) + (t.existing || 0) + (t.machine || 0)
    log(`${r.widget}: ${r.skipped ? 'skipped (' + r.skipped + ')' : `${total ? Math.round(done / total * 100) : 0}% translated across ${locales.length} locales; esri ${t.esri || 0}, check ${t['esri-check'] || 0}, community ${t.community || 0}, manual ${(t.manual || 0) + (t.existing || 0)}, machine ${t.machine || 0}, stale ${t.stale || 0}, missing ${t.missing || 0}; ${r.written.length} file(s) written`}`)
  }
  return reports
}

async function addCldr (tm, cfg, args, log) {
  if (cfg.cldr === false) return
  try {
    const cache = await loadCldr({ tarball: args.cldrTarball || cfg.cldrTarball, refresh: !!args.refreshCldr, log })
    const n = addCldrToTm(tm, cache)
    if (n) log(`Added Unicode CLDR ${cache.version} unit names.`)
  } catch (e) {
    log(`! CLDR unit names unavailable (${e.message}). Continuing without them; pass --cldr-tarball <cldr-units-full.tgz> on offline machines.`)
  }
}

function statusOf (widgetDir) {
  const lock = readLock(widgetDir)
  const rows = {}
  for (const part of Object.keys(lock.parts)) {
    for (const [loc, l] of Object.entries(lock.parts[part].locales || {})) {
      const r = rows[loc] = rows[loc] || { total: 0, done: 0, review: 0 }
      const c = l.counts || {}
      for (const [st, n] of Object.entries(c)) {
        r.total += n
        if (['esri', 'esri-check', 'community', 'manual', 'existing', 'machine'].includes(st)) r.done += n
        if (['missing', 'stale', 'machine', 'esri-check'].includes(st)) r.review += n
      }
    }
  }
  return rows
}

function checkWidget (widgetDir, locales) {
  const { englishHash } = require('../lib/sync')
  const lock = readLock(widgetDir)
  const problems = []
  for (const p of discoverParts(widgetDir)) {
    const en = loadDefaultTs(path.join(p.dir, 'default.ts'))
    const keys = Object.keys(en).filter(k => typeof en[k] === 'string')
    const lp = lock.parts[p.part]
    if (!lp) { problems.push(`${p.part}: never synced`); continue }
    if (lp.en !== englishHash(en, keys)) problems.push(`${p.part}: default.ts changed since the last sync (new, edited or deleted strings)`)
    for (const loc of locales) {
      if (!fs.existsSync(path.join(p.dir, `${loc}.js`))) problems.push(`${p.part}: ${loc}.js missing`)
    }
  }
  return problems
}

async function main () {
  const args = parseArgs(process.argv.slice(2))
  const [cmd, target, extra] = args._
  if (args.version) return console.log(pkg.version)
  if (!cmd || args.help || cmd === 'help') return console.log(HELP)
  const log = (m) => console.log(m)

  if (cmd === 'lookup') {
    const cfg = buildCfg(args, '.')
    const text = target
    const { norm, looseNorm } = require('../lib/match')
    const tm = harvest(cfg.client, { needed: new Set([norm(text), 'L:' + looseNorm(text)]), extra: cfg.extraTm, log })
    await addCldr(tm, cfg, args, log)
    const locales = parseLocaleList(args.locale || cfg.locales)
    const { adapt } = require('../lib/match')
    for (const loc of locales) {
      const c = tm.lookup(text, loc)
      console.log(`${loc.padEnd(6)} ${c.length ? c.slice(0, 4).map(x => `${adapt(text, x.text, x.en, loc) || '(rejected) ' + x.text} [${x.count}x ${x.sources.slice(0, 2).join(',')}]`).join('  |  ') : '-'}`)
    }
    return
  }

  if (cmd === 'memory-build') {
    const cfg = buildCfg(args, '.')
    const provider = loadProvider(cfg.provider, process.cwd())
    if (!provider) throw new Error('memory-build needs a provider, e.g. --provider libretranslate --lt-url http://localhost:5000')
    await buildMemory({ sourcesFile: path.resolve(args.sources || 'memory/sources.json'), outDir: path.resolve(args.out || 'memory'), provider, locales: parseLocaleList(cfg.locales), log, max: args.max ? Number(args.max) : Infinity })
    return
  }

  const cfg = buildCfg(args, target)
  const targets = cmd === 'import' ? [path.resolve(target)] : widgetTargets(target, cfg)
  if (!targets.length) throw new Error('No custom widgets with src/runtime/translations/default.ts found there.')

  if (cmd === 'sync') {
    await runSync(targets, cfg, args, log)
  } else if (cmd === 'review') {
    await runSync(targets, cfg, args, log, true)
    for (const w of targets) log(`Review sheets: ${path.join(w, 'i18n', 'review')}  (open in Excel, fill "translation" or put x in "approve", then exb-i18n import)`)
  } else if (cmd === 'watch') {
    log(`Watching ${targets.length} widget(s). Edit any default.ts and the locale files follow. Ctrl+C to stop.`)
    await runSync(targets, cfg, args, log)
    const timers = new Map()
    for (const w of targets) {
      for (const p of discoverParts(w)) {
        const f = path.join(p.dir, 'default.ts')
        // watchFile polls, which also works on network drives and OneDrive folders.
        fs.watchFile(f, { interval: 1000 }, () => {
          clearTimeout(timers.get(w))
          timers.set(w, setTimeout(() => {
            log(`\n${new Date().toLocaleTimeString()} ${path.relative(path.dirname(w), f)} changed`)
            runSync([w], cfg, args, log).catch(e => log('! ' + e.message))
          }, 400))
        })
      }
    }
  } else if (cmd === 'audit') {
    let found = 0
    const all = []
    for (const w of targets) {
      const r = auditWidget(w, { client: cfg.client, sinks: cfg.sinks, sinkArgs: cfg.sinkArgs })
      found += r.findings.length + r.missing.length
      all.push(r)
      if (!args.json) console.log(formatAudit(r) + '\n')
    }
    if (args.json) console.log(JSON.stringify(all, null, 2))
    if (args.strict && found) process.exitCode = 1
  } else if (cmd === 'localize') {
    const { backupAndExtract } = require('../lib/localize')
    const { auditWidget } = require('../lib/audit')
    for (const w of targets) {
      const name = path.basename(w)
      log(`\n== ${name} ==`)
      log('1/3 Moving hardcoded English into translations/default.ts')
      const { result, backupDir, changed } = backupAndExtract(w, { client: cfg.client, prefix: args.prefix || cfg.prefix, sinks: cfg.sinks, sinkArgs: cfg.sinkArgs })
      const edits = result.results.reduce((n, r) => n + r.edits.length, 0)
      const skipped = result.results.flatMap(r => r.skipped)
      const added = Object.values(result.added).reduce((n, a) => n + Object.keys(a).length, 0)
      log(`    ${edits} change(s) in ${changed} file(s), ${added} new key(s)${backupDir ? `; originals saved in ${path.relative(w, backupDir)}` : ''}`)
      if (!args.noWire) {
        const { wireWidget } = require('../lib/wire')
        const wr = wireWidget(w, { client: cfg.client, sinks: cfg.sinks, sinkArgs: cfg.sinkArgs, localizeFormats: args.localizeFormats || cfg.localizeFormats, apply: true })
        const files = (wr.results || []).filter(r => r.changed).length
        const keys = Object.values(wr.added || {}).reduce((n, a) => n + Object.keys(a).length, 0)
        if (files) log(`    wire: ${files} more file(s), ${keys} new key(s) (English outside a translator, config defaults, messages reads)`)
        for (const r of wr.results || []) for (const p of r.report) if (/by hand/.test(p.why)) log(`    hand edit: ${r.rel}: ${p.why}`)
      }
      log('2/3 Writing language files')
      await runSync([w], cfg, args, log)
      log('3/3 Checking what is left')
      const a = auditWidget(w, { client: cfg.client, sinks: cfg.sinks, sinkArgs: cfg.sinkArgs })
      if (!skipped.length && !a.findings.length && !a.missing.length) log('    No remaining findings in the supported static patterns. Test the UI in your target languages.')
      for (const s of skipped) log(`    hand edit: ${s.file}:${s.line}  ${s.why}  ${s.text}`)
      if (a.missing.length) log(`    keys used in code but missing from default.ts: ${a.missing.join(', ')}`)
      if (skipped.some(s => /translator/.test(s.why))) log('    "no translator in scope": see docs/WIRING.md, add one, then run localize again.')
    }
    log('\nNext: review the changes (git diff), test with ?locale=es, then add your widget to memory/sources.json for community translations.')
    log('Undo: exb-i18n restore <widget>')
  } else if (cmd === 'restore') {
    const { restoreLatest } = require('../lib/localize')
    for (const w of targets) {
      const r = restoreLatest(w)
      log(`${path.basename(w)}: restored ${r.restored.length} file(s) from i18n/backup/${r.from}. Run sync to refresh the language files.`)
    }
  } else if (cmd === 'wire') {
    const { wireWidget, formatWire } = require('../lib/wire')
    for (const w of targets) {
      const r = wireWidget(w, { client: cfg.client, sinks: cfg.sinks, sinkArgs: cfg.sinkArgs, localizeFormats: args.localizeFormats || cfg.localizeFormats, apply: !!args.apply })
      log(formatWire(r, !!args.apply))
      if (!args.apply && args.json) console.log(JSON.stringify(r.results.flatMap(x => x.report.map(p => Object.assign({ file: x.rel }, p))), null, 2))
    }
    log(args.apply ? 'Next: exb-i18n sync <folder>, type check, then test ?locale=es. Undo: exb-i18n restore <widget>' : 'Dry run. Add --apply to write (originals go to i18n/backup).')
  } else if (cmd === 'extract') {
    const { extractWidget, formatExtract } = require('../lib/extract')
    for (const w of targets) {
      const r = extractWidget(w, { client: cfg.client, apply: !!args.apply, prefix: args.prefix || cfg.prefix, sinks: cfg.sinks, sinkArgs: cfg.sinkArgs })
      console.log(`${path.basename(w)}\n` + formatExtract(r, !!args.apply) + '\n')
    }
    if (args.apply) log('Next: review the diff in git, then run exb-i18n sync.')
  } else if (cmd === 'import') {
    if (!extra) throw new Error('Usage: exb-i18n import <widget-folder> <review.csv> [--locale es]')
    const r = importCsv(targets[0], path.resolve(extra), args.locale)
    log(`Imported ${r.applied} translation(s) for ${r.locale}.`)
    for (const s of r.skipped) log(`  skipped ${s}`)
    if (r.applied) await runSync(targets, cfg, args, log)
  } else if (cmd === 'check') {
    let bad = 0
    for (const w of targets) {
      const problems = checkWidget(w, parseLocaleList(cfg.locales))
      bad += problems.length
      log(`${path.basename(w)}: ${problems.length ? problems.length + ' problem(s)' : 'up to date'}`)
      for (const p of problems.slice(0, 20)) log('  ' + p)
      if (problems.length > 20) log(`  ... +${problems.length - 20} more`)
    }
    if (bad) { log('\nRun: exb-i18n sync <folder>'); process.exitCode = 1 }
  } else if (cmd === 'status') {
    const all = {}
    for (const w of targets) all[path.basename(w)] = statusOf(w)
    if (args.json) return console.log(JSON.stringify(all, null, 2))
    for (const [name, rows] of Object.entries(all)) {
      console.log(`\n${name}`)
      if (!Object.keys(rows).length) { console.log('  not synced yet'); continue }
      for (const [loc, r] of Object.entries(rows)) console.log(`  ${loc.padEnd(6)} ${String(Math.round(r.done / r.total * 100)).padStart(3)}%  ${r.done}/${r.total}  review ${r.review}`)
    }
  } else {
    console.log(HELP)
    process.exitCode = 1
  }
}

main().catch(e => { console.error('exb-i18n: ' + e.message); process.exitCode = 1 })
