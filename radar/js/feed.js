// The feed: ranking (taste.json + reactions), item rows, and the lists on Today, Explore, Work and Saved.
import { paint as paintFresh, wasSeen } from "./fresh.js";
import { $, html, put, d, today, shortDate, safeUrl, km, kmText, ago, isoDay } from "./util.js";
import { S, save } from "./store.js";
import { D, emit, visible, past, isWork, isGo, focusRegion, REGION_NAME, Q, refreshUntil, nearTrip } from "./data.js";
import { swipeRow, say, currentTab } from "./ui.js";
import { track, note } from "./notes.js";

// Read & listen: what you read, watch or listen to. Things to go to (concerts, exhibitions, food) are in Go.
export const KINDS = [["all", "Everything"], ["concert", "Music"], ["story", "Books & film"], ["meditation", "Meditation"]];
export const WORK_KINDS = [["all", "Everything"], ["mine", "Tracking"], ["event", "Events"], ["call", "Calls & grants"], ["job", "Jobs"], ["freelance", "Freelance"], ["startups", "Startups"], ["insight", "Reading"]];
// Startup-ecosystem work (mentoring, programme roles, juries, investor-readiness coaching at accelerators, climate
// funds, public funders and corporate innovation): the work task marks it `eco: true` with `eco_role`.
const ECO_ROLE = { mentor: "Mentor", programme: "Programme", jury: "Jury", coach: "Investor readiness", entry: "Market entry", tender: "Tender" };
export const isEco = (it) => !!it.eco;
// Where a work lead is: from its region (nl | be/de/uk/eu → Europe | jp | anything else → Global/remote)
export const WORK_PLACES = [["all", "Anywhere"], ["nl", "Netherlands"], ["eu", "Europe"], ["jp", "Japan"], ["global", "Global"]];
const workPlace = (it) => (it.region === "nl" ? "nl" : ["eu", "be", "de", "uk", "fr", "lu", "ie"].includes(it.region) ? "eu" : it.region === "jp" ? "jp" : "global");
// Work items carry an optional `sub` (event | call | grant | job | freelance | insight) and `deadline`
// (application or registration date). Older items without them are sorted into place.
const WORK_LABEL = { event: "Event", call: "Call", grant: "Grant", job: "Job", freelance: "Freelance", insight: "Reading" };
export function workSub(it) {
  if (it.sub && WORK_LABEL[it.sub]) return it.sub;
  if (it.kind === "freelance") return "freelance";
  if (it.start) return "event";
  if (it.end) return "call";
  return "job";
}
// The date to act by: an explicit deadline, or the closing date of calls, grants and freelance leads.
export function deadline(it) {
  if (it.deadline) return d(it.deadline);
  const s = workSub(it);
  return s === "call" || s === "grant" || s === "freelance" || s === "job" ? d(it.end) : null;
}
const KLABEL = { concert: "Music", release: "Music", news: "Music", exhibition: "Art", restaurant: "Food", story: "Books & film", meditation: "Meditation", work: "Work", freelance: "Freelance", bucket: "Bucket list" };
const MUSIC = ["concert", "release", "news"];
export const state = { kind: "all", region: "all", work: "all", wplace: "all", showHidden: false, all: false, q: "", company: "" };
// a work lead is at a company when its org (or the work task's `company` tag) names it
let coFlag = () => "", grp = () => 0;
export const setGroupRank = (fn) => { grp = fn; };
export const setCompanyFlag = (fn) => { coFlag = fn; };
export const atCompany = (it, name) => { const o = String(it.company || it.org || "").trim().toLowerCase(), n = String(name || "").trim().toLowerCase(); return !!o && !!n && (o === n || o.includes(n) || (o.length > 3 && n.includes(o))); };
const textMatch = (it) => !Q.q || [it.title, it.summary, it.why, it.place, it.city].join(" ").toLowerCase().includes(Q.q);

// Location filters come from where the items are: Near me (when Look around knows where you are), the
// Netherlands, then every other country or region that has something, most items first.
const RNAME = { nl: "Netherlands", be: "Belgium", de: "Germany", fr: "France", uk: "UK", es: "Spain", pt: "Portugal", it: "Italy",
  ch: "Switzerland", at: "Austria", dk: "Denmark", eu: "Europe", jp: "Japan", us: "USA", ma: "Morocco", cv: "Cape Verde" };
