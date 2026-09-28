# Radar — brief for Claude Code

Radar is a personal "interest radar": a fullscreen home-screen web app on his iPhone that shows
wind for his windsports spots, and a curated feed of things he'd like (music, art, food, books & film,
meditation, climate-work opportunities). Live at https://almanac-dgf.pages.dev/radar/ (behind Cloudflare Access).

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
  - `js/saved.js` Saved tab: bucket list, learned, teach (reaction notice + tab dot), add interest/wish forms
  - `js/around.js` Look around here and Scout this city
  - `sw.js` offline cache (network first; only same-site files and Google Fonts; never `/api/`). Bump `CACHE`
    when files change and add new modules to `FILES`.
- **Data files** (read by the app, written by the Claude tasks — keep them backward compatible):
  - `interests.json` — wind spots (lat/lon, good directions as degree ranges, optional `water: false` for lakes),
    sport ranges, daylight, minHours, artists, museums, culture, stories, meditation, work, freelance,
    bucketlist, `focus` {place, until, since, region?}, `_rules`.
  - `feed.json` — `{updated, note, items:[{id, kind, region, title, place, city, start, end, summary, why, url,
    found, flags?, pick?, lat?, lon?, bucket?}]}`. kinds: concert, release, news, exhibition, restaurant, story,
    meditation, work, freelance, bucket. regions: nl, be, de, eu, uk, jp, all (unknown regions show everywhere).
  - `taste.json` — `{updated, learned:[sentences], more:[keywords], less:[keywords]}` — ranking and Around me.
- **Travel focus:** items in a travel region (today only `jp`) show, and get a region filter, only while
  `focus` points there (`focus.region`, or `focus.place` matches) and `focus.until` hasn't passed.
- **localStorage keys** (never rename; the owner's saves live there): radar-saved, radar-reactions, radar-hidden,
  radar-outbox, radar-gh-key, radar-welcomed, radar-bucket-sent, radar-here, radar-wind, radar-water, radar-cache,
  radar-around (last Around me result), radar-scout (last city sent). sessionStorage: radar-reload-for.
- **Notes to Claude** (`js/notes.js`): add interest (`radar-interest`), bucket wish (`radar-bucket`), reactions
  (`radar-feedback`), scouted city (`radar-location`, title `I'm in <city, country> until <YYYY-MM-DD>`).
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
- **Wind alert:** `.github/workflows/radar-wind.yml` runs `radar/tools/wind_alert.py` every morning and pushes to
  ntfy.sh. Keep it working if you touch `interests.json`'s wind section.
- **Tests:** `python3 radar/tools/test_app.py [screenshot-dir]` serves the repo, mocks every outside API
  (Open-Meteo, Marine, Overpass + mirrors, Wikipedia, Nominatim, /api/note, GitHub, fonts), runs every tab in
  light and dark at 390×844, 320 px overflow, detail sheet + .ics, offline copy, notes + outbox + github.io
  fallback, Around me (success, Overpass down, location denied) and Scout; plus JSON validity, `node --check`
  and the safety check. The Cloudflare site is simulated as `radar.localhost`. Run it before every commit and
  look at the screenshots.

## Design system (keep it; refine, don't replace)

- Sea-instrument feel. Tokens in `app.css` `:root` (day sea) and `prefers-color-scheme: dark` (night sea):
  `--bg` mist `#e5ebea`, `--surface` foam `#f8fbfa`, `--ink` deep `#0e2a33`, `--ink-2` slate, `--ink-3` haze,
  marine `#1b5e7a`, kelp `#2f8660` (wingfoil), buoy `#dba73a` (windsurf), flag `#b8452f` (warnings / over 30 kn).
- Type: Familjen Grotesk (interface), Literata (reading text: summaries, explanations).
- The one bold element is the **wind ribbon** (one bar per daylight hour, height = strength, colour =
  rideable for which sport, hatched = wrong direction, dotted lines at the wingfoil and windsurf thresholds).
  Everything else stays quiet: grouped sheets,
  sentence case, no all-caps labels, no identical boxed cards, no decorative gradients.
- Bottom tab bar: Today · Wind · Explore · Work · Saved. Mobile-first (390 px), safe-area insets, 44 px tap targets.
- **Work** tab holds `work` and `freelance` items (filter: Everything / Jobs & calls / Freelance; freelance sorted by deadline).
  They are kept out of Explore; Today still surfaces them when a deadline is close.
- **Reactions:** a new 👍/👎 pops a short notice (fades after 5 s, × closes it, pauses while touched). The lasting place
  to send them is Saved › Teach it more, flagged by a red dot on the Saved tab. Don't make the notice sticky again.

## About the user (only what the app needs)

Wingfoils (10–20 kn) and windsurfs (20–30 kn) at the spots in `interests.json`. Has strict dietary
restrictions: never claim a place is safe unless the data says so, and always show flags. Loves
contemplative art in nature and strong architecture, the artists and stories listed in `interests.json`,
zen/meditation; works in climate-adaptation finance. Travel is handled by `interests.json` `focus`.
Don't add personal details to this public repo.

## Bucket list

`interests.json` has a `bucketlist` array: `{id, title, good_time, where, added}`. The Saved tab shows each
wish, its matching feed items, and an "Add to bucket list" form that sends a note labelled
`radar-bucket` (and keeps the wish locally as "sent" until it appears in `interests.json`). The daily task
adds the wish, then checks every wish each morning for a genuinely good moment (price drop, season, rare
availability) and writes feed items with `kind: "bucket"` and `bucket: "<wish id>"`; the app ranks them
high and labels them "Good time". A new bucket item is always worth a push notification.

## Freelance

`interests.json` has a `freelance` section (his profile and what to look for). Feed items for it use
`kind: "freelance"`. The app needs a **Freelance** filter (its own colour dot) and freelance items may
appear in "Worth your attention" when a deadline is close.
For freelance items, `end` is the application deadline: the app shows "Apply by …", sorts the Freelance
filter by it, flags it as "Deadline soon" within 14 days and offers the deadline as a calendar entry.

## Rules

Don't add frameworks or a build step; keep all JSON schemas and localStorage keys backward compatible;
don't touch the other apps' folders; keep copy plain, sentence case, active voice; run
`tools/safety_check.py` (and the tests) before pushing, and add any new outside host to its allowlist with a reason.
