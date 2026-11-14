// New finds, everywhere: one "New" mark per thing found in the last 7 days that you haven't seen yet.
// Lists tag their rows with data-fresh="<key>" data-found="<YYYY-MM-DD>" data-fk="<kind>" (feed items f:, Go ideas do:,
// ads ad:, watched items w:). This module adds the "New" label, counts unseen new things per tab (Today excluded: it
// repeats other tabs), puts dots on You's jump buttons, and writes the line in Today's brief. A row counts as seen
// after it has been at least 60% on screen for a second: the label fades, and it's gone from the next draw. Seen keys
// live in radar-seen {key: day}; the first time, only things found in the last 2 days count as new.
import { $, html, put } from "./util.js";
import { get, set } from "./store.js";
import { showTab, currentTab } from "./ui.js";
import { track } from "./notes.js";

const SEEN = "radar-seen", START = "radar-seen-start", DAYS = 7;
let seen = get(SEEN, {}) || {};
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Amsterdam" }).format(new Date());
let start = get(START, null);
if (!start) { start = new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10); set(START, start); }

const KIND = { lead: ["lead", "leads", "work"], idea: ["idea", "ideas", "discover"], ad: ["ad", "ads", "saved"],
  concert: ["concert", "concerts", "discover"], bucket: ["bucket-list moment", "bucket-list moments", "saved"],
  watch: ["Watching update", "Watching updates", "saved"], policy: ["policy update", "policy updates", "work"], read: ["read", "reads", "discover"] };
const TABS = ["discover", "wind", "work", "saved"];
const JUMP = { hSaved: "#savedList", hBucket: "#bucketList", hFollow: "#follow", hFinds: "#wingBox, #wanted", hWatching: "#watching" };

export function isNew(key, found) {
  if (!key || !found || seen[key]) return false;
  const f = String(found).slice(0, 10), age = (Date.parse(today()) - Date.parse(f)) / 864e5;
  return f >= start && age <= DAYS && age >= -1;
}

// What you've seen also goes to Radar's tasks (sealed, in a radar-track note as `seen`), so a push never names
// something you already looked at. Queued in radar-seen-out and sent when Radar goes to the background, at most
// every 15 minutes, or when the queue gets long.
const OUT = "radar-seen-out", OUT_AT = "radar-seen-sent";
function queue(key) {
  const q = get(OUT, []) || [];
  if (!q.includes(key)) q.push(key);
  set(OUT, q.slice(-500));
  if (q.length >= 60) flushSeen(true);
}
export function flushSeen(force) {
  const q = get(OUT, []) || [];
  if (!q.length || (!force && Date.now() - (+get(OUT_AT, 0) || 0) < 15 * 6e4)) return;
  track({ seen: q });
  set(OUT, []); set(OUT_AT, Date.now());
}
let saveT = 0;
// also called when you open something (detail sheet, an ad, a link)
export function markSeen(key) {
  if (!key) return;
  queue(key);
  if (seen[key]) return;
  seen[key] = today();
  clearTimeout(saveT);
  saveT = setTimeout(() => { // forget keys older than a month, so the list stays small
    const cut = new Date(Date.now() - 40 * 864e5).toISOString().slice(0, 10);
    Object.keys(seen).forEach((k) => { if (seen[k] < cut) delete seen[k]; });
    set(SEEN, seen);
  }, 400);
  document.querySelectorAll('[data-fresh="' + CSS.escape(key) + '"] .fresh').forEach((l) => l.classList.add("gone"));
  paint();
}

const timers = new WeakMap();
const io = "IntersectionObserver" in window ? new IntersectionObserver((entries) => {
  entries.forEach((e) => {
    const el = e.target;
    if (e.isIntersecting && e.intersectionRatio >= 0.6 && document.visibilityState === "visible") {
      if (!timers.has(el)) timers.set(el, setTimeout(() => { timers.delete(el); io.unobserve(el); markSeen(el.dataset.fresh); }, 1000));
    } else if (timers.has(el)) { clearTimeout(timers.get(el)); timers.delete(el); }
  });
}, { threshold: [0, 0.6, 1] }) : null;

