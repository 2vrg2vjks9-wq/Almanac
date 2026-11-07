// Saved tab: starred items, bucket list, what Radar has learned, teaching it (reactions,
// new interests), show hidden, plus the short reaction notice and the Saved tab dot.
import { $, html, put, isoDay } from "./util.js";
import { S, save } from "./store.js";
import { D, emit } from "./data.js";
import { note, track, SERVER, authFailed, signedOut } from "./notes.js";
import { signed } from "./vault.js";
import { openSheet, closeSheet, showTab, currentTab, showPane, say } from "./ui.js";
import { drawSavedItems, mountBucketHits, state, drawFeed, drawWork } from "./feed.js";
import { past } from "./data.js";
import { doPending, doLines, markDoSent } from "./do.js";

// --- Bucket list ------------------------------------------------------------------------------
// Edits wait on the phone (radar-bucket-edits) until the morning data shows them, so the list never jumps back.
function withEdits(b) {
  const e = S.bucketEdits[b.id];
  if (!e) return b;
  const same = ["title", "good_time", "where"].every((k) => !e[k] || e[k] === b[k]);
  if (same && !e.remove) { delete S.bucketEdits[b.id]; save("bucketEdits"); return b; }
  return Object.assign({}, b, e.title ? { title: e.title } : {}, e.good_time ? { good_time: e.good_time } : {}, e.where ? { where: e.where } : {}, { edited: true, remove: !!e.remove });
}
function editWish(b) {
  compose({
    title: "Edit wish", intro: "Change the wish or what would make it a good moment. Radar uses it from the next morning check.",
    fields: [
      { name: "t", label: "The wish", value: b.title, required: true },
      { name: "g", label: "A good moment would be", value: b.good_time || "", long: true, placeholder: "Close to a good wingfoil spot or in the mountains, under €…" },
      { name: "w", label: "Where to look (optional)", value: b.where || "", placeholder: "Italy, Spain, Portugal…" },
    ],
    submit: "Save changes",
    extra: { label: "Remove from bucket list", run: () => saveWish(b, { remove: true }) },
    send: (v) => saveWish(b, { title: v.t, good_time: v.g, where: v.w }),
  });
}
function saveWish(b, ch) {
  S.bucketEdits[b.id] = Object.assign({}, ch, { t: Date.now() });
  save("bucketEdits");
  track({ bucket: { [b.id]: ch } });
  drawBucket();
  say(ch.remove ? "Removed. Radar stops watching it." : "Saved. The next morning check uses it.");
}
function drawBucket() {
  const wishes = (D.config.bucketlist || []).map(withEdits).filter((b) => !b.remove), known = {};
  wishes.forEach((b) => { known[String(b.title).toLowerCase()] = 1; });
  S.bucketSent = S.bucketSent.filter((b) => !known[String(b.title).toLowerCase()]);
  save("bucketSent");
  const box = $("bucketList");
  if (!wishes.length && !S.bucketSent.length) {
    put(box, html`<p class="empty">Nothing on it yet. Add what you want to do once in your life, and what would make it a good moment.</p>`);
    return;
  }
  const hitsFor = (id) => D.feed.items.filter((it) => it.kind === "bucket" && it.bucket === id && !past(it) && !S.hidden[it.id]);
  put(box, html`${wishes.map((b) => {
    const n = hitsFor(b.id).length;
    return html`<div class="bk"><div class="bk-h"><h3>${b.title}</h3><button class="linkbtn bk-edit" type="button" data-e="${b.id}">Edit</button></div>${b.good_time ? html`<p class="bw">Good moment: ${b.good_time}</p>` : ""}${b.where ? html`<p class="bw">Where: ${b.where}</p>` : ""}${b.edited ? html`<p class="bs">Changed. Radar uses it from the next morning check.</p>` : ""}
      ${n ? html`<p class="bs hot">${n === 1 ? "1 good chance right now" : n + " good chances right now"}</p><div class="bkhits" data-b="${b.id}"></div>` : html`<p class="bs">Watching. Radar flags it when the timing is right.</p>`}</div>`;
  })}${S.bucketSent.map((b) => html`<div class="bk"><h3>${b.title}</h3>${b.good_time ? html`<p class="bw">Good moment: ${b.good_time}</p>` : ""}<p class="bs">Sent. Radar starts watching after the next morning update.</p></div>`)}`);
  box.querySelectorAll(".bkhits").forEach((el) => mountBucketHits(el, el.dataset.b));
  box.querySelectorAll("[data-e]").forEach((x) => { x.onclick = () => editWish(wishes.find((w) => String(w.id) === x.dataset.e)); });
}

