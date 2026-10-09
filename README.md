# exb-i18n-kit

**Make any ArcGIS Experience Builder custom widget speak all 39 Experience Builder languages.**

Esri's own widgets switch language with the user's ArcGIS profile, the browser, the `?locale=` URL parameter or the out-of-the-box [Language Switcher](https://doc.arcgis.com/en/experience-builder/latest/configure-widgets/language-switcher-widget.htm). Custom widgets usually stay in English. This kit fixes that for any widget, with one command, and helps keep translations current as the widget changes. Static scans and file coverage do not replace testing in the target language.

- Works on **your** widget: nothing here is tied to one widget.
- Uses the translations **Esri already ships** with Experience Builder first, so shared words match Esri's widgets exactly.
- Fills the rest from a **free shared translation memory** on GitHub, kept current by a GitHub Action and corrected by the community.
- `sync` writes the same translation file format Esri uses. `localize` and `wire` also add a small runtime helper to connect UI text to the widget locale.
- Node 18 or later. Source scanning uses the TypeScript compiler from your Experience Builder client (or a local TypeScript installation). Translation providers are optional.

> Example: [Draw Advanced](https://github.com/brianmcleer/draw-advanced-widget) 4.6.0 was localized with this kit.

---

## Quick start (any widget, about 5 minutes)

You need Experience Builder Developer Edition installed, with your widget in `client\your-extensions\widgets`.

**1. Get the kit.** Download the ZIP from GitHub (Code > Download ZIP) and unzip it anywhere, or:

```bat
git clone https://github.com/brianmcleer/exb-i18n-kit.git
```

**2. Localize your widget.** Windows: drag your widget folder onto **`localize.cmd`**. Or in **Command Prompt** (no admin needed):

```bat
cd /d C:\path\to\exb-i18n-kit
node bin\exb-i18n.js localize "C:\arcgis-experience-builder-1.21\client\your-extensions\widgets\my-widget"
```

That one command:

1. backs up your source files to `my-widget\i18n\backup`
2. moves hardcoded English (buttons, tooltips, screen-reader labels, messages) into `translations\default.ts`
3. writes `translations\<language>.js` for all 39 languages and updates `manifest.json`
4. lists remaining findings in supported static patterns; test runtime and settings in your target languages

**3. Test.** Restart `pnpm start`, open your app with `?locale=es` (or `&locale=es` if the link already has a `?`).

Did not like the result? `node bin\exb-i18n.js restore <widget>` puts your files back.

No git or download? This also works straight from GitHub:

```bat
npx github:brianmcleer/exb-i18n-kit localize "C:\...\widgets\my-widget"
```

New to this? Read **[docs/GETTING-STARTED.md](docs/GETTING-STARTED.md)**.

---

## Keep it translated

Your widget changes; the translations follow. Pick one:

| Way | How |
|---|---|
| While you code | `node bin\exb-i18n.js watch "...\your-extensions\widgets"` next to `pnpm start`. Every save of a `default.ts` updates all languages within a second. |
| Before a release | `node bin\exb-i18n.js sync "...\widgets\my-widget"` |
| On GitHub, automatically | Add the [GitHub Action](#github-action) to your widget repo. |

What sync does when your English changes:

| You... | sync... |
|---|---|
| add a string | translates it (Esri, then the shared memory); English until then |
| change a string | stops showing the old translation and flags it for review |
| delete a string | removes it from every language |
| hand-edit a language file | keeps your edit |

## Get community translations for your widget

The shared memory (on the [`translation-memory`](https://github.com/brianmcleer/exb-i18n-kit/tree/translation-memory/memory) branch) is translated by a weekly GitHub Action that runs the open-source LibreTranslate on GitHub's servers. To have your widget's strings included, open a pull request adding the raw links to your `translations/default.ts` files in [`memory/sources.json`](memory/sources.json):

```json
{ "name": "my-widget", "files": [
  "https://raw.githubusercontent.com/you/my-widget/main/my-widget/src/runtime/translations/default.ts",
  "https://raw.githubusercontent.com/you/my-widget/main/my-widget/src/setting/translations/default.ts"
] }
```

After the next run, `sync` picks them up. Machine translations are labeled `machine` and listed for review until someone checks them.

**Speak another language?** Fix any entry in `memory/<language>.json` on the `translation-memory` branch, set `"reviewed": true`, and open a pull request against that branch. Every widget using the kit gets the fix. See [memory/README.md](memory/README.md).

## GitHub Action

Keep a widget repo translated on every push. Copy [docs/widget-repo-workflow.yml](docs/widget-repo-workflow.yml) to `.github/workflows/translations.yml` in your repo:

```yaml
- uses: actions/setup-node@v4
  with: { node-version: 22 }
- uses: brianmcleer/exb-i18n-kit@v1
  with:
    widget: ./my-widget        # folder with manifest.json
    command: sync              # or: check (fail the build if out of date), audit
    commit: true               # commit updated language files
```

GitHub has no Experience Builder install, so the Action keeps the Esri translations already in your files and fills new strings from the shared memory. Run `localize` or `sync` locally once first so the Esri matches are in place.

If your repo is a copy of a local folder (for example published with a mirror script), use `command: check` instead of committing from CI, and run `sync` locally.

## Where translations come from

Best first. A later source never overrides an earlier one.

1. **You**: hand edits in a language file, or a reviewed sheet you `import`.
2. **Esri, Experience Builder**: framework strings and every out-of-the-box widget in your install.
3. **Esri, ArcGIS Maps SDK, Calcite and map components**: the `t9n` bundles in your install.
4. **[Unicode CLDR](https://cldr.unicode.org)**: unit names (Square Feet, Hectares...), the locale data behind every OS and browser. Downloaded once, cached in `%USERPROFILE%\.exb-i18n`.
5. **Shared memory**: community-reviewed entries first, then machine translations (flagged).
6. **Your own translation server** (optional): LibreTranslate or any provider module.
7. **English**, when nothing else exists.

Matching forgives case, spacing, trailing `:` `...`, placeholder names and articles ("Draw point" finds Esri's "Draw a point", flagged to check). Unsafe matches are rejected. Nothing from Esri is redistributed: each developer reads their own licensed install.

## Commands

| Command | What it does |
|---|---|
| `localize <widget>` | Everything for a new widget: backup, extract, wire, sync, report. |
| `wire <widget or folder> [--apply]` | Second pass for what `extract` cannot reach (see below). Part of `localize`; run it on its own for widgets localized before 1.1. |
| `restore <widget>` | Undo the last `localize` or `wire`. |
| `sync <widget or folder>` | Create or update the language files and `manifest.json`. |
| `watch <widget or folder>` | `sync` on every save. |
| `audit <widget or folder>` | List hardcoded English. `--strict` fails for CI. |
| `extract <widget> [--apply]` | Only the source rewrite step (dry run without `--apply`). |
| `review <widget> --locales es` | Write `i18n\review\es.csv`: what still needs a person. |
| `import <widget> <sheet.csv>` | Apply a filled-in sheet. |
| `check <widget or folder>` | Fail when `default.ts` changed since the last sync (CI). |
| `status <widget or folder>` | Coverage per language. |
| `lookup "<English>"` | What Esri ships for a string. |

A path with a `manifest.json` is one widget; any other folder is scanned for widgets (Esri's are skipped).

Options: `--client <EB client folder>` (auto-detected), `--locales es,fr` (default all 39), `--no-memory`, `--memory <url or folder>`, `--no-cldr`, `--provider libretranslate --lt-url http://localhost:5000`, `--dry-run`.

Settings can also live in `exb-i18n.config.json` in the widget, widgets or your-extensions folder. See [docs/REFERENCE.md](docs/REFERENCE.md).

## What localize changes in your code

```tsx
<span>Delete all</span>                          ->  <span>{this.nls('deleteAll')}</span>
title="Undo"                                     ->  title={t('undo')}
aria-label={`Opacity ${pct}%`}                   ->  aria-label={t('opacityPct', { pct })}
{n} item{n !== 1 ? 's' : ''}                      ->  {(n !== 1 ? t('nItems', { n }) : t('nItem', { n }))}
announceStatus('Buffer removed')                 ->  announceStatus(t('bufferRemoved'))
```

It uses the translator your code already has (`this.nls`, `t` from `hooks.useTranslation`, `props.nls`). Then `wire` covers the rest:

```tsx
// anywhere in src/: class helpers, module-level code, child components without intl
jsx('div', { children: 'Mailing Labels' })      ->  jsx('div', { children: __t('mailingLabels') })
{ label: 'Point', placeholder: 'Search…' }      ->  { label: __t('point'), placeholder: __t('search') }
getToolHint () { return 'Click to add a point' } ->  getToolHint () { return __t('clickToAddAPoint') }
config.areaButtonText || 'Freehand Area'        ->  __tc(config.areaButtonText, 'freehandArea')
setStatus('Searching…')                         ->  setStatus(__t('searching'))
defaultMessages.searching                       ->  __m.searching
const t = (id) => defaultMessages[id] ...       ->  const t = (id) => { { const __i = __tryIntl(id, values); ... }
```

`__t`, `__tc`, `__m` and `__tryIntl` come from a small generated helper next to each part's
translations (`src/runtime/i18n-t.ts`, `src/setting/i18n-t.ts`). The entry component (`widget.tsx`,
`setting.tsx`) hands the widget's intl to it on every render, so every module of the widget follows the
app language, including code that runs outside React. `__tc` also translates a config value that is
still the English default (settings panels that saved the default as text).

Left alone on purpose: strings the same file compares against (`label.includes('Freehand Line')`,
`=== 'Point'`, `case 'Area':`), constructor arguments (`new GraphicsLayer({ title })`), keys, ids,
CSS, console and `Error` messages. Always review the diff and type check; `restore` undoes a run.

## Requirements and limits

- Experience Builder Developer Edition 1.17 or later (tested on 1.21), Node 18+.
- The source rewrite uses the TypeScript compiler that ships with the Experience Builder client; nothing to install.
- Text split by inline elements (`use the <b>Export</b> button`) stays in pieces.
- Plurals follow your existing `n !== 1 ?` logic; languages with more plural forms can be hand-converted to ICU `{n, plural, ...}`.

## Contributing

Issues and pull requests welcome: translations in `memory/`, new widgets in `memory/sources.json`, and code. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Apache-2.0. Not affiliated with or endorsed by Esri.

## UI wiring beyond JSX

The scanner follows local variables, metadata used by array callbacks, and parameters passed through local UI helpers. It detects `showMessage('success', 'Saved')` at argument 1 and preserves the severity. Module-level UI metadata uses getters so it follows locale changes after import. IDs, comparisons, constructors, code samples, and console output remain protected.

For your own notification or UI API, configure zero-based argument positions in `exb-i18n.config.json`:

```json
{ "sinkArgs": { "renderPanel": [1], "customNotice": [1] } }
```

Run `audit` after wiring, then type check, build, and test runtime and settings. The scanner cannot prove coverage of external data, reflection, arbitrary imported helper functions, or all message interpolation. A filled locale file may still contain English fallbacks or unreviewed machine translations.
