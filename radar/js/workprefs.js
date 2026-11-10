// Work › Your work search: a few multiple-choice preferences that steer the work search and the order of All leads.
// Nothing here is free text, so nothing personal is typed: only choices from fixed lists. They are kept on this phone in
// radar-settings (`work`) and sent sealed with the other settings (a radar-settings note); `task.py apply` keeps only
// known values in interests.settings.work, which the work task reads. Nothing is preset in the (public) code.
import { $, html, put } from "./util.js";
import { S, save } from "./store.js";
import { say } from "./ui.js";
import { track } from "./notes.js";
import { drawWork } from "./feed.js";

export const ORDER = {
  date: ["Nearest date", []],
  freelance: ["Freelance", ["freelance", "job", "call", "grant", "event"]],
  job: ["Jobs", ["job", "freelance", "call", "grant", "event"]],
  call: ["Calls and grants", ["call", "grant", "job", "freelance", "event"]],
  event: ["Events", ["event", "call", "grant", "job", "freelance"]],
};
const VOLUME = { "": "Search decides", few: "3–5 a week, strong", mix: "5–10 a week, mix", wide: "10+ a week, wide" };
const FREELANCE = { "": "Leave open", month: "Days a month", "1-2": "1–2 days a week", "3-5": "3–5 days a week" };
const FORMATS = [["remote", "Remote"], ["hybrid", "Hybrid in NL"], ["onsite", "On site in NL"], ["abroad", "Now and then abroad"]];
const ECO = {
  roles: [["mentor", "Mentor or expert in residence"], ["programme", "Programme lead"], ["jury", "Jury and selection"], ["coach", "Investor readiness"]],
  orgs: [["accelerators", "Accelerators"], ["funds", "Climate funds and VCs"], ["public", "Public and development funders"], ["corporate", "Corporate innovation"]],
  places: [["nl", "Netherlands"], ["eu", "Europe"], ["jpeu", "Japan and Europe"], ["online", "Online, anywhere"]],
  xb: [["entry", "Market-entry programmes"], ["agencies", "Trade and innovation agencies"], ["jpcorp", "Japanese companies in Europe"], ["tenders", "Tenders to run programmes"]],
};
const THEMES = [["regen-econ", "Regenerative economics"], ["regen-fin", "Regenerative finance"]];
const LEVELS = [["mid", "Mid-level"], ["senior", "Senior"], ["director", "Director, if the fit is strong"]];

export const prefs = () => {
  const p = Object.assign({ order: "date", volume: "", freelance: "", formats: [], levels: [], themes: [] }, (S.settings || {}).work || {});
  p.startups = Object.assign({ on: false, roles: [], orgs: [], places: [] }, p.startups || {});
  if (!Array.isArray(p.startups.xb)) p.startups.xb = p.startups.on ? ECO.xb.map((x) => x[0]) : []; // added later: on for those who switched on
  return p;
};
// group rank for sorting All leads and New leads (lower first); 0 for everything when the order is by date
export function groupRank(sub) {
  const o = (ORDER[prefs().order] || ORDER.date)[1];
  if (!o.length) return 0;
  const i = o.indexOf(sub);
  return i < 0 ? o.length : i;
}

function saveWork(patch) {
  const s = Object.assign({}, S.settings || {});
  s.work = Object.assign({}, prefs(), patch);
  S.settings = s; save("settings");
  track({ settings: { notify: s.notify || {}, tasks: s.tasks || {}, budget: s.budget || 5, work: s.work } });
  say("Saved. The order changes now; the work search uses it from its next run.");
  drawWorkPrefs(); drawWork();
}

const select = (id, label, map, val) => html`<label class="tg wp"><span><b>${label}</b></span>
  <select id="${id}">${Object.keys(map).map((k) => html`<option value="${k}"${k === val ? " selected" : ""}>${Array.isArray(map[k]) ? map[k][0] : map[k]}</option>`)}</select></label>`;
const chips = (id, label, list, on) => html`<div class="tg wp col"><span><b>${label}</b></span><div class="chips" id="${id}">${list.map(([k, t]) =>
  html`<button class="pill${on.includes(k) ? " on" : ""}" type="button" data-k="${k}" aria-pressed="${String(on.includes(k))}">${t}</button>`)}</div></div>`;

export function drawWorkPrefs() {
  const box = $("workPrefs");
  if (!box) return;
  const p = prefs();
  put(box, html`${select("wpOrder", "Show first", ORDER, p.order)}${select("wpVolume", "New leads", VOLUME, p.volume)}
    ${chips("wpFormats", "Ways of working", FORMATS, p.formats)}${chips("wpLevels", "Level", LEVELS, p.levels)}
    ${select("wpFree", "Time for freelance", FREELANCE, p.freelance)}
    ${chips("wpThemes", "Also look for", THEMES, p.themes)}
    <label class="tg"><span><b>Startup and accelerator work</b><small>Mentoring, programme roles, juries and investor-readiness work, labelled Startups</small></span>
      <input type="checkbox" role="switch" id="wpEco"${p.startups.on ? " checked" : ""}></label>
    ${p.startups.on ? html`${chips("wpEcoRoles", "Roles", ECO.roles, p.startups.roles)}${chips("wpEcoOrgs", "Organisations", ECO.orgs, p.startups.orgs)}${chips("wpEcoPlaces", "Where", ECO.places, p.startups.places)}${chips("wpEcoXb", "Cross-border programmes", ECO.xb, p.startups.xb)}` : ""}`);
  $("wpOrder").onchange = (e) => saveWork({ order: e.target.value });
  $("wpVolume").onchange = (e) => saveWork({ volume: e.target.value });
  $("wpFree").onchange = (e) => saveWork({ freelance: e.target.value });
  // switching it on picks every role, organisation and place; tap a chip to leave one out
  $("wpEco").onchange = (e) => saveWork({ startups: e.target.checked
    ? { on: true, roles: ECO.roles.map((x) => x[0]), orgs: ECO.orgs.map((x) => x[0]), places: ECO.places.map((x) => x[0]), xb: ECO.xb.map((x) => x[0]) }
    : Object.assign({}, prefs().startups, { on: false }) });
  [["wpEcoRoles", "roles"], ["wpEcoOrgs", "orgs"], ["wpEcoPlaces", "places"], ["wpEcoXb", "xb"]].forEach(([id, key]) => {
    const box = $(id);
    if (!box) return;
    box.querySelectorAll(".pill").forEach((b) => {
      b.onclick = () => { const st = prefs().startups, cur = st[key].slice(), k = b.dataset.k, i = cur.indexOf(k);
        if (i < 0) cur.push(k); else cur.splice(i, 1); saveWork({ startups: Object.assign({}, st, { [key]: cur }) }); };
    });
  });
  [["wpFormats", "formats"], ["wpLevels", "levels"], ["wpThemes", "themes"]].forEach(([id, key]) => {
    $(id).querySelectorAll(".pill").forEach((b) => {
      b.onclick = () => { const cur = prefs()[key].slice(), k = b.dataset.k, i = cur.indexOf(k); if (i < 0) cur.push(k); else cur.splice(i, 1); saveWork({ [key]: cur }); };
    });
  });
}
