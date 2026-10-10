// Second-hand finds: ads from Marktplaats (NL), 2dehands (BE) and Kleinanzeigen (DE), collected and
// filtered a few times a day by a Claude task into gear.json (encrypted), one list per wanted search in
// interests.wanted. Wingfoil gear shows on the Wind tab ("Gear for sale"); every other search shows
// under You › Wanted. The phone never contacts those sites; it only opens an ad when tapped.
// gear.json = {updated, note?, ads:[{id, search (wanted id; missing = "wingfoil"), site, country,
//   type, brand?, title, price (number, EUR), size?, location?, posted? (YYYY-MM-DD), found, url,
//   match (hit|maybe), note?, shipping?}]}
import { $, html, put, d, today, ago, safeUrl } from "./util.js";
import { get, set, KEYS } from "./store.js";
import { D } from "./data.js";
import { ask } from "./saved.js";

const SITES = { marktplaats: ["Marktplaats", "NL"], "2dehands": ["2dehands", "BE"], kleinanzeigen: ["Kleinanzeigen", "DE"] };
const TYPES = [["all", "All"], ["wing", "Wings"], ["board", "Boards"], ["foil", "Foils"], ["set", "Sets"]];
const WING = "wingfoil";
let type = "all";
let hidden = get(KEYS.gearHidden, {});

const searchOf = (a) => a.search || WING;
const ads = (search) => ((D.gear && D.gear.ads) || [])
  .filter((a) => a && a.id && a.title && safeUrl(a.url) && searchOf(a) === search && !hidden[a.id]);
function age(a) {
  const p = d(a.posted || a.found);
  if (!p) return "";
  const n = Math.round((today() - p) / 864e5);
  return n <= 0 ? "Today" : n === 1 ? "Yesterday" : n < 7 ? n + " days ago" : p.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
const isNew = (a) => { const f = d(a.found); return !!(f && (today() - f) / 864e5 <= 1); };
const euro = (n) => (typeof n === "number" && isFinite(n) ? "€" + Math.round(n) : "");
const sortAds = (list) => list.slice().sort((x, y) => (x.match === "hit" ? 0 : 1) - (y.match === "hit" ? 0 : 1) ||
  String(y.found || "").localeCompare(String(x.found || "")) || (x.price || 0) - (y.price || 0));

function rowHTML(a, maybeLabel) {
  const s = SITES[a.site] || [a.site || "", (a.country || "").toUpperCase()];
  return html`<article class="ad" data-id="${a.id}">
    <a class="ad-main" href="${safeUrl(a.url)}" target="_blank" rel="noopener">
      <span class="ad-top"><span class="ad-site">${s[1]} · ${s[0]}</span>${a.match === "hit" ? html`<span class="state now">Match</span>` : html`<span class="state">${maybeLabel}</span>`}${isNew(a) ? html`<span class="state new">New</span>` : ""}</span>
      <b>${a.title}</b>
      <small>${[a.size, a.location, a.shipping ? "ships" : "", age(a)].filter(Boolean).join(" · ")}</small>
      ${a.note ? html`<small class="ad-note">${a.note}</small>` : ""}
    </a>
    <span class="ad-price">${euro(a.price)}</span>
    <button class="ib hide" type="button" data-hide="${a.id}" aria-label="Hide this ad"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
  </article>`;
}
function wireHide(box) {
  box.querySelectorAll("[data-hide]").forEach((b) => {
    b.onclick = () => { hidden[b.dataset.hide] = Date.now(); set(KEYS.gearHidden, hidden); drawGear(); };
  });
}

// --- Wind tab: wingfoil gear ------------------------------------------------------------------------
function drawWing() {
  const box = $("gear");
  if (!box) return;
  const all = ads(WING);
  const list = sortAds(all.filter((a) => type === "all" || a.type === type));
  const u = D.gear && D.gear.updated;
  $("gearSub").textContent = u
    ? all.length + (all.length === 1 ? " ad" : " ads") + " that fit your sizes and budget, checked " + ago(u) + ". Tap one to open it."
    : "No scan yet. A Claude task checks Marktplaats, 2dehands and Kleinanzeigen a few times a day.";
  put(box, list.length ? html`${list.map((a) => rowHTML(a, "Check size"))}` : html`<p class="empty">${u ? "Nothing matches right now." : "The first scan fills this in."}</p>`);
  wireHide(box);
  const tab = document.querySelector('.tab[data-v="wind"]');
  const fresh = all.filter((a) => a.match === "hit" && isNew(a)).length;
  if (tab) tab.setAttribute("aria-label", fresh ? "Wind, " + fresh + " new gear matches" : "Wind");
}

// --- You tab: everything else on the wanted list ------------------------------------------------------
function drawWanted() {
  const box = $("wanted");
  if (!box) return;
  const wanted = ((D.config && D.config.wanted) || []).filter((w) => w && w.id && w.id !== WING && w.title);
  $("wantedHead").hidden = box.hidden = !wanted.length;
  if (!wanted.length) return;
  const u = D.gear && D.gear.updated;
  put(box, html`${wanted.map((w) => {
    const list = sortAds(ads(w.id)), hits = list.filter((a) => a.match === "hit").length;
    return html`<section class="want" data-w="${w.id}">
      <h3>${w.title}</h3>
      <p class="want-sub">${w.short || ""}${w.short ? " " : ""}${u ? (list.length ? list.length + (list.length === 1 ? " ad" : " ads") + (hits ? ", " + hits + " clear " + (hits === 1 ? "match" : "matches") : "") + ", checked " + ago(u) + "." : "Nothing right now, checked " + ago(u) + ".") : "The first scan fills this in."}</p>
      ${list.length ? html`<div class="want-list">${list.map((a) => rowHTML(a, "Check fit"))}</div>` : ""}
    </section>`;
  })}`);
  wireHide(box);
}

export function drawGear() { drawWing(); drawWanted(); }

export function initGear() {
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
