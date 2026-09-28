// Radar start-up: wires the modules, loads data and wind, keeps things fresh.
import { $, ago, hm, stamp } from "./util.js";
import { D, loadData, on } from "./data.js";
import { initTabs, initSheet, initPullToRefresh, initWelcome } from "./ui.js";
import { initWind, loadWind, skeleton, net } from "./wind.js";
import { drawTop, drawFeed, drawWork, segs, KINDS, WORK_KINDS, regions, setOpener } from "./feed.js";
import { openItem, refreshItem } from "./detail.js";
import { initNotes } from "./notes.js";
import { initSaved, drawSaved, paintTeach } from "./saved.js";
import { initAround } from "./around.js";

const APP_VERSION = window.APP_VERSION || "dev";

function greet() {
  const h = new Date().getHours();
  $("hello").textContent = h < 5 ? "Good night" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  $("today").textContent = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}

function drawAll() { drawTop(); drawFeed(); drawWork(); drawSaved(); }

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

greet();
initTabs();
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
loadAll();
checkVersion();
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").then((r) => r.update()).catch(() => {}));
}
