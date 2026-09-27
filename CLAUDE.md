# Almanac

GitHub Pages site (served from `main`) with Guus's home-screen apps: `radar/`, `polder/`, `nakasendo/`, `curiosity/`, `enso/`.

## Apps published from Claude artifacts

| App | Source | Claude artifact (always publish with this `url`) |
|---|---|---|
| Curiosity Almanac | `curiosity/app.html` | https://claude.ai/artifact/NPb3KSCWDTx3Uvf3Ueh78Y |
| Ensō | `enso/app.html` + `enso/poems.json` | https://claude.ai/artifact/9sKwQdx8Kb1V4krY24QSer (publish poems.json via `files`) |

- `<app>/index.html` is generated from `<app>/app.html` by `python3 tools/build_app.py <app>`, which keeps the home-screen wrapper (icons, manifest, service worker) at the top of index.html. Don't edit index.html by hand.
- The PostToolUse hook in `.claude/settings.json` runs `tools/after_publish.sh` after every Artifact publish of an `app.html`: it rebuilds index.html, commits (plus `enso/poems.json`) and pushes to `main`.
- Curiosity fact ids are array positions, and readers' kept/read progress is stored by id: append new facts (and their `MORE` entries) at the end of the arrays, never insert or reorder.
- Ensō poem ids are stored in readers' "kept" lists: give new poems the next free id, never renumber. Only public-domain texts, or fresh translations of pre-modern originals (note: "translated for Ensō").
