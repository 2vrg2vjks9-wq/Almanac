// Second-hand finds: ads from Marktplaats (NL), 2dehands (BE) and Kleinanzeigen (DE), collected and
// filtered every morning by a Claude task into gear.json (encrypted), one list per wanted search in
// interests.wanted. Everything shows under You › Finds, wingfoil gear first. Each ad says how long it has
// been online and how its price compares with similar ads (same search and type), with "Good deal" at 20% under. The phone never contacts those sites; it only opens an ad when tapped.
// gear.json = {updated, note?, ads:[{id, search (wanted id; missing = "wingfoil"), site, country,
//   type, brand?, title, price (number, EUR), size?, location?, posted? (YYYY-MM-DD), found, url,
//   match (hit|maybe), note?, shipping?}]}
import { $, html, put, d, today, ago, safeUrl } from "./util.js";
import { get, set, KEYS, S, save } from "./store.js";
import { track } from "./notes.js";
import { D } from "./data.js";
import { swipeRow, undoable, openSheet, closeSheet, say } from "./ui.js";
import { ask } from "./saved.js";

const SITES = { marktplaats: ["Marktplaats", "NL"], "2dehands": ["2dehands", "BE"], kleinanzeigen: ["Kleinanzeigen", "DE"] };
const TYPES = [["all", "All"], ["wing", "Wings"], ["board", "Boards"], ["foil", "Foils"], ["set", "Sets"]];
const WING = "wingfoil";
let type = "all";
let hidden = get(KEYS.gearHidden, {});
// Ratings of shown ads (👍 / 👎 with reasons), kept per phone in radar-ad-votes and sent in radar-track as
// `adFeedback`; task.py apply keeps the latest 40 per search in interests.adFeedback, which the finds task learns from.
const VOTES_KEY = "radar-ad-votes";
let votes = get(VOTES_KEY, {});
const WHY_NOT = [["price", "Too expensive"], ["far", "Too far away"], ["size", "Wrong size"], ["model", "Wrong model or type"], ["condition", "Condition"], ["seller", "Seller or ad looks off"]];
const WHY_YES = [["price", "Good price"], ["model", "Right model"], ["near", "Close by"], ["condition", "Good condition"]];
const UP = html`<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M7 11v9H4v-9zM7 11l4-7c1.5 0 2.5 1 2 3l-1 3h6a2 2 0 0 1 2 2.3l-1.2 6A2 2 0 0 1 16.8 20H7"/></svg>`;
const DOWN = html`<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M7 13V4H4v9zM7 13l4 7c1.5 0 2.5-1 2-3l-1-3h6a2 2 0 0 0 2-2.3l-1.2-6A2 2 0 0 0 16.8 4H7"/></svg>`;
function sendVote(a, v, reasons) {
  votes[a.id] = { v, r: reasons, at: Date.now() }; set(VOTES_KEY, votes);
  track({ adFeedback: [{ search: a.search || "wingfoil", id: a.id, t: String(a.title || "").slice(0, 120), p: a.price, site: a.site, v, r: reasons }] });
}
function rate(a, v) {
  const mine = votes[a.id];
  if (mine && mine.v === v && v === "up") { // tap 👍 again: take it back
    delete votes[a.id]; set(VOTES_KEY, votes);
    track({ adFeedback: [{ search: a.search || "wingfoil", id: a.id, t: String(a.title || "").slice(0, 120), v: "clear" }] });
    drawGear(); return;
  }
  const list = v === "up" ? WHY_YES : WHY_NOT, picked = new Set();
  openSheet(() => html`<h2 class="sheet-title" id="sheetTitle">${v === "up" ? "What's good about it?" : "Why not this one?"}</h2>
    <p class="lede">${a.title}</p>
    <div class="chips rate-why">${list.map(([k, t]) => html`<button class="pill" type="button" data-why="${k}" aria-pressed="false">${t}</button>`)}</div>
    <p class="fine">${v === "up" ? "The next scans look for more like this." : "The ad is hidden, and the next scans skip ads like it."} Pick any that apply, or none.</p>
    <div class="sheet-acts"><button class="btn" type="button" id="rateSend">${v === "up" ? "Good find" : "Not for me"}</button></div>`, (el) => {
    el.querySelectorAll("[data-why]").forEach((b) => { b.onclick = () => { const k = b.dataset.why; if (picked.has(k)) picked.delete(k); else picked.add(k); b.classList.toggle("on", picked.has(k)); b.setAttribute("aria-pressed", String(picked.has(k))); }; });
    el.querySelector("#rateSend").onclick = () => {
      closeSheet();
      sendVote(a, v, [...picked]);
      if (v === "down") { hidden[a.id] = Date.now(); set(KEYS.gearHidden, hidden); }
      drawGear();
      if (v === "down") undoable("Ad hidden. Radar learns from it.", () => {
        delete hidden[a.id]; set(KEYS.gearHidden, hidden); delete votes[a.id]; set(VOTES_KEY, votes);
        track({ adFeedback: [{ search: a.search || "wingfoil", id: a.id, t: String(a.title || "").slice(0, 120), v: "clear" }] }); drawGear();
      });
      else say("Thanks. The next scans look for more like this.");
    };
  }, v === "up" ? "Good find" : "Not for me");
}

