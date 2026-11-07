// Data files written by the daily and hourly Claude tasks: interests, feed, taste and things (the Do
// tab). They are committed encrypted as data/<name>.enc.json (see vault.js); this opens them, falls
// back to the last good copy on this phone when offline, and holds the travel-focus rules.
import { d, today } from "./util.js";
import { get, set, KEYS } from "./store.js";
import { open, unlocked } from "./vault.js";

export const Q = { q: "" }; // the Discover search, shared by Go and Read & listen
export const D = { config: null, feed: null, taste: { learned: [], more: [], less: [] }, things: { ideas: [] }, gear: { ads: [] }, byId: {}, source: null };

// Tiny event bus so modules can redraw after reactions, saves or new data.
const bus = new EventTarget();
export const on = (name, fn) => bus.addEventListener(name, (e) => fn(e.detail));
export const emit = (name, detail) => bus.dispatchEvent(new CustomEvent(name, { detail }));

async function fetchData(name) {
  const r = await fetch("data/" + name + ".enc.json?v=" + Date.now(), { cache: "no-store" });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return JSON.parse(await open(await r.json(), name));
}

function adopt(config, feed, taste, things, gear) {
  D.gear = gear && Array.isArray(gear.ads) ? gear : { updated: null, ads: [] };
  D.config = config;
  D.feed = feed && Array.isArray(feed.items) ? feed : { updated: null, items: [] };
  D.taste = taste || { learned: [] };
  D.things = things && Array.isArray(things.ideas) ? things : { updated: null, ideas: [] };
  D.baseIdeas = D.things.ideas.slice();
  mergePicks();
}

// --- One list of things to go to ---------------------------------------------------------------
// Discover › Go shows everything you could go to in one list: the Do ideas from things.json, plus the
// feed's concerts, exhibitions and restaurants (and a trip's instant picks), turned into ideas so they can
// be answered yes or no like the rest. Read & listen keeps releases, stories, news and meditation.
export const GO_KINDS = { concert: "music", exhibition: "art", restaurant: "food" };
const GO_FIT = { concert: 5, exhibition: 4, restaurant: 3 }; // artist and museum research is a strong match
function feedIdea(it) {
  return {
    id: "f-" + it.id, from: it.id, cat: GO_KINDS[it.kind] || "odd", title: it.title, venue: it.place, city: it.city,
    start: it.start, end: it.end, summary: it.summary, why: it.why, url: it.url, lat: it.lat, lon: it.lon,
    flags: it.flags, found: it.found, fit: GO_FIT[it.kind] || 3,
    trip: isTravelRegion(it.region) || !!it.picked, // trip picks show while the stay lasts, wherever they are
  };
}
function mergeIdeas() {
  const base = (D.baseIdeas || []).filter((x) => x && x.id && x.title);
  const seen = new Set(base.map((x) => String(x.title).toLowerCase()));
  const add = (x) => { const k = String(x.title).toLowerCase(); if (seen.has(k)) return; seen.add(k); base.push(x); };
  const M = get(KEYS.more, null);
  (M && Array.isArray(M.items) ? M.items : []).filter((x) => x && x.title && !past(x)).forEach(add);
  D.feed.items.filter((it) => isGo(it) && visible(it)).forEach((it) => add(feedIdea(it)));
  D.things.ideas = base;
}
// Claude's instant picks for a trip live on the phone until the daily task has them in the feed,
// and only while the stay lasts.
export function mergePicks() {
  const P = get(KEYS.picks, null), items = D.feed.items.filter((it) => !it.picked);
  const live = P && (!P.until || d(P.until) >= today()) ? P.items || [] : [];
  const titles = new Set(items.map((it) => String(it.title).toLowerCase()));
  D.feed.items = items.concat(live.filter((p) => !titles.has(String(p.title).toLowerCase())));
  D.byId = {};
  D.feed.items.forEach((it) => { D.byId[it.id] = it; });
  mergeIdeas();
}

// Returns "live", "cache", "locked" (no key on this phone) or null (nothing to show yet).
export async function loadData() {
  if (!unlocked()) { D.source = "locked"; return D.source; }
  try {
    const [c, f, t, x, g] = await Promise.all([
      fetchData("interests"),
      fetchData("feed"),
      fetchData("taste").catch(() => ({ learned: [] })),
      fetchData("things").catch(() => ({ ideas: [] })),
      fetchData("gear").catch(() => ({ ads: [] })),
    ]);
    adopt(c, f, t, x, g);
    set(KEYS.cache, { c, f, t, x, g });
    D.source = "live"; D.keyBad = false;
  } catch (e) {
    D.keyBad = !!(e && e.name === "OperationError"); // the passphrase changed since this phone unlocked
    const cached = get(KEYS.cache, null);
    if (cached && cached.c && !D.feed) adopt(cached.c, cached.f, cached.t, cached.x, cached.g);
    D.source = D.feed ? "cache" : null;
  }
  return D.source;
}

// --- Travel focus -------------------------------------------------------------
// interests.json `focus` = {place, until, since, region?}. Items in a travel region (only Japan
// today) show while the focus points there and focus.until hasn't passed; afterwards they hide.
const TRAVEL = { jp: /japan|tokyo|kyoto|osaka|nara|kanazawa|hiroshima|hokkaido|okinawa|naoshima/i };
export const REGION_NAME = { jp: "Japan" };

export function focusRegion() {
  const F = D.config && D.config.focus;
  if (!F || (F.until && d(F.until) < today())) return null;
  if (F.region && TRAVEL[F.region]) return F.region;
  return Object.keys(TRAVEL).find((k) => TRAVEL[k].test(F.place || "")) || null;
}
export const isTravelRegion = (r) => Object.prototype.hasOwnProperty.call(TRAVEL, r);

export function past(it) {
  const e = d(it.end) || (it.kind === "concert" ? d(it.start) : null);
  return !!(e && e < today());
}
export function visible(it) {
  if (past(it)) return false;
  if (isTravelRegion(it.region) && focusRegion() !== it.region) return false;
  return true;
}
export const isWork = (it) => it.kind === "work" || it.kind === "freelance";
// Things to go to: concerts, exhibitions, food, and any instant city pick with a place on the map
// (quick research sometimes files a beach or a mural trail under "story").
export const isGo = (it) => !!GO_KINDS[it.kind] || (!!it.picked && it.lat != null && !isWork(it) && it.kind !== "bucket");
