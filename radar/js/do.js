// Do: things to do, Den Haag first. Ideas come from things.json (researched each morning by Claude):
// exhibitions, gigs, film, talks, festivals, markets, outdoor and quiet things, plus fresh ideas.
// - Den Haag and around gets everything Claude found; further away an idea needs a higher `fit`
//   (1–5) to show: Leiden/Rotterdam 3+, Amsterdam/Utrecht 4+, beyond 5.
// - Decide: one card at a time, yes / no / later (buttons or swipe). Yes goes on the yes list.
// - Answers are kept on this phone (radar-do) and sent to Claude, sealed, with the other reactions.
import { $, html, put, d, today, shortDate, longDate, safeUrl, mapUrl, km, reduceMotion } from "./util.js";
import { S, save, get, set, KEYS } from "./store.js";
import { D, emit, Q, mergePicks, refreshUntil, tripPoint } from "./data.js";
import { openSheet, sheetOpen, paintSheet, swipeRow, say } from "./ui.js";
import { ics } from "./detail.js";
import { signed } from "./vault.js";
import { note, SERVER, authFailed, signedOut, track } from "./notes.js";

export const CATS = {
  art: "Art", music: "Music", stage: "Theatre & dance", film: "Film", talk: "Talks & ideas", festival: "Festival",
  market: "Markets", outdoors: "Outdoors", calm: "Calm", food: "Food", design: "Design & architecture", odd: "Something different",
  sport: "Sport & padel",
};
const CAT_FILTERS = [["all", "Everything"], ["art", "Art"], ["music", "Music"], ["stage", "Stage"], ["film", "Film & talks"], ["festival", "Festivals & markets"], ["outdoors", "Outdoors & calm"], ["sport", "Sport"], ["odd", "Different"]];
const CAT_GROUP = { film: ["film", "talk"], festival: ["festival", "market", "food"], outdoors: ["outdoors", "calm"], odd: ["odd", "design"] };
const WHEN = [["all", "Anytime"], ["weekend", "This weekend"], ["week", "Next 7 days"], ["month", "Next 30 days"], ["open", "Always on"]];

const HOME = { lat: 52.0799, lon: 4.3113 }; // Den Haag, Plein
const NEAR = /den haag|the hague|'s-gravenhage|scheveningen|wassenaar|rijswijk|voorburg|leidschendam|kijkduin|loosduinen|delft|voorschoten|monster|ter heijde/i;

const view = Object.assign({ when: "all", city: "all", cat: "all" }, get(KEYS.doView, {}));
let showNo = false, busy = false;

// --- Place, distance, eligibility --------------------------------------------------------------
// Distances count from Den Haag, or from the trip point in trip mode (tripPoint() in data.js).
function distance(it) {
  const T = tripPoint();
  if (T) {
    if (it.lat != null && isFinite(it.lat) && isFinite(it.lon)) return km(T.lat, T.lon, +it.lat, +it.lon);
    return String(it.city || "").toLowerCase() && String(T.name).toLowerCase().includes(String(it.city).toLowerCase()) ? 5 : 90;
  }
  if (it.lat != null && isFinite(it.lat) && isFinite(it.lon)) return km(HOME.lat, HOME.lon, +it.lat, +it.lon);
  const c = String(it.city || "");
  if (NEAR.test(c)) return 5;
  if (/amsterdam|utrecht|haarlem|zaandam/i.test(c)) return 55;
  if (/leiden|rotterdam|schiedam|zoetermeer|katwijk|noordwijk/i.test(c)) return 22;
  return 90;
}
const tier = (k) => (k <= 15 ? 0 : k <= 40 ? 1 : k <= 80 ? 2 : 3);
const MIN_FIT = [1, 3, 4, 5];
// Den Haag and around count as one place; every other city gets its own filter.
export const homeName = () => { const T = tripPoint(); return T ? T.name : "Den Haag"; };
function cityKey(it) {
  const c = String(it.city || "").trim();
  if (tier(distance(it)) === 0 || (!tripPoint() && NEAR.test(c))) return "haag";
  return c.toLowerCase() || "elsewhere";
}
// City filters from the ideas that can show: Den Haag first, then the rest nearest first.
function cities() {
  const seen = {};
  ideas().filter(eligible).forEach((it) => {
    const k = cityKey(it);
    if (k === "haag") return;
    if (!seen[k]) seen[k] = { label: String(it.city || "Elsewhere").trim(), km: distance(it) };
  });
  return [["all", "All"], ["haag", homeName()]].concat(Object.keys(seen).sort((a, b) => seen[a].km - seen[b].km).map((k) => [k, seen[k].label]));
}
const fit = (it) => (it.fit == null ? 3 : +it.fit);
export const ideaPast = (it) => { const e = d(it.end) || (it.start && !it.end ? d(it.start) : null); return !!(e && e < today()); };
// Far-out things (starting more than three weeks from now) only show when they need planning now:
// tickets that sell out, a registration or booking (`prep`). The rest wait until they're close.
const HORIZON = 21;
const farOut = (it) => { const s = d(it.start); return !!(s && (s - today()) / 864e5 > HORIZON); };
export function eligible(it) { return !ideaPast(it) && (it.trip || fit(it) >= MIN_FIT[tier(distance(it))]) && (!farOut(it) || !!it.prep); }
export const prepText = (it) => (it.prep ? (typeof it.prep === "string" ? it.prep : "Book ahead") : "");

