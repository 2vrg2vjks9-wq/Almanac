// The feed: ranking (taste.json + reactions), item rows, and the lists on Today, Explore, Work and Saved.
import { $, html, put, d, today, shortDate, safeUrl, km, kmText, ago } from "./util.js";
import { S, save } from "./store.js";
import { D, emit, visible, past, isWork, focusRegion, REGION_NAME } from "./data.js";

export const KINDS = [["all", "Everything"], ["concert", "Music"], ["exhibition", "Art"], ["restaurant", "Food"], ["story", "Books & film"], ["meditation", "Meditation"], ["bucket", "Bucket list"]];
export const WORK_KINDS = [["all", "Everything"], ["work", "Jobs & calls"], ["freelance", "Freelance"]];
const KLABEL = { concert: "Music", release: "Music", news: "Music", exhibition: "Art", restaurant: "Food", story: "Books & film", meditation: "Meditation", work: "Work", freelance: "Freelance", bucket: "Bucket list" };
const MUSIC = ["concert", "release", "news"];
export const state = { kind: "all", region: "all", work: "all", showHidden: false, all: false };

export function regions() {
  const list = [["all", "Anywhere"], ["nl", "Netherlands"], ["near", "Belgium, Germany, EU"]];
  const f = focusRegion();
  if (f) list.push([f, REGION_NAME[f] || f]);
  return list;
}

// --- Status, dates, score --------------------------------------------------------------
function endsSoon(it) {
  const s = d(it.start), e = d(it.end), t = today();
  return !!(e && e >= t && (e - t) / 864e5 <= 14 && (!s || s <= t || it.kind === "freelance"));
}
function status(it) {
  const s = d(it.start), e = d(it.end), f = d(it.found), t = today();
  if (endsSoon(it)) return ["soon", it.kind === "freelance" ? "Deadline soon" : "Ends soon"];
  if (f && (t - f) / 864e5 <= 3) return ["new", "New"];
  if (s && s <= t && (!e || e >= t) && it.kind !== "restaurant" && it.kind !== "story") return ["now", "On now"];
  if (it.pick) return ["", "Suggestion"];
  if (it.kind === "bucket") return ["now", "Good time"];
  return null;
}
function when(it) {
  const s = d(it.start), e = d(it.end);
  if (it.kind === "freelance") return s ? "From " + shortDate(s) : "";
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
export const calable = (it) => !!(it.start || (it.kind === "freelance" && it.end));

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
  return html`<span class="dot k-${it.kind}" aria-hidden="true"></span><span>${KLABEL[it.kind] || it.kind}</span>${w ? html`<span>${w}</span>` : ""}${st ? html`<span class="state ${st[0]}">${st[1]}</span>` : ""}`;
}
export function dueHTML(it) {
  const e = d(it.end);
  if (it.kind !== "freelance" || !e) return "";
  const n = Math.floor((e - today()) / 864e5);
  const date = e.toLocaleDateString("en-GB", { weekday: n < 7 ? "long" : undefined, day: "numeric", month: "long" });
  return html`<div class="due${n <= 14 ? " close" : ""}">Apply by ${date}${n === 0 ? ", today" : n === 1 ? ", tomorrow" : n <= 14 ? ", " + n + " days left" : ""}</div>`;
}
export const flagsHTML = (it) => (it.flags && it.flags.length ? html`<div class="flags">${it.flags.map((f) => html`<span class="flag">${f}</span>`)}</div>` : "");
export function reactButtons(it, labels) {
  const r = S.reactions[it.id], up = !!(r && r.v > 0), down = !!(r && r.v < 0), sv = !!S.saved[it.id], hd = !!S.hidden[it.id];
  const L = (t) => (labels ? html`<span>${t}</span>` : "");
  return html`<button class="ib up${up ? " on" : ""}" data-a="up" type="button" aria-label="More like this" aria-pressed="${up}">${I.up}${L("More")}</button><button class="ib down${down ? " on" : ""}" data-a="down" type="button" aria-label="Less like this" aria-pressed="${down}">${I.down}${L("Less")}</button><button class="ib save${sv ? " on" : ""}" data-a="save" type="button" aria-label="${sv ? "Saved" : "Save"}" aria-pressed="${sv}">${sv ? I.saveOn : I.save}${L(sv ? "Saved" : "Save")}</button><button class="ib hide" data-a="hide" type="button" aria-label="${hd ? "Unhide" : "Hide"}">${hd ? I.unhide : I.hide}${L(hd ? "Unhide" : "Hide")}</button>`;
}
function itemHTML(it, big) {
  const place = placeOf(it), url = safeUrl(it.url);
  return html`<article class="item${big ? " big" : ""}" data-id="${it.id}"${calable(it) ? html` data-cal="1"` : ""}>
    <div class="meta">${metaLine(it)}</div>
    <h3><button class="open" type="button" aria-haspopup="dialog">${it.title}</button></h3>
    ${place ? html`<div class="where">${place}</div>` : ""}${dueHTML(it)}
    ${it.summary ? html`<p class="clip">${it.summary}</p>` : ""}${flagsHTML(it)}
    <div class="acts">${url ? html`<a class="go" href="${url}" target="_blank" rel="noopener">Open details</a>` : html`<span class="go"></span>`}${reactButtons(it, false)}</div>
  </article>`;
}

