# Radar — brief for Claude Code

Radar is a personal "interest radar": a fullscreen home-screen web app on the owner's iPhone that shows
wind for their windsports spots, things to do (Den Haag first), and a curated feed of things they'd like
(music, art, food, books & film, meditation, work opportunities). Live at https://almanac-dgf.pages.dev/radar/
(behind Cloudflare Access).

## Privacy: the vault (read this first)

The repo is public, so **all personal data is committed encrypted**. Never commit plain data, the passphrase,
the ntfy topic, or personal details (names, diet specifics, employer, email, exact places) anywhere in the repo,
in commit messages, issue comments or Actions logs.

- `radar/data/<name>.enc.json` for `interests`, `feed`, `taste`, `things`: AES-256-GCM, key from the passphrase
  via PBKDF2-SHA256 (salt, iterations and a check value in `radar/vault.json`). The file name is bound in as
  additional data. The app (`js/vault.js`, WebCrypto) and `radar/tools/vault.mjs` (Node, no dependencies) use
  the same format.
- The passphrase is the `RADAR_KEY` environment variable (Claude tasks: in their instructions; GitHub Actions and
  optionally Cloudflare: a secret). To edit data:
  `node radar/tools/vault.mjs unlock` → edit `radar/.plain/*.json` (git-ignored) → `node radar/tools/vault.mjs lock`
  (only changed files are rewritten) → commit `radar/data/*.enc.json`.
- Notes from the app arrive as GitHub issues titled "Radar note" with a sealed body (`radar-sealed:v1:…`);
  read one with `node radar/tools/vault.mjs open '<body>'` (the text starts with `Title: <real title>`). When you
  close an issue, comment only "Done." — never repeat its content.
- The phone keeps only the derived key (`radar-key`); "Lock Radar on this phone" in You removes it and the
  decrypted cache. On the Cloudflare site `/api/key` (`functions/api/key.js`, owner-only) can hand out the
  passphrase if the `RADAR_KEY` secret is set there, so the owner doesn't have to type it.
- Rotating the passphrase: `RADAR_KEY=<old> node radar/tools/vault.mjs init` prints a new one and re-encrypts;
  then update every place that holds it.

## How it works (keep this architecture)

- **Hosting.** Cloudflare Pages serves `main` at https://almanac-dgf.pages.dev/radar/ behind Cloudflare Access
  (login). Every other branch gets a preview at `https://<branch>.almanac-dgf.pages.dev/radar/`: work on a branch,
  let the owner test the preview, merge after approval. The GitHub Pages copy still works (github.io mode below).
  The repo is **public**: never commit secrets, tokens or personal data (names, diet specifics, employer, email).
- **Static site, no build step, no framework.** Native ES modules, iOS Safari 16+:
  - `index.html` — markup shell. Holds `var APP_VERSION="…"` in a tiny inline script: bump it on every change.
    The app (old and new copies) fetches the live index.html, compares that line and reloads once if newer.
  - `app.css` — all styles and design tokens (light + dark).
  - `js/main.js` start-up, loading, freshness line, version check, service worker registration
  - `js/util.js` `html```/`esc`/`put` (auto-escaping markup: use it for every piece of HTML), `safeUrl`, dates, distance, `fetchT` (timeout)
  - `js/store.js` localStorage keys and the live copies (`S.saved`, `S.reactions`, …)
  - `js/data.js` loads interests/feed/taste (falls back to `radar-cache`), travel focus rules, event bus
  - `js/ui.js` tabs, bottom sheet, short notices, pull to refresh, first-run welcome
  - `js/wind.js` Open-Meteo wind + marine water temperature, ribbons, hourly chart, Today lead sentence
  - `js/feed.js` ranking (reactions, saves, taste.json, distance), item rows, Today/Explore/Work lists, reactions
  - `js/detail.js` item detail sheet and the `.ics` calendar file
  - `js/notes.js` notes to Claude (/api/note, GitHub token fallback, outbox)
  - `js/saved.js` You tab: saved items, bucket list, learned, teach (reactions + Do answers, notice + tab dot), forms
  - `js/around.js` Look around here and Scout this city
  - `js/vault.js` unlock (passphrase → key), open data files, seal notes, lock
  - `js/do.js` the Do tab: decide card (yes/no/later, swipe), yes list, filters, Hague-first rule, Today's "Coming up"
  - `sw.js` offline cache (network first; only same-site files and Google Fonts; never `/api/`). Bump `CACHE`
    when files change and add new modules to `FILES`.