// --- Dates --------------------------------------------------------------------------------------
function range(when) {
  const t = today(), day = t.getDay(); // 0 Sun … 6 Sat
  if (when === "weekend") {
    const fri = new Date(t); fri.setDate(t.getDate() + (day === 0 ? -2 : day === 6 ? -1 : 5 - day));
    const sun = new Date(fri); sun.setDate(fri.getDate() + 2);
    return [fri < t ? t : fri, sun];
  }
  const n = when === "week" ? 7 : 30, e = new Date(t); e.setDate(t.getDate() + n);
  return [t, e];
}
const undated = (it) => !it.start && !it.end;
function inWhen(it, when) {
  if (when === "all") return true;
  if (when === "open") return undated(it);
  if (undated(it)) return false;
  const [a, b] = range(when), s = d(it.start) || today(), e = d(it.end) || s;
  return s <= b && e >= a;
}
function whenText(it) {
  const s = d(it.start), e = d(it.end), parts = [];
  if (s && e && +s !== +e) parts.push((s <= today() ? "Now" : shortDate(s)) + " to " + shortDate(e));
  else if (s) parts.push(s.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }));
  else if (e) parts.push("Until " + shortDate(e));
  if (it.when) parts.push(it.when);
  return parts.join(", ");
}
function badge(it) {
  const s = d(it.start), e = d(it.end), t = today();
  const x = s && s > t ? s : !s && e ? null : s && e && s <= t ? null : s;
  if (x) return html`<div class="dt"><b>${x.getDate()}</b><small>${x.toLocaleDateString("en-GB", { month: "short" })}</small></div>`;
  if (e) return html`<div class="dt"><b>${e.getDate()}</b><small>until ${e.toLocaleDateString("en-GB", { month: "short" })}</small></div>`;
  return html`<div class="dt any"><b>Any</b><small>time</small></div>`;
}
function status(it) {
  const s = d(it.start), e = d(it.end), f = d(it.found), t = today();
  if (e && e >= t && (e - t) / 864e5 <= 10 && (!s || s <= t)) return ["soon", "Ends soon"];
  if (s && +s === +t) return ["now", "Today"];
  if (it.prep && farOut(it)) return ["soon", "Plan ahead"];
  if (f && (t - f) / 864e5 <= 3) return ["new", "New"];
  if (it.picked) return ["new", "Just found"];
  if (it.major) return ["", "Big one"];
  if (it.fresh) return ["", "Fresh idea"];
  return null;
}

// --- Score -----------------------------------------------------------------------------------------
function score(it) {
  const k = distance(it);
  let sc = fit(it) * 20 - Math.min(40, k * 0.4);
  const s = d(it.start), e = d(it.end), t = today();
  if (s && s >= t) sc += Math.max(0, 24 - (s - t) / 864e5); // soon beats later
  if (e && e >= t && (e - t) / 864e5 <= 10) sc += 18;       // last chance
  if (it.major) sc += 8;
  if (it.fresh) sc += 6;
  const txt = (it.title + " " + (it.why || "") + " " + (it.summary || "")).toLowerCase();
  (D.taste.more || []).forEach((m) => { if (txt.includes(String(m).toLowerCase())) sc += 8; });
  (D.taste.less || []).forEach((m) => { if (txt.includes(String(m).toLowerCase())) sc -= 12; });
  // learn a little from this phone's own answers: categories said yes/no to
  let y = 0, n = 0;
  Object.values(S.do).forEach((a) => { if (a.cat === it.cat) { if (a.v > 0) y++; else if (a.v < 0) n++; } });
  sc += Math.max(-15, Math.min(15, (y - n) * 3));
  return sc;
}