// --- Reactions waiting to teach Radar ------------------------------------------------------------
const pendingReactions = () => Object.keys(S.reactions).filter((k) => !S.reactions[k].sent);
const pending = () => pendingReactions().concat(doPending());
// New thumbs and yes/no answers go to Radar by themselves a few seconds after the last one. The notice says so
// and offers Undo, which takes back everything in that batch (reactions, answers, hides) before it leaves.
const SEND_AFTER = 6000;
let toastFor = -1, sendTimer = null, batchHidden = null;
function hideToast() { $("fbBar").classList.remove("show"); }
function armSend() {
  clearTimeout(sendTimer);
  sendTimer = setTimeout(() => { sendTimer = null; batchHidden = null; sendReactions(true); }, SEND_AFTER);
}
function undoBatch() {
  clearTimeout(sendTimer); sendTimer = null;
  pendingReactions().forEach((k) => { delete S.reactions[k]; });
  doPending().forEach((k) => { delete S.do[k]; });
  if (batchHidden) Object.keys(S.hidden).forEach((k) => { if (!batchHidden.has(k)) delete S.hidden[k]; });
  batchHidden = null;
  save("reactions"); save("do"); save("hidden");
  hideToast();
  emit("change");
}
export function paintTeach() {
  const n = pending().length, txt = n === 1 ? "1 answer ready to teach Radar" : n + " answers ready to teach Radar";
  $("teachText").textContent = txt;
  $("teachBox").hidden = !n;
  const tab = document.querySelector('.tab[data-v="saved"]');
  let b = tab.querySelector(".badge");
  if (n && !b) { b = document.createElement("span"); b.className = "badge"; b.setAttribute("aria-hidden", "true"); tab.appendChild(b); }
  else if (!n && b) b.remove();
  tab.setAttribute("aria-label", n ? "You, " + txt : "You");
  if (toastFor < 0) { toastFor = n; return; }
  if (!n) { clearTimeout(sendTimer); sendTimer = null; batchHidden = null; hideToast(); }
  else if (n > toastFor) {
    if (!batchHidden) batchHidden = new Set(Object.keys(S.hidden));
    $("fbText").textContent = (n === 1 ? "1 answer" : n + " answers") + " going to Radar";
    $("fbBar").classList.add("show");
    armSend();
  }
  toastFor = n;
}
function sendReactions(auto) {
  const p = pendingReactions(), dl = doLines();
  if (!p.length && !dl.length) return;
  const lines = p.map((k) => {
    const r = S.reactions[k];
    return (r.v > 0 ? "+1" : "-1") + " | " + r.kind + " | " + r.title + " | because: " + r.why + " | id: " + k;
  });
  const body = "Radar feedback, sent from the app.\n\n" + lines.concat(dl).join("\n") +
    (dl.length ? "\n\nLines starting yes/no are answers in Do (things to do, Den Haag first)." : "");
  note("Radar feedback " + isoDay(new Date()), body, "radar-feedback", auto ? "" : "Sent. Tomorrow morning's update learns from it.");
  clearTimeout(sendTimer); sendTimer = null; batchHidden = null;
  p.forEach((k) => { S.reactions[k].sent = true; });
  save("reactions");
  markDoSent();
  hideToast();
  paintTeach();
}

