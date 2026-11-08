// Today: the morning brief and "Act now"; Wind: the weekend planner.
// - Brief: a few plain sentences pulling the day together: the best idea, new work leads, finds, bucket moments.
// - Act now: one list of things with a date to act by, nearest first: deadlines (tracked leads first), tickets to
//   book, last chances, things on your yes list in the next three days and bucket-list "good time" moments.
// - Weekend (Thursday to Sunday, on Today): rideable wind on Saturday and Sunday next to your yes list that weekend.
import { $, html, put, d, today, shortDate, getJSON } from "./util.js";
import { S } from "./store.js";
import { D, visible, isWork, tripPoint, nearTrip, emit } from "./data.js";
import { net } from "./wind.js";
import { showTab, showPane, swipeRow, undoable, say } from "./ui.js";
import { S as Store, save, get, set, KEYS } from "./store.js";
import { ideas, answer, eligible, ideaPast, placeText, prepText, sortByDate, openIdea, decide, findPadel } from "./do.js";
import { deadline, tracked, WORK_LABEL, workSub } from "./feed.js";
import { gearNews } from "./gear.js";

let openItem = () => {};
export function setTodayOpener(fn) { openItem = fn; }

const days = (x) => Math.round((x - today()) / 864e5);
const dayLabel = (x) => { const n = days(x); return n <= 0 ? "Today" : n === 1 ? "Tomorrow" : n < 7 ? x.toLocaleDateString("en-GB", { weekday: "short" }) : shortDate(x); };
const homeIdea = (it) => (tripPoint() ? nearTrip(it, 40) : /den haag|the hague|scheveningen|kijkduin/i.test(String(it.city || "")) || !it.city);

// --- Act now ---------------------------------------------------------------------------------------------
function actItems() {
  const t = today(), out = [];
  D.feed.items.filter((it) => isWork(it) && visible(it) && !S.hidden[it.id] && !["applied", "skip"].includes(tracked(it))).forEach((it) => {
    const x = deadline(it);
    if (x && x >= t && days(x) <= 14) out.push({ at: x, rank: tracked(it) === "interested" ? 0 : 2, label: (workSub(it) === "event" ? "Register by " : "Apply by ") + (/^(Today|Tomorrow)$/.test(dayLabel(x)) ? dayLabel(x).toLowerCase() : dayLabel(x)),
      title: it.title, sub: (tracked(it) === "interested" ? "Interested · " : "") + WORK_LABEL[workSub(it)] + (it.org ? " · " + it.org : ""), open: () => openItem(it), hot: days(x) <= 3 });
  });
  ideas().filter((it) => !ideaPast(it)).forEach((it) => {
    const a = answer(it), yes = !!(a && a.v > 0), no = !!(a && a.v < 0);
    if (no) return;
    const s = d(it.start), e = d(it.end);
    if (yes && s && s >= t && days(s) <= 3) out.push({ at: s, rank: 1, label: dayLabel(s), title: it.title, sub: "On your list · " + placeText(it), open: () => openIdea(it), hot: days(s) <= 1 });
    else if (prepText(it) && eligible(it) && (yes || it.fit >= 4)) out.push({ at: s || t, rank: yes ? 1 : 3, label: "Book now", title: it.title, sub: prepText(it) + (s ? " · " + shortDate(s) : ""), open: () => openIdea(it) });
    else if (e && e >= t && days(e) <= 7 && (!s || s <= t) && (yes || (eligible(it) && (it.fit || 3) >= 4 && homeIdea(it)))) out.push({ at: e, rank: yes ? 1 : 3, label: "Ends " + (/^(Today|Tomorrow)$/.test(dayLabel(e)) ? dayLabel(e).toLowerCase() : dayLabel(e)), title: it.title, sub: "Last chance · " + placeText(it), open: () => openIdea(it), hot: days(e) <= 2 });
  });
  D.feed.items.filter((it) => it.kind === "bucket" && visible(it) && !S.hidden[it.id]).forEach((it) => {
    out.push({ at: d(it.end) || d(it.start) || t, rank: 1, label: "Good time", title: it.title, sub: "Bucket list" + (it.place ? " · " + it.place : ""), open: () => openItem(it), hot: true });
  });
  // things swiped out of Act now are kept in radar-hidden as "act:<title>" (they stay everywhere else)
  return out.filter((x) => !Store.hidden["act:" + x.title]).sort((a, b) => a.at - b.at || a.rank - b.rank).slice(0, 6);
}
function drawAct() {
  const list = actItems(), box = $("act");
  put(box, list.length ? html`${list.map((x, i) => html`<button class="mini" type="button" data-i="${i}"><span class="when${x.hot ? " close" : ""}">${x.label}</span><span class="what"><b>${x.title}</b><small>${x.sub}</small></span></button>`)}`
    : html`<p class="empty">Nothing needs doing right now. Discover has ideas, Work has leads.</p>`);
  box.querySelectorAll(".mini").forEach((b) => {
    const x = list[+b.dataset.i];
    b.onclick = () => x.open();
    swipeRow(b, () => x.open(), () => {
      Store.hidden["act:" + x.title] = Date.now(); save("hidden"); drawAct();
      undoable("Taken off Act now.", () => { delete Store.hidden["act:" + x.title]; save("hidden"); drawAct(); });
    }, ["Open", "Done"]);
  });
}

