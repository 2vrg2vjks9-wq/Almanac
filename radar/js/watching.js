// What Radar watches for you (the `watch` task, Mon, Tue, Thu and Sat: the 2 monitors checked longest ago, so each
// about twice a week). interests.watching.<monitor> = {checked, summary, items: [{id, title, summary, url, date,
// important, found}]}. You › Watching shows holiday-home rules and prices, houses for sale and new-build launches;
// Work › Policy and funding shows the climate-finance policy monitor. The houses monitor follows choices made here
// (areas, price band, rooms, outdoor space, type: fixed lists only, nothing typed), kept in radar-settings `house` and
// sent sealed with the settings note. Rows swipe: right opens, left hides on this phone (radar-watch-hidden), with Undo.
import { $, html, put, ago, safeUrl } from "./util.js";
import { S, save, get, set } from "./store.js";
import { D } from "./data.js";
import { swipeRow, undoable, say } from "./ui.js";
import { track } from "./notes.js";
import { settingsNote } from "./settings.js";

const MON = {
  holiday: ["Holiday-home rules and prices", "Holiday-rental rules and price trends in your holiday-home spots."],
  houses: ["Houses for sale", "New listings that match the choices below."],
  newbuild: ["New-build launches", "Sales starts, lotteries and registration deadlines in Zuid-Holland."],
  policy: ["Policy and funding", "Climate-finance and adaptation policy, and calls opening or closing soon."],
};
const AREAS = [["coast", "The Hague coast"], ["wassenaar", "Wassenaar to Noordwijk"], ["westland", "Westland and Hoek van Holland"], ["delft", "Delft and Rijswijk"], ["leiden", "Leiden and Voorschoten"]];
const PRICE = { "": "Any price", 500: "Up to €500k", 750: "€500k to €750k", 1000: "€750k to €1M", "1000+": "Above €1M" };
const ROOMS = { "": "Any", 3: "3 or more", 4: "4 or more", 5: "5 or more" };
const OUTDOOR = { any: "Any", garden: "Must have a garden" };
const TYPE = { any: "House or apartment", house: "Houses only" };
const HIDE = "radar-watch-hidden";

const house = () => Object.assign({ areas: [], price: "", rooms: null, outdoor: "any", type: "any" }, (S.settings || {}).house || {});
const mon = (k) => ((D.config && D.config.watching) || {})[k] || null;

function saveHouse(patch) {
  const s = Object.assign({}, S.settings || {});
  s.house = Object.assign(house(), patch);
  S.settings = s; save("settings");
  track({ settings: settingsNote(s) });
  say(s.house.areas.length ? "Saved. The houses check uses it from its next run." : "No areas picked, so Radar won't look for houses.");
  drawWatching();
}

function itemsHTML(k, m) {
  const hidden = get(HIDE, {});
  const items = ((m && m.items) || []).filter((x) => x && x.title && !hidden[x.id]);
  if (!items.length) return html`<p class="empty">${m && m.checked ? "Nothing to report right now." : "First check coming soon."}</p>`;
  return html`${items.map((x) => html`<article class="item watch-item" data-w="${k}" data-id="${x.id || x.title}">
    <div class="meta">${x.important ? html`<span class="flag">Important</span>` : ""}${x.date ? html`<span>${x.date}</span>` : ""}${x.found && (Date.now() - Date.parse(x.found)) / 864e5 < 4 ? html`<span class="state new">New</span>` : ""}</div>
    <h3>${safeUrl(x.url) ? html`<a class="open" href="${safeUrl(x.url)}" target="_blank" rel="noopener" data-swipeok>${x.title}</a>` : x.title}</h3>
    ${x.summary ? html`<p class="clip">${x.summary}</p>` : ""}
  </article>`)}`;
}

function block(k) {
  const m = mon(k), [title, sub] = MON[k];
  return html`<section class="want watch-box" id="watch-${k}">
    <div class="bk-h"><h3>${title}</h3></div>
    <p class="want-sub">${m && m.summary ? m.summary : sub}${m && m.checked ? html` <small>Checked ${ago(m.checked)}.</small>` : ""}</p>
    <div class="sheet">${itemsHTML(k, m)}</div>
    ${k === "houses" ? houseForm() : ""}
  </section>`;
}

const sel = (id, map, val) => html`<select id="${id}">${Object.keys(map).map((v) => html`<option value="${v}"${String(v) === String(val == null ? "" : val) ? " selected" : ""}>${map[v]}</option>`)}</select>`;
function houseForm() {
  const h = house();
  return html`<details class="nopts house-opts"${h.areas.length ? "" : " open"}><summary>What to look for</summary>
    <div class="nopt col"><span>Areas</span><div class="chips" id="houseAreas">${AREAS.map(([v, t]) => html`<button class="pill${h.areas.includes(v) ? " on" : ""}" type="button" data-area="${v}" aria-pressed="${String(h.areas.includes(v))}">${t}</button>`)}</div></div>
    <label class="nopt"><span>Price</span>${sel("housePrice", PRICE, h.price)}</label>
    <label class="nopt"><span>Rooms</span>${sel("houseRooms", ROOMS, h.rooms)}</label>
    <label class="nopt"><span>Outdoor space</span>${sel("houseOut", OUTDOOR, h.outdoor)}</label>
    <label class="nopt"><span>Type</span>${sel("houseType", TYPE, h.type)}</label>
    <p class="tg-note">Choices only. They travel encrypted and are never in Radar's public code.</p></details>`;
}

function wire(box) {
  box.querySelectorAll(".watch-item").forEach((el) => {
    const a = el.querySelector("a.open");
    swipeRow(el, () => { if (a) window.open(a.href, "_blank", "noopener"); }, () => {
      const h = get(HIDE, {}), id = el.dataset.id; h[id] = Date.now(); set(HIDE, h); drawWatching();
      undoable("Hidden.", () => { const h2 = get(HIDE, {}); delete h2[id]; set(HIDE, h2); drawWatching(); });
    }, ["Open", "Hide"]);
  });
  const areas = box.querySelector("#houseAreas");
  if (!areas) return;
  areas.querySelectorAll("[data-area]").forEach((b) => {
    b.onclick = () => { const cur = house().areas.slice(), i = cur.indexOf(b.dataset.area); if (i < 0) cur.push(b.dataset.area); else cur.splice(i, 1); saveHouse({ areas: cur }); };
  });
  $("housePrice").onchange = (e) => saveHouse({ price: e.target.value });
  $("houseRooms").onchange = (e) => saveHouse({ rooms: e.target.value ? +e.target.value : null });
  $("houseOut").onchange = (e) => saveHouse({ outdoor: e.target.value });
  $("houseType").onchange = (e) => saveHouse({ type: e.target.value });
}

export function drawWatching() {
  const you = $("watching"), work = $("workPolicy");
  if (you && D.config) {
    const open = you.querySelector(".house-opts") && you.querySelector(".house-opts").open;
    put(you, html`${block("holiday")}${block("houses")}${block("newbuild")}`);
    if (open && you.querySelector(".house-opts")) you.querySelector(".house-opts").open = true;
    wire(you);
  }
  if (work && D.config) {
    const m = mon("policy");
    put(work, html`<p class="sub tight">${m && m.summary ? m.summary : MON.policy[1]}${m && m.checked ? " Checked " + ago(m.checked) + "." : ""}</p><div class="sheet">${itemsHTML("policy", m)}</div>`);
    wire(work);
  }
}