- **Data files** (encrypted, see the vault; read by the app, written by the Claude tasks — keep them backward compatible):
  - `interests` — `about` (who Radar is for), `do` (what the Do tab should find), `alerts.ntfy` (wind alert topic), wind spots (lat/lon, good directions as degree ranges, optional `water: false` for lakes),
    sport ranges, daylight, minHours, artists, museums, culture, stories, meditation, work, freelance,
    bucketlist, `focus` {place, until, since, region?}, `_rules`.
  - `feed` — `{updated, note, items:[{id, kind, region, title, place, city, start, end, summary, why, url,
    found, flags?, pick?, lat?, lon?, bucket?}]}`. kinds: concert, release, news, exhibition, restaurant, story,
    meditation, work, freelance, bucket. regions: nl, be, de, eu, uk, jp, all (unknown regions show everywhere).
  - `taste` — `{updated, learned:[sentences], more:[keywords], less:[keywords]}` — ranking and Around me.
  - `things` — the Do tab: `{updated, note, home, ideas:[{id, cat, title, venue, city, area?, start, end, when?,
    summary, why, url?, lat?, lon?, price?, travel?, fit (1–5), major?, fresh?, flags?, found}]}`.
    cats: art, music, stage, film, talk, festival, market, outdoors, calm, food, design, odd. `when` is free text
    for times or recurring things ("Daily 10–16, book a slot"); undated ideas show as "Any time". Ids are stored
    in the owner's answers: keep them stable, never reuse one.
- **Travel focus:** items in a travel region (today only `jp`) show, and get a region filter, only while
  `focus` points there (`focus.region`, or `focus.place` matches) and `focus.until` hasn't passed.