// --- Morning brief -----------------------------------------------------------------------------------------
function bestIdea() {
  const t = today(), soon = new Date(t); soon.setDate(t.getDate() + 3);
  const on = (it) => { const s = d(it.start) || t, e = d(it.end) || s; return !it.start && !it.end ? false : s <= soon && e >= t; };
  const yes = ideas().filter((it) => answer(it) && answer(it).v > 0 && !ideaPast(it) && on(it)).sort(sortByDate);
  if (yes.length) return [yes[0], "on your list"];
  const open = ideas().filter((it) => eligible(it) && !answer(it) && on(it) && homeIdea(it)).sort((a, b) => (b.fit || 3) - (a.fit || 3) || sortByDate(a, b));
  return open.length ? [open[0], "worth a look"] : null;
}
function drawBrief() {
  const box = $("brief"), parts = [];
  const b = bestIdea();
  if (b) {
    const it = b[0], s = d(it.start), lab = s && s > today() ? dayLabel(s) : "";
    const when = !lab ? "on now" : /^(Today|Tomorrow)$/.test(lab) ? lab.toLowerCase() : "on " + lab;
    parts.push(html`<p><span class="bk-k">Go</span><button class="linkish" type="button" data-b="idea">${it.title}</button>, ${when}${it.venue ? ", " + it.venue : ""} (${b[1]}).</p>`);
  }
  const fresh = D.feed.items.filter((it) => isWork(it) && visible(it) && !S.hidden[it.id] && tracked(it) !== "skip" && d(it.found) && days(d(it.found)) >= -2);
  const due = D.feed.items.filter((it) => isWork(it) && tracked(it) === "interested" && deadline(it) && deadline(it) >= today() && days(deadline(it)) <= 7);
  if (fresh.length || due.length) {
    const t = [fresh.length ? (fresh.length === 1 ? "1 new lead" : fresh.length + " new leads") : "", due.length ? due.length + " tracked " + (due.length === 1 ? "deadline" : "deadlines") + " this week" : ""].filter(Boolean).join(", ");
    parts.push(html`<p><span class="bk-k">Work</span><button class="linkish" type="button" data-b="work">${t}</button>.</p>`);
  }
  const g = gearNews();
  if (g) parts.push(html`<p><span class="bk-k">Finds</span><button class="linkish" type="button" data-b="finds">${g}</button>.</p>`);
  const n = ideas().filter((it) => eligible(it) && !answer(it)).length;
  if (n) parts.push(html`<p><span class="bk-k">Decide</span><button class="linkish" type="button" data-b="decide">${n === 1 ? "1 idea" : n + " ideas"} waiting for a yes or no</button>.</p>`);
  box.hidden = !parts.length;
  put(box, html`${parts}`);
  const go = { idea: () => b && openIdea(b[0]), work: () => showTab("work"), finds: () => { showTab("saved"); const w = $("wingBox"); if (w) w.scrollIntoView(); },
    decide: () => { showTab("discover"); showPane("go"); } };
  box.querySelectorAll("[data-b]").forEach((x) => { x.onclick = go[x.dataset.b]; });
}

