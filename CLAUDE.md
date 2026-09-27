# Almanac

GitHub Pages site (served from `main`) with Guus's home-screen apps: `radar/`, `polder/`, `nakasendo/`, `curiosity/`.

## Curiosity Almanac

- `curiosity/app.html` is the source. It is published as the Claude artifact https://claude.ai/artifact/NPb3KSCWDTx3Uvf3Ueh78Y — always publish with that `url` so the link stays the same.
- `curiosity/index.html` is generated from it by `tools/build_curiosity.py` (keeps the home-screen wrapper at the top of index.html). Don't edit index.html by hand.
- The PostToolUse hook in `.claude/settings.json` runs `tools/after_publish.sh` after every Artifact publish of `curiosity/app.html`: it rebuilds index.html, commits both files and pushes to `main`.
- Fact ids are array positions, and readers' kept/read progress is stored by id: append new facts (and their `MORE` entries) at the end of the arrays, never insert or reorder.
