// Small shared helpers: DOM, safe HTML, dates, distance, fetch with a timeout.

export const $ = (id) => document.getElementById(id);

// --- Safe HTML ---------------------------------------------------------------
// Everything interpolated into html`` is escaped unless it is itself html`` (or raw()).
// Use it for every piece of markup so text from feed.json, OpenStreetMap, Wikipedia
// or the user can never become markup.
class Safe { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Safe(String(s));
export function esc(v) {
  return String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function part(v) {
  if (v == null || v === false) return "";
  if (v instanceof Safe) return v.s;
  if (Array.isArray(v)) return v.map(part).join("");
  return esc(v);
}
export function html(strings, ...vals) {
  let out = strings[0];
  vals.forEach((v, i) => { out += part(v) + strings[i + 1]; });
  return new Safe(out);
}
export function put(el, safe) { el.innerHTML = safe instanceof Safe ? safe.s : esc(safe); }

// Only http(s) links from data files reach an href.
export function safeUrl(u) {
  try { const x = new URL(String(u), location.href); return /^https?:$/.test(x.protocol) ? x.href : ""; } catch (e) { return ""; }
}
export const mapUrl = (lat, lon) => "https://www.google.com/maps/search/?api=1&query=" + (+lat) + "%2C" + (+lon);

// --- Dates -------------------------------------------------------------------
export const pad = (n) => (n < 10 ? "0" : "") + n;
export function today() { const t = new Date(); t.setHours(0, 0, 0, 0); return t; }
export const d = (s) => (s ? new Date(String(s).slice(0, 10) + "T12:00:00") : null);
export const isoDay = (x) => x.getFullYear() + "-" + pad(x.getMonth() + 1) + "-" + pad(x.getDate());
export const daysFrom = (x) => Math.round((new Date(x).setHours(0, 0, 0, 0) - today()) / 864e5);
export const hm = (t) => { const x = new Date(t); return pad(x.getHours()) + ":" + pad(x.getMinutes()); };
export const shortDate = (x) => x.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
export function longDate(x) {
  return x.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "long", year: x.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined });
}
export function ago(iso) {
  const h = (Date.now() - new Date(iso)) / 36e5;
  if (!isFinite(h)) return "a while ago";
  if (h < 1) return "just now";
  if (h < 1.5) return "an hour ago";
  if (h < 24) return Math.round(h) + " hours ago";
  const n = Math.round(h / 24);
  return n === 1 ? "yesterday" : n + " days ago";
}
export function stamp(t) {
  if (!t) return "earlier";
  const n = -daysFrom(t);
  return (n === 0 ? "today" : n === 1 ? "yesterday" : new Date(t).toLocaleDateString("en-GB", { weekday: "long" })) + " at " + hm(t);
}

// --- Distance ----------------------------------------------------------------
export function km(a, b, c, e) {
  const R = 6371, x = (c - a) * Math.PI / 180, y = (e - b) * Math.PI / 180;
  const h = Math.sin(x / 2) ** 2 + Math.cos(a * Math.PI / 180) * Math.cos(c * Math.PI / 180) * Math.sin(y / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
export const kmText = (k) => (k < 1 ? Math.max(10, Math.round(k * 100) * 10) + " m" : (k < 10 ? k.toFixed(1) : Math.round(k)) + " km");

// --- Network -----------------------------------------------------------------
export async function fetchT(url, opts = {}, ms = 20000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctl.signal }); } finally { clearTimeout(timer); }
}
export async function getJSON(url, ms = 20000, opts = {}) {
  const r = await fetchT(url, opts, ms);
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}
export const reduceMotion = () => !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
