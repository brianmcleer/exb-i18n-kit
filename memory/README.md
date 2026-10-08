# Shared translation memory

One JSON file per Experience Builder locale (`es.json`, `fr.json`, ...), keyed by the exact English string:

```json
"Delete all drawings": { "t": "Eliminar todos los dibujos", "src": "libretranslate", "reviewed": false }
```

- A GitHub Action (`.github/workflows/memory.yml`) fills new strings every week, and whenever `sources.json` changes, using a LibreTranslate container. Nothing leaves GitHub's runner.
- It works in batches (150 new strings per locale per pass) and pushes after every pass, so a long first run keeps what it finished. If a run stops at its time budget, run the workflow again and it carries on.
- It never changes an entry that already exists.
- Locales LibreTranslate does not support get no machine entries; those widgets show English for anything Esri does not ship.
- **Fix a translation:** edit the `t` value, set `"reviewed": true`, open a pull request. Reviewed entries ship as `community`; unreviewed ones ship as `machine` and stay in each widget's review list.
- **Add your widget:** add the raw URLs of its `translations/default.ts` files to `sources.json` by pull request. Only register public widgets, and check the English first: no tokens, internal URLs or data.

`exb-i18n sync` reads this folder from GitHub automatically (after Esri's own translations, which always win). `--no-memory` turns it off.