const searchOf = (a) => a.search || WING;
// Some ads come back from a scan with the marketplace's search page instead of the ad's own page (the page
// didn't show that ad's link). Those still open something useful: a search on that site for the ad's title, so
// the ad is at or near the top. The finds task re-finds the real link on its next run.
const AD_PATH = { marktplaats: /^\/(v|a)\//, "2dehands": /^\/(v|a)\//, kleinanzeigen: /^\/s-anzeige\// };
function adLink(a) {
  const u = safeUrl(a.url), re = AD_PATH[a.site];
  if (!u || !re) return { href: u, direct: true };
  let path = "";
  try { path = new URL(u).pathname; } catch (e) { return { href: u, direct: true }; }
  if (re.test(path)) return { href: u, direct: true };
  const words = String(a.title || "").replace(/\([^)]*\)/g, " ").replace(/[^\p{L}\p{N}.,'-]+/gu, " ").trim().split(/\s+/).filter(Boolean).slice(0, 5);
  if (!words.length) return { href: u, direct: false };
  const q = encodeURIComponent(words.join(" ").toLowerCase());
  const href = a.site === "kleinanzeigen" ? "https://www.kleinanzeigen.de/s-" + q.replace(/%20/g, "-") + "/k0"
    : "https://www." + (a.site === "2dehands" ? "2dehands.be" : "marktplaats.nl") + "/q/" + q.replace(/%20/g, "+") + "/";
  return { href: safeUrl(href) || u, direct: false };
}
// The scan's own note about a missing link is replaced by the app's line below.
const cleanNote = (n) => String(n || "").replace(/\s*Ad link not shown[^.]*\.(\s*(Find|find) it with this search page\.)?/g, "").replace(/^\s*[.;:]\s*/, "").trim();
const ads = (search) => ((D.gear && D.gear.ads) || [])
  .filter((a) => a && a.id && a.title && safeUrl(a.url) && searchOf(a) === search && !hidden[a.id]);
function age(a) {
  const p = d(a.posted || a.found);
  if (!p) return "";
  const n = Math.round((today() - p) / 864e5);
  return n <= 0 ? "Today" : n === 1 ? "Yesterday" : n < 7 ? n + " days ago" : p.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
const isNew = (a) => { const f = d(a.found); return !!(f && (today() - f) / 864e5 <= 1); };
// How long an ad has been for sale (from `posted`): long-listed ads often leave room to negotiate.
function online(a) {
  const p = d(a.posted);
  if (!p) return "";
  const n = Math.round((today() - p) / 864e5);
  return n <= 1 ? "" : n < 14 ? "online " + n + " days" : n < 60 ? "online " + Math.round(n / 7) + " weeks" : "online " + Math.round(n / 30) + " months";
}
// Price against similar ads: the same search and type, at least three with a price.
function median(xs) { const v = xs.slice().sort((a, b) => a - b), m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; }
const priced = (a) => typeof a.price === "number" && isFinite(a.price) && a.price > 0;
function deal(a, pool) {
  if (!priced(a)) return null;
  const same = pool.filter((x) => x !== a && priced(x) && (x.type || "") === (a.type || ""));
  if (same.length < 2) return null;
  const m = median(same.concat([a]).map((x) => x.price)), r = a.price / m;
  if (r <= 0.8) return { good: true, text: Math.round((1 - r) * 100) + "% below similar ads (€" + Math.round(m) + ")" };
  if (r >= 1.25) return { good: false, text: Math.round((r - 1) * 100) + "% above similar ads (€" + Math.round(m) + ")" };
  return null;
}
const euro = (n) => (typeof n === "number" && isFinite(n) ? "€" + Math.round(n) : "");
const sortAds = (list) => list.slice().sort((x, y) => (dropped(y) ? 1 : 0) - (dropped(x) ? 1 : 0) || (S.watch[y.id] ? 1 : 0) - (S.watch[x.id] ? 1 : 0) ||
  (x.match === "hit" ? 0 : 1) - (y.match === "hit" ? 0 : 1) ||
  ((deal(y, list) || {}).good ? 1 : 0) - ((deal(x, list) || {}).good ? 1 : 0) ||
  String(y.found || "").localeCompare(String(x.found || "")) || (x.price || 0) - (y.price || 0));

// Price-drop watch: the eye button keeps an ad on Radar's list (radar-watch, sent sealed); the finds task re-opens
// watched ads every morning, keeps the old price in `was` when it drops, and pushes a notification.
const dropped = (a) => typeof a.was === "number" && typeof a.price === "number" && a.price < a.was;
function toggleWatch(a) {
  if (S.watch[a.id]) delete S.watch[a.id];
  else S.watch[a.id] = { url: a.url, title: a.title, price: a.price, search: a.search || WING, t: Date.now() };
  save("watch");
  track({ watch: S.watch });
  drawGear();
}
const EYE = html`<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/></svg>`;
function rowHTML(a, maybeLabel, pool) {
  const dl = deal(a, pool || []), w = !!S.watch[a.id], link = adLink(a), note = cleanNote(a.note);
  // marketplaces have a fixed label; dismantlers (sloperijen) and parts networks bring their own name
  const s = a.seller ? [a.seller, (a.country || "").toUpperCase()] : SITES[a.site] || [a.site || "", (a.country || "").toUpperCase()];
  return html`<article class="ad" data-id="${a.id}">
    <a class="ad-main" href="${link.href}" target="_blank" rel="noopener" data-swipeok>
      <span class="ad-top"><span class="ad-site">${s[1]} · ${s[0]}</span>${a.match === "hit" ? html`<span class="state now">Match</span>` : html`<span class="state">${maybeLabel}</span>`}${isNew(a) ? html`<span class="state new">New</span>` : ""}${dl && dl.good ? html`<span class="state deal">Good deal</span>` : ""}${dropped(a) ? html`<span class="state deal">Price dropped</span>` : w ? html`<span class="state">Watching</span>` : ""}${a.gone ? html`<span class="state soon">Gone</span>` : ""}</span>
      <b>${a.title}</b>
      <small>${[a.size, a.location, a.shipping ? "ships" : "", a.warranty ? a.warranty + " warranty" : "", online(a) || age(a)].filter(Boolean).join(" · ")}</small>
      ${dl ? html`<small class="ad-deal${dl.good ? " good" : ""}">${dl.text}</small>` : ""}
      ${note ? html`<small class="ad-note">${note}</small>` : ""}
      ${link.direct ? "" : html`<small class="ad-nolink">Opens a ${s[0]} search for this ad; its own link comes with the next scan.</small>`}
    </a>
    <span class="ad-price">${dropped(a) ? html`<s>${euro(a.was)}</s> ` : ""}${euro(a.price)}</span>
    <button class="ib watch${w ? " on" : ""}" type="button" data-watch="${a.id}" aria-pressed="${String(w)}" aria-label="${w ? "Stop watching the price" : "Watch the price"}">${EYE}</button>
    <button class="ib hide" type="button" data-hide="${a.id}" aria-label="Hide this ad"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
    <div class="ad-rate"><button class="rate${(votes[a.id] || {}).v === "up" ? " on" : ""}" type="button" data-rate="up" data-ad="${a.id}" aria-pressed="${String((votes[a.id] || {}).v === "up")}">${UP}<span>${(votes[a.id] || {}).v === "up" ? "Good find" : "Good"}</span></button>
      <button class="rate" type="button" data-rate="down" data-ad="${a.id}">${DOWN}<span>Not this</span></button></div>
  </article>`;
}
function hideAd(id) {
  hidden[id] = Date.now(); set(KEYS.gearHidden, hidden); drawGear();
  undoable("Ad hidden.", () => { delete hidden[id]; set(KEYS.gearHidden, hidden); drawGear(); });
}
function wireHide(box) {
  box.querySelectorAll("[data-hide]").forEach((b) => { b.onclick = () => hideAd(b.dataset.hide); });
  box.querySelectorAll("[data-rate]").forEach((b) => { b.onclick = () => { const a = ((D.gear && D.gear.ads) || []).find((x) => x.id === b.dataset.ad); if (a) rate(a, b.dataset.rate); }; });
  box.querySelectorAll("[data-watch]").forEach((b) => { b.onclick = () => { const a = ((D.gear && D.gear.ads) || []).find((x) => x.id === b.dataset.watch); if (a) toggleWatch(a); }; });
  // swipe left hides, right opens the ad
  box.querySelectorAll(".ad").forEach((el) => {
    const a = el.querySelector(".ad-main");
    swipeRow(el, () => window.open(a.href, "_blank", "noopener"), () => hideAd(el.dataset.id), ["Open", "Hide"]);
  });
}

// --- You › Finds: wingfoil gear ------------------------------------------------------------------------
function drawWing() {
  const box = $("gear");
  if (!box) return;
  const all = ads(WING);
  const list = sortAds(all.filter((a) => type === "all" || a.type === type));
  const u = D.gear && D.gear.updated;
  $("gearSub").textContent = u
    ? all.length + (all.length === 1 ? " ad" : " ads") + " that fit your sizes and budget, checked " + ago(u) + "."
    : "No scan yet. A Claude task checks Marktplaats, 2dehands and Kleinanzeigen every morning.";
  put(box, list.length ? html`${list.map((a) => rowHTML(a, "Check size", all))}` : html`<p class="empty">${u ? "Nothing matches right now." : "The first scan fills this in."}</p>`);
  wireHide(box);
}

// For Today's brief: new matches and good deals across every search.
export function gearNews() {
  const all = ((D.gear && D.gear.ads) || []).filter((a) => a && a.id && safeUrl(a.url) && !hidden[a.id]);
  const fresh = all.filter((a) => a.match === "hit" && isNew(a)).length;
  const deals = all.filter((a) => isNew(a) && (deal(a, all.filter((x) => searchOf(x) === searchOf(a))) || {}).good).length;
  if (!fresh && !deals) return "";
  return [fresh ? (fresh === 1 ? "1 new match" : fresh + " new matches") : "", deals ? (deals === 1 ? "1 good deal" : deals + " good deals") : ""].filter(Boolean).join(", ");
}

// --- You › Finds: everything else on the wanted list ------------------------------------------------------
// --- Editing a search ----------------------------------------------------------------------------------------
// Edits wait on the phone (radar-wanted-edits) until the data shows them, and go sealed in a radar-track note;
// task.py apply changes interests.wanted, and the finds task writes new queries for a changed search.
function withEdit(w) {
  const e = S.wantedEdits[w.id];
  if (!e) return w;
  const done = !e.remove && ["title", "look_for", "fit", "budget", "where"].every((k) => !e[k] || e[k] === w[k]);
  if (done) { delete S.wantedEdits[w.id]; save("wantedEdits"); return w; }
  return Object.assign({}, w, ...["title", "look_for", "fit", "budget", "where"].filter((k) => e[k]).map((k) => ({ [k]: e[k] })), { edited: true, remove: !!e.remove });
}
const searches = () => ((D.config && D.config.wanted) || []).filter((w) => w && w.id && w.title).map(withEdit).filter((w) => !w.remove);
function saveSearch(w, ch) {
  S.wantedEdits[w.id] = Object.assign({}, ch, { t: Date.now() }); save("wantedEdits");
  track({ wanted: { [w.id]: ch } });
  drawGear();
}
function editSearch(id) {
  const w = searches().find((x) => x.id === id) || (id === WING ? { id: WING, title: "Wingfoil gear" } : null);
  if (!w) return;
  ask({
    title: "Edit search", intro: "Change what Radar looks for. The next morning scan uses it.",
    fields: [
      { name: "t", label: "What to look for", value: w.title, required: true },
      { name: "l", label: "A good find would be", value: w.look_for || w.short || "", long: true, placeholder: "Brand, size, condition…" },
      { name: "b", label: "Budget (optional)", value: w.budget ? String(w.budget) : "", placeholder: "Up to €400" },
      { name: "p", label: "Where (optional)", value: w.where ? String(w.where) : "", placeholder: "Within 100 km, or ships to NL" },
    ],
    submit: "Save search",
    extra: id === WING ? null : { label: "Remove this search", run: () => {
      const sec = document.querySelector('#wanted .want[data-w="' + CSS.escape(id) + '"]');
      if (sec) sec.hidden = true;
      undoable("Search removed.", () => { if (sec) sec.hidden = false; }, () => saveSearch(w, { remove: true }));
    } },
    send: (v) => saveSearch(w, { title: v.t, look_for: v.l, budget: v.b, where: v.p }),
  });
}

function drawWanted() {
  const box = $("wanted");
  if (!box) return;
  const wanted = searches().filter((w) => w.id !== WING);
  box.hidden = !wanted.length;
  if (!wanted.length) return;
  const u = D.gear && D.gear.updated;
  put(box, html`${wanted.map((w) => {
    const list = sortAds(ads(w.id)), hits = list.filter((a) => a.match === "hit").length;
    return html`<section class="want" data-w="${w.id}">
      <div class="bk-h"><h3>${w.title}</h3><button class="linkbtn bk-edit" type="button" data-edit="${w.id}">Edit</button></div>
      ${w.edited ? html`<p class="want-sub">Changed. The next morning scan uses it.</p>` : ""}
      <p class="want-sub">${w.short || ""}${w.short ? " " : ""}${u ? (list.length ? list.length + (list.length === 1 ? " ad" : " ads") + (hits ? ", " + hits + " clear " + (hits === 1 ? "match" : "matches") : "") + ", checked " + ago(u) + "." : "Nothing right now, checked " + ago(u) + ".") : "The first scan fills this in."}</p>
      ${list.length ? html`<div class="want-list">${list.map((a) => rowHTML(a, "Check fit", list))}</div>` : ""}
    </section>`;
  })}`);
  wireHide(box);
  box.querySelectorAll("[data-edit]").forEach((b) => { b.onclick = () => editSearch(b.dataset.edit); });
}

export function drawGear() { drawWing(); drawWanted(); }

export function initGear() {
  const we = $("wingEdit");
  if (we) we.onclick = () => editSearch(WING);
  const wb = $("wantBtn");
  if (wb) wb.onclick = () => ask({
    title: "Look for something second-hand", intro: "Say what you want and what would make it a good find. Radar adds it to the searches it runs a few times a day.",
    fields: [{ name: "t", label: "What to look for", placeholder: "Leather seats for my car, a road bike frame 56 cm…", required: true },
      { name: "g", label: "A good find would be (optional)", placeholder: "Both front seats, under €400, within 100 km", long: true }],
    submit: "Start looking", label: "radar-interest",
    note: (v) => ["Wanted: " + v.t, "Please add a second-hand search to interests.wanted: " + v.t + "\n\nA good find would be: " + (v.g || "(work it out)")],
    done: "Radar starts looking with the next scan.",
  });
  const seg = $("gearTypes");
  if (!seg) return;
  const paint = () => {
    seg.textContent = "";
    TYPES.forEach(([k, label]) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "pill" + (type === k ? " on" : ""); b.textContent = label;
      b.setAttribute("aria-pressed", type === k);
      b.onclick = () => { type = k; paint(); drawGear(); };
      seg.appendChild(b);
    });
  };
  paint();
}