// --- Answers --------------------------------------------------------------------------------------------
export const ideas = () => ((D.things && D.things.ideas) || []).filter((it) => it && it.id && it.title);
export const byId = (id) => ideas().find((x) => x.id === id);
export const answer = (it) => S.do[it.id];
let steady = false, lastOrder = null; // a yes or no doesn't re-rank the list under your finger
export function decide(it, v) {
  steady = true; setTimeout(() => { steady = false; }, 0);
  const a = answer(it);
  if (a && a.v === v && v !== 0) delete S.do[it.id];
  else S.do[it.id] = { v, t: Date.now(), title: it.title, cat: it.cat, city: it.city || "", sent: v === 0 };
  save("do");
  emit("change");
}
function queue() {
  return ideas().filter((it) => eligible(it) && (!answer(it) || answer(it).v === 0))
    .sort((a, b) => {
      const la = answer(a) ? answer(a).t : 0, lb = answer(b) ? answer(b).t : 0; // "later" goes to the back
      return (la - lb) || (score(b) - score(a));
    });
}
export const undecidedCount = () => ideas().filter((it) => eligible(it) && !answer(it)).length;
// For the teach box: answers not yet sent to Claude.
export const doPending = () => Object.keys(S.do).filter((k) => S.do[k].v !== 0 && !S.do[k].sent);
export function doLines() {
  return doPending().map((k) => { const a = S.do[k]; return (a.v > 0 ? "yes" : "no") + " | do:" + (a.cat || "") + " | " + a.title + " | " + (a.city || "") + " | id: " + k; });
}
export function markDoSent() { doPending().forEach((k) => { S.do[k].sent = true; }); save("do"); }

// --- Markup ---------------------------------------------------------------------------------------------
const Y = html`<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`;
const N = html`<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg>`;
function meta(it) {
  const st = status(it);
  return html`<span class="dot c-${it.cat}" aria-hidden="true"></span><span>${CATS[it.cat] || "Idea"}</span>${st ? html`<span class="state ${st[0]}">${st[1]}</span>` : ""}`;
}
export const placeText = (it) => [it.venue, it.area, it.city].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join(", ");
function travelText(it) {
  if (it.travel) return it.travel;
  const k = distance(it);
  return tier(k) === 0 ? "" : "About " + Math.round(k) + " km from Den Haag";
}

