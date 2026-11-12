# Radar — brief for Claude Code

Radar is a personal "interest radar": a fullscreen home-screen web app on the owner's iPhone that shows
wind for their windsports spots, things to do (Den Haag first), and a curated feed of things they'd like
(music, art, food, books & film, meditation, work opportunities). Live at https://almanac-dgf.pages.dev/radar/
(no login page: the passphrase is the only lock, see the vault).

## Privacy: the vault (read this first)

The repo is public, so **all personal data is committed encrypted**. Never commit plain data, the passphrase,
the ntfy topic, or personal details (names, diet specifics, employer, email, exact places) anywhere in the repo,
in commit messages, issue comments or Actions logs.

- `radar/data/<name>.enc.json` for `interests`, `feed`, `taste`, `things`, `gear`: AES-256-GCM, key from the passphrase
  via PBKDF2-SHA256 (salt, iterations and a check value in `radar/vault.json`). The file name is bound in as
  additional data. The app (`js/vault.js`, WebCrypto) and `radar/tools/vault.mjs` (Node, no dependencies) use
  the same format.
- The passphrase is the `RADAR_KEY` environment variable, or `PK` (GitHub Actions, which runs the wind alert and
  the Claude tasks: the `PK` secret). To edit data:
  `node radar/tools/vault.mjs unlock` → edit `radar/.plain/*.json` (git-ignored) → `node radar/tools/vault.mjs lock`
  (only changed files are rewritten) → commit `radar/data/*.enc.json`.
- Notes from the app arrive as GitHub issues titled "Radar note" with a sealed body (`radar-sealed:v1:…`);
  read one with `node radar/tools/vault.mjs open '<body>'` (the text starts with `Title: <real title>`). When you
  close an issue, comment only "Done." — never repeat its content.
- The phone keeps only the derived key (`radar-key`); "Lock Radar on this phone" in You removes it and the
  decrypted cache. The owner types the passphrase once per phone (there is no `/api/key` any more: it relied on a login).
- **The passphrase also guards the server functions** (`functions/api/note.js`, `scout.js`), so the site needs no
  Cloudflare Access login: the phone signs each request (`signed()` in `js/vault.js`: headers `X-Radar-Time` and
  `X-Radar-Sig` = HMAC-SHA256(proof key, time + "\n" + path + "\n" + body), proof key = HMAC-SHA256(vault key,
  "radar-auth-v1")). Cloudflare holds only the proof key as the secret `RADAR_AUTH` (print it with
  `node radar/tools/vault.mjs auth`); it can check requests but can't open the data. Unsigned, wrong, retargeted or
  over-5-minutes-old requests get 401; a missing secret 503 (note) / 404 (scout). `radar/tools/test_functions.mjs` covers this.
- Rotating the passphrase: `RADAR_KEY=<old> node radar/tools/vault.mjs init` prints a new one and re-encrypts;
  then update every place that holds it, including `RADAR_AUTH` in Cloudflare.

## How it works (keep this architecture)

- **Hosting.** Cloudflare Pages serves `main` at https://almanac-dgf.pages.dev/radar/ (public static files: the code is
  public anyway and the data is encrypted; the functions check signatures, see the vault). Cloudflare secrets:
  `RADAR_AUTH`, `GITHUB_TOKEN` (notes), `ANTHROPIC_API_KEY` (instant research). **The owner's rule: ship every change straight to `main` (the
  live app); no preview branches or test updates.** Ask design decisions as multiple-choice questions (dropdowns),
  not in prose. The GitHub Pages copy still works (github.io mode below).
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
  - `js/saved.js` You tab: saved items, bucket list (edit, remove, Brainstorm wishes), Following (artists and concert-alert
    bells), learned, teach (reactions and answers send by themselves 6 s after the last one, with Undo), forms
  - `js/today.js` Today's morning brief, Act now, and the weekend card (Thursday to Sunday)
  - `js/settings.js` Settings (You › gear): status from `status.json`, notification and task switches, monthly budget
  - `js/around.js` Look around (Discover › Nearby) and the Ask Claude offer with instant research
  - `js/vault.js` unlock (passphrase → key), open data files, seal notes, lock
  - `js/do.js` Discover › Go: decide card (yes/no/later, swipe), yes list, filters, Hague-first rule, Find more ideas now
    (`/api/ideas`). The list merges things.json ideas with the feed's concerts, exhibitions and food and a trip's instant
    picks (`data.js` mergeIdeas, ids `f-<feed id>`, `trip: true` skips the distance rule) and instant ideas (`radar-more`)
  - `sw.js` offline cache (network first; only same-site files and Google Fonts; never `/api/`). Bump `CACHE`
    when files change and add new modules to `FILES`.
