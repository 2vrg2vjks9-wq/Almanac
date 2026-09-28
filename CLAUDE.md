# Almanac

GitHub Pages site (served from `main`) with Guus's home-screen apps: `radar/`, `polder/`, `nakasendo/`, `curiosity/`, `enso/`, `proxima/`.

## Safety check — required for every app, every change

Guus asked for this on all current and future apps. The repo is public and the apps run on his phone.

1. **Automatic:** `tools/safety_check.py` runs as a PreToolUse hook before every Artifact publish and blocks it on secrets, scripts or requests to hosts outside its allowlist, or eval-style code. Also run it by hand before pushing any app: `python3 tools/safety_check.py <app>/*.html <app>/*.js <app>/*.json`. Adding a host to `ALLOWED_HOSTS` needs a reason in the comment.
2. **Manual review** (a script can't judge these), before publishing or pushing:
   - Every place text reaches the page as HTML (`innerHTML`, string-built markup) escapes or sanitises it, especially text from users, pasted input, shared storage (`db`), other viewers, or Claude (`sample`). Prefer `textContent`.
   - Prompts sent to Claude from a page can't be steered by other viewers into doing something harmful, and Claude's replies are treated as untrusted text.
   - No personal data (names, emails, precise locations, notification topics that act as passwords) is committed to the public repo; say what leaves the device (e.g. location sent to an API) and when.
   - Offline service workers only cache same-site files and fonts.
3. **Report it:** tell Guus what was checked and anything found, fixed or left as is.

## Apps published from Claude artifacts

| App | Source | Claude artifact (always publish with this `url`) |
|---|---|---|
| Curiosity Almanac | `curiosity/app.html` | https://claude.ai/artifact/NPb3KSCWDTx3Uvf3Ueh78Y |
| Ensō | `enso/app.html` + `enso/poems.json` | https://claude.ai/artifact/9sKwQdx8Kb1V4krY24QSer (publish poems.json via `files`) |
| Proxima | `proxima/app.html` | https://claude.ai/artifact/3VdbgkQe44VAjUWEogZTau |

- `<app>/index.html` is generated from `<app>/app.html` by `python3 tools/build_app.py <app>`, which keeps the home-screen wrapper (icons, manifest, service worker) at the top of index.html. Don't edit index.html by hand.
- The PostToolUse hook in `.claude/settings.json` runs `tools/after_publish.sh` after every Artifact publish of an `app.html`: it rebuilds index.html, commits (plus `enso/poems.json`) and pushes to `main`.
- Curiosity fact ids are array positions, and readers' kept/read progress is stored by id: append new facts (and their `MORE` entries) at the end of the arrays, never insert or reorder.
- Ensō poem ids are stored in readers' "kept" lists: give new poems the next free id, never renumber. Only public-domain texts, or fresh translations of pre-modern originals (note: "translated for Ensō").
- Proxima invention ids are array positions stored in readers' kept/seen lists: append new inventions at the end of `ALL`, never insert or reorder. Keep the "Seeds today" notes factual.
- Proxima's lab (artifact only, owner only): once Guus has seen nearly everything, Claude invents 3 more per tap, after a confirm, at most 3 batches a day (`LAB_DAILY`, counted in db `labmeta/usage`), at most 9 waiting. Drafts wait in db `lab/<id>`; approved ones move to `catalogue/<id>` and show in the artifact as id `g-<id>`. db rules make everything owner-write-only and `lab`/`labmeta` owner-read-only. Always republish with `capabilities: {sample: {}, user: {}, db: {rules: [{path: "", read: "view", write: "owner"}, {path: "lab", read: "owner", write: "owner"}, {path: "labmeta", read: "owner", write: "owner"}]}}`.
- To bring approved lab inventions to the home-screen app ("sync Proxima"): read `catalogue` with ArtifactData, fact-check each entry, append it to the end of `ALL` with `gid: "<doc id>"` plus its `plain`/`wow`/`ideas` in `POP`, publish, then set `synced: true` on those docs. The page skips db entries whose gid is already in `ALL` and moves readers' kept/seen marks over.
