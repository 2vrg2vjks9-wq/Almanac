// Everything Radar keeps on the phone. Key names are part of the contract with earlier
// versions (the owner's saved items and reactions live under them): never rename them.
export const KEYS = {
  saved: "radar-saved",          // {itemId: 1}
  reactions: "radar-reactions",  // {itemId: {v: 1|-1, t, title, kind, why, sent}}
  hidden: "radar-hidden",        // {itemId: 1}
  outbox: "radar-outbox",        // [{title, body, labels: [label]}] notes waiting to send
  ghKey: "radar-gh-key",         // GitHub token, only used on github.io (never in the repo)
  welcomed: "radar-welcomed",    // true after the first-run welcome
  bucketSent: "radar-bucket-sent", // [{title, good_time, added}] wishes sent but not yet in interests.json
  here: "radar-here",            // {lat, lon, t} last position from "Look around here"
  wind: "radar-wind",            // {t, res} last Open-Meteo forecast
  water: "radar-water",          // {spotId: °C}
  cache: "radar-cache",          // {c: interests, f: feed, t: taste, x: things} last good data files (decrypted, on this phone only)
  around: "radar-around",        // last Around me / city guide result
  scout: "radar-scout",          // {city, until, sent} last city sent to Claude
  key: "radar-key",              // vault key derived from the passphrase (never leaves the phone)
  locked: "radar-locked",        // true after "Lock Radar on this phone"
  do: "radar-do",                // {ideaId: {v: 1 yes | -1 no | 0 later, t, title, cat, city, sent}}
  doView: "radar-do-view",       // {when, city, cat} last Do filters
  gearHidden: "radar-gear-hidden", // {adId: time} gear ads hidden on this phone
  picks: "radar-picks",          // {place, until, t, items} Claude's instant picks for the current trip
  work: "radar-work",            // {itemId: {state: interested|applied|skip, t, title, deadline, url, org}} Work tracker
  settings: "radar-settings",    // {notify: {key: bool}, budget, tasks: {key: bool}, sent} Settings, sent sealed to Radar
  more: "radar-more",            // {t, items} ideas found right away by "Find more ideas now", until the tasks keep them
  pane: "radar-pane",            // last Discover pane: foryou | go | read | near
  windPlace: "radar-wind-place", // {mode: home | here | search, name, lat, lon, spots} where Wind shows the forecast for
  follow: "radar-follow",        // {add: [names], remove: [names], alerts: {name: bool}} artist changes not yet in interests
  bucketEdits: "radar-bucket-edits", // {wishId: {title, good_time, where, remove, t}} edits sent but not yet in interests
};

export function get(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
}
export function set(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* private mode or full: keep going */ }
}

// Live copies shared by the modules; write back with save(name).
export const S = {
  saved: get(KEYS.saved, {}),
  reactions: get(KEYS.reactions, {}),
  hidden: get(KEYS.hidden, {}),
  outbox: get(KEYS.outbox, []),
  ghKey: get(KEYS.ghKey, ""),
  bucketSent: get(KEYS.bucketSent, []),
  here: get(KEYS.here, null),
  do: get(KEYS.do, {}),
  work: get(KEYS.work, {}),
  settings: get(KEYS.settings, {}),
  bucketEdits: get(KEYS.bucketEdits, {}),
  follow: get(KEYS.follow, { add: [], remove: [], alerts: {} }),
};
export function save(name) { set(KEYS[name], S[name]); }
