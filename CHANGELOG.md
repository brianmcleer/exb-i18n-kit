# Changelog

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
