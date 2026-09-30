// Data files written by the daily and hourly Claude tasks: interests, feed, taste and things (the Do
// tab). They are committed encrypted as data/<name>.enc.json (see vault.js); this opens them, falls
// back to the last good copy on this phone when offline, and holds the travel-focus rules.
import { d, today } from "./util.js";
import { get, set, KEYS } from "./store.js";
import { open, unlocked } from "./vault.js";

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
  mergePicks();
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
