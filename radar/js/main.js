// Radar start-up: wires the modules, loads data and wind, keeps things fresh.
import { $, ago, hm, stamp } from "./util.js";
import { D, loadData, on } from "./data.js";
import { initTabs, initSheet, initPullToRefresh, initWelcome } from "./ui.js";
import { initWind, loadWind, skeleton, net } from "./wind.js";
import { drawTop, drawFeed, drawWork, segs, KINDS, WORK_KINDS, regions, setOpener } from "./feed.js";
import { openItem, refreshItem } from "./detail.js";
import { initNotes } from "./notes.js";
import { initSaved, drawSaved, paintTeach, ask } from "./saved.js";
import { initAround } from "./around.js";
import { initDo, drawDo } from "./do.js";
import { restore, unlock, unlockFromServer, forget, supported } from "./vault.js";
import { SERVER } from "./notes.js";

const APP_VERSION = window.APP_VERSION || "dev";

function greet() {
  const h = new Date().getHours();
  $("hello").textContent = h < 5 ? "Good night" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  $("today").textContent = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}

function drawAll() { drawTop(); drawFeed(); drawWork(); drawSaved(); drawDo(); paintAlert(); }

// The ntfy topic lives in the encrypted interests file (anyone who knows it can read the alerts).
function paintAlert() {
  const t = D.config && D.config.alerts && D.config.alerts.ntfy, el = $("alertLine");
  if (!t) { el.hidden = true; return; }
  el.hidden = false;
  el.textContent = "";
  el.append("Morning wind alert: in the free ntfy app, subscribe to ");
  const c = document.createElement("span"); c.className = "alert-topic"; c.textContent = t;
  el.append(c, ". Keep it to yourself: anyone with the topic can read the alerts.");
}

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
    segs("regions", regions(), "region", drawFeed);
    segs("workKinds", WORK_KINDS, "work", drawWork);
    initDo(ask);
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
async function checkVersion() {
  if (!navigator.onLine) return;
  try {
    const t = await (await fetch("index.html?v=" + Date.now(), { cache: "no-store" })).text();
    const m = t.match(/var APP_VERSION="([^"]+)"/);
    if (!m || m[1] === APP_VERSION) return;
    let tried = null;
    try { tried = sessionStorage.getItem("radar-reload-for"); } catch (e) { /* ignore */ }
    if (tried === m[1]) return;
    try { sessionStorage.setItem("radar-reload-for", m[1]); } catch (e) { /* ignore */ }
    location.reload();
  } catch (e) { /* offline or signed out: try next time */ }
}

// Explore: interests or work
function pane(work) {
  $("paneFeed").hidden = work; $("paneWork").hidden = !work;
  $("swFeed").setAttribute("aria-pressed", String(!work)); $("swWork").setAttribute("aria-pressed", String(work));
}

greet();
initTabs();
initLock();
$("swFeed").onclick = () => pane(false);
$("swWork").onclick = () => pane(true);
initSheet();
initWind();
setOpener(openItem);
initNotes();
initSaved();
initAround();
initWelcome();
initPullToRefresh(loadAll);
on("change", () => { drawAll(); refreshItem(); paintTeach(); });
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
  if (!(await restore()) && !(SERVER && (await unlockFromServer()))) { showLock(); return; }
  loadAll();
})();
checkVersion();
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").then((r) => r.update()).catch(() => {}));
}