// --- Weekend planner (Today, Thursday to Sunday) ------------------------------------------------------------------------------
function weekend() {
  const t = today(), wd = t.getDay(); // 0 Sun … 6 Sat
  const sat = new Date(t); sat.setDate(t.getDate() + (wd === 0 ? -1 : 6 - wd));
  const sun = new Date(sat); sun.setDate(sat.getDate() + 1);
  return [sat, sun];
}
const iso = (x) => x.getFullYear() + "-" + String(x.getMonth() + 1).padStart(2, "0") + "-" + String(x.getDate()).padStart(2, "0");
export function drawWeekend() {
  const box = $("weekend");
  if (!box) return;
  box.hidden = ![4, 5, 6, 0].includes(today().getDay()); // Today shows it from Thursday to Sunday
  if (box.hidden) return;
  const [sat, sun] = weekend(), keys = [iso(sat), iso(sun)];
  const wind = (net.sessions || []).filter((x) => keys.includes(x.Dy.day));
  const overlaps = (it) => { const s = d(it.start), e = d(it.end) || s; return s && s <= sun && e >= sat; };
  const yes = ideas().filter((it) => answer(it) && answer(it).v > 0 && !ideaPast(it) && overlaps(it)).sort(sortByDate);
  const maybe = yes.length ? [] : ideas().filter((it) => eligible(it) && !answer(it) && overlaps(it) && homeIdea(it)).sort((a, b) => (b.fit || 3) - (a.fit || 3)).slice(0, 2);
  const day = (k) => (k === keys[0] ? "Sat" : "Sun");
  put(box, html`<h2>This weekend</h2><div class="sheet brief wk">
    ${wind.length ? wind.slice(0, 4).map((x) => html`<p class="wk-w"><b>${day(x.Dy.day)}</b> ${x.k === "wing" ? "Wingfoil" : "Windsurf"} at ${x.spot.name}, ${x.r.from}–${x.r.to}, ~${x.r.kn} kn ${x.r.dir}</p>`)
      : html`<p class="wk-w muted">${net.windAt ? "No rideable wind forecast for the weekend yet." : "Checking the forecast…"}</p>`}
    ${yes.concat(maybe).map((it) => html`<button class="mini" type="button" data-id="${it.id}"><span class="when">${(() => { const s = d(it.start); return s && s >= sat ? day(iso(s)) : "Sat–Sun"; })()}</span><span class="what"><b>${it.title}</b><small>${yes.includes(it) ? "On your list · " : "Idea · "}${placeText(it)}</small></span></button>`)}
    ${!yes.length && !maybe.length ? html`<p class="wk-w muted">Nothing on your yes list this weekend yet.</p>` : ""}
  </div>`);
  box.querySelectorAll(".mini").forEach((b) => {
    const it = ideas().find((x) => x.id === b.dataset.id);
    b.onclick = () => openIdea(it);
    swipeRow(b, () => decide(it, 1), () => decide(it, -1), ["Yes", "No"]);
  });
}

export function drawToday() { if (!D.feed) return; drawBrief(); drawAct(); drawWeekend(); paintTrip(); }

// --- Trip mode banner (Discover) ------------------------------------------------------------------------------
export function paintTrip() {
  const T = tripPoint(), bar = $("tripBar");
  if (!bar) return;
  bar.hidden = !T;
  if (T) $("tripText").textContent = "Trip mode: " + T.name;
  if (T && T.name === "where you are" && !naming && navigator.onLine) nameTrip(T);
}
// The town for a trip found by Look around, looked up once (OpenStreetMap's Nominatim) and kept with the result.
let naming = false;
async function nameTrip(T) {
  naming = true;
  try {
    const g = await getJSON("https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&accept-language=en&lat=" + T.lat.toFixed(4) + "&lon=" + T.lon.toFixed(4), 8000);
    const a = g.address || {}, city = a.city || a.town || a.village || a.municipality;
    if (city) { const A = get(KEYS.around, {}) || {}; set(KEYS.around, Object.assign({}, A, { place: Object.assign({}, A.place || {}, { city, country: a.country || "" }) })); emit("change"); }
  } catch (e) { /* keep the generic name */ }
}
export function initTrip(reloadWind) {
  $("tripPadel").onclick = findPadel;
  $("tripHome").onclick = () => {
    Store.settings = Object.assign({}, Store.settings, { tripOff: Date.now() }); save("settings");
    try { localStorage.setItem("radar-wind-place", JSON.stringify({ mode: "home" })); } catch (e) { /* ignore */ }
    reloadWind();
    emit("change");
  };
}

// --- Calendar export: yes-list things with a date plus deadlines of leads marked Interested or Applied --------------
export function plans() {
  const t = today();
  const yes = ideas().filter((it) => answer(it) && answer(it).v > 0 && !ideaPast(it) && (it.start || it.end))
    .map((it) => Object.assign({}, it, { place: it.venue }));
  const leads = D.feed.items.filter((it) => isWork(it) && ["interested", "applied"].includes(tracked(it)) && deadline(it) && deadline(it) >= t);
  return yes.concat(leads);
}
export function initCal(icsAll) {
  const go = () => { const n = icsAll(plans()); say(n ? n + (n === 1 ? " date" : " dates") + " ready for your calendar." : "Nothing with a date yet: say yes to something or mark a lead Interested."); };
  ["calAll", "calWork"].forEach((id) => { const b = $(id); if (b) b.onclick = go; });
}
