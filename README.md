# exb-i18n-kit

Localize ArcGIS Experience Builder custom widgets the way Esri's own widgets are localized, using the translations Esri already ships.

Experience Builder runs in 40 languages. Esri's out-of-the-box widgets switch language with the user's ArcGIS profile, the browser, the `?locale=` URL parameter or the [Language Switcher](https://doc.arcgis.com/en/experience-builder/latest/configure-widgets/language-switcher-widget.htm) widget. Most custom widgets stay in English because writing 39 locale files by hand is not realistic. This kit does the repeatable part for any widget:

1. **audit** finds English that is still hardcoded in your source.
2. **extract** moves it into `translations/default.ts` and rewrites the source to call your translator.
3. **sync** writes `translations/<locale>.js` for all 39 locales, filled from Esri's own translations, and keeps them current as the widget changes.
4. **review** and **import** handle the strings Esri does not ship: a spreadsheet per language for a person (or an optional machine translation server) to fill in.

No runtime code is added to your widget. The output is the same file format Esri's widgets use, so Experience Builder loads it on its own.

- Zero dependencies. Node 18 or later (Experience Builder already needs Node).
- Works on one widget or a whole `your-extensions\widgets` folder.
- Nothing from Esri is redistributed. Each developer harvests from their own licensed Experience Builder install.

Reference implementation: [Draw Advanced](https://github.com/brianmcleer/draw-advanced-widget) 4.6.0.

---

## Quick start

From a **Command Prompt** (no elevation needed), with the kit cloned anywhere:

```bat
git clone https://github.com/brianmcleer/exb-i18n-kit.git
cd exb-i18n-kit

rem 1. What is still hardcoded?
node bin\exb-i18n.js audit "C:\arcgis-experience-builder-1.21\client\your-extensions\widgets\my-widget"

rem 2. Move it into default.ts (dry run first, then --apply). Review the diff in git.
node bin\exb-i18n.js extract "C:\arcgis-experience-builder-1.21\client\your-extensions\widgets\my-widget"
node bin\exb-i18n.js extract "C:\arcgis-experience-builder-1.21\client\your-extensions\widgets\my-widget" --apply

rem 3. Generate all 39 locale files and update manifest.json translatedLocales
node bin\exb-i18n.js sync "C:\arcgis-experience-builder-1.21\client\your-extensions\widgets\my-widget"
```

Restart `pnpm start` in the client folder, open the app with `?locale=es`, and the widget answers in Spanish wherever Esri has the words.

Optional: `npm link` inside the kit folder puts `exb-i18n` on your PATH so you can drop the `node bin\exb-i18n.js` prefix.

## Keeping it current (the "dynamic" part)

Add a tool, rename a button, delete a dialog: run `sync` again, or leave `watch` running next to `pnpm start`:

```bat
node bin\exb-i18n.js watch "C:\arcgis-experience-builder-1.21\client\your-extensions\widgets"
```

Every time any widget's `default.ts` is saved, its 39 locale files follow within a second:

| Change in `default.ts` | What sync does |
|---|---|
| New key | Looks it up in Esri's translations; English until someone translates it |
| English text edited | Earlier human or machine translations are marked **stale** and stop shipping (English shows) until reviewed |
| Key deleted | Removed from every locale file |
| Locale file edited by hand | Kept as a manual translation |
| New Experience Builder release | Re-run sync; Esri's newer translations are picked up automatically |

`sync` is incremental and safe to run any time. State lives in `<widget>\i18n\translations.lock.json` (small: only human, machine and stale entries are stored). `i18n\STATUS.md` shows coverage per language.

Point any command at a folder of widgets and it handles every custom widget inside (widgets authored by Esri are skipped).

## Where translations come from

In order of trust:

1. **Esri, Experience Builder**: `client\dist\jimu-*` framework strings and every out-of-the-box widget (`client\dist\widgets`).
2. **Esri, ArcGIS Maps SDK, Calcite and map components**: the `t9n` bundles in `client\node_modules`.
3. **[Unicode CLDR](https://cldr.unicode.org)**: unit names (Square Yards, Nautical Miles, Hectares...) from the official `cldr-units-full` package, the same locale data behind Windows, macOS, Android and every browser. Downloaded once from the npm registry and cached in `%USERPROFILE%\.exb-i18n`. `--no-cldr` turns it off; `--cldr-tarball <file.tgz>` uses a local copy on machines without internet.
4. **Shared translation memory** on GitHub, filled by a weekly GitHub Action and corrected by pull request: see below.
5. **People**: review sheets you fill in and import, or hand edits in a locale file.
6. **Optional machine translation on your own server**: see below.

Matching is exact but forgiving about letter case, spacing, trailing `:` `...` `.`, placeholder names (`{count}` matches `{n}`), and articles (`Draw point` finds Esri's `Draw a point`, flagged for a quick check). The Esri wording is then fitted to your string: placeholders renamed, trailing punctuation and first-letter case carried over. Unsafe matches are rejected (for example the SQL operator `AND` for the English word "and").

Expect roughly 10 to 25 percent coverage from Esri alone, more for widgets that use common GIS vocabulary (units, Undo, Delete, Export, Zoom to, Buffer, Snapping). The rest shows in English until a person or a machine fills it.

## Filling the gaps

### People (recommended)

```bat
node bin\exb-i18n.js review "...\widgets\my-widget" --locales es,fr
```

writes `i18n\review\es.csv` and `fr.csv`. Open in Excel. Each row has the English, a status, and a suggestion when there is one:

| status | meaning |
|---|---|
| `missing` | Nobody has translated it yet. English shows. |
| `esri-check` | Esri has it but in more than one wording, or as a close match. Shipped; please confirm. |
| `stale` | The English changed. The old translation is in `suggestion`. |
| `machine` | Machine translated. Shipped (unless `shipMachine` is off); please confirm. |

Type the final text in `translation`, or put `x` in `approve` to accept the suggestion, save, then:

```bat
node bin\exb-i18n.js import "...\widgets\my-widget" "...\widgets\my-widget\i18n\review\es.csv"
```

Rows are checked before they are applied: the English must still match and `{placeholders}` must be kept. This is also the easiest way for community members to contribute a language by pull request.

### Shared translation memory on GitHub (automatic)

The kit repo holds a free, open translation memory in [`memory/`](memory/): one JSON file per language. A GitHub Action ([docs/memory-workflow.yml](docs/memory-workflow.yml)) runs a LibreTranslate container on GitHub's own runner every week, translates any new English from the widgets listed in `memory/sources.json`, and commits it. No server to host, nothing to pay for.

`sync` downloads the memory automatically (after Esri, which always wins) and caches it for offline runs:

- entries a person has checked (`"reviewed": true`) ship as **community**
- the rest ship as **machine** and stay in the review sheets

Fix a wording or add your widget with a pull request; see [memory/README.md](memory/README.md). `--no-memory` skips it, `--memory <url or folder>` points at your own copy.

### Machine translation on your own server (optional)

Built in: **[LibreTranslate](https://github.com/LibreTranslate/LibreTranslate)**, open source (AGPL-3.0, built on Argos Translate) and self-hosted, so widget text never leaves your network. One way to run it, from **PowerShell** (no elevation, Docker Desktop installed):

```powershell
docker run -d -p 5000:5000 --name libretranslate libretranslate/libretranslate
```

Then:

```bat
node bin\exb-i18n.js sync "...\widgets" --provider libretranslate --lt-url http://localhost:5000
```

Machine output is marked `machine`, never overrides Esri or a person, keeps placeholders intact (strings it damages are dropped), skips ICU plural messages, and stays in the review sheets until approved. Add `--no-ship-machine` to keep it out of the locale files entirely. Languages the server does not support are skipped.

Any other service plugs in as a small module (`--provider .\my-provider.js`):

```js
module.exports = {
  name: 'my-provider',
  async translate (texts, locale) { /* return an array of strings, same length, null to skip */ }
}
```

## Commands

| Command | Does |
|---|---|
| `audit <path> [--strict] [--json]` | Lists hardcoded UI text (JSX text, `title` / `aria-label` / `placeholder` / `label` and friends, `announce` / `alert` style calls), keys used but missing from `default.ts`, and keys never referenced. `--strict` exits 1 when anything is found (for CI). |
| `extract <widget> [--apply] [--prefix x]` | Moves hardcoded English into `default.ts` and rewrites the source. Dry run unless `--apply`. |
| `sync <path>` | Creates or updates every locale file and `manifest.json`. |
| `watch <path>` | `sync` on every save of a `default.ts`. |
| `review <path> [--locales es]` | `sync`, then writes the review sheets. |
| `import <widget> <sheet.csv>` | Applies a reviewed sheet, then syncs. |
| `check <path>` | For CI: exits 1 when `default.ts` changed since the last sync. Needs no Experience Builder install. |
| `status <path>` | Coverage per locale. |
| `lookup "<English>" [--locale es]` | Shows what Esri (and CLDR) ship for a string. |

Common options: `--client <path to ...\client>` (auto-detected when the widget is inside an EB install), `--locales es,fr,de` (default all 39), `--tm <folder>` extra trusted translations, `--dry-run`.

## What extract does to your source

```tsx
<span>Delete all</span>                         ->  <span>{this.nls('deleteAll')}</span>
title="Undo"                                    ->  title={t('undo')}
aria-label={`Opacity ${pct}%`}                  ->  aria-label={t('opacityPct', { pct })}
aria-label={`Draw line${on ? ' (active)' : ''}`} -> aria-label={(on ? t('drawLineActive') : t('drawLine'))}
{n} item{n !== 1 ? 's' : ''}                     -> {(n !== 1 ? t('nItems', { n }) : t('nItem', { n }))}
Updates opacity to {o}% for selected.           ->  {t('updatesOpacityTo', { o })}
announceStatus('Buffer removed')                ->  announceStatus(t('bufferRemoved'))
```

- Sentences stay whole: text with values becomes one ICU message (`Delete {name}`), and `cond ? 'a' : 'b'` inside a sentence becomes separate full sentences, so translators never stitch fragments.
- The translator is whatever is already in scope: a class member `nls` / `translate` / `t` (`this.nls(...)`), a `const t = hooks.useTranslation(defaultMessages)` in a function component, or `props.nls(...)`. Places with no translator in scope are listed, never guessed. Wire one in (see [docs/WIRING.md](docs/WIRING.md)) and run again.
- Existing keys are reused when `default.ts` already has the same English.
- Code samples (`<code>`, `<pre>`, `<kbd>`), template tokens like `{{length}}`, ids, class names and comparisons are left alone.
- Text split by inline elements (`use the <strong>Export</strong> button`) stays in pieces; restructure by hand if the word order matters.

Always review the diff before committing.

## Configuration

Optional `exb-i18n.config.json` in a widget folder, the `widgets` folder or `your-extensions` (inner files win, CLI flags win over all):

```json
{
  "locales": "all",
  "provider": { "type": "libretranslate", "url": "http://localhost:5000", "apiKeyEnv": "LT_API_KEY" },
  "shipMachine": true,
  "fillMissingWithEnglish": true,
  "reviewFiles": false,
  "cldr": true,
  "extraTm": ["../shared-translations"],
  "exclude": ["some-widget-to-skip"],
  "prefix": { "runtime": "", "setting": "setting" }
}
```

`fillMissingWithEnglish` writes English for untranslated keys so every key resolves. Experience Builder loads a widget's messages from the locale file only (it does not merge `default.ts`), so without it react-intl logs a missing-translation error for each key and falls back per call.

## How Experience Builder uses the files

- `manifest.json` `translatedLocales` must list the locales, starting with `"en"` (the build reads `default.ts` for the first entry). `sync` maintains it.
- `src\runtime\translations\<locale>.js` and `src\setting\translations\<locale>.js` are copied to `dist` by the EB webpack build and loaded on demand for the active locale.
- Files are written in Esri's SystemJS format with one key per line. That layout matters: the EB build reads `_widgetLabel` line by line to show the translated widget name in the Builder's widget panel.

## CI

`check` needs only Node and the widget, so a widget repo can fail a pull request whose `default.ts` changed without a sync. See [docs/ci-check.yml](docs/ci-check.yml).

## Notes and limits

- Translation quality is Esri's and CLDR's; this kit only reuses it. A short UI word can mean different things in different places ("Single", "Clear"). Those show as `esri-check` when Esri itself uses more than one wording.
- Plurals: extract produces one sentence per branch of your existing `n !== 1 ?` logic. Languages with more plural forms can be hand-converted to ICU `{n, plural, one {...} other {...}}`; react-intl in Experience Builder handles it.
- Right-to-left (Arabic, Hebrew) text direction is Experience Builder's job; check custom CSS that assumes left-to-right.

## License

Apache-2.0. Contributions welcome, especially translations and support for more widget patterns.