// --- Short forms in the sheet --------------------------------------------------------------------------
function compose({ title, intro, fields, submit, send, extra }) {
  openSheet(() => html`<h2 class="sheet-title" id="sheetTitle">${title}</h2><p class="lede">${intro}</p>
    <form class="compose" novalidate>${fields.map((f) => html`<label><span>${f.label}</span>${f.long
      ? html`<textarea name="${f.name}" rows="3" placeholder="${f.placeholder || ""}"${f.required ? " required" : ""}>${f.value || ""}</textarea>`
      : html`<input name="${f.name}" type="text" autocomplete="off" placeholder="${f.placeholder || ""}" value="${f.value || ""}"${f.required ? " required" : ""}>`}</label>`)}
      <div class="sheet-acts"><button class="btn" type="submit">${submit}</button><button class="btn ghost" type="button" data-close>Cancel</button></div>
      ${extra ? html`<button class="linkbtn danger" type="button" data-extra>${extra.label}</button>` : ""}</form>
    <p class="fine tight">Radar seals this note so only Claude can read it, then files it in the Almanac repository.</p>`,
  (el) => {
    const form = el.querySelector("form"), first = form.querySelector("input,textarea");
    const x = el.querySelector("[data-extra]");
    if (x) x.onclick = () => { closeSheet(); extra.run(); };
    setTimeout(() => first && first.focus({ preventScroll: true }), 350);
    form.onsubmit = (e) => {
      e.preventDefault();
      const v = {};
      fields.forEach((f) => { v[f.name] = (form.elements[f.name].value || "").trim(); });
      const missing = fields.find((f) => f.required && !v[f.name]);
      if (missing) { form.elements[missing.name].focus(); form.elements[missing.name].setAttribute("aria-invalid", "true"); return; }
      closeSheet();
      send(v);
    };
  }, title);
}
// A short form that sends one note to Claude (used by Do's "Ask for more ideas").
export function ask(o) {
  compose({ title: o.title, intro: o.intro, fields: o.fields, submit: o.submit, send: o.send || ((v) => { const [t, b] = o.note(v); note(t, b, o.label, o.done); }) });
}
function addInterest() {
  compose({
    title: "Add an interest", intro: "Tell Radar what to keep an eye on. It starts looking the next morning.",
    fields: [{ name: "t", label: "What to watch", placeholder: "Concerts by an artist, a festival, new Noguchi shows…", required: true, long: true }],
    submit: "Send to Radar",
    send: (v) => note("Add interest: " + v.t, "Please add to Radar: " + v.t, "radar-interest", "Added. Radar starts looking for “" + v.t + "” tomorrow morning."),
  });
}
function addWish() {
  compose({
    title: "Add to bucket list", intro: "Something to do once in your life. Radar checks the timing every morning.",
    fields: [
      { name: "t", label: "The wish", placeholder: "See the northern lights", required: true },
      { name: "g", label: "A good moment would be (optional)", placeholder: "Flights under €150, clear dark skies…", long: true },
    ],
    submit: "Add wish",
    send: (v) => {
      S.bucketSent.push({ title: v.t, good_time: v.g, added: isoDay(new Date()) });
      save("bucketSent");
      drawBucket();
      note("Bucket list: " + v.t, "Add to my Radar bucket list: " + v.t + "\n\nA good moment would be: " + (v.g || "(work it out)"), "radar-bucket", "On your bucket list. Radar checks the timing every morning.");
    },
  });
}