const regionName = (r) => REGION_NAME[r] || RNAME[r] || String(r).toUpperCase();
export function regions() {
  const list = [["all", "Anywhere"]];
  if (S.here && D.feed && D.feed.items.some((it) => it.lat != null && visible(it))) list.push(["here", "Near me"]);
  const n = {};
  (D.feed ? D.feed.items : []).filter((it) => visible(it) && !isWork(it) && it.region && it.region !== "all").forEach((it) => { n[it.region] = (n[it.region] || 0) + 1; });
  if (n.nl) list.push(["nl", "Netherlands"]);
  Object.keys(n).filter((r) => r !== "nl").sort((a, b) => n[b] - n[a]).forEach((r) => list.push([r, regionName(r)]));
  return list;
}

// --- Status, dates, score --------------------------------------------------------------
function endsSoon(it) {
  const s = d(it.start), t = today(), dl = isWork(it) ? deadline(it) : null, e = dl || d(it.end);
  return !!(e && e >= t && (e - t) / 864e5 <= 14 && (!s || s <= t || !!dl));
}
function status(it) {
  const s = d(it.start), e = d(it.end), f = d(it.found), t = today();
  if (endsSoon(it)) return ["soon", isWork(it) && deadline(it) ? "Deadline soon" : "Ends soon"];
  if (s && s <= t && (!e || e >= t) && it.kind !== "restaurant" && it.kind !== "story") return ["now", "On now"];
  if (it.pick) return ["", "Suggestion"];
  if (it.kind === "bucket") return ["now", "Good time"];
  return null;
}
function when(it) {
  const s = d(it.start), e = d(it.end);
  if (it.kind === "freelance" || (isWork(it) && workSub(it) !== "event" && !it.deadline)) return s ? "From " + shortDate(s) : "";
  if (s && e && +s !== +e) return shortDate(s) + " to " + shortDate(e);
  if (s) return shortDate(s);
  if (e) return "Until " + shortDate(e);
  return "";
}
export function score(it) {
  let sc = 0;
  const r = S.reactions[it.id];
  if (r) sc += r.v * 50;
  if (S.saved[it.id]) sc += 40;
  if (it.kind === "bucket") sc += 35;
  const st = status(it);
  if (st && st[0] === "new") sc += 30;
  if (st && st[0] === "soon") sc += 25;
  const s = d(it.start), t = today();
  if (s && s >= t) sc += Math.max(0, 20 - (s - t) / 864e5 / 3);
  if (S.here && it.lat != null) { const k = km(S.here.lat, S.here.lon, it.lat, it.lon); sc += k < 5 ? 25 : k < 30 ? 15 : k < 100 ? 5 : 0; }
  if (nearTrip(it)) sc += 40; // trip mode: things around where you are come first
  const txt = (it.title + " " + (it.why || "") + " " + (it.summary || "")).toLowerCase();
  (D.taste.more || []).forEach((m) => { if (txt.includes(String(m).toLowerCase())) sc += 15; });
  (D.taste.less || []).forEach((m) => { if (txt.includes(String(m).toLowerCase())) sc -= 15; });
  return sc;
}
export function placeOf(it) {
  let place = [it.place, it.city].filter(Boolean).join(", ");
  if (S.here && it.lat != null) place += (place ? ", " : "") + kmText(km(S.here.lat, S.here.lon, it.lat, it.lon)) + " away";
  return place;
}
export const calable = (it) => !!(it.start || (isWork(it) && deadline(it)));

