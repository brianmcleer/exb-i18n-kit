# Changelog

## 1.2.0 (2026-10-09)

- Audit and wiring follow local UI helper parameters, aliases and array metadata, including headings passed to arbitrary helper names.
- Message severities remain unchanged while message argument 1 translates; custom `sinkArgs` positions work in audit, extract, wire and localize.
- Concatenated UI sentences become one translation with placeholders. Module UI metadata translates lazily through getters and follows locale changes.
- Audit recognizes generated translators and reports translations evaluated before render. Source scanning no longer claims complete runtime coverage from an empty result.
- Regression tests cover helper wrappers, notification positions, metadata, full sentences, repeated runs and locale changes.


## 1.1.0 (2026-10-09)

- New `wire` command, also run by `localize` (`--no-wire` to skip). A second pass for any custom widget
  that catches what `extract` cannot reach: English with no translator in scope, props passed through
  `jsx()` / `createElement` instead of JSX, UI fields of object literals (`label`, `placeholder`, ...),
  config fallbacks (`config.x || 'Default'`, which also translates a config value still equal to the
  English default), returns of label/hint/text helpers, status setters, direct reads of the messages
  object (`defaultMessages.key`, always English before), and hand-written translators that never ask
  intl. They all go through a generated helper per part (`src/<part>/i18n-t.ts`) that the entry
  component feeds with the widget's intl. Strings the same file compares against are left alone.
  Backed up in `i18n/backup/<time>-wire`; `restore` undoes it. Found on the City of Grand Junction
  widgets, where 650+ strings stayed English after `localize`.

## 1.0.4 (2026-10-09)

- An Esri match whose "translation" is the English itself (Esri bundles that ship English in a locale
  file) no longer counts as translated. It used to win over the shared memory, so strings such as
  "New here?" and "Dismiss" stayed English in Spanish while the memory had them.

## 1.0.3 (2026-10-09)

- `sync`, `localize` and `audit` on a widgets folder skipped every widget whose manifest author starts
  with "Esri", so customized forks (map-layers-custom) never picked up the shared memory. A widget
  with Esri in the author line is now skipped only when it has no `i18n/translations.lock.json`.
- `memory/sources.json`: registers the new settings strings of enhanced-measurement and rac-manager.

## 1.0.2 (2026-10-08)

- The shared memory now lives on the `translation-memory` branch. `main` is protected (pull requests
  only), so the Action's pushes to it were rejected (GH006) after translating; the first batched run
  translated 5,400 entries and lost them. The workflow now commits each pass to `translation-memory`,
  and `sync` reads `https://raw.githubusercontent.com/brianmcleer/exb-i18n-kit/translation-memory/memory`
  by default. `sources.json` stays on `main`. Older kits read `main/memory` and find nothing: update.

## 1.0.1 (2026-10-08)

Fixes from rolling the kit out to 20+ widgets (every one of these produced type errors that the
rollout's type check caught and rolled back):

- Scope-aware translator lookup: a callback parameter or block variable named `t` (`list.map((t, i) => ...)`,
  `const t = this.getTheme()`) is no longer taken for the translator, and it shadows the outer one.
- Auto-wire skips components that already bind `t`, `nls` or `translate` through destructuring
  (`({ t }) =>`, `const { t } = props`), and drops the hook again from files where nothing was extracted.
- Values for a local translator typed `values?: Record<string, string>` are wrapped in `String()`.
- A translator with one parameter (`nls = (id: string) => ...`) is never given values; those sentences
  are reported for a hand edit instead.
- `vendor` folders (third-party code copied into a widget) are skipped by extract and audit.

## 1.0.0 (2026-10-08)

- First release: audit, extract, sync, watch, review, import, check, status, lookup.
- Translation sources: Experience Builder framework and out-of-the-box widgets, ArcGIS Maps SDK / Calcite / map components t9n bundles, Unicode CLDR unit names, reviewed spreadsheets, optional LibreTranslate or custom provider.
- `localize` (backup, extract, sync, report) and `restore` for one-command use; `localize.cmd` drag and drop.
- Shared translation memory in `memory/`, filled weekly by a GitHub Action running LibreTranslate, corrected by pull request.
- Reusable GitHub Action (`uses: brianmcleer/exb-i18n-kit@v1`) for widget repos; keeps existing Esri translations when no Experience Builder install is present.
- Reference implementation: Draw Advanced 4.6.0.
