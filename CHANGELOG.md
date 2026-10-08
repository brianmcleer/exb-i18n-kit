# Changelog

## 1.0.0 (2026-10-08)

- First release: audit, extract, sync, watch, review, import, check, status, lookup.
- Translation sources: Experience Builder framework and out-of-the-box widgets, ArcGIS Maps SDK / Calcite / map components t9n bundles, Unicode CLDR unit names, reviewed spreadsheets, optional LibreTranslate or custom provider.
- `localize` (backup, extract, sync, report) and `restore` for one-command use; `localize.cmd` drag and drop.
- Shared translation memory in `memory/`, filled weekly by a GitHub Action running LibreTranslate, corrected by pull request.
- Reusable GitHub Action (`uses: brianmcleer/exb-i18n-kit@v1`) for widget repos; keeps existing Esri translations when no Experience Builder install is present.
- Reference implementation: Draw Advanced 4.6.0.