// --- Markup -------------------------------------------------------------------------------
const I = {
  up: html`<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M7 11v9H4v-9zM7 11l4-7c1.5 0 2.5 1 2.2 2.6L12.8 10H19a2 2 0 0 1 2 2.3l-1.2 6A2 2 0 0 1 17.8 20H7"/></svg>`,
  down: html`<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M7 13V4H4v9zM7 13l4 7c1.5 0 2.5-1 2.2-2.6l-.4-3.4H19a2 2 0 0 0 2-2.3l-1.2-6A2 2 0 0 0 17.8 4H7"/></svg>`,
  save: html`<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/></svg>`,
  saveOn: html`<svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/></svg>`,
  hide: html`<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>`,
  unhide: html`<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4"/></svg>`,
};
export function metaLine(it) {
  const st = status(it), w = when(it);
  const label = isWork(it) ? WORK_LABEL[workSub(it)] : KLABEL[it.kind] || it.kind;
  return html`<span class="dot k-${isWork(it) ? "w-" + workSub(it) : it.kind}" aria-hidden="true"></span><span>${label}</span>${isWork(it) && it.org ? html`<span>${it.org}</span>` : ""}${w ? html`<span>${w}</span>` : ""}${st ? html`<span class="state ${st[0]}">${st[1]}</span>` : ""}`;
}
export function dueHTML(it) {
  const e = isWork(it) ? deadline(it) : null;
  if (!e || e < today()) return "";
  const n = Math.floor((e - today()) / 864e5);
  const date = e.toLocaleDateString("en-GB", { weekday: n < 7 ? "long" : undefined, day: "numeric", month: "long" });
  const verb = workSub(it) === "event" ? "Register by" : "Apply by";
  return html`<div class="due${n <= 14 ? " close" : ""}">${verb} ${date}${n === 0 ? ", today" : n === 1 ? ", tomorrow" : n <= 14 ? ", " + n + " days left" : ""}</div>`;
}
export const flagsHTML = (it) => {
  const eco = isWork(it) && isEco(it) ? html`<span class="flag eco">Startups${ECO_ROLE[it.eco_role] ? " · " + ECO_ROLE[it.eco_role] : ""}</span>` : "";
  const regen = isWork(it) && it.theme === "regen" ? html`<span class="flag eco">Regenerative</span>` : "";
  const f = Array.isArray(it.flags) ? it.flags : [];
  return eco || regen || f.length ? html`<div class="flags">${eco}${regen}${f.map((x) => html`<span class="flag">${x}</span>`)}</div>` : "";
};
export function reactButtons(it, labels) {
  const r = S.reactions[it.id], up = !!(r && r.v > 0), down = !!(r && r.v < 0), sv = !!S.saved[it.id], hd = !!S.hidden[it.id];
  const L = (t) => (labels ? html`<span>${t}</span>` : "");
  return html`<button class="ib up${up ? " on" : ""}" data-a="up" type="button" aria-label="More like this" aria-pressed="${String(up)}">${I.up}${L("More")}</button><button class="ib down${down ? " on" : ""}" data-a="down" type="button" aria-label="Less like this" aria-pressed="${String(down)}">${I.down}${L("Less")}</button><button class="ib save${sv ? " on" : ""}" data-a="save" type="button" aria-label="${sv ? "Saved" : "Save"}" aria-pressed="${String(sv)}">${sv ? I.saveOn : I.save}${L(sv ? "Saved" : "Save")}</button><button class="ib hide" data-a="hide" type="button" aria-label="${hd ? "Unhide" : "Hide"}">${hd ? I.unhide : I.hide}${L(hd ? "Unhide" : "Hide")}</button>`;
}
// the kind of new find, for the "New" counts and Today's line (fresh.js)
export const freshKind = (it) => (isWork(it) ? "lead" : it.kind === "concert" ? "concert" : it.kind === "bucket" ? "bucket"
  : ["release", "story", "news", "meditation"].includes(it.kind) ? "read" : "idea");
function itemHTML(it, big) {
  const place = placeOf(it), url = safeUrl(it.url);
  return html`<article class="item${big ? " big" : ""}" data-id="${it.id}" data-fresh="f:${it.id}" data-found="${it.found || ""}" data-fk="${freshKind(it)}"${calable(it) ? html` data-cal="1"` : ""}>
    <div class="meta">${metaLine(it)}</div>
    <h3><button class="open" type="button" aria-haspopup="dialog">${it.title}</button></h3>
    ${place ? html`<div class="where">${place}</div>` : ""}${dueHTML(it)}
    ${it.summary ? html`<p class="clip">${it.summary}</p>` : ""}${flagsHTML(it)}${coFlag(it)}
    <div class="acts">${url ? html`<a class="go" href="${url}" target="_blank" rel="noopener">Open details</a>` : html`<span class="go"></span>`}${isWork(it) ? trackButtons(it) : reactButtons(it, false)}</div>
  </article>`;
}