- **Data files** (encrypted, see the vault; read by the app, written by the Claude tasks — keep them backward compatible):
  - `interests` — `about` (who Radar is for), `do` (what the Do tab should find), `alerts.ntfy` (wind alert topic), wind spots (lat/lon, good directions as degree ranges, optional `water: false` for lakes),
    sport ranges, daylight, minHours, artists, museums, culture, stories, meditation, work, freelance,
    bucketlist, `focus` {place, until, since, region?}, `_rules`.
  - `feed` — `{updated, note, items:[{id, kind, region, title, place, city, start, end, summary, why, url,
    found, flags?, pick?, lat?, lon?, bucket?}]}`. kinds: concert, release, news, exhibition, restaurant, story,
    meditation, work, freelance, bucket. regions: nl, be, de, eu, uk, jp, all (unknown regions show everywhere).
    Work items (kind work/freelance) also take `sub` (event | call | grant | job | freelance | insight), `deadline`
    (YYYY-MM-DD to apply or register by), `org`, `format` (in person / online / hybrid) and `cost`. Without `sub`
    the app guesses: freelance → freelance, has start → event, has end → call, else job.
  - `taste` — `{updated, learned:[sentences], more:[keywords], less:[keywords]}` — ranking and Around me.
  - `things` — the Do tab: `{updated, note, home, ideas:[{id, cat, title, venue, city, area?, start, end, when?,
    summary, why, url?, lat?, lon?, price?, travel?, fit (1–5), major?, fresh?, prep?, flags?, found}]}`.
    `prep` (true or a short "what to do now" text) marks things that need planning ahead: tickets that sell out,
    registration, booking. Ideas starting more than 21 days out only show when they have `prep`; the rest appear
    once they're within three weeks. Don't set prep for things with nothing to do yet (free events, sales not open).
    cats: art, music, stage, film, talk, festival, market, outdoors, calm, food, design, odd, sport. `when` is free text
    for times or recurring things ("Daily 10–16, book a slot"); undated ideas show as "Any time". Ids are stored
    in the owner's answers: keep them stable, never reuse one.
  - `gear` — second-hand finds (`js/gear.js`): `{updated, note, ads:[{id, search (an `interests.wanted` id; missing =
    "wingfoil"), site (marktplaats | 2dehands | kleinanzeigen), country (nl | be | de), type, brand?, title, price (EUR
    number), size?, location?, posted?, found, url, match (hit | maybe), note?, shipping?}]}`. Filled a few times a day
    by the `finds` Claude task. `interests.wanted` lists the searches ({id, title, short?, look_for, fit, check,
    budget, where, queries per site}); the wingfoil search uses the rules in `interests.gear` and shows on the Wind tab
    ("Gear for sale"); every other search shows under **You › Wanted**, one block per search. "Look for something
    second-hand" in Wanted sends a sealed `radar-interest` note starting "Wanted:" that the daily task turns into a
    new `interests.wanted` entry. A search can list extra `sources` (e.g. sloperij networks such as Onderdelenlijn,
    TotalParts, Proxyparts, RRR.lt and Volvo dismantlers for the C30 seats); ads from those carry `site` "sloperij" or
    "parts", `seller` (shown instead of the marketplace name) and optional `warranty`. The phone never contacts those sites; it opens an ad on tap. Ads can be hidden per
    phone (`radar-gear-hidden`).
- **Travel focus:** items in a travel region (today only `jp`) show, and get a region filter, only while
  `focus` points there (`focus.region`, or `focus.place` matches) and `focus.until` hasn't passed.
