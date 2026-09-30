// Gear for sale (Wind tab): second-hand wingfoil ads from Marktplaats (NL), 2dehands (BE) and
// Kleinanzeigen (DE), collected and filtered a few times a day by a Claude task into gear.json
// (encrypted). The phone never contacts those sites; it only opens an ad when tapped.
// gear.json = {updated, note?, ads:[{id, site, country, type (wing|board|foil|set), brand?, title,
//   price (number, EUR), size?, location?, posted? (YYYY-MM-DD), found, url, match (hit|maybe), note?, shipping?}]}
import { $, html, put, d, today, ago, safeUrl } from "./util.js";
import { get, set, KEYS } from "./store.js";
import { D } from "./data.js";

const SITES = { marktplaats: ["Marktplaats", "NL"], "2dehands": ["2dehands", "BE"], kleinanzeigen: ["Kleinanzeigen", "DE"] };
const TYPES = [["all", "All"], ["wing", "Wings"], ["board", "Boards"], ["foil", "Foils"], ["set", "Sets"]];
let type = "all";
let hidden = get(KEYS.gearHidden, {});

const ads = () => ((D.gear && D.gear.ads) || []).filter((a) => a && a.id && a.title && safeUrl(a.url));
function age(a) {
  const p = d(a.posted || a.found);
  if (!p) return "";
  const n = Math.round((today() - p) / 864e5);
  return n <= 0 ? "Today" : n === 1 ? "Yesterday" : n < 7 ? n + " days ago" : p.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
const isNew = (a) => { const f = d(a.found); return !!(f && (today() - f) / 864e5 <= 1); };
const euro = (n) => (typeof n === "number" && isFinite(n) ? "€" + Math.round(n) : "");

function rowHTML(a) {
  const s = SITES[a.site] || [a.site || "", (a.country || "").toUpperCase()];
  return html`<article class="ad" data-id="${a.id}">
    <a class="ad-main" href="${safeUrl(a.url)}" target="_blank" rel="noopener">
      <span class="ad-top"><span class="ad-site">${s[1]} · ${s[0]}</span>${a.match === "hit" ? html`<span class="state now">Match</span>` : html`<span class="state">Check size</span>`}${isNew(a) ? html`<span class="state new">New</span>` : ""}</span>
      <b>${a.title}</b>
      <small>${[a.size, a.location, a.shipping ? "ships" : "", age(a)].filter(Boolean).join(" · ")}</small>
      ${a.note ? html`<small class="ad-note">${a.note}</small>` : ""}
    </a>
    <span class="ad-price">${euro(a.price)}</span>
    <button class="ib hide" type="button" data-hide="${a.id}" aria-label="Hide this ad"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
  </article>`;
}

export function drawGear() {
  const box = $("gear");
  if (!box) return;
  const all = ads().filter((a) => !hidden[a.id]);
  const list = all.filter((a) => type === "all" || a.type === type)
    .sort((x, y) => (x.match === "hit" ? 0 : 1) - (y.match === "hit" ? 0 : 1) || String(y.found || "").localeCompare(String(x.found || "")) || (x.price || 0) - (y.price || 0));
  const u = D.gear && D.gear.updated;
  $("gearSub").textContent = u
    ? all.length + (all.length === 1 ? " ad" : " ads") + " that fit your sizes and budget, checked " + ago(u) + ". Tap one to open it."
    : "No scan yet. A Claude task checks Marktplaats, 2dehands and Kleinanzeigen a few times a day.";
  put(box, list.length ? html`${list.map(rowHTML)}` : html`<p class="empty">${u ? "Nothing matches right now." : "The first scan fills this in."}</p>`);
  box.querySelectorAll("[data-hide]").forEach((b) => {
    b.onclick = () => { hidden[b.dataset.hide] = Date.now(); set(KEYS.gearHidden, hidden); drawGear(); };
  });
  const tab = document.querySelector('.tab[data-v="wind"]');
  const fresh = all.filter((a) => a.match === "hit" && isNew(a)).length;
  if (tab) tab.setAttribute("aria-label", fresh ? "Wind, " + fresh + " new gear matches" : "Wind");
}

export function initGear() {
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