// --- Work tracker: interested / applied / not for me ------------------------------------------------
// Kept on this phone (radar-work) and sent sealed (a radar-track note), so Radar can remind you of deadlines
// and the work search learns what isn't for you.
export const tracked = (it) => (S.work[it.id] || {}).state || "";
const TRACK = [["interested", "Interested"], ["applied", "Applied"], ["skip", "Not for me"]];
export function trackButtons(it, big) {
  const st = tracked(it);
  return html`<span class="track${big ? " big" : ""}" role="group" aria-label="Track this lead">${TRACK.map(([k, label]) =>
    html`<button class="tk ${k}${st === k ? " on" : ""}" type="button" data-t="${k}" aria-pressed="${String(st === k)}">${label}</button>`)}</span>`;
}
export function setTrack(it, st) {
  holdOrder();
  emit("work-before", JSON.parse(JSON.stringify(S.work)));
  const cur = tracked(it);
  if (cur === st) delete S.work[it.id];
  else {
    const dl = deadline(it);
    S.work[it.id] = { state: st, t: Date.now(), title: it.title, deadline: dl ? isoDay(dl) : "", url: it.url || "", org: it.org || "" };
    if (st === "skip") { S.hidden[it.id] = 1; justHidden.add(it.id); save("hidden"); react(it, -1, true); }
    else if (S.hidden[it.id]) { delete S.hidden[it.id]; save("hidden"); }
  }
  save("work");
  // send what's still current (leads that haven't passed), so reminders and the work search stay in step
  const snap = {};
  Object.keys(S.work).forEach((k) => {
    const w = S.work[k], x = d(w.deadline);
    if (!x || x >= today() || w.state !== "interested") snap[k] = w;
  });
  track({ work: snap });
  emit("change");
}

let openItem = () => {};
export function setOpener(fn) { openItem = fn; }
function mount(box, list, big, empty) {
  put(box, list.length ? html`${list.map((it) => itemHTML(it, big))}` : html`<p class="empty">${empty}</p>`);
  box.querySelectorAll(".item").forEach((el) => {
    const it = D.byId[el.dataset.id];
    el.querySelector(".open").onclick = () => openItem(it);
    el.querySelectorAll(".ib").forEach((b) => { b.onclick = () => act(it, b.dataset.a); });
    el.querySelectorAll(".tk").forEach((b) => { b.onclick = () => setTrack(it, b.dataset.t); });
    if (isWork(it)) swipeRow(el, () => setTrack(it, "interested"), () => setTrack(it, "skip"), ["Interested", "Not for me"]);
    else swipeRow(el, () => react(it, 1, true) || emit("change"), () => act(it, "hide"), ["More like this", "Hide"]);
  });
}

// --- Steady order -----------------------------------------------------------------------------------------
// A reaction changes an item's score; re-sorting right away would make the item you just tapped jump. So a
// redraw caused by a reaction or save keeps the last order (items that left are dropped, new ones go last);
// the new ranking shows the next time the list loads or a filter changes.
const ORDER = {};
let steady = false;
function holdOrder() { steady = true; setTimeout(() => { steady = false; }, 0); }
function ordered(key, items) {
  const prev = ORDER[key];
  if (steady && prev) {
    const pos = new Map(prev.map((id, i) => [id, i]));
    items = items.slice().sort((a, b) => (pos.has(a.id) ? pos.get(a.id) : 1e9) - (pos.has(b.id) ? pos.get(b.id) : 1e9));
  }
  ORDER[key] = items.map((it) => it.id);
  return items;
}

// --- Reactions ---------------------------------------------------------------------------
export function react(it, v, soft) {
  const r = S.reactions[it.id];
  if (r && r.v === v && !soft) delete S.reactions[it.id];
  else if (!(soft && r)) S.reactions[it.id] = { v, t: Date.now(), title: it.title, kind: it.kind, why: it.why || "", sent: false };
  save("reactions");
  holdOrder();
}
// Items hidden since the last send, so Undo in the notice can bring exactly those back.
export const justHidden = new Set();
export function act(it, a) {
  holdOrder();
  if (a === "save") { if (S.saved[it.id]) delete S.saved[it.id]; else S.saved[it.id] = 1; save("saved"); }
  else if (a === "hide") { if (S.hidden[it.id]) delete S.hidden[it.id]; else { S.hidden[it.id] = 1; justHidden.add(it.id); react(it, -1, true); } save("hidden"); }
  else react(it, a === "up" ? 1 : -1);
  emit("change");
}