function cardHTML(it, left) {
  const far = tier(distance(it)) > 0, url = safeUrl(it.url), w = whenText(it);
  return html`<div class="dcount"><span><b>${left}</b> ${left === 1 ? "idea" : "ideas"} to decide</span><span>Swipe or tap</span></div>
  <article class="dcard" data-id="${it.id}" aria-label="${it.title}">
    <div class="dband${far ? " far" : ""}"><span>${far ? "Worth the trip: " + (it.city || "") : homeName() + (it.area ? ", " + it.area : "")}</span><span class="tr">${far ? travelText(it) : ""}</span></div>
    <span class="dstamp y" aria-hidden="true">Yes</span><span class="dstamp n" aria-hidden="true">No</span>
    <div class="dbody">
      <div class="meta">${meta(it)}</div>
      <h3>${it.title}</h3>
      ${placeText(it) ? html`<div class="dwhere">${placeText(it)}</div>` : ""}
      ${w ? html`<div class="dwhen">${w}</div>` : ""}
      ${it.summary ? html`<p>${it.summary}</p>` : ""}
      ${it.why ? html`<p class="dwhy">${it.why}</p>` : ""}
      ${prepText(it) ? html`<p class="dprep"><b>Plan ahead:</b> ${prepText(it)}</p>` : ""}
      ${url ? html`<a class="dmore" href="${url}" target="_blank" rel="noopener">More about it</a>` : ""}
    </div>
    <div class="dchoice"><button class="no" type="button" data-v="-1">${N}Not for me</button><button class="yes" type="button" data-v="1">${Y}I'd go</button></div>
  </article>
  <button class="dlater" type="button" data-v="0">Ask me later</button>`;
}
function rowHTML(it) {
  const a = answer(it), yes = !!(a && a.v > 0), no = !!(a && a.v < 0), w = whenText(it);
  return html`<article class="idea" data-id="${it.id}">${badge(it)}<div class="im">
    <div class="meta">${meta(it)}</div>
    <h3><button class="open" type="button" aria-haspopup="dialog">${it.title}</button></h3>
    <div class="where">${[placeText(it), w].filter(Boolean).join(" · ")}</div>
    <div class="acts"><span class="go"></span><button class="vote n${no ? " on" : ""}" type="button" data-v="-1" aria-pressed="${String(no)}" aria-label="Not for me">${N}</button><button class="vote y${yes ? " on" : ""}" type="button" data-v="1" aria-pressed="${String(yes)}">${Y}${yes ? "Going" : "Yes"}</button></div>
  </div></article>`;
}
function wireRows(box) {
  box.querySelectorAll(".idea").forEach((el) => {
    const it = byId(el.dataset.id);
    if (!it) return;
    el.querySelector(".open").onclick = () => openIdea(it);
    el.querySelectorAll(".vote").forEach((b) => { b.onclick = () => decide(it, +b.dataset.v); });
    swipeRow(el, () => decide(it, 1), () => decide(it, -1), ["Yes", "No"]);
  });
}
const textMatch = (it) => !Q.q || [it.title, it.summary, it.why, it.venue, it.city].join(" ").toLowerCase().includes(Q.q);

// --- Decide card ------------------------------------------------------------------------------------------------
function drawDecide() {
  const box = $("decide"), q = queue();
  if (!ideas().length) {
    put(box, html`<div class="sheet ddone"><b>No ideas yet</b><p>The morning update fills this with things to do in Den Haag, and the best of Amsterdam and Utrecht.</p></div>`);
    return;
  }
  if (!q.length) {
    const yes = Object.values(S.do).filter((a) => a.v > 0).length;
    put(box, html`<div class="sheet ddone"><b>All decided</b><p>${yes ? "You said yes to " + yes + (yes === 1 ? " thing" : " things") + ". " : ""}New ideas arrive with the morning update.</p></div>`);
    return;
  }
  const it = q[0];
  put(box, cardHTML(it, q.length));
  const card = box.querySelector(".dcard");
  const go = (v) => {
    if (busy) return;
    busy = true;
    if (v === 0 || reduceMotion()) { busy = false; decide(it, v); return; }
    card.classList.add(v > 0 ? "gone-yes" : "gone-no");
    setTimeout(() => { busy = false; decide(it, v); }, 260);
  };
  box.querySelectorAll("[data-v]").forEach((b) => { b.onclick = () => go(+b.dataset.v); });
  // swipe right = yes, left = no
  let x0 = null, y0 = 0, dx = 0, lock = null;
  const sy = card.querySelector(".dstamp.y"), sn = card.querySelector(".dstamp.n");
  card.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" || e.target.closest("a,button")) return;
    x0 = e.clientX; y0 = e.clientY; dx = 0; lock = null;
  });
  card.addEventListener("pointermove", (e) => {
    if (x0 == null) return;
    dx = e.clientX - x0;
    if (lock == null && (Math.abs(dx) > 8 || Math.abs(e.clientY - y0) > 8)) lock = Math.abs(dx) > Math.abs(e.clientY - y0) ? "x" : "y";
    if (lock !== "x") return;
    card.style.transition = "none";
    card.style.transform = "translateX(" + dx + "px) rotate(" + dx / 30 + "deg)";
    sy.style.opacity = Math.max(0, Math.min(1, dx / 90));
    sn.style.opacity = Math.max(0, Math.min(1, -dx / 90));
  });
  const end = () => {
    if (x0 == null) return;
    x0 = null; card.style.transition = "";
    if (lock === "x" && Math.abs(dx) > 90) { card.style.transform = ""; go(dx > 0 ? 1 : -1); }
    else { card.style.transform = ""; sy.style.opacity = 0; sn.style.opacity = 0; }
  };
  card.addEventListener("pointerup", end);
  card.addEventListener("pointercancel", end);
}