- **localStorage keys** (never rename; the owner's saves live there): radar-saved, radar-reactions, radar-hidden,
  radar-outbox, radar-gh-key, radar-welcomed, radar-bucket-sent, radar-here, radar-wind, radar-water, radar-cache,
  radar-around (last Around me result), radar-scout (last city sent), radar-key (vault key), radar-locked,
  radar-do (Do answers), radar-do-view (Do filters), radar-picks, radar-gear-hidden, radar-work (Work tracker),
  radar-settings, radar-more (instant ideas), radar-pane (Discover pane), radar-bucket-edits, radar-follow,
  radar-wind-place, radar-watch, radar-places, radar-wanted-edits, radar-work-seen, radar-scout-wx, radar-scout-hidden, radar-scout-sea, radar-companies, radar-go-seen, radar-ad-votes, radar-backup-at, radar-backup-sent, radar-restore-offered, radar-watch-hidden.
  sessionStorage: radar-reload-for.
- **Notes to Claude** (`js/notes.js`): add interest (`radar-interest`), bucket wish (`radar-bucket`), reactions
  (`radar-feedback`), city to research (`radar-location`, title `I'm in <city, country> until <YYYY-MM-DD>`).
  Every note is sealed before it leaves the phone (generic title, encrypted body). Do answers go with the
  reactions in `radar-feedback` as lines `yes|no | do:<cat> | <title> | <city> | id: <id>`.
  On the Cloudflare site they POST `{title, body, label}` to `/api/note` (`functions/api/note.js` files a GitHub
  issue with a token kept in Cloudflare). On github.io/localhost they use a GitHub token the owner pastes in Saved
  (kept only on the phone). Anything unsent waits in `radar-outbox` and retries when online. Never open GitHub
  in the browser. The daily task handles interests/feedback/bucket; an hourly task handles `radar-location`
  notes and adds researched items for that city to feed.json within the hour.
- **Around you** (`js/around.js`): one **Look around** button, only on tap. Geolocation (distinct messages for denied /
  timeout / unavailable, with the iOS Settings path) → Overpass (overpass-api.de, then overpass.kumi.systems, then
  overpass.private.coffee; 20 s timeout each, GET) and Wikipedia geosearch in parallel, so results appear even
  when Overpass is down. Merged, de-duplicated, ranked (names in interests count most, taste words a little),
  grouped: Art & museums, Zen & quiet places, Food that may suit you (only places with OSM `diet:*` tags, always
  with "check with staff"), Nature & viewpoints, Landmarks & architecture. A switch changes the range: Walking
  distance (2.5 km) or Whole city (Nominatim reverse, zoom 10, ~10–12 km of the centre), reusing the same position.
  Away from home (more than 30 km from Den Haag) it names the city and **offers** to ask Claude to research it
  ("Here until" date, default focus.until when there, else 3 days); only a tap on "Ask Claude about <city>" sends
  the radar-location note. After that, changing the date sends one update; the same city isn't resent within 12 hours.
  At home nothing is offered or sent, and Walking distance doesn't call Nominatim.
  **Instant research:** on the Cloudflare site the tap first calls `/api/scout` (`functions/api/scout.js`: Claude API
  with web search, needs the Cloudflare secrets `ANTHROPIC_API_KEY` and `RADAR_AUTH`, signed requests only). The picks (feed-item format, escaped,
  `picked: true`) show at once, are kept in `radar-picks` until the stay ends and join Explore; the sealed note then
  carries them so the hourly task checks them and puts the good ones in the feed. Without the secret, or on failure,
  the hourly task researches from the note as before, and the box says why instant research didn't run (secret
  missing = 404, sign-in expired, or no answer). The request carries the city, dates and the owner's tastes
  from interests (no position).
  What leaves the phone: coordinates to OpenStreetMap, Wikipedia and (Whole city or away) Nominatim, on tap; the
  city name and dates to Claude only when asked.
