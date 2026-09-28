// Saved tab: starred items, bucket list, what Radar has learned, teaching it (reactions,
// new interests), show hidden, plus the short reaction notice and the Saved tab dot.
import { $, html, put, isoDay } from "./util.js";
import { S, save } from "./store.js";
import { D } from "./data.js";
import { note } from "./notes.js";
import { openSheet, closeSheet, showTab } from "./ui.js";
import { drawSavedItems, mountBucketHits, state, drawFeed, drawWork } from "./feed.js";
import { past } from "./data.js";

// --- Bucket list ------------------------------------------------------------------------------
function drawBucket() {
  const wishes = (D.config.bucketlist || []).slice(), known = {};
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
    return html`<div class="bk"><h3>${b.title}</h3>${b.good_time ? html`<p class="bw">Good moment: ${b.good_time}</p>` : ""}
      ${n ? html`<p class="bs hot">${n === 1 ? "1 good chance right now" : n + " good chances right now"}</p><div class="bkhits" data-b="${b.id}"></div>` : html`<p class="bs">Watching. Radar flags it when the timing is right.</p>`}</div>`;
  })}${S.bucketSent.map((b) => html`<div class="bk"><h3>${b.title}</h3>${b.good_time ? html`<p class="bw">Good moment: ${b.good_time}</p>` : ""}<p class="bs">Sent. Radar starts watching after the next morning update.</p></div>`)}`);
  box.querySelectorAll(".bkhits").forEach((el) => mountBucketHits(el, el.dataset.b));
}

// --- Reactions waiting to teach Radar ------------------------------------------------------------
const pending = () => Object.keys(S.reactions).filter((k) => !S.reactions[k].sent);
let toastFor = -1, toastTimer = null;
function hideToast() { clearTimeout(toastTimer); toastTimer = null; $("fbBar").classList.remove("show"); }
function armToast() { clearTimeout(toastTimer); toastTimer = setTimeout(hideToast, 5000); }
export function paintTeach() {
  const n = pending().length, txt = n === 1 ? "1 reaction ready to teach Radar" : n + " reactions ready to teach Radar";
  $("fbText").textContent = txt;
  $("teachText").textContent = txt;
  $("teachBox").hidden = !n;
  const tab = document.querySelector('.tab[data-v="saved"]');
  let b = tab.querySelector(".badge");
  if (n && !b) { b = document.createElement("span"); b.className = "badge"; b.setAttribute("aria-hidden", "true"); tab.appendChild(b); }
  else if (!n && b) b.remove();
  tab.setAttribute("aria-label", n ? "Saved, " + txt : "Saved");
  if (toastFor < 0) { toastFor = n; return; }
  if (!n) hideToast();
  else if (n > toastFor) { $("fbBar").classList.add("show"); armToast(); }
  toastFor = n;
}
function sendReactions() {
  const p = pending();
  if (!p.length) return;
  const body = "Radar feedback, sent from the app.\n\n" + p.map((k) => {
    const r = S.reactions[k];
    return (r.v > 0 ? "+1" : "-1") + " | " + r.kind + " | " + r.title + " | because: " + r.why + " | id: " + k;
  }).join("\n") + "\n\nAnything to add about why? Write it here, e.g. 'more Ando, less street photography':\n";
  note("Radar feedback " + isoDay(new Date()), body, "radar-feedback", "Sent. Tomorrow morning's update learns from it.");
  p.forEach((k) => { S.reactions[k].sent = true; });
  save("reactions");
  hideToast();
  paintTeach();
}

// --- Short forms in the sheet --------------------------------------------------------------------------
function compose({ title, intro, fields, submit, send }) {
  openSheet(() => html`<h2 class="sheet-title" id="sheetTitle">${title}</h2><p class="lede">${intro}</p>
    <form class="compose" novalidate>${fields.map((f) => html`<label><span>${f.label}</span>${f.long
      ? html`<textarea name="${f.name}" rows="3" placeholder="${f.placeholder}"${f.required ? " required" : ""}></textarea>`
      : html`<input name="${f.name}" type="text" autocomplete="off" placeholder="${f.placeholder}"${f.required ? " required" : ""}>`}</label>`)}
      <div class="sheet-acts"><button class="btn" type="submit">${submit}</button><button class="btn ghost" type="button" data-close>Cancel</button></div></form>
    <p class="fine tight">Radar files this as a note in the public Almanac repository, where Claude picks it up.</p>`,
  (el) => {
    const form = el.querySelector("form"), first = form.querySelector("input,textarea");
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

export function drawSaved() {
  drawSavedItems();
  drawBucket();
  const learned = D.taste.learned || [];
  put($("learned"), learned.length ? html`${learned.map((l) => html`<li>${l}</li>`)}` : html`<li>Nothing yet. Use thumbs up and down.</li>`);
  paintTeach();
}

export function initSaved() {
  $("fbClose").onclick = hideToast;
  const bar = $("fbBar");
  bar.addEventListener("pointerenter", () => clearTimeout(toastTimer));
  bar.addEventListener("pointerleave", () => { if (bar.classList.contains("show")) armToast(); });
  bar.addEventListener("focusin", () => clearTimeout(toastTimer));
  bar.addEventListener("focusout", () => { if (bar.classList.contains("show")) armToast(); });
  $("fbSend").onclick = sendReactions;
  $("fbSend2").onclick = sendReactions;
  $("addBtn").onclick = addInterest;
  $("bucketBtn").onclick = addWish;
  $("showHidden").onclick = () => {
    state.showHidden = !state.showHidden;
    $("showHidden").textContent = state.showHidden ? "Hide hidden items" : "Show hidden items";
    drawFeed(); drawWork();
    showTab("explore");
  };
}