// --- Yes list -------------------------------------------------------------------------------------------------------
export function sortByDate(a, b) {
  const x = d(a.start) || d(a.end), y = d(b.start) || d(b.end);
  if (x && y) return x - y;
  if (x) return -1;
  if (y) return 1;
  return score(b) - score(a);
}
function drawPlan() {
  const list = ideas().filter((it) => answer(it) && answer(it).v > 0 && !ideaPast(it)).sort(sortByDate);
  $("planHead").hidden = !list.length;
  $("doPlan").hidden = !list.length;
  if (!list.length) return;
  put($("doPlan"), html`${list.map(rowHTML)}`);
  wireRows($("doPlan"));
}

// --- Everything -------------------------------------------------------------------------------------------------------
function catMatch(it) {
  if (view.cat === "all") return true;
  return (CAT_GROUP[view.cat] || [view.cat]).includes(it.cat);
}
function drawAll() {
  const list = ideas().filter((it) => eligible(it) && inWhen(it, view.when) && (view.city === "all" || cityKey(it) === view.city) && catMatch(it) && textMatch(it) &&
    (showNo || !(answer(it) && answer(it).v < 0))).sort((a, b) => score(b) - score(a));
  if (steady && lastOrder) { const pos = new Map(lastOrder.map((id, i) => [id, i])); list.sort((a, b) => (pos.has(a.id) ? pos.get(a.id) : 1e9) - (pos.has(b.id) ? pos.get(b.id) : 1e9)); }
  lastOrder = list.map((it) => it.id);
  const near = list.filter((it) => cityKey(it) === "haag"), far = list.filter((it) => cityKey(it) !== "haag");
  const group = (title, sub, arr, isFar) => (arr.length ? html`<div class="cityline"><span class="flagmark${isFar ? " far" : ""}" aria-hidden="true"></span><h3>${title}</h3><small>${sub}</small></div><div class="sheet">${arr.map(rowHTML)}</div>` : "");
  put($("doAll"), list.length
    ? html`${group(homeName() + " & around", near.length + (near.length === 1 ? " idea" : " ideas"), near, false)}${group("Worth the trip", "only the strongest matches", far, true)}`
    : html`<div class="sheet"><p class="empty">${Q.q ? "Nothing matches “" + Q.q + "”." : "Nothing for this filter. Try another time or place."}</p></div>`);
  wireRows($("doAll"));
  $("doNoBtn").textContent = showNo ? "Hide what I said no to" : "Show what I said no to";
}
function segs(id, list, key) {
  const box = $(id);
  box.textContent = "";
  list.forEach(([k, label]) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "pill" + (view[key] === k ? " on" : "");
    b.setAttribute("aria-pressed", view[key] === k); b.textContent = label;
    b.onclick = () => { view[key] = k; set(KEYS.doView, view); segs(id, list, key); drawAll(); };
    box.appendChild(b);
  });
}