- **Expired sign-in** (only while Cloudflare Access is still switched on in front of the site): an expired session turns the site's own requests into redirects to the
  login page, so the app could silently stay on an old copy and notes would only queue. `checkVersion` (on open and on
  every return to the front), `/api/note` and `/api/scout` fetch with `redirect: "manual"`; an opaque redirect or a
  non-JSON 401/403 shows the **Sign in** bar (`#signin`, `signedOut()` in `js/notes.js`), which reloads through the login.
- **Concert alerts:** the `concerts` Claude task checks every evening whether an artist in
  `interests.concertAlerts.artists` has announced a show (own concert or festival slot) in the Netherlands, Belgium or
  Germany near the border, and pushes a notification once per show. Shows already notified are listed (by
  artist|date|city) in `interests.concertAlerts.notified`; the daily update reads the same list so nobody is told twice.
  New shows also go into the feed as `concert` items.
- **Claude tasks** (`.github/workflows/radar-tasks.yml`, `radar/tools/task.py`): GitHub Actions runs Claude Code for
  `daily` (~06:52), `inbox` (hourly, only when the phone sent a city/interest/bucket note), `finds` (08:10, no web searches)
  `concerts` (Sundays 18:47) and `work` (Tuesdays and Fridays 08:40: freelance and work leads; its instructions are in
  `BUILTIN` in task.py, kept free of personal details, and the sources it reuses are saved encrypted in
  `interests.freelance.sources`); "Run workflow" runs one by hand. GitHub sometimes skips scheduled runs, so the hourly
  run catches up a daily, finds or work run that didn't happen that day (`radar/status.json`: per task when it last ran,
  the outcome and cost, plus the month's spend; public, nothing personal, shown in Settings). A note from the phone
  starts its task at once (`issues: opened`, only for issues the owner opens). When money runs low, finds, concerts and
  inbox give way first (they need 25% of the paced budget left over). **Low-cost mode** (the owner's limit: about €5 a month
  on the API key): `task.py` runs every task on Haiku with a search allowance and a cap per run (`LOW`,
  `claude --max-budget-usd`), prefixes the instructions with the cost rules, and paces a monthly budget (`BUDGET`, $5, or
  the repo variable `RADAR_BUDGET_USD`) over the month: a run that would pass it is skipped. Spend is kept in
  `radar/spend.json` (amounts only) and every run logs outcome, turns, cost and error kind. With the subscription token
  nothing is billed per use, so the task's own model runs and the guard is off. Their instructions are encrypted in `radar/data/tasks.enc.json`
  (vault name `tasks`; edit with unlock/lock like the rest, never commit them plain). `task.py prepare` unlocks the data into
  `radar/.plain/` and opens the task's notes into `radar/.plain/notes.json`; Claude then runs **without** the passphrase or a
  GitHub token (checkout without credentials) and edits only `radar/.plain/`; `task.py finish` validates the JSON, encrypts
  and commits only the data files (never `tasks`, so a run can't rewrite its own instructions; anything else is discarded),
  closes the notes with "Done." and sends Claude's final message to the phone via ntfy (fixed "nothing new" replies stay
  quiet). The log is public: Claude's output stays in a temp file and the log shows counts only. Secrets: `PK`,
  `ANTHROPIC_API_KEY` (or `PK2`, or `CLAUDE_CODE_OAUTH_TOKEN`), optional `NTFY_TOPIC`. These replaced the Claude cloud routines, which
  couldn't get the passphrase.
- **Wind alert:** `.github/workflows/radar-wind.yml` runs `radar/tools/wind_alert.py` every morning (Actions
  secret `RADAR_KEY`; topic from `alerts.ntfy` or the `NTFY_TOPIC` secret) and pushes to ntfy.sh. The Actions log
  is public: it prints only a count. Keep it working if you touch the wind section.