// --- Lists -----------------------------------------------------------------------------------
function kindMatch(it) {
  if (state.kind === "all") return true;
  return it.kind === state.kind || (state.kind === "concert" && MUSIC.includes(it.kind));
}
function regionMatch(it) {
  if (state.region === "all") return true;
  if (state.region === "here") return !!(S.here && it.lat != null && km(S.here.lat, S.here.lon, it.lat, it.lon) <= 50);
  return it.region === state.region || it.region === "all";
}
export function drawFeed() {
  const items = D.feed.items.filter((it) => visible(it) && !isWork(it) && !isGo(it) && it.kind !== "bucket" && (state.showHidden || !S.hidden[it.id]) && kindMatch(it) && regionMatch(it) && textMatch(it))
    .sort((a, b) => score(b) - score(a));
  const items2 = ordered("feed", items);
  const limit = state.all ? items2.length : 12;
  mount($("feed"), items2.slice(0, limit), false, Q.q ? "Nothing matches “" + Q.q + "”." : "Nothing here yet. The daily update adds new finds every morning.");
  if (items.length > limit) {
    const m = document.createElement("button");
    m.className = "more"; m.type = "button"; m.textContent = "Show " + (items.length - limit) + " more";
    m.onclick = () => { state.all = true; drawFeed(); };
    $("feed").appendChild(m);
  }
  $("feedSub").textContent = (items.length === 1 ? "1 thing" : items.length + " things") + " to read, watch and listen to, updated " + ago(D.feed.updated) + ". Swipe right for more like it, left to hide.";
}
// --- For you: one feed of everything Radar found (not work), best first --------------------------------------
// Ranked by score(): taste words, your thumbs and saves, what's new or ending soon, the bucket list. Each card
// says why it's there (the `why` Claude wrote from your interests). Things you went no on in Go stay out.
let forAll = false;
export function drawForYou() {
  const box = $("forYou");
  if (!box) return;
  const no = (it) => { const a = S.do["f-" + it.id]; return !!(a && a.v < 0); };
  const items = D.feed.items.filter((it) => visible(it) && !isWork(it) && !S.hidden[it.id] && !no(it) && !(S.reactions[it.id] && S.reactions[it.id].v < 0) && regionMatch(it) && textMatch(it))
    .sort((a, b) => score(b) - score(a));
  const list = ordered("forYou", items);
  const limit = forAll ? list.length : 15;
  mount(box, list.slice(0, limit), true, Q.q ? "Nothing matches “" + Q.q + "”." : "Nothing yet. The morning update fills this in.");
  if (list.length > limit) {
    const m = document.createElement("button");
    m.className = "more"; m.type = "button"; m.textContent = "Show " + (list.length - limit) + " more";
    m.onclick = () => { forAll = true; drawForYou(); };
    box.appendChild(m);
  }
  box.querySelectorAll(".item").forEach((el) => {
    const it = D.byId[el.dataset.id];
    if (!it || !it.why || el.querySelector(".because")) return;
    const p = document.createElement("p"); p.className = "because"; p.textContent = "Because: " + it.why;
    const h = el.querySelector("h3"); if (h) h.after(p);
  });
}

