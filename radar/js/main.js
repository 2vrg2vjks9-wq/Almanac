// Radar start-up: wires the modules, loads data and wind, keeps things fresh.
import { $, ago, hm, stamp } from "./util.js";
import { D, loadData, on, mergePicks } from "./data.js";
import { initTabs, initSheet, initPullToRefresh, initWelcome, currentTab, initUndo } from "./ui.js";
import { initWind, loadWind, skeleton, net, reloadWind } from "./wind.js";
import { loadScout } from "./scout.js";
import { drawCompanies, initCompanies } from "./companies.js";
import { state, drawFeed, drawForYou, drawWork, initFindRead, markLeadsSeen, segs, KINDS, WORK_KINDS, WORK_PLACES, regions, setOpener, initSearch } from "./feed.js";
import { openItem, refreshItem, icsAll } from "./detail.js";
import { initNotes } from "./notes.js";
import { initSaved, drawSaved, paintTeach, ask } from "./saved.js";
import { initAround } from "./around.js";
import { initDo, drawDo, drawList } from "./do.js";
import { drawToday, setTodayOpener, drawWeekend, initTrip, initCal } from "./today.js";
import { initSettings, drawSettings } from "./settings.js";
import { initGear, drawGear } from "./gear.js";
import { restore, unlock, forget, supported } from "./vault.js";
import { authFailed, signedOut } from "./notes.js";

const APP_VERSION = window.APP_VERSION || "dev";

function greet() {
  const h = new Date().getHours();
  $("hello").textContent = h < 5 ? "Good night" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  $("today").textContent = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}

function drawRegions() {
  const r = regions();
  if (!r.some((x) => x[0] === state.region)) state.region = "all";
  const both = () => { drawFeed(); drawForYou(); drawRegions(); };
  segs("regions", r, "region", both); segs("forRegions", r, "region", both);
}
function drawAll() { drawRegions(); drawFeed(); drawForYou(); drawWork(); drawCompanies(); drawSaved(); drawDo(); drawGear(); drawToday(); if (currentTab() === "settings") drawSettings(); }

// --- Lock screen ---------------------------------------------------------------------------
function showLock(text) {
  const l = $("lock");
  if (text) $("lockText").textContent = text;
  l.classList.add("show");
  document.body.classList.add("locked");
  setTimeout(() => $("lockPass").focus({ preventScroll: true }), 50);
}
function hideLock() {
  $("lock").classList.remove("show");
  document.body.classList.remove("locked");
  $("lockPass").value = ""; $("lockMsg").textContent = "";
}
function initLock() {
  if (!supported()) $("lockText").textContent = "This browser can't open Radar's encrypted data. Open Radar in Safari on iOS 16 or later.";
  $("lockForm").onsubmit = async (e) => {
    e.preventDefault();
    const inp = $("lockPass"), msg = $("lockMsg"), go = $("lockGo");
    if (!inp.value.trim()) { inp.focus(); return; }
    go.disabled = true; msg.textContent = "Unlocking…"; inp.removeAttribute("aria-invalid");
    const r = await unlock(inp.value);
    go.disabled = false;
    if (r === "ok") { hideLock(); loadAll(); return; }
    msg.textContent = r === "offline" ? "Radar needs a connection to unlock the first time." : "That isn't the Radar passphrase. Check it and try again.";
    if (r !== "offline") { inp.setAttribute("aria-invalid", "true"); inp.select(); }
  };
  $("lockBtn").onclick = () => { forget(); location.reload(); };
}

function fresh() {
  const el = $("fresh"), off = D.source === "cache" || net.wind === "cache", t = [];
  if (D.feed && D.feed.updated) t.push("Feed updated " + ago(D.feed.updated));
  if (net.windAt) t.push("wind " + (net.wind === "cache" ? "from " + stamp(net.windAt) : "checked at " + hm(net.windAt)));
  el.textContent = (off ? "Offline, showing the last copy. " : "") + t.join(", ") + (t.length ? "." : "");
  el.classList.toggle("off", off);
}