- **Tests:** `python3 radar/tools/test_app.py [screenshot-dir]` builds a temp copy with made-up data encrypted
  under a throwaway passphrase (it never needs the real key), covers the lock screen, sealed notes and the Do tab,
  serves it, mocks every outside API
  (Open-Meteo, Marine, Overpass + mirrors, Wikipedia, Nominatim, /api/note, GitHub, fonts), runs every tab in
  light and dark at 390×844, 320 px overflow, detail sheet + .ics, offline copy, notes + outbox + github.io
  fallback, Look around (success, Overpass down, location denied, at home, away with the Ask Claude offer); plus JSON validity, `node --check`
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
- Floating capsule tab bar: Today · Discover · Wind · Work · You (`data-v="saved"`; Settings opens from its gear icon,
  `v-settings`). Each thing lives in one place: Today = morning brief + Act now (deadlines, tickets to book, last
  chances, yes-list soon, bucket moments); Discover = For you (one ranked feed with "Because", location filters
  built from the items' regions plus Near me), Go (things to go to), Read & listen (release, story, news, meditation),
  Nearby (Look around), one search box with a clear button over the first three, and a one-tap Find more in For you,
  Go and Read & listen that follows the pane's filters (place, Near me, when, what, search text; `/api/ideas` with
  `where`, or the inbox task); Wind = forecast with a place switch (Home spots, Where I am, Search a place:
  `radar-wind-place`; every place found becomes a kept chip with its spots in `radar-places`, reopened without a search
  within 5 km; Edit removes and reorders spots and removes a kept place, and home edits travel as `homeSpots` in a
  radar-track note so `task.py apply` updates `interests.wind.spots` and the morning alert follows);
  You = jump buttons (Saved, Bucket list, Following, Finds, Learned, Settings), saved, bucket list, Following, Finds
  (each search has Edit: title, a good find, budget, where, or remove; sent as `wanted` in radar-track, applied to
  `interests.wanted`, and finds writes new queries for a changed search) (all second-hand searches, wingfoil first: ad age, price vs similar ads,
  Good deal at 20% under), learned. Everything that lists swipes: rows (right yes/more/Interested, left no/hide/Not for me), ads (right opens,
  left hides), wishes (right edits, left removes), artists (right alerts, left unfollows), Act now (right opens, left
  takes it off). What swipes away gets an Undo notice (`undoable()` in ui.js; wishes and artists only change when it
  runs out). Rows keep
  their order after a reaction until the next load. Mobile-first (390 px), safe-area insets (a paper strip covers the
  status bar), 44 px tap targets. Work holds `work` and `freelance`, kept out of Discover. Work tracker: Interested /
  Applied / Not for me (`radar-work`, sent as a sealed `radar-track` note; Interested gets ntfy reminders 3 days and
  1 day before the deadline from `tools/remind.py`; Not for me hides and teaches). Work filters: "Next deadlines"
  (three nearest), then all leads filtered Everything / Events / Calls & grants / Jobs / Freelance / Reading and by place (Anywhere / Netherlands / Europe, which includes NL / Japan / Global, from `region`), sorted
  by the nearest date to act on (deadline ahead, else event start).