// The next date that matters: a deadline still ahead, else the event's start.
function actBy(it) {
  const t = today(), dl = deadline(it), s = d(it.start);
  if (dl && dl >= t) return dl;
  if (s && s >= t) return s;
  return null;
}
function workMatch(it) {
  if (state.company && !atCompany(it, state.company)) return false;
  // Europe includes the Netherlands
  if (state.wplace !== "all" && workPlace(it) !== state.wplace && !(state.wplace === "eu" && workPlace(it) === "nl")) return false;
  if (state.work === "all") return true;
  if (state.work === "mine") return ["interested", "applied"].includes(tracked(it));
  if (state.work === "startups") return isEco(it);
  const s = workSub(it);
  return s === state.work || (state.work === "call" && s === "grant");
}
// --- New work leads -------------------------------------------------------------------------------------------
// A lead found in the last 7 days that you haven't seen in Work yet is new: it gets its own section at the top of
// Work and a count on the Work tab. Leaving Work marks them as seen (radar-work-seen). The first time, leads found in
// the last 3 days count as new and older ones as seen.
const leadsNow = () => D.feed.items.filter((it) => isWork(it) && visible(it) && !S.hidden[it.id] && tracked(it) !== "skip");
export function newLeads() {
  const t = today();
  if (!S.workSeen) { // first time: leads from the last 3 days count as new, older ones as seen
    S.workSeen = {};
    leadsNow().forEach((it) => { if (!(d(it.found) && (t - d(it.found)) / 864e5 <= 3)) S.workSeen[it.id] = 1; });
    save("workSeen");
  }
  // seen on screen or opened (fresh.js), or already marked Interested / Applied: not new any more
  return leadsNow().filter((it) => !S.workSeen[it.id] && !wasSeen("f:" + it.id) && !tracked(it) && d(it.found) && (t - d(it.found)) / 864e5 <= 7)
    .sort((a, b) => (grp(workSub(a)) - grp(workSub(b))) || (d(b.found) - d(a.found)) || ((actBy(a) || 9e15) - (actBy(b) || 9e15)));
}
// as leads get seen, the New leads number goes down; the section goes once all are seen and it's off screen
window.addEventListener("radar-seen", (e) => {
  if (!/^f:/.test(e.detail || "") || !D.feed) return;
  const box = $("workNew");
  if (!box || box.hidden) return;
  const n = newLeads().length, c = box.querySelector(".h-count");
  if (n && c) { c.textContent = n; return; }
  if (c) c.remove();
  const r = box.getBoundingClientRect();
  if (currentTab() !== "work" || r.bottom < 0 || r.top > innerHeight) drawNewLeads();
  else { const h = box.querySelector("#hNewLeads"); if (h && !box.querySelector(".all-seen")) h.insertAdjacentHTML("beforeend", '<span class="all-seen">all seen</span>'); }
});
export function markLeadsSeen() {
  const n = newLeads();
  if (!n.length) return;
  n.forEach((it) => { S.workSeen[it.id] = 1; });
  // forget leads that are gone, so the list stays small
  const live = new Set(leadsNow().map((it) => it.id));
  Object.keys(S.workSeen).forEach((k) => { if (!live.has(k)) delete S.workSeen[k]; });
  save("workSeen");
  paintWorkCount(); drawNewLeads();
}
// tab numbers come from fresh.js: unseen new things on each tab, gone once you've seen them
export function paintWorkCount() { paintFresh(); }
function drawNewLeads() {
  const box = $("workNew"), list = newLeads();
  if (!box) return;
  box.hidden = !list.length;
  if (!list.length) return;
  put(box, html`<h2 id="hNewLeads">New leads <span class="h-count">${list.length}</span></h2><div class="sheet" id="workNewList"></div>
    <p class="fine tight">New since you last looked. They move into All leads below when you leave Work.</p>`);
  mount($("workNewList"), list, false, "");
}

