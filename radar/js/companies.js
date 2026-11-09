// Work › Companies you track: follow a company (from a lead's details, or by name with "Track a company") and the work
// task checks its careers page for jobs and freelance work that fit. A bell per company sends a push when it has new
// roles. Kept like Following artists: interests.companies [{name, bell, careers?, added}] is the source, and changes made
// on this phone wait in radar-companies ({add: {name: {bell, url}}, remove: [names], bell: {name: bool}}) until the data
// shows them; they travel sealed in a radar-track note as `companies` and `task.py apply` merges them.
// Tap a company to show only its leads in All leads.
import { $, html, put, safeUrl } from "./util.js";
import { get, set } from "./store.js";
import { D, isWork, visible } from "./data.js";
import { say, swipeRow, undoable, closeSheet } from "./ui.js";
import { track } from "./notes.js";
import { state, drawWork, atCompany } from "./feed.js";
import { ask } from "./saved.js";

const KEY = "radar-companies";
const low = (s) => String(s || "").trim().toLowerCase();
const local = () => { const c = get(KEY, null) || {}; return { add: c.add || {}, remove: c.remove || [], bell: c.bell || {} }; };

export function companies() {
  const C = D.config || {}, L = local();
  const base = (Array.isArray(C.companies) ? C.companies : []).map((x) => (typeof x === "string" ? { name: x } : x)).filter((x) => x && x.name);
  // forget local changes once the data shows them
  Object.keys(L.add).forEach((n) => { if (base.some((b) => low(b.name) === low(n))) delete L.add[n]; });
  L.remove = L.remove.filter((n) => base.some((b) => low(b.name) === low(n)));
  Object.keys(L.bell).forEach((n) => { const b = base.find((x) => low(x.name) === low(n)); if (b && !!b.bell === L.bell[n]) delete L.bell[n]; });
  set(KEY, L);
  const rm = new Set(L.remove.map(low));
  const list = base.filter((b) => !rm.has(low(b.name))).map((b) => ({ name: b.name, bell: !!b.bell, careers: b.careers }))
    .concat(Object.keys(L.add).filter((n) => !base.some((b) => low(b.name) === low(n))).map((n) => ({ name: n, bell: !!L.add[n].bell, careers: L.add[n].url, pending: true })));
  list.forEach((c) => { const k = Object.keys(L.bell).find((n) => low(n) === low(c.name)); if (k) c.bell = L.bell[k]; });
  return list.sort((a, b) => a.name.localeCompare(b.name));
}
export const isTracked = (name) => !!name && companies().some((c) => low(c.name) === low(name));
const leads = () => D.feed.items.filter((it) => isWork(it) && visible(it));

export function follow(name, url) {
  name = String(name || "").trim().slice(0, 80);
  if (!name) return;
  const L = local(), u = safeUrl(url || "") || undefined;
  L.remove = L.remove.filter((n) => low(n) !== low(name));
  L.add[name] = { bell: true, url: u };
  set(KEY, L);
  track({ companies: { add: [{ name, bell: true, url: u }] } });
  say("Tracking " + name + ". The work search checks its jobs on Tuesdays and Fridays.");
  drawCompanies(); drawWork();
}
function unfollow(name) {
  const L = local(), was = JSON.parse(JSON.stringify(L));
  Object.keys(L.add).forEach((n) => { if (low(n) === low(name)) delete L.add[n]; });
  if (!L.remove.some((n) => low(n) === low(name))) L.remove.push(name);
  set(KEY, L);
  if (low(state.company) === low(name)) state.company = "";
  drawCompanies(); drawWork();
  undoable("Stopped tracking " + name + ".", () => { set(KEY, was); drawCompanies(); drawWork(); },
    () => track({ companies: { remove: [name] } }));
}
function setBell(c) {
  const L = local(), on = !c.bell;
  L.bell[c.name] = on;
  if (L.add[c.name]) L.add[c.name].bell = on;
  set(KEY, L);
  track({ companies: { bell: { [c.name]: on } } });
  say(on ? "Pushes on for new roles at " + c.name + "." : "Pushes off for " + c.name + ".");
  drawCompanies();
}
export function trackCompany() {
  ask({
    title: "Track a company", intro: "Radar's work search checks its careers page for jobs and freelance work that fit you, and pushes when there's something new.",
    fields: [{ name: "t", label: "Company", placeholder: "Company or organisation name", required: true },
      { name: "u", label: "Careers page (optional)", placeholder: "https://…" }],
    submit: "Track",
    send: (v) => follow(v.t, v.u),
  });
}

const BELL = (on) => html`<svg aria-hidden="true" viewBox="0 0 24 24" fill="${on ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0"/></svg>`;
export function initCompanies() {
  const b = $("workCompanyClear");
  if (b) b.onclick = () => { state.company = ""; drawCompanies(); drawWork(); };
  const t = $("trackCo");
  if (t) t.onclick = trackCompany;
}
export function drawCompanies() {
  const box = $("companies");
  if (!box || !D.feed) return;
  const list = companies(), all = leads();
  put(box, html`${list.length ? html`<ul class="follow companies">${list.map((c) => {
    const n = all.filter((it) => atCompany(it, c.name)).length, on = low(state.company) === low(c.name);
    return html`<li data-name="${c.name}"${on ? html` class="on"` : ""}><button class="cn" type="button" aria-pressed="${String(on)}" data-swipeok="1"><span class="fn">${c.name}${c.pending ? html`<small> · added</small>` : ""}</span>
      <small>${n ? (n === 1 ? "1 open lead" : n + " open leads") : c.pending ? "First check on the next work search" : "No open leads"}</small></button>
      <button class="ib bell${c.bell ? " on" : ""}" type="button" data-bell="1" aria-pressed="${String(c.bell)}" aria-label="Pushes for new roles at ${c.name}">${BELL(c.bell)}</button>
      <button class="ib hide" type="button" data-unf="1" aria-label="Stop tracking ${c.name}"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button></li>`;
  })}</ul>` : html`<p class="empty">No companies yet. Track one by name, or open a lead and tap Track with its company's name.</p>`}`);
  box.querySelectorAll(".companies li").forEach((li) => {
    const c = list.find((x) => x.name === li.dataset.name);
    li.querySelector(".cn").onclick = () => {
      state.company = low(state.company) === low(c.name) ? "" : c.name;
      drawCompanies(); drawWork();
      if (state.company) { const f = $("workFeed"); if (f) f.scrollIntoView({ behavior: "smooth", block: "start" }); }
    };
    li.querySelector("[data-bell]").onclick = () => setBell(c);
    li.querySelector("[data-unf]").onclick = () => unfollow(c.name);
    swipeRow(li, () => setBell(c), () => unfollow(c.name), [c.bell ? "Pushes off" : "Pushes on", "Stop tracking"]);
  });
}
// for the detail sheet: a "Track <org>" button on work leads
export function trackButton(it) {
  const org = String(it.company || it.org || "").trim();
  if (!isWork(it) || !org || org.length > 80) return "";
  return isTracked(org) ? html`<p class="fine tight">You track ${org}.</p>` : html`<button class="btn ghost" type="button" data-a="company">Track ${org}</button>`;
}
export function wireTrackButton(el, it) {
  const b = el.querySelector('[data-a="company"]');
  if (b) b.onclick = () => { closeSheet(); follow(String(it.company || it.org).trim()); };
}
