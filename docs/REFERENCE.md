# Reference

## Config file

`exb-i18n.config.json` in a widget folder, the `widgets` folder or `your-extensions`. Inner files win; command-line options win over all.

```json
{
  "locales": "all",
  "client": "C:/arcgis-experience-builder-1.21/client",
  "memory": true,
  "cldr": true,
  "provider": { "type": "libretranslate", "url": "http://localhost:5000", "apiKeyEnv": "LT_API_KEY" },
  "shipMachine": true,
  "fillMissingWithEnglish": true,
  "reviewFiles": false,
  "extraTm": ["../more-translations"],
  "exclude": ["widget-to-skip"],
  "prefix": { "runtime": "", "setting": "setting" }
}
```

| Setting | Meaning |
|---|---|
| `memory` | `true` (shared memory on GitHub), `false`, or a URL / folder of your own memory |
| `shipMachine` | `false` keeps machine translations out of the language files (review only) |
| `fillMissingWithEnglish` | write English for untranslated keys. Experience Builder loads a widget's messages from the language file only, so without this react-intl logs a missing-translation error per key |
| `reviewFiles` | `true` makes every sync also write review sheets |
| `localizeFormats` | opt in to the app locale for English/browser date and number formatting; preserves formatting options, currencies and units |
| `sinks` | additional message function names, using argument 0 |
| `sinkArgs` | map function names to zero-based UI argument indexes, e.g. `{ "customNotice": [1] }`; an empty array disables that sink |
| `prefix` | key prefix for new keys from `localize` / `extract`, per translations folder |

## Status labels

| Label | Meaning | Shipped |
|---|---|---|
| `esri` | Esri ships this exact string | yes |
| `esri-check` | Esri has it in more than one wording, or a close match | yes, listed for review |
| `community` | reviewed entry from the shared memory | yes |
| `manual` / `existing` | a person's translation | yes |
| `machine` | machine translation not checked yet | yes (unless `shipMachine` is false), listed for review |
| `stale` | English changed after it was translated | no, listed for review |
| `missing` | nothing yet | English shows |

## Review sheets

`exb-i18n review <widget> --locales es` writes `i18n/review/es.csv` (UTF-8, opens in Excel). Fill `translation`, or put `x` in `approve` to accept the `suggestion`, then `exb-i18n import <widget> i18n/review/es.csv`. Rows are applied only if the English still matches and every `{placeholder}` is kept.

## Files the kit writes

| File | Commit it? |
|---|---|
| `src/*/translations/<locale>.js` | yes, these are what Experience Builder loads |
| `manifest.json` (`translatedLocales`) | yes |
| `i18n/translations.lock.json` | yes, it remembers human and machine work and what changed |
| `i18n/STATUS.md` | yes, coverage table |
| `i18n/review/*.csv`, `i18n/backup/` | your choice; leave them out of release zips |

Language files keep one key per line with unquoted keys: the Experience Builder build reads `_widgetLabel:` line by line for the widget's name in the Builder. `translatedLocales` must start with `"en"`.

## Your own translation server

LibreTranslate (open source, self-hosted). **PowerShell**, Docker Desktop installed:

```powershell
docker run -d -p 5000:5000 --name libretranslate libretranslate/libretranslate
```

Then `exb-i18n sync <widget> --provider libretranslate --lt-url http://localhost:5000`. Or write a provider module and pass `--provider .\my-provider.js`:

```js
module.exports = { name: 'my-provider', async translate (texts, locale) { return texts.map(t => null) } }
```

Placeholders are protected, damaged results are dropped, ICU plural messages are skipped.

## Running the shared memory yourself

`memory-build --sources memory/sources.json --out memory --provider libretranslate --lt-url ...` translates strings missing from `memory/<locale>.json`. It never changes an existing entry. [memory-workflow.yml](memory-workflow.yml) runs it weekly on GitHub Actions.

## Static audit limits

`audit`, `wire`, and `extract` share notification argument selection. `audit` and `wire` also follow local helper parameters and variable/array metadata bindings. `__t` and `__tc` are recognized as translators. Calls evaluated outside a function are flagged because they can run before the widget receives its locale. Wiring module UI properties uses getters; standalone module and class initializers can need hand edits.

`--strict` fails for remaining findings or missing keys. Missing-key candidates may be Experience Builder common messages or dynamic message objects; verify their source before adding English defaults. Translation status measures known catalog entries, not every displayed string or linguistic quality. Test drawing, search, export, keyboard/screen-reader text, settings and locale switching.