let openItem = () => {};
export function setOpener(fn) { openItem = fn; }
function mount(box, list, big, empty) {
  put(box, list.length ? html`${list.map((it) => itemHTML(it, big))}` : html`<p class="empty">${empty}</p>`);
  box.querySelectorAll(".item").forEach((el) => {
    const it = D.byId[el.dataset.id];
    el.querySelector(".open").onclick = () => openItem(it);
    el.querySelectorAll(".ib").forEach((b) => { b.onclick = () => act(it, b.dataset.a); });
  });
}

// --- Reactions ---------------------------------------------------------------------------
function react(it, v, soft) {
  const r = S.reactions[it.id];
  if (r && r.v === v && !soft) delete S.reactions[it.id];
  else if (!(soft && r)) S.reactions[it.id] = { v, t: Date.now(), title: it.title, kind: it.kind, why: it.why || "", sent: false };
  save("reactions");
}
export function act(it, a) {
  if (a === "save") { if (S.saved[it.id]) delete S.saved[it.id]; else S.saved[it.id] = 1; save("saved"); }
  else if (a === "hide") { if (S.hidden[it.id]) delete S.hidden[it.id]; else { S.hidden[it.id] = 1; react(it, -1, true); } save("hidden"); }
  else react(it, a === "up" ? 1 : -1);
  emit("change");
}

// --- Lists -----------------------------------------------------------------------------------
export function drawTop() {
  const pool = D.feed.items.filter((it) => visible(it) && !S.hidden[it.id] && !(S.reactions[it.id] && S.reactions[it.id].v < 0));
  const first = pool.filter(endsSoon).sort((a, b) => d(a.end) - d(b.end) || score(b) - score(a)).slice(0, 2);
  const rest = pool.filter((it) => !first.includes(it)).sort((a, b) => score(b) - score(a));
  mount($("top"), first.concat(rest).slice(0, 4), true, "Nothing urgent. Explore has everything Radar found.");
}
function kindMatch(it) {
  if (state.kind === "all") return true;
  return it.kind === state.kind || (state.kind === "concert" && MUSIC.includes(it.kind));
}
function regionMatch(it) {
  if (state.region === "all") return true;
  if (state.region === "near") return ["be", "de", "eu", "uk"].includes(it.region);
  return it.region === state.region || it.region === "all";
}
export function drawFeed() {
  const items = D.feed.items.filter((it) => visible(it) && !isWork(it) && (state.showHidden || !S.hidden[it.id]) && kindMatch(it) && regionMatch(it))
    .sort((a, b) => score(b) - score(a));
  const limit = state.all ? items.length : 12;
  mount($("feed"), items.slice(0, limit), false, "Nothing here yet. The daily update adds new finds every morning.");
  if (items.length > limit) {
    const m = document.createElement("button");
    m.className = "more"; m.type = "button"; m.textContent = "Show " + (items.length - limit) + " more";
    m.onclick = () => { state.all = true; drawFeed(); };
    $("feed").appendChild(m);
  }
  $("feedSub").textContent = (items.length === 1 ? "1 thing" : items.length + " things") + " for you, updated " + ago(D.feed.updated);
}
const deadline = (it) => (it.kind === "freelance" ? d(it.end) : null);
export function drawWork() {
  const items = D.feed.items.filter((it) => isWork(it) && visible(it) && (state.showHidden || !S.hidden[it.id]) && (state.work === "all" || it.kind === state.work))
    .sort((a, b) => {
      const x = deadline(a), y = deadline(b);
      if (x && y && +x !== +y) return x - y;
      if (x && !y) return -1;
      if (y && !x) return 1;
      return score(b) - score(a);
    });
  mount($("workFeed"), items, false, state.work === "freelance" ? "No freelance leads right now. The daily update checks every morning." : "Nothing here yet. The daily update adds new roles and calls every morning.");
  $("workSub").textContent = (items.length === 1 ? "1 opportunity" : items.length + " opportunities") + ", updated " + ago(D.feed.updated);
}
export function drawSavedItems() {
  mount($("savedList"), D.feed.items.filter((it) => S.saved[it.id] && !past(it)), false, "Nothing saved yet. Tap the star on anything you want to keep.");
}
export function mountBucketHits(el, wishId) {
  mount(el, D.feed.items.filter((it) => it.kind === "bucket" && it.bucket === wishId && !past(it) && !S.hidden[it.id]), false, "");
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
