# Radar — brief for Claude Code

Radar is Guus's personal "interest radar": a fullscreen home-screen web app on his iPhone that shows
wind for his windsports spots, and a curated feed of things he'd like (music, art, food, books & film,
meditation, climate-work opportunities). Live at https://2vrg2vjks9-wq.github.io/Almanac/radar/

## How it works (keep this architecture)

- **Static site, no build step.** Everything is in `radar/index.html` (inline CSS + JS, vanilla ES5-ish),
  served by GitHub Pages from `main`. The repo is **public**: never commit secrets, tokens or personal
  data beyond what's already in the JSON files.
- **Data files** (read by the app, written by the daily Claude scheduled task — keep them backward compatible):
  - `radar/interests.json` — what to watch: wind spots (lat/lon, good wind directions as degree ranges),
    sport ranges (wingfoil 10–20 kn, windsurf 20–30 kn), artists, museums, restaurants rules, culture,
    stories, meditation, work, `focus` (current travel city + until date), `_rules`.
  - `radar/feed.json` — `{updated, note, items:[{id, kind, region, title, place, city, start, end, summary,
    why, url, found, flags?, pick?, lat?, lon?}]}`. kinds: concert, release, exhibition, restaurant, story,
    meditation, work, news. regions: nl, be, de, eu, uk, jp, all.
  - `radar/taste.json` — `{updated, learned:[sentences], more:[keywords], less:[keywords]}` — used for ranking.
- **Live data in the browser:** wind from Open-Meteo (`api.open-meteo.com`, no key, CORS ok),
  "Around me" from OpenStreetMap Overpass (`overpass-api.de`) and city lookup from Nominatim.
- **Feedback loop:** 👍/👎/save/hide are stored in `localStorage`; "Send" opens a pre-filled GitHub issue
  (labels `radar-feedback`, `radar-interest`, `radar-location`) which the daily task processes and closes.
  No tokens on the phone — keep it that way.
- **Wind alert:** `.github/workflows/radar-wind.yml` runs `radar/tools/wind_alert.py` every morning and
  pushes to ntfy.sh. Keep it working if you touch `interests.json`'s wind section.
- **Offline:** `radar/sw.js` (network-first, cache fallback). Bump the cache name when you change files.

## Design system (keep it; refine, don't replace)

- Sea-instrument feel. Palette tokens in `:root` (light) and `prefers-color-scheme: dark` ("night sea"):
  mist `#e4eae9`, foam `#f7faf9`, deep `#0e2a33`, slate `#4a5f67`, haze `#8b9b9f`, marine `#1b5e7a`,
  kelp `#2f8660` (wingfoil), buoy `#dba73a` (windsurf), flag `#b8452f` (warnings / over 30 kn).
- Type: Familjen Grotesk (interface), Literata (reading text: summaries, explanations).
- The one bold element is the **wind ribbon** (one bar per daylight hour, height = strength, colour =
  rideable for which sport, hatched = wrong direction). Everything else stays quiet: grouped sheets,
  sentence case, no all-caps labels, no identical boxed cards, no decorative gradients.
- Bottom tab bar: Today · Wind · Explore · Saved. Mobile-first (390 px), safe-area insets, 44 px tap targets.

## About Guus (only what the app needs)

Wingfoils (10–20 kn) and windsurfs (20–30 kn) at Scheveningen, Oostvoornse Meer and a lake near Groet
(currently guessed as Amstelmeer). Diet: gluten-, dairy-, egg- and oat-free — any food suggestion must be
flagged when safety is uncertain. Loves contemplative art in nature and strong architecture (Ando, Noguchi,
Karavan, Turrell, Murou Art Forest, D.T. Suzuki Museum), Bon Iver / Ben Howard / Nick Mulvey, Ted Chiang,
Arrival, Shantaram, Eastern Body Western Mind, zen/meditation retreats; works in climate-adaptation finance.
In Japan until 9 Oct 2026, back in the Netherlands (Den Haag/Rotterdam area) from 10 Oct.

## Freelance

`interests.json` has a `freelance` section (his profile and what to look for). Feed items for it use
`kind: "freelance"`. The app needs a **Freelance** filter (its own colour dot) and freelance items may
appear in "Worth your attention" when a deadline is close.

## Improvement pass to do now

Work through these in order, committing after each (small commits, clear messages), testing as you go:

1. **Item detail sheet.** Tapping an item opens a bottom sheet with the full summary, why it matches,
   flags, dates, a map link (when lat/lon), "Open details" and **Add to calendar** (generate an `.ics`
   download client-side for items with a start date). Close by swipe-down or tap outside. Keep 👍/👎/save there too.
2. **Water temperature + wetsuit hint** per spot on the Wind tab, from Open-Meteo Marine
   (`https://marine-api.open-meteo.com/v1/marine?latitude=..&longitude=..&daily=sea_surface_temperature_max`
   or hourly `sea_surface_temperature`). Show e.g. "Water 15°C — 4/3 wetsuit". Degrade gracefully for lakes
   or if the API fails.
3. **Refresh and freshness.** Pull-to-refresh (or a clear refresh control) that re-fetches feed + wind,
   and an unobtrusive "Updated …" line. Handle offline state with the cached copy and say so plainly.
4. **First-run welcome** (once, stored in localStorage): three short cards — what Radar is, how 👍/👎 teach it,
   add to home screen + ntfy topic `radar-wind-f13296657ff9` for wind alerts. Skippable.
5. **Today tab polish:** if the feed has "Ends soon" items, surface them first; show the next wind session
   even when it's days away; keep the page calm (max 4 items in "Worth your attention").
6. **Accessibility & quality:** visible focus, aria labels, reduced-motion respected, contrast AA in both
   themes, no layout shift when wind loads, no horizontal scroll at 320 px.
7. **Freelance category:** add `freelance` to the Explore filters (label "Freelance"), KLABEL and a KCOLOR
   (pick one that fits the palette), and show deadlines prominently ("Apply by …" using `end`).
8. **Tests:** add `radar/tools/test_app.py` (Playwright, Python) that serves the repo locally, mocks
   Open-Meteo/Overpass/Marine responses, loads each tab in light and dark at 390×844, asserts no JS errors,
   and saves screenshots to a temp dir. Run it before every commit.

Rules: don't add frameworks or a build step; keep all JSON schemas backward compatible (the daily task
writes them); don't touch the almanac folders (`polder/`, `nakasendo/`, `curiosity/`); keep copy plain,
sentence case, active voice. Push to `main` when done and summarise what changed.