// --- Detail sheet ------------------------------------------------------------------------------------------------------
let current = null;
function sheetBody(it) {
  const a = answer(it), yes = !!(a && a.v > 0), no = !!(a && a.v < 0), url = safeUrl(it.url), rows = [];
  const s = d(it.start), e = d(it.end);
  if (s && e && +s !== +e) rows.push(["Dates", longDate(s) + " to " + longDate(e)]);
  else if (s) rows.push(["Date", longDate(s)]);
  else if (e) rows.push(["Until", longDate(e)]);
  if (it.when) rows.push(["When", it.when]);
  if (placeText(it)) rows.push(["Where", placeText(it)]);
  if (it.price) rows.push(["Price", it.price]);
  if (prepText(it)) rows.push(["Plan ahead", prepText(it)]);
  if (travelText(it)) rows.push(["Getting there", travelText(it)]);
  if (it.why) rows.push(["Why you", it.why]);
  const hasMap = it.lat != null && isFinite(it.lat) && isFinite(it.lon);
  const acts = [
    url && html`<a class="btn" href="${url}" target="_blank" rel="noopener">Open details</a>`,
    hasMap && html`<a class="btn ghost" href="${mapUrl(it.lat, it.lon)}" target="_blank" rel="noopener">Show on map</a>`,
    it.start && html`<button class="btn ghost" type="button" data-a="ics">Add to calendar</button>`,
  ].filter(Boolean);
  return html`<div class="meta">${meta(it)}</div>
    <h2 class="sheet-title" id="sheetTitle">${it.title}</h2>
    ${it.summary ? html`<p class="full">${it.summary}</p>` : ""}
    ${it.flags && it.flags.length ? html`<div class="flags">${it.flags.map((f) => html`<span class="flag">${f}</span>`)}</div>` : ""}
    ${rows.length ? html`<dl class="facts">${rows.map((r) => html`<div><dt>${r[0]}</dt><dd>${r[1]}</dd></div>`)}</dl>` : ""}
    ${acts.length ? html`<div class="sheet-acts">${acts}</div>` : ""}
    <div class="react two"><button class="vote n${no ? " on" : ""}" type="button" data-v="-1" aria-pressed="${String(no)}">${N}Not for me</button><button class="vote y${yes ? " on" : ""}" type="button" data-v="1" aria-pressed="${String(yes)}">${Y}${yes ? "On my list" : "I'd go"}</button></div>`;
}
export function openIdea(it) {
  current = it;
  openSheet(() => sheetBody(current), (el) => {
    el.querySelectorAll(".vote").forEach((b) => { b.onclick = () => decide(current, +b.dataset.v); });
    const c = el.querySelector('[data-a="ics"]');
    if (c) c.onclick = () => ics(Object.assign({ place: it.venue }, current));
  }, it.title);
}
function refreshIdea() { if (sheetOpen() && current && document.querySelector("#sheetBody .react.two")) paintSheet(); }

function paintCount() {
  const tab = document.querySelector('.tab[data-v="discover"]');
  if (!tab) return;
  const n = undecidedCount();
  let c = tab.querySelector(".count");
  if (n && !c) { c = document.createElement("span"); c.className = "count"; c.setAttribute("aria-hidden", "true"); tab.appendChild(c); }
  if (c) { if (n) c.textContent = n > 99 ? "99+" : n; else c.remove(); }
  tab.setAttribute("aria-label", n ? "Discover, " + n + " ideas to decide" : "Discover");
}

export function drawList() { drawAll(); }
export function drawDo() {
  const cs = cities();
  if (!cs.some((c) => c[0] === view.city)) view.city = "all";
  segs("doCity", cs, "city");
  drawDecide(); drawPlan(); drawAll(); paintCount(); refreshIdea();
  const u = D.things && D.things.updated;
  $("doDate").textContent = "Den Haag first" + (u ? ", updated " + shortDate(new Date(u)) : "");
}

