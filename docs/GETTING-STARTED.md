# Getting started (plain version)

## The idea

Your widget has words in it: button names, tooltips, messages. Right now they are all English.
Experience Builder can show apps in 39 other languages, but only if each widget has a
"language file" for each language. This kit makes those files for you.

## What happens when you run it

1. **It finds the English.** Some English is typed straight into the code. The kit moves every
   one of those into a single list, `translations/default.ts`, and gives each a short name
   (`deleteAll = "Delete all"`). The code now asks for the word by name.
2. **It copies Esri's homework.** Esri already translated their own widgets into 39 languages.
   If your widget says "Undo", the kit uses exactly what Esri uses ("Deshacer" in Spanish).
3. **Unit names come from the official list** (Unicode CLDR), the same one your phone uses.
4. **The rest comes from the shared memory** on GitHub. A free robot translator fills it every
   week, and people who speak the language fix it. Robot words are marked "not checked yet".
5. **Anything still missing stays English**, so nothing breaks.
6. **It writes one file per language** (`es.js` for Spanish and so on) and tells Experience
   Builder they exist.

The app then picks the language from the user's ArcGIS settings, the browser, `?locale=es`
in the link, or the Language Switcher widget.

## Do it

1. Download this kit (green **Code** button > **Download ZIP**) and unzip it.
2. Drag your widget folder (the one with `manifest.json`) onto `localize.cmd`.
3. Read what it printed. If it lists "no translator in scope", ask your favorite developer or
   follow [WIRING.md](WIRING.md), then drag the folder on again.
4. Restart `pnpm start` and open your app with `?locale=es`.

Changed your mind? Run `node bin\exb-i18n.js restore "<your widget folder>"`.

## Keep it up to date

Every time you add or change words, run `sync` again (or leave `watch` running). New words
get translated, changed words get re-checked, deleted words disappear.

## Make it better for everyone

- Add your widget to `memory/sources.json` (pull request) so the robot translates it too.
- Speak a language? Fix words in `memory/<language>.json` and mark them `"reviewed": true`.