// label new rows and watch them; called after lists draw (a MutationObserver batches it)
function scan() {
  document.querySelectorAll("[data-fresh]").forEach((el) => {
    const on = isNew(el.dataset.fresh, el.dataset.found);
    let l = el.querySelector(":scope .fresh");
    if (on && !l) {
      l = document.createElement("span"); l.className = "state new fresh"; l.textContent = "New";
      const host = el.querySelector(".meta, .ad-top") || el;
      host.insertBefore(l, host.firstChild);
      if (io) io.observe(el);
    } else if (!on && l && !l.classList.contains("gone")) l.remove();
  });
  paint();
}

function unseenIn(sel) {
  const keys = new Set();
  document.querySelectorAll(sel).forEach((root) => root.querySelectorAll("[data-fresh]").forEach((el) => {
    if (isNew(el.dataset.fresh, el.dataset.found)) keys.add(el.dataset.fresh + "|" + (el.dataset.fk || ""));
  }));
  return keys;
}

function badge(tab, n, label) {
  const t = document.querySelector('.tab[data-v="' + tab + '"]');
  if (!t) return;
  let c = t.querySelector(".count");
  if (n && !c) { c = document.createElement("span"); c.className = "count"; c.setAttribute("aria-hidden", "true"); t.appendChild(c); }
  if (c) { if (n) c.textContent = n > 99 ? "99+" : n; else c.remove(); }
  t.setAttribute("aria-label", n ? label + ", " + n + " new" : label);
}

let painting = false;
export function paint() {
  if (painting) return;
  painting = true;
  const names = { discover: "Discover", wind: "Wind", work: "Work", saved: "You" };
  TABS.forEach((t) => badge(t, unseenIn("#v-" + t).size, names[t]));
  Object.keys(JUMP).forEach((id) => {
    const b = document.querySelector('#youJump [data-to="' + id + '"]');
    if (b) b.classList.toggle("has-new", unseenIn(JUMP[id]).size > 0);
  });
  brief();
  painting = false;
}

// Today: "6 new: 3 leads, 2 ads, 1 concert", each part jumps to the first one
function brief() {
  const box = $("freshLine");
  if (!box) return;
  const by = {};
  TABS.forEach((t) => unseenIn("#v-" + t).forEach((k) => { const fk = k.split("|")[1] || "idea"; by[fk] = (by[fk] || 0) + 1; }));
  const kinds = Object.keys(by).filter((k) => KIND[k]).sort((a, b) => by[b] - by[a]), n = kinds.reduce((s, k) => s + by[k], 0);
  box.hidden = !n;
  if (!n) return;
  put(box, html`<b>${String(n)} new:</b> ${kinds.map((k, i) => html`${i ? ", " : ""}<button class="linkbtn" type="button" data-fk="${k}">${String(by[k])} ${by[k] === 1 ? KIND[k][0] : KIND[k][1]}</button>`)}`);
  box.querySelectorAll("[data-fk]").forEach((b) => {
    b.onclick = () => {
      const k = b.dataset.fk, tab = KIND[k][2];
      showTab(tab);
      setTimeout(() => {
        const el = [...document.querySelectorAll("#v-" + tab + ' [data-fk="' + k + '"][data-fresh]')].find((x) => isNew(x.dataset.fresh, x.dataset.found) && x.offsetParent);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 120);
    };
  });
}

let scanT = 0;
export function initFresh() {
  const mo = new MutationObserver(() => { clearTimeout(scanT); scanT = setTimeout(scan, 60); });
  mo.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("radar-tab", () => setTimeout(scan, 50));
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushSeen(false); });
  // opening a row (its title, link or Open details) counts as seen too
  document.addEventListener("click", (e) => {
    const row = e.target.closest && e.target.closest("[data-fresh]");
    if (row && e.target.closest(".open, a, [data-a]")) markSeen(row.dataset.fresh);
  }, true);
  scan();
}
export const freshTab = currentTab; // for tests