export function drawWork() {
  drawNewLeads(); paintWorkCount();
  const all = D.feed.items.filter((it) => isWork(it) && visible(it) && (state.showHidden || (!S.hidden[it.id] && tracked(it) !== "skip")));
  const rank = (it) => ({ interested: 0, applied: 1 }[tracked(it)] ?? 2);
  const items = all.filter(workMatch).sort((a, b) => {
    if (state.work === "mine" && rank(a) !== rank(b)) return rank(a) - rank(b);
    if (state.work === "all" && grp(workSub(a)) !== grp(workSub(b))) return grp(workSub(a)) - grp(workSub(b));
    const x = actBy(a), y = actBy(b);
    if (x && y && +x !== +y) return x - y;
    if (x && !y) return -1;
    if (y && !x) return 1;
    return score(b) - score(a);
  });
  const empty = { mine: "Nothing tracked yet. Mark a lead Interested or Applied, or swipe it right.", freelance: "No freelance leads right now.", event: "No events on the radar right now.", call: "No open calls right now.", job: "No roles right now.", startups: "No startup or accelerator work right now.", insight: "Nothing to read yet." }[state.work] || "Nothing here yet.";
  mount($("workFeed"), items, false, state.company ? "No open leads at " + state.company + " right now. The work search checks again on Tuesdays and Fridays." : empty + " The daily update checks every morning.");
  const cf = $("workCompany");
  if (cf) { cf.hidden = !state.company; if (state.company) { $("workCompanyName").textContent = "Only " + state.company; } }
  const mine = all.filter((it) => tracked(it) === "interested" || tracked(it) === "applied").length;
  $("workSub").textContent = (items.length === 1 ? "1 lead" : items.length + " leads") + (mine ? ", " + mine + " tracked" : "") + ", updated " + ago(D.feed.updated) + ". Swipe right for Interested, left for Not for me.";
  // Next deadlines across everything, the three nearest
  const due = all.filter((it) => { const x = deadline(it); return x && x >= today() && tracked(it) !== "applied"; })
    .sort((a, b) => (tracked(a) === "interested" ? 0 : 1) - (tracked(b) === "interested" ? 0 : 1) || deadline(a) - deadline(b)).slice(0, 3);
  const box = $("workDue");
  box.hidden = !due.length;
  put(box, html`<h2>Next deadlines</h2><div class="sheet brief">${due.map((it) => {
    const x = deadline(it), n = Math.floor((x - today()) / 864e5);
    return html`<button class="mini" type="button" data-id="${it.id}"><span class="when${n <= 14 ? " close" : ""}">${x.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span><span class="what"><b>${it.title}</b><small>${tracked(it) === "interested" ? "Interested · " : ""}${WORK_LABEL[workSub(it)]}${n === 0 ? " · today" : n === 1 ? " · tomorrow" : " · " + n + " days"}</small></span></button>`;
  })}</div>`);
  box.querySelectorAll(".mini").forEach((b) => {
    const it = D.byId[b.dataset.id];
    b.onclick = () => openItem(it);
    swipeRow(b, () => setTrack(it, "interested"), () => setTrack(it, "skip"), ["Interested", "Not for me"]);
  });
}
export function drawSavedItems() {
  mount($("savedList"), D.feed.items.filter((it) => S.saved[it.id] && !past(it)), false, "Nothing saved yet. Tap the star on anything you want to keep; your yes list is in Discover.");
}
export { mount, endsSoon, status as itemStatus, WORK_LABEL };
export function mountBucketHits(el, wishId) {
  mount(el, D.feed.items.filter((it) => it.kind === "bucket" && it.bucket === wishId && !past(it) && !S.hidden[it.id]), false, "");
}
// Read & listen › Find more: a sealed note that the inbox task answers within minutes (it adds feed items).
export function initFindRead() {
  const b = $("findMoreRead");
  if (!b) return;
  b.onclick = () => {
    const what = [state.kind !== "all" ? (KINDS.find((x) => x[0] === state.kind) || [])[1] : "", Q.q].filter(Boolean).join(", ");
    note("Read & listen: more" + (what ? " " + what : ""), "Please find 5 more things to read, watch or listen to" + (what ? ": " + what : "") + ".", "radar-interest", "");
    say("Claude is looking. New things appear here in a few minutes.");
    const before = D.feed.items.length, sent = Date.now();
    refreshUntil(() => D.feed.items.length > before || Date.parse(D.feed.updated) > sent, () => emit("change"));
  };
}
export function initSearch(redrawGo) {
  const q = $("q");
  const x = $("qClear");
  q.oninput = () => { Q.q = q.value.trim().toLowerCase(); state.all = !!Q.q; x.hidden = !q.value; drawFeed(); drawForYou(); redrawGo(); };
  x.onclick = () => { q.value = ""; q.oninput(); q.focus(); };
}
export function segs(id, list, key, redraw) {
  const box = $(id);
  box.textContent = "";
  list.forEach(([k, label]) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "pill" + (state[key] === k ? " on" : "");
    b.setAttribute("aria-pressed", state[key] === k); b.textContent = label;
    b.onclick = () => { state[key] = k; state.all = false; segs(id, list, key, redraw); redraw(); };
    box.appendChild(b);
  });
}