// --- Following: artists (interests.artists) and which get concert alerts (interests.concertAlerts.artists) ---------
const nm = (x) => String(typeof x === "string" ? x : (x && (x.name || x.artist)) || "").trim();
function artists() {
  const C = D.config || {}, F = S.follow, low = (a) => a.map((x) => nm(x).toLowerCase());
  const base = (Array.isArray(C.artists) ? C.artists : []).map(nm).filter(Boolean);
  const alertsBase = low((C.concertAlerts && Array.isArray(C.concertAlerts.artists)) ? C.concertAlerts.artists : []);
  // forget local changes once the data shows them
  F.add = F.add.filter((n) => !base.some((b) => b.toLowerCase() === n.toLowerCase()));
  F.remove = F.remove.filter((n) => base.some((b) => b.toLowerCase() === n.toLowerCase()));
  Object.keys(F.alerts).forEach((n) => { if (alertsBase.includes(n.toLowerCase()) === F.alerts[n]) delete F.alerts[n]; });
  save("follow");
  const rm = new Set(F.remove.map((n) => n.toLowerCase()));
  const list = base.filter((n) => !rm.has(n.toLowerCase())).concat(F.add);
  const seen = new Set();
  return list.filter((n) => { const k = n.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
    .map((n) => ({ name: n, alert: n in F.alerts ? F.alerts[n] : alertsBase.includes(n.toLowerCase()) || F.add.includes(n), pending: F.add.includes(n) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
function followChange(patch, msg) {
  track({ artists: patch });
  drawFollow();
  if (msg) say(msg);
}
function drawFollow() {
  const box = $("follow");
  if (!box) return;
  const list = artists();
  const bell = (on) => html`<svg aria-hidden="true" viewBox="0 0 24 24" fill="${on ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0"/></svg>`;
  put(box, list.length ? html`<ul class="follow">${list.map((a) => html`<li><span class="fn">${a.name}${a.pending ? html`<small> · added</small>` : ""}</span>
      <button class="ib bell${a.alert ? " on" : ""}" type="button" data-bell="${a.name}" aria-pressed="${String(a.alert)}" aria-label="Concert alerts for ${a.name}">${bell(a.alert)}</button>
      <button class="ib hide" type="button" data-unf="${a.name}" aria-label="Stop following ${a.name}"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button></li>`)}</ul>`
    : html`<p class="empty">No artists yet. Follow one and Radar watches for their concerts and releases.</p>`);
  box.querySelectorAll("[data-bell]").forEach((b) => { b.onclick = () => {
    const n = b.dataset.bell, on = b.getAttribute("aria-pressed") !== "true";
    S.follow.alerts[n] = on; save("follow");
    followChange({ alerts: { [n]: on } }, on ? "Concert alerts on for " + n + "." : "Concert alerts off for " + n + ".");
  }; });
  box.querySelectorAll("[data-unf]").forEach((b) => { b.onclick = () => {
    const n = b.dataset.unf;
    S.follow.add = S.follow.add.filter((x) => x !== n);
    if (!S.follow.remove.includes(n)) S.follow.remove.push(n);
    save("follow");
    followChange({ remove: [n] }, "Stopped following " + n + ".");
  }; });
}
function followArtist() {
  compose({
    title: "Follow an artist", intro: "Radar watches for their concerts nearby and new releases, and alerts you when they announce a show.",
    fields: [{ name: "t", label: "Artist", placeholder: "Nils Frahm", required: true }],
    submit: "Follow",
    send: (v) => {
      S.follow.remove = S.follow.remove.filter((x) => x.toLowerCase() !== v.t.toLowerCase());
      if (!S.follow.add.includes(v.t)) S.follow.add.push(v.t);
      save("follow");
      followChange({ add: [v.t] }, "Following " + v.t + ". The next concert check looks for shows.");
    },
  });
}

// --- Brainstorm wishes: Claude suggests bucket-list wishes from your interests (/api/ideas, mode "bucket") ---------
function wishProfile() {
  const C = D.config || {}, T = D.taste || {};
  return { about: C.about, wind: C.wind && { spots: (C.wind.spots || []).map((x) => x.name), sports: Object.keys(C.wind.sports || {}) },
    culture: C.culture, museums: C.museums, artists: C.artists, meditation: C.meditation, travel: C.focus && C.focus.place,
    learned: T.learned, more: T.more };
}
async function brainstorm(about) {
  if (!SERVER || !navigator.onLine) return { why: navigator.onLine ? "setup" : "offline" };
  const have = (D.config.bucketlist || []).map((b) => b.title).concat(S.bucketSent.map((b) => b.title));
  try {
    const body = JSON.stringify({ mode: "bucket", ask: about || "", profile: wishProfile(), have });
    const r = await fetch("/api/ideas", { method: "POST", credentials: "same-origin", redirect: "manual",
      headers: Object.assign({ "Content-Type": "application/json" }, await signed("/api/ideas", body)), body });
    if (authFailed(r)) { signedOut(true); return { why: "signin" }; }
    if (r.status === 404 || r.status === 401 || r.status === 503) return { why: "setup" };
    const j = await r.json().catch(() => ({}));
    if (j.cost) track({ spend: j.cost });
    return Array.isArray(j.wishes) && j.wishes.length ? { wishes: j.wishes } : { why: "none" };
  } catch (e) { return { why: "fail" }; }
}
function brainSheet(state) {
  openSheet(() => html`<h2 class="sheet-title" id="sheetTitle">Brainstorm wishes</h2>
    ${state.loading ? html`<p class="lede">Claude is thinking up wishes that fit you…</p>`
      : state.wishes ? html`<p class="lede">Add the ones you like. Radar starts watching them for a good moment.</p>
        <div class="wishes">${state.wishes.map((w, i) => html`<div class="bk"><div class="bk-h"><h3>${w.title}</h3>
          <button class="btn${state.added[i] ? " ghost" : ""} wadd" type="button" data-i="${i}"${state.added[i] ? " disabled" : ""}>${state.added[i] ? "Added" : "Add"}</button></div>
          ${w.good_time ? html`<p class="bw">Good moment: ${w.good_time}</p>` : ""}${w.why ? html`<p class="bs">${w.where ? w.where + " · " : ""}${w.why}</p>` : ""}</div>`)}</div>
        <div class="sheet-acts"><button class="btn ghost" type="button" data-again>More ideas</button><button class="btn ghost" type="button" data-close>Done</button></div>`
      : html`<p class="lede">${state.msg}</p><div class="sheet-acts"><button class="btn ghost" type="button" data-close>Close</button></div>`}`,
  (el) => {
    el.querySelectorAll(".wadd").forEach((b) => { b.onclick = () => {
      const w = state.wishes[+b.dataset.i];
      state.added[+b.dataset.i] = true;
      S.bucketSent.push({ title: w.title, good_time: w.good_time, added: isoDay(new Date()) });
      save("bucketSent");
      note("Bucket list: " + w.title, "Add to my Radar bucket list: " + w.title + "\n\nA good moment would be: " + (w.good_time || "(work it out)") + (w.where ? "\nWhere: " + w.where : ""), "radar-bucket", "");
      drawBucket();
      brainSheet(state);
    }; });
    const again = el.querySelector("[data-again]");
    if (again) again.onclick = () => runBrainstorm(state.about);
  }, "Brainstorm wishes");
}
async function runBrainstorm(about) {
  const state = { loading: true, about, added: {} };
  brainSheet(state);
  const res = await brainstorm(about);
  state.loading = false;
  if (res.wishes) state.wishes = res.wishes;
  else state.msg = { setup: "Brainstorming needs Radar's server with the ANTHROPIC_API_KEY secret in Cloudflare.", offline: "You're offline.",
    signin: "Sign in again, then try once more.", none: "No ideas this time. Try again." }[res.why] || "Claude couldn't be reached. Try again in a moment.";
  brainSheet(state);
}

export function drawSaved() {
  drawFollow();
  drawSavedItems();
  drawBucket();
  const learned = D.taste.learned || [];
  put($("learned"), learned.length ? html`${learned.map((l) => html`<li>${l}</li>`)}` : html`<li>Nothing yet. Use thumbs up and down.</li>`);
  paintTeach();
}

export function initSaved() {
  $("fbClose").onclick = hideToast; // closes the notice; the answers still go
  $("fbUndo").onclick = undoBatch;
  $("fbSend2").onclick = () => sendReactions(false);
  $("addBtn").onclick = addInterest;
  $("bucketBtn").onclick = addWish;
  $("followBtn").onclick = followArtist;
  $("brainBtn").onclick = () => compose({
    title: "Brainstorm wishes", intro: "Claude suggests wishes that fit your interests. Give it a direction, or leave it empty for a mix.",
    fields: [{ name: "t", label: "Around (optional)", placeholder: "Wind trips, mountains, art pilgrimages, a house abroad…" }],
    submit: "Brainstorm", send: (v) => runBrainstorm(v.t),
  });
  $("showHidden").onclick = () => {
    state.showHidden = !state.showHidden;
    $("showHidden").textContent = state.showHidden ? "Hide hidden items" : "Show hidden items";
    drawFeed(); drawWork();
    showTab("discover"); showPane("read");
  };
}