- **localStorage keys** (never rename; the owner's saves live there): radar-saved, radar-reactions, radar-hidden,
  radar-outbox, radar-gh-key, radar-welcomed, radar-bucket-sent, radar-here, radar-wind, radar-water, radar-cache,
  radar-around (last Around me result), radar-scout (last city sent), radar-key (vault key), radar-locked,
  radar-do (Do answers), radar-do-view (Do filters). sessionStorage: radar-reload-for.
- **Notes to Claude** (`js/notes.js`): add interest (`radar-interest`), bucket wish (`radar-bucket`), reactions
  (`radar-feedback`), scouted city (`radar-location`, title `I'm in <city, country> until <YYYY-MM-DD>`).
  Every note is sealed before it leaves the phone (generic title, encrypted body). Do answers go with the
  reactions in `radar-feedback` as lines `yes|no | do:<cat> | <title> | <city> | id: <id>`.
  On the Cloudflare site they POST `{title, body, label}` to `/api/note` (`functions/api/note.js` files a GitHub
  issue with a token kept in Cloudflare). On github.io/localhost they use a GitHub token the owner pastes in Saved
  (kept only on the phone). Anything unsent waits in `radar-outbox` and retries when online. Never open GitHub
  in the browser. The daily task handles interests/feedback/bucket; an hourly task handles `radar-location`
  notes and adds researched items for that city to feed.json within the hour.
- **Around you** (`js/around.js`), only on tap: geolocation (distinct messages for denied / timeout /
  unavailable, with the iOS Settings path) → Overpass (overpass-api.de, then overpass.kumi.systems, then
  overpass.private.coffee; 20 s timeout each, GET) and Wikipedia geosearch in parallel, so results appear even
  when Overpass is down. Merged, de-duplicated, ranked (names in interests.json count most, taste words a little),
  grouped: Art & museums, Zen & quiet places, Food that may suit you (only places with OSM `diet:*` tags, always
  with "check with staff"), Nature & viewpoints, Landmarks & architecture. Tap a place for a sheet with map,
  Wikipedia and website links. Look around here = 2.5 km; Scout this city = Nominatim reverse (zoom 10), a guide
  within ~10–12 km of the centre shown at once, and the radar-location note (date defaults to focus.until when
  there, else 3 days; changing it sends one update; the same city isn't resent within 12 hours).
  What leaves the phone: coordinates to OpenStreetMap and Wikipedia on tap; city name and dates to Claude.
- **Wind alert:** `.github/workflows/radar-wind.yml` runs `radar/tools/wind_alert.py` every morning (Actions
  secret `RADAR_KEY`; topic from `alerts.ntfy` or the `NTFY_TOPIC` secret) and pushes to ntfy.sh. The Actions log
  is public: it prints only a count. Keep it working if you touch the wind section.
- **Tests:** `python3 radar/tools/test_app.py [screenshot-dir]` builds a temp copy with made-up data encrypted
  under a throwaway passphrase (it never needs the real key), covers the lock screen, sealed notes and the Do tab,
  serves it, mocks every outside API
  (Open-Meteo, Marine, Overpass + mirrors, Wikipedia, Nominatim, /api/note, GitHub, fonts), runs every tab in
  light and dark at 390×844, 320 px overflow, detail sheet + .ics, offline copy, notes + outbox + github.io
  fallback, Around me (success, Overpass down, location denied) and Scout; plus JSON validity, `node --check`
  and the safety check. The Cloudflare site is simulated as `radar.localhost`. Run it before every commit and
  look at the screenshots.

## Design system (coastal almanac; refine, don't replace)

- Warm paper by day, ink-dark sea by night. Tokens in `app.css` `:root` and `prefers-color-scheme: dark`:
  paper `--bg #f2efe7`, card `--surface #fbf9f4`, `--ink #17201d`, marine `#1c5a63`, kelp `#2f7d57` (wingfoil),
  buoy `#d19a24` (windsurf), flag `#b4432c` (warnings / over 30 kn), The Hague's yellow `#f2c230` and green `#1f5a35` (Do).
- Type: Fraunces (headlines, titles, reading text), Hanken Grotesk (interface).
- Two bold moments: the **wind ribbon** (one bar per daylight hour, height = strength, colour = rideable for which
  sport, hatched = wrong direction, dotted lines at the thresholds) and the **Do card** (yellow band for Den Haag,
  grey for "Worth the trip"). Everything else is paper, ink and hairlines: sentence case, no all-caps, no gradients.
- Floating capsule tab bar: Today · Do · Wind · Explore · Work · You (`data-v="saved"`). Mobile-first (390 px), safe-area insets,
  44 px tap targets. Work holds `work` and `freelance` (freelance sorted by deadline), kept out of Explore.
- In list rows the title button stretches over the row (tap anywhere opens it); action buttons sit above that layer.
- **Do rule (the owner's wish):** Den Haag is the most comprehensive; the farther away, the stronger the match
  must be. The app enforces it with `fit`: ≤15 km from Den Haag any fit, ≤40 km 3+, ≤80 km (Amsterdam, Utrecht) 4+, beyond 5.
- **Reactions:** a new 👍/👎 pops a short notice (fades after 5 s, not on the Do tab). The lasting place to send
  them is You › Teach it more, flagged by a red dot. Don't make the notice sticky.

## Do research (daily task)

Keep `things` a long list (about 30–60 live ideas) to say yes or no to. Den Haag and around first and fullest
(museums, galleries such as West, Stroom, Nest and The Grey Space in the Middle, Amare/NDT/Residentie Orkest, Paard,
Korzo, Koninklijke Schouwburg, Filmhuis, festivals like Crossing Border and Rewire, markets, dunes, beach and gardens);
Amsterdam and Utrecht only with fit 4–5. Mix the major events with fresh, unexpected ideas (`fresh: true`) that
read the owner's vibe. Every dated item needs a real URL you opened. Learn from `yes | do:` / `no | do:` lines:
more of what gets yes, less of what gets no. Remove past ideas; keep ids stable.

## About the user

Everything personal (sports, diet rules, taste, work, travel focus) lives in the encrypted `interests` (`about`,
`do`, `focus`). Read it there; don't copy it into this file or any other public file.

## Bucket list

`interests` has a `bucketlist` array: `{id, title, good_time, where, added}`. The Saved tab shows each
wish, its matching feed items, and an "Add to bucket list" form that sends a note labelled
`radar-bucket` (and keeps the wish locally as "sent" until it appears in `interests`). The daily task
adds the wish, then checks every wish each morning for a genuinely good moment (price drop, season, rare
availability) and writes feed items with `kind: "bucket"` and `bucket: "<wish id>"`; the app ranks them
high and labels them "Good time". A new bucket item is always worth a push notification.

## Freelance

`interests` has a `freelance` section (the owner's profile and what to look for). Feed items for it use
`kind: "freelance"`. The app needs a **Freelance** filter (its own colour dot) and freelance items may
appear in "Worth your attention" when a deadline is close.
For freelance items, `end` is the application deadline: the app shows "Apply by …", sorts the Freelance
filter by it, flags it as "Deadline soon" within 14 days and offers the deadline as a calendar entry.

## Rules

Don't add frameworks or a build step; keep all JSON schemas and localStorage keys backward compatible;
don't touch the other apps' folders; keep copy plain, sentence case, active voice; run
`tools/safety_check.py` (and the tests) before pushing, and add any new outside host to its allowlist with a reason.
