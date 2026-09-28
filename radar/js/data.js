// Data files written by the daily and hourly Claude tasks: interests.json, feed.json, taste.json.
// Loads them fresh, falls back to the last good copy offline, and holds the travel-focus rules.
import { d, today } from "./util.js";
import { get, set, KEYS } from "./store.js";

export const D = { config: null, feed: null, taste: { learned: [], more: [], less: [] }, byId: {}, source: null };

// Tiny event bus so modules can redraw after reactions, saves or new data.
const bus = new EventTarget();
export const on = (name, fn) => bus.addEventListener(name, (e) => fn(e.detail));
export const emit = (name, detail) => bus.dispatchEvent(new CustomEvent(name, { detail }));

async function fetchJSON(u) {
  const r = await fetch(u + "?v=" + Date.now(), { cache: "no-store" });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}

function adopt(config, feed, taste) {
  D.config = config;
  D.feed = feed && Array.isArray(feed.items) ? feed : { updated: null, items: [] };
  D.taste = taste || { learned: [] };
  D.byId = {};
  D.feed.items.forEach((it) => { D.byId[it.id] = it; });
}

// Returns "live", "cache" or null (nothing to show yet).
export async function loadData() {
  try {
    const [c, f, t] = await Promise.all([
      fetchJSON("interests.json"),
      fetchJSON("feed.json"),
      fetchJSON("taste.json").catch(() => ({ learned: [] })),
    ]);
    adopt(c, f, t);
    set(KEYS.cache, { c, f, t });
    D.source = "live";
  } catch (e) {
    const cached = get(KEYS.cache, null);
    if (cached && !D.feed) adopt(cached.c, cached.f, cached.t);
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
