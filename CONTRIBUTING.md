# Contributing

- **Translations:** edit `memory/<locale>.json`, set `"reviewed": true` on entries you checked, open a pull request. Keep every `{placeholder}` exactly as in the English.
- **Add a widget to the shared memory:** add the raw GitHub URLs of its `translations/default.ts` files to `memory/sources.json`.
- **Code:** `npm install` then `npm test` (Node 18+). Keep zero runtime dependencies. Plain language in docs, no em dashes.
- **Bugs:** open an issue with the command you ran, its output, and your Experience Builder version.