- In list rows the title button stretches over the row (tap anywhere opens it); action buttons sit above that layer.
- **Do rule (the owner's wish):** Den Haag is the most comprehensive; the farther away, the stronger the match
  must be. The app enforces it with `fit`: ≤15 km from Den Haag any fit, ≤40 km 3+, ≤80 km (Amsterdam, Utrecht) 4+, beyond 5.
- **Reactions:** thumbs and yes/no answers send themselves 6 s after the last one; the notice says so and offers Undo
  (takes back the whole batch: reactions, answers and hides). You › Teach it more sends at once.

## Trip mode, surf, calendar, padel, price watch

- **Trip mode** (`tripPoint()` in data.js): a Wind place other than home, or a Look around more than 30 km from Den Haag
  in the last two days. Distances, the "Den Haag" filter and band, For you ranking (+40 near the trip), Act now and
  Find more all follow that place; Discover shows a banner with Padel nearby and Back home (`settings.tripOff`).
- **Surf layer:** Wind fetches daily max wave height, period and direction (Open-Meteo Marine) for sea spots: a row
  under each ribbon (bold at 0.8 m+ and 7 s+) and a sentence in the day details.
- **Calendar:** "Add my plans to the calendar" (Go and Work) downloads one .ics with yes-list things that have a date
  and the deadlines of leads marked Interested or Applied (`icsAll` in detail.js).
- **Padel when away:** Padel nearby asks for courts and open matches (Playtomic, clubs) as ideas with cat `sport`;
  city notes ask for padel too.
- **Price watch:** the eye button on an ad (`radar-watch`, sent in `radar-track` as `watch`, applied to
  `interests.watch`); finds re-opens watched ads each run, sets `was` on a drop (the app shows the old price and
  "Price dropped") or `gone`, and names drops in its push. Bucket wishes keep a `price` {amount, currency, what, at,
  url}; a clearly lower price becomes a "Price drop:" bucket item.

## Settings, tracker, bucket edits and artists (no Claude)

The phone sends small sealed JSON notes: `radar-settings` ({notify, tasks, budget}) and `radar-track` ({work, bucket,
artists, spend}). `task.py apply` (first step of every task run, and right away when such a note arrives through the
`issues: opened` trigger) merges them into the encrypted interests: `settings`, `tracked`, `bucketlist` edits/removals,
`artists` and `concertAlerts.artists`, and adds instant-research spend to the ledger. `settings.notify.<key> === false`
silences a push (wind, weekend, deadlines, work, concerts, daily, finds); `settings.tasks.<task> === false` skips
finds, concerts or work; `settings.budget` (1–100 USD) replaces the default. Instant calls (`/api/ideas` for Find more
ideas and the bucket brainstorm, `/api/scout` for cities) run on Haiku and report their cost.

## Do research (daily task)

Keep `things` a long list (about 30–60 live ideas) to say yes or no to. Den Haag and around first and fullest
(museums, galleries such as West, Stroom, Nest and The Grey Space in the Middle, Amare/NDT/Residentie Orkest, Paard,
Korzo, Koninklijke Schouwburg, Filmhuis, festivals like Crossing Border and Rewire, markets, dunes, beach and gardens);
then a spread of other places (Rotterdam and Leiden fit 3+, Haarlem, Amsterdam and Utrecht 4+, day trips such as Otterlo or Eindhoven 5); the city filter builds itself from the cities in the list. Mix the major events with fresh, unexpected ideas (`fresh: true`) that
read the owner's vibe. Every dated item needs a real URL you opened. Learn from `yes | do:` / `no | do:` lines:
more of what gets yes, less of what gets no. Remove past ideas; keep ids stable.

## About the user

Everything personal (sports, diet rules, taste, work, travel focus) lives in the encrypted `interests` (`about`,
`do`, `focus`). Read it there; don't copy it into this file or any other public file.

## Bucket list

`interests` has a `bucketlist` array: `{id, title, good_time, where, added, checked?, sources?}`. You › Bucket list
shows each wish, when it was last checked, its matching feed items, and an "Add to bucket list" form that sends a note
labelled `radar-bucket` (kept locally as "sent" until it appears in `interests`); inbox adds it and does a first check
right away. The `bucket` task (BUILTIN in task.py; Sun, Mon, Wed, Fri 10:25) checks the 3 wishes checked longest ago,
keeps good pages per wish in `sources`, sets `checked`, and writes feed items with `kind: "bucket"` and
`bucket: "<wish id>"`; the app ranks them high and labels them "Good time". Brainstorm wishes uses `/api/ideas` when
Cloudflare has a Claude key, otherwise a sealed `radar-ask` note that inbox answers in
`interests.suggestions.bucket` ({at, around, items}), shown as "Ideas from Claude" under the bucket list (the app
reloads every 30 s until it arrives). "Find more ideas now" falls back the same way (inbox adds ideas to things).

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
- **New work leads:** Work opens with a "New leads" section (`#workNew`) and the Work tab shows a count. A lead is new when it was found in the last 7 days and isn't in `radar-work-seen`; leaving the Work tab (the `radar-tab` event) marks them seen. On first run, only leads from the last 3 days count as new. The brief's "new leads" link jumps to `#hNewLeads`.
- **Windsurf trips** (Wind tab, `js/scout.js`, `trips.json`): scouts trips from the Netherlands with good wind, 14 °C or
  warmer by day and low travel costs. `trips.json` holds public destinations (coordinates, good directions, car km and
  tolls from The Hague, or airport, typical fares [rest of year, peak] and flight season). One Open-Meteo request
  (16 days, `timezone=auto`, cached 3 h in `radar-scout-wx`) feeds two lists: Weekends by car (next two weekends, Sat and
  Sun ride, spots up to 900 km) and 4–7 day trips by plane or car (best window per spot from the day after tomorrow, at
  least 3 windsurf days and half the days; "Long range" past day 8). A windsurf day = a run of max(3, minHours) daylight
  hours in the windsurf range with a good direction. Costs: car = km × 2 × fuel + tolls × 2; plane = typical fare. The
  daily task runs `tools/trips.py` (same rules, flight trips only) in `prepare`, writes the top 3 to `.plain/trips.json`
  and asks Claude for live fares into `interests.fares` {at, items: [{spot, out, back, from, price, airline, url}]}; the
  app uses a live fare less than 3 days old when spot and departure (±1 day) match. Swipe left hides a spot for two
  weeks (`radar-scout-hidden`), with Undo. When adding destinations, keep ids stable and the data public and generic.
  Each trip shows air (mean daily high) and water temperature: Open-Meteo Marine daily `sea_surface_temperature_max`
  (7 days, cached 6 h in `radar-scout-sea`, after the trips draw); lakes have `water: false`; trips starting after day 7
  use the latest day known.
- **Companies you track** (Work, `js/companies.js`): `interests.companies` [{name, bell, careers?, added, checked?}].
  Track by name (+ optional careers page) or with "Track <org>" in a work lead's details; tap a company to filter All
  leads to it (`state.company`, matched on `company` or `org`); the bell switches pushes for its new roles; swipe right
  toggles the bell, left stops tracking (Undo). Phone changes wait in `radar-companies` until the data shows them and
  travel in radar-track as `companies` {add: [{name, bell, url}], remove, bell}; `task.py apply_companies` merges them.
  The `work` task opens each company's careers page (finds and saves it when missing, at most 2 searches a run), adds
  fitting roles with org/company = the tracked name, and names new roles at bell companies first in its push.
  Edit (pencil, `edit` {oldName: {name, url, look_for}}; empty url clears `careers`) changes name, careers page and
  `look_for` (what counts as relevant there), or removes. The work task lists every open role at a tracked company with
  `fit` 1–5 against the profile and `look_for`; fit 4+ is relevant: the row shows "At <company>" and its `why`
  (`companyFlag`, hooked into feed.js rows via `setCompanyFlag`), and only those are pushed for bell companies.
- **Your work search** (Work, `js/workprefs.js`): fixed choices only (no free text, nothing preset in the public code):
  Show first (`order`: date | freelance | job | call | event; sorts Everything and New leads by kind, then date),
  New leads (`volume`: few | mix | wide), Ways of working (`formats`), Level (`levels`: mid, senior, director = strong
  fit only) and Time for freelance (`freelance`: month | 1-2 | 3-5). Kept in radar-settings `work`, sent with the
  settings note; `task.py apply` keeps only known values in `interests.settings.work`, and the work prompt follows it.
- **Startups** (Work): a "Startups" filter chip and a "Startups · <role>" label (`flag eco`) for items with `eco: true`
  and `eco_role` mentor | programme | jury | coach. Your work search has a "Startup and accelerator work" switch
  (`settings.work.startups` {on, roles, orgs: accelerators | funds | public | corporate, places: nl | eu | jpeu | online, xb: entry | agencies | jpcorp | tenders});
  switching it on picks every choice, chips leave one out. The work task looks for these only when it's on, keeps good
  programme pages in `interests.freelance.sources` (what = "startups") and aims for 2–4 live eco items.
- **Regenerative** (Work): regenerative economics and finance are always part of the work search (no setting); the work
  task marks matching items `theme: "regen"` and the row shows a "Regenerative" label. Startup work is on by default
  too: with no `settings.work.startups` the app shows the switch on with every choice and the task uses them all.
- **Tab numbers** go once seen: Work's count clears when you open Work (its New leads list stays until you leave);
  Discover's counts only Go ideas new since you last opened Discover (`radar-go-seen`), not every undecided idea.
- **Done** (Go): on your list, the X becomes "Done" (swipe left too): `radar-do[id].done`, still a yes for Radar's
  learning, gone from the lists, Act now and the brief. Not the same as "Not for me".
- **One show per artist:** for artists in `interests.artists`/`concertAlerts.artists` the app shows only the nearest
  upcoming concert (`oneShowPerArtist` in data.js; saved or yes-answered dates stay); the tasks keep one concert item
  per artist with the other dates in its summary. Following an artist or switching its bell on sends a "Concert check:"
  interest note, so the inbox task checks and pushes new shows right away instead of waiting for Sunday.
- **Ads without their own link** (the scan only had the search page): the row opens a site search for the ad's title
  and says so (`adLink` in gear.js); the finds task must re-find the real ad link.
- **Test notification** (Settings, under the alert topic): "Send a test notification" posts one message from the phone
  to `https://ntfy.sh/<alerts.ntfy>` (only on tap; the topic must match `[A-Za-z0-9_-]{1,64}`).
- **Notification options** (Settings): Quiet hours (`settings.alerts.quiet` {on, from, to}, hours in Amsterdam time; a push
  in those hours gets ntfy's `At` header for the end), and under each switch "Options": Importance (`alerts.level.<key>`
  loud | normal | silent = ntfy priority 4 / 3 / 2), for the wind alert Sports, At least (hours) and Look ahead
  (`alerts.wind` {sports, minHours, days}), for deadlines When (`alerts.remind` 3-1 | 7-2 | 1 | 7-3-1). All pushes go
  through `tools/push.py` (wind_alert.py, remind.py, task.py notify); `task.py apply` keeps only known values. The
  settings note carries everything (`settingsNote` in settings.js, also used by workprefs.js).
- **No useless pushes:** every task prompt ends with `PUSH_RULE` (at most 3 new things by title, else exactly
  "Nothing new."); `worth_pushing` drops empty or "nothing new" replies and a message already pushed today for the same
  key (short hashes in status.json `pushed`, saved before the commit). A scheduled run of a task that already ran
  today (after the hourly catch-up) runs as inbox instead (radar-tasks.yml), so it can't run and push twice.
- **Rate an ad** (Finds): "Good" / "Not this" under each ad open a sheet of reasons (price, far, size, model, condition,
  seller; for good: price, model, near, condition). Kept in `radar-ad-votes`, sent in radar-track as `adFeedback`;
  `apply_ad_feedback` keeps the latest 40 per search in `interests.adFeedback`; the finds prompt gets `AD_FEEDBACK`
  (find more like up, skip down patterns, never re-add a down ad, adjust look_for). "Not this" also hides the ad (Undo).
- **Backup** (Settings, `js/backup.js`): the phone-only lists (see `KEYS` there and `BACKUP_KEYS` in task.py) are
  gzipped, sent as a sealed `radar-backup` note and stored by `task.py apply` (`save_backup`) as data/backup.enc.json
  (vault name `backup`), with `interests.backupAt` set. Weekly by itself (the first a day after Radar starts on a phone),
  "Back up now", "Restore from backup" (replaces those keys, reloads), and a one-time restore offer on a phone with
  nothing saved when `backupAt` exists. Never in it: the key, the data cache, the outbox, the GitHub token, caches.
- **Watching** (`watch` task, BUILTIN in task.py, Mon/Tue/Thu/Sat 12:17 Amsterdam, LOW (0.07, 3), switchable, push key
  `watch`): the 2 monitors checked longest ago, so each about twice a week: holiday (rules and prices in the spots of
  casaviento's `D` array), houses (`settings.house` {areas: coast | wassenaar | westland | delft | leiden, price: 500 |
  750 | 1000 | 1000+, rooms, outdoor: garden | any, type: house | any}; skipped when unset), newbuild (Zuid-Holland),
  policy (climate-finance policy and the funding calendar). `interests.watching.<k>` {checked, summary, items[≤6],
  sources}. `js/watching.js` shows holiday, houses (with the house choices) and newbuild under You › Watching and
  policy under Work › Policy and funding; rows swipe (right opens, left hides in `radar-watch-hidden`, Undo).