// --- Find more ideas now -----------------------------------------------------------------------------------------
// On the Cloudflare site Claude finds ideas right away (/api/ideas, signed like notes, about a minute, a few cents).
// They show at once (kept on this phone in radar-more) and travel in a sealed note, so the next task run checks
// them and keeps the good ones in things.json. Without the server it falls back to the note alone.
function profile() {
  const C = D.config || {}, T = D.taste || {};
  return { do: C.do, culture: C.culture, museums: C.museums, artists: C.artists, meditation: C.meditation,
    learned: T.learned, more: T.more, less: T.less,
    yes: Object.values(S.do).filter((a) => a.v > 0).slice(-15).map((a) => a.title),
    no: Object.values(S.do).filter((a) => a.v < 0).slice(-15).map((a) => a.title) };
}
async function instantIdeas(askText, where) {
  if (!SERVER || !navigator.onLine) return { why: "offline" };
  try {
    const have = ideas().filter((it) => !ideaPast(it)).map((it) => it.title).slice(0, 80);
    const body = JSON.stringify({ ask: askText, where: where || "", profile: profile(), have });
    const r = await fetch("/api/ideas", { method: "POST", credentials: "same-origin", redirect: "manual",
      headers: Object.assign({ "Content-Type": "application/json" }, await signed("/api/ideas", body)), body });
    if (authFailed(r)) { signedOut(true); return { why: "signin" }; }
    if (r.status === 404 || r.status === 401 || r.status === 503) return { why: "setup" };
    const j = await r.json().catch(() => ({}));
    if (j.cost) track({ spend: j.cost });
    return Array.isArray(j.ideas) && j.ideas.length ? { ideas: j.ideas } : { why: "none" };
  } catch (e) { return { why: "fail" }; }
}
let finding = false;
const MORE_BTNS = ["doMoreBtn", "findMoreFor"];
async function findMore(askText, where) {
  if (finding) return;
  finding = true;
  MORE_BTNS.forEach((id) => { const b = $(id); if (b) { b.disabled = true; b.textContent = "Finding more…"; } });
  say("Claude is looking" + (where ? " around " + where : "") + (askText ? " for " + askText : "") + ". This takes about a minute.");
  const res = await instantIdeas(askText, where);
  finding = false;
  MORE_BTNS.forEach((id) => { const b = $(id); if (b) { b.disabled = false; b.textContent = "Find more"; } });
  const stamp = new Date().toISOString().slice(0, 10);
  let found = [];
  if (res.ideas) {
    const slug = (t) => String(t).toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
    found = res.ideas.map((x) => Object.assign({}, x, { id: "m-" + slug(x.title), found: stamp, picked: true }, where ? { trip: true } : {}));
    const M = get(KEYS.more, null), keep = (M && M.items) || [], ids = new Set(keep.map((x) => x.id));
    set(KEYS.more, { t: Date.now(), items: keep.filter((x) => (Date.now() - (M.t || 0)) < 30 * 864e5).concat(found.filter((x) => !ids.has(x.id))) });
    mergePicks();
    emit("change");
    say(found.length + " new ideas. Say yes or no to them first.");
    window.scrollTo({ top: 0 });
  } else {
    const why = { setup: "Instant ideas aren't switched on yet (the ANTHROPIC_API_KEY secret in Cloudflare).", signin: "Sign in again to get ideas right away.",
      offline: "You're offline.", none: "Claude found nothing it could stand behind right now." }[res.why] || "Claude couldn't be reached.";
    say(res.why === "setup" ? "Claude is finding ideas through Radar's tasks. They appear here in about 3 minutes." : why + " Your request went to Radar; ideas arrive within a few minutes.");
    const before = ideas().length, sent = Date.now();
    refreshUntil(() => ideas().length > before || (D.things && Date.parse(D.things.updated) > sent), () => emit("change"));
  }
  note("Do: more ideas" + (askText ? " like " + askText : "") + (where ? " around " + where : ""),
    "Please look for more Do ideas (things to do, " + (where ? "in or near " + where : "Den Haag first") + ")" + (askText ? ": " + askText : ".") +
    (found.length ? "\n\nPicked ideas (instant research, check before keeping):\n" + JSON.stringify(found) : ""),
    "radar-interest", "");
}

// One tap: Find more follows what the pane is set to (place, Near me, when, what, the search text).
const label = (list, k) => (list.find((x) => x[0] === k) || [])[1] || "";
function hereText() { return S.here ? "where I am now (" + (+S.here.lat).toFixed(3) + ", " + (+S.here.lon).toFixed(3) + ")" : ""; }
export function findHere(pane, region, regionLabel) {
  const parts = [];
  let where = "";
  if (pane === "go") {
    if (view.city !== "all" && view.city !== "haag") where = label(cities(), view.city);
    if (view.cat !== "all") parts.push(label(CAT_FILTERS, view.cat).toLowerCase());
    if (view.when !== "all") parts.push(label(WHEN, view.when).toLowerCase());
  } else if (region === "here") where = hereText();
  else if (region && region !== "all" && region !== "nl") where = regionLabel;
  if (Q.q) parts.push(Q.q);
  const T = tripPoint();
  if (!where && T) where = T.name + " (" + T.lat.toFixed(3) + ", " + T.lon.toFixed(3) + ")";
  findMore(parts.join(", "), where);
}

// Trip mode: padel courts and open matches near where you are.
export function findPadel() {
  const T = tripPoint();
  findMore("padel: courts to book and open matches to join (Playtomic and club pages), with cat sport", T ? T.name + " (" + T.lat.toFixed(3) + ", " + T.lon.toFixed(3) + ")" : "");
}

export function initDo(ask, regionNow) {
  segs("doWhen", WHEN, "when");
  segs("doCat", CAT_FILTERS, "cat");
  $("doNoBtn").onclick = () => { showNo = !showNo; drawAll(); };
  $("doMoreBtn").onclick = () => findHere("go");
  const f = $("findMoreFor");
  if (f) f.onclick = () => { const r = regionNow(); findHere("foryou", r[0], r[1]); };
}
