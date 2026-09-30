// Item detail sheet: full summary, why it fits, flags, dates, map link, Open details,
// Add to calendar (.ics made on the phone) and the reaction buttons.
import { html, d, pad, longDate, safeUrl, mapUrl } from "./util.js";
import { openSheet, paintSheet, sheetOpen } from "./ui.js";
import { metaLine, dueHTML, flagsHTML, reactButtons, placeOf, calable, act, deadline, workSub } from "./feed.js";
import { isWork } from "./data.js";

let current = null;

function body(it) {
  const s = d(it.start), e = d(it.end), rows = [], place = placeOf(it), url = safeUrl(it.url);
  const dl = isWork(it) ? deadline(it) : null;
  if (isWork(it) && workSub(it) !== "event") { if (s) rows.push(["Starts", longDate(s)]); if (dl) rows.push(["Apply by", longDate(dl), "due"]); }
  else if (s && e && +s !== +e) rows.push(["Dates", longDate(s) + " to " + longDate(e)]);
  else if (s) rows.push(["Date", longDate(s)]);
  else if (e) rows.push(["Until", longDate(e)]);
  if (dl && workSub(it) === "event") rows.push(["Register by", longDate(dl), "due"]);
  if (it.org) rows.push(["Organiser", it.org]);
  if (it.format) rows.push(["Format", it.format]);
  if (it.cost) rows.push(["Cost", it.cost]);
  if (it.why) rows.push(["Why it fits", it.why]);
  if (it.found) rows.push(["Found", d(it.found).toLocaleDateString("en-GB", { day: "numeric", month: "long" })]);
  const hasMap = it.lat != null && it.lon != null && isFinite(it.lat) && isFinite(it.lon);
  const acts = [
    url && html`<a class="btn" href="${url}" target="_blank" rel="noopener">Open details</a>`,
    hasMap && html`<a class="btn ghost" href="${mapUrl(it.lat, it.lon)}" target="_blank" rel="noopener">Show on map</a>`,
    calable(it) && html`<button class="btn ghost" type="button" data-a="ics">${isWork(it) && deadline(it) && !(workSub(it) === "event" && it.start) ? "Add deadline to calendar" : "Add to calendar"}</button>`,
  ].filter(Boolean);
  return html`<div class="meta">${metaLine(it)}</div>
    <h2 class="sheet-title" id="sheetTitle">${it.title}</h2>
    ${place ? html`<div class="where">${place}</div>` : ""}${dueHTML(it)}
    ${it.summary ? html`<p class="full">${it.summary}</p>` : ""}${flagsHTML(it)}
    ${rows.length ? html`<dl class="facts">${rows.map((r) => html`<div><dt>${r[0]}</dt><dd${r[2] ? html` class="${r[2]}"` : ""}>${r[1]}</dd></div>`)}</dl>` : ""}
    ${acts.length ? html`<div class="sheet-acts">${acts}</div>` : ""}
    <div class="react">${reactButtons(it, true)}</div>`;
}

export function openItem(it) {
  if (!it) return;
  current = it;
  openSheet(() => body(current), (el) => {
    el.querySelectorAll(".ib").forEach((b) => { b.onclick = () => act(current, b.dataset.a); });
    const c = el.querySelector('[data-a="ics"]');
    if (c) c.onclick = () => ics(current);
  }, it.title);
}
// Called after a reaction so the open sheet shows the new state.
export function refreshItem() { if (sheetOpen() && current && document.querySelector("#sheetBody .react")) paintSheet(); }

export function ics(it) {
  const dead = isWork(it) && deadline(it) && !(workSub(it) === "event" && it.start) ? deadline(it) : null;
  const s = dead || d(it.start);
  let e = dead ? s : d(it.end) || s;
  if (e < s) e = s;
  const end = new Date(e); end.setDate(end.getDate() + 1);
  const f = (x) => x.getFullYear() + pad(x.getMonth() + 1) + pad(x.getDate());
  const t = (v) => String(v || "").replace(/\\/g, "\\\\").replace(/([,;])/g, "\\$1").replace(/\r?\n/g, "\\n");
  const one = (v) => String(v || "").replace(/[\r\n]+/g, " ");
  const now = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Radar//EN", "CALSCALE:GREGORIAN", "BEGIN:VEVENT",
    "UID:" + String(it.id).replace(/[^\w.-]/g, "") + "@radar", "DTSTAMP:" + now,
    "DTSTART;VALUE=DATE:" + f(s), "DTEND;VALUE=DATE:" + f(end), "SUMMARY:" + t((dead ? "Deadline: " : "") + it.title)];
  const loc = [it.place, it.city].filter(Boolean).join(", ");
  if (loc) lines.push("LOCATION:" + t(loc));
  const url = safeUrl(it.url);
  lines.push("DESCRIPTION:" + t((it.summary || "") + (url ? "\n\n" + url : "")));
  if (url) lines.push("URL:" + one(url));
  if (it.lat != null && isFinite(it.lat) && isFinite(it.lon)) lines.push("GEO:" + (+it.lat) + ";" + (+it.lon));
  lines.push("END:VEVENT", "END:VCALENDAR");
  const blob = new Blob([lines.join("\r\n") + "\r\n"], { type: "text/calendar" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = (String(it.id || "radar").replace(/[^\w.-]/g, "") || "radar") + ".ics";
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}