let started = false, busy = false;
function start() {
  if (!started) {
    segs("kinds", KINDS, "kind", drawFeed);
    segs("workKinds", WORK_KINDS, "work", drawWork);
    segs("workPlaces", WORK_PLACES, "wplace", drawWork);
    initSearch(drawList);
    initFindRead();
    initDo(ask, () => { const r = regions().find((x) => x[0] === state.region) || ["all", ""]; return r; });
    initGear();
    started = true;
  }
  drawAll();
  skeleton();
  fresh();
}
async function loadAll() {
  if (busy) return;
  busy = true;
  const r = $("refresh");
  r.classList.add("spin"); r.setAttribute("aria-busy", "true");
  try {
    const src = await loadData();
    if (src === "locked") { showLock(); return; }
    if (D.keyBad && src !== "live") showLock("Radar's passphrase has changed. Enter the new one to see today's data.");
    if (!src) { $("lead").textContent = "Radar needs a connection the first time you open it."; $("leadSub").textContent = ""; return; }
    start();
    loadScout();
    await loadWind();
  } finally {
    busy = false;
    r.classList.remove("spin"); r.removeAttribute("aria-busy");
    fresh();
  }
}

// A home-screen app on iPhone often resumes from memory instead of reloading, so it can keep
// showing an old version. On open and whenever it comes back to the front, compare with the
// live index.html and reload once if there's a newer one.
// An expired Cloudflare sign-in shows up here first (see signedOut in notes.js).
async function checkVersion() {
  if (!navigator.onLine) return;
  try {
    const r = await fetch("index.html?v=" + Date.now(), { cache: "no-store", redirect: "manual" });
    signedOut(authFailed(r));
    if (!r.ok) return;
    const t = await r.text();
    const m = t.match(/var APP_VERSION="([^"]+)"/);
    if (!m || m[1] === APP_VERSION) return;
    let tried = null;
    try { tried = sessionStorage.getItem("radar-reload-for"); } catch (e) { /* ignore */ }
    if (tried === m[1]) return;
    try { sessionStorage.setItem("radar-reload-for", m[1]); } catch (e) { /* ignore */ }
    location.reload();
  } catch (e) { /* offline: try next time */ }
}

greet();
initTabs();
initLock();
initSheet();
initWind();
setOpener(openItem);
setTodayOpener(openItem);
initSettings();
initUndo();
initTrip(reloadWind);
initCal(icsAll);
initCompanies();
initNotes();
initSaved();
initAround();
initWelcome();
initPullToRefresh(loadAll);
on("change", () => { drawAll(); refreshItem(); paintTeach(); });
on("picks", () => { if (D.feed) { mergePicks(); drawAll(); } });
on("wind", () => { if (D.feed) drawWeekend(); });
// Leaving Work marks the new leads you saw there as seen.
window.addEventListener("radar-tab", (e) => { if (D.feed && e.detail.from === "work" && e.detail.to !== "work") markLeadsSeen(); });
// Opening Discover or Today redraws them, so trip mode follows a Look around or a new Wind place right away.
document.querySelectorAll('.tab[data-v="discover"], .tab[data-v="today"]').forEach((t) => t.addEventListener("click", () => { if (D.feed) drawAll(); }));
$("refresh").onclick = loadAll;
$("appVersion").textContent = "Radar version " + APP_VERSION;
window.addEventListener("online", () => { if (D.source === "cache" || net.wind === "cache") loadAll(); });
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  greet();
  if (net.windAt && Date.now() - net.windAt > 30 * 6e4) loadAll();
  checkVersion();
});
(async () => {
  if (!(await restore())) { showLock(); return; }
  loadAll();
})();
checkVersion();
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").then((r) => r.update()).catch(() => {}));
}
