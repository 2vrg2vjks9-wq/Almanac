// Settings (You › gear icon): status, notifications, budget, sending notes, privacy, about.
// - Status reads the public radar/status.json (run times, outcomes and spend only) written by the tasks.
// - Notifications, the monthly budget and the task switches are kept on this phone (radar-settings) and sent
//   sealed (a radar-settings note); a script merges them into the encrypted interests without Claude.
import { $, html, put, ago, fetchT } from "./util.js";
import { S, save, set, KEYS } from "./store.js";
import { D } from "./data.js";
import { showTab, say } from "./ui.js";
import { track, outboxCount, outboxWhy } from "./notes.js";

const NOTIFY = [
  ["wind", "Morning wind alert", "When a spot has a rideable window in the next 3 days."],
  ["weekend", "Weekend planner", "Thursdays: weekend wind and the best things to do."],
  ["deadlines", "Deadline reminders", "3 days and 1 day before a lead you marked Interested."],
  ["work", "New work leads", "After the Tuesday and Friday work search."],
  ["concerts", "Concert alerts", "When an artist you follow announces a show nearby."],
  ["daily", "Morning update", "What the daily research added."],
  ["finds", "Second-hand finds", "When a clear match turns up."],
];
const TASKS = [
  ["work", "Work search", "Tuesdays and Fridays, about $0.10 a run."],
  ["finds", "Second-hand finds", "Every morning, about $0.05 a run."],
  ["concerts", "Concert check", "Sundays, about $0.06 a run."],
  ["bucket", "Bucket-list check", "4 times a week, 3 wishes a run, about $0.08 a run."],
];
const BUDGETS = [3, 5, 8, 10];
const TASK_NAMES = { daily: "Daily update", inbox: "Notes from the phone", finds: "Second-hand finds", concerts: "Concert check", work: "Work search", bucket: "Bucket-list check" };
const cur = () => S.settings || {};
// everything the settings note carries (task.py apply keeps only known values)
export const settingsNote = (s) => ({ notify: s.notify || {}, tasks: s.tasks || {}, budget: s.budget || 5, work: s.work, alerts: alerts(s) });
const LEVELS = { loud: "Loud", normal: "Normal", silent: "Silent" };
const REMIND = { "3-1": "3 and 1 days before", "7-2": "7 and 2 days before", "1": "The day before", "7-3-1": "7, 3 and 1 days before" };
const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0") + ":00");
function alerts(s) {
  const a = Object.assign({}, (s || cur()).alerts || {});
  a.quiet = Object.assign({ on: false, from: 22, to: 7 }, a.quiet || {});
  a.level = Object.assign({}, a.level || {});
  a.remind = a.remind || "3-1";
  a.wind = Object.assign({ sports: [], minHours: null, days: 3 }, a.wind || {});
  return a;
}
function setAlerts(patch, msg) {
  const s = Object.assign({}, cur());
  s.alerts = Object.assign(alerts(s), patch);
  S.settings = s; save("settings");
  track({ settings: settingsNote(s) });
  drawSettings();
  say(msg || "Saved. Radar uses it from the next notification.");
}
const isOn = (group, k) => ((cur()[group] || {})[k]) !== false;

let status = null, statusAt = 0;
const OPEN = new Set();
async function loadStatus() {
  if (status && Date.now() - statusAt < 60000) return status;
  try {
    const r = await fetch("status.json?v=" + Date.now(), { cache: "no-store" });
    if (r.ok) { status = await r.json(); statusAt = Date.now(); }
  } catch (e) { /* offline: keep the last one */ }
  return status;
}

function change(group, k, v) {
  const s = Object.assign({}, cur());
  if (group === "budget") s.budget = v;
  else s[group] = Object.assign({}, s[group] || {}, { [k]: v });
  S.settings = s; save("settings");
  track({ settings: settingsNote(s) });
  drawSettings();
  say("Saved. Radar uses it from the next run.");
}

function toggle(group, [k, label, sub]) {
  const on = isOn(group, k);
  return html`<label class="tg"><span><b>${label}</b><small>${sub}</small></span><input type="checkbox" role="switch" data-g="${group}" data-k="${k}"${on ? " checked" : ""}></label>`;
}

function drawStatus() {
  const box = $("status"), st = status;
  const waiting = outboxCount(), why = outboxWhy();
  if (!st) {
    put(box, html`<p class="empty">The status isn't available yet${navigator.onLine ? "" : " (offline)"}.</p>${waiting ? html`<p class="st-warn">${waiting} ${waiting === 1 ? "note is" : "notes are"} waiting to send. ${why}</p>` : ""}`);
    return;
  }
  const b = +(cur().budget || st.budget || 5), spent = +(st.spent || 0), pct = Math.min(100, Math.round(spent / b * 100));
  const tasks = Object.keys(TASK_NAMES).filter((k) => st.tasks && st.tasks[k]);
  const res = (r) => (r === "ok" ? "done" : r === "failed" ? "didn't finish" : String(r || "").startsWith("skipped") ? "skipped (budget)" : r || "");
  const bad = tasks.filter((k) => st.tasks[k].result === "failed");
  put(box, html`
    <div class="st-spend"><div class="st-row"><b>${st.mode === "subscription" ? "Your Claude subscription" : "$" + spent.toFixed(2) + " of $" + b + " this month"}</b><small>${st.mode === "subscription" ? "Nothing billed per use" : pct + "%"}</small></div>
      ${st.mode === "subscription" ? "" : html`<div class="bar" role="img" aria-label="${pct}% of the monthly budget used"><i style="width:${pct}%"></i></div>`}</div>
    <ul class="st-tasks">${tasks.map((k) => html`<li><span>${TASK_NAMES[k]}</span><small class="${st.tasks[k].result === "failed" ? "bad" : ""}">${res(st.tasks[k].result)} ${ago(st.tasks[k].at)}${st.tasks[k].cost ? ", $" + (+st.tasks[k].cost).toFixed(2) : ""}</small></li>`)}</ul>
    ${bad.length ? html`<p class="st-warn">${bad.map((k) => TASK_NAMES[k]).join(" and ")} didn't finish last time; Radar tries again on the next run.</p>` : ""}
    <p class="st-line">${waiting ? html`<span class="st-warn">${waiting} ${waiting === 1 ? "note is" : "notes are"} waiting to send. ${why}</span>` : "No notes waiting to send."}</p>
    <p class="st-line">${D.feed && D.feed.updated ? "Feed updated " + ago(D.feed.updated) : ""}${D.things && D.things.updated ? ", ideas " + ago(D.things.updated) : ""}${D.gear && D.gear.updated ? ", finds " + ago(D.gear.updated) : ""}.</p>`);
}

export function drawSettings() {
  if (!$("notifyBox")) return;
  const A = alerts(), W = (D.config && D.config.wind) || {}, sports = Object.keys(W.sports || {});
  const sel = (id, map, val) => html`<select id="${id}">${Object.keys(map).map((k) => html`<option value="${k}"${String(k) === String(val) ? " selected" : ""}>${map[k]}</option>`)}</select>`;
  const hours = Object.fromEntries(HOURS.map((h, i) => [i, h]));
  const extra = (k) => {
    if (k === "wind") {
      const on = A.wind.sports.length ? A.wind.sports : sports;
      return html`<div class="nopt col"><span>Sports</span><div class="chips">${sports.map((sp) => html`<button class="pill${on.includes(sp) ? " on" : ""}" type="button" data-sport="${sp}" aria-pressed="${String(on.includes(sp))}">${(W.sports[sp] || {}).label || sp}</button>`)}</div></div>
        <label class="nopt"><span>At least</span>${sel("optHours", { "": "As set (" + (W.minHours || 2) + " h)", 1: "1 hour", 2: "2 hours", 3: "3 hours", 4: "4 hours" }, A.wind.minHours || "")}</label>
        <label class="nopt"><span>Look ahead</span>${sel("optDays", { 1: "Today", 2: "2 days", 3: "3 days" }, A.wind.days || 3)}</label>`;
    }
    if (k === "deadlines") return html`<label class="nopt"><span>When</span>${sel("optRemind", REMIND, A.remind)}</label>`;
    return "";
  };
  put($("notifyBox"), html`<label class="tg"><span><b>Quiet hours</b><small>${A.quiet.on ? "Pushes in these hours wait until " + HOURS[A.quiet.to] : "Pushes can come at any time"}</small></span>
      <input type="checkbox" role="switch" id="quietOn"${A.quiet.on ? " checked" : ""}></label>
    ${A.quiet.on ? html`<div class="nopts quiet"><label class="nopt"><span>From</span>${sel("quietFrom", hours, A.quiet.from)}</label><label class="nopt"><span>Until</span>${sel("quietTo", hours, A.quiet.to)}</label></div>` : ""}
    ${NOTIFY.map((n) => html`${toggle("notify", n[0] === "wind" ? [n[0], n[1], "When a spot has a rideable window " + (A.wind.days === 1 ? "today." : "in the next " + (A.wind.days || 3) + " days.")]
      : n[0] === "deadlines" ? [n[0], n[1], REMIND[A.remind] + " the deadline of a lead you marked Interested."] : n)}${isOn("notify", n[0]) ? html`<details class="nopts" data-k="${n[0]}"><summary>Options</summary>
      <label class="nopt"><span>Importance</span>${sel("lvl-" + n[0], LEVELS, A.level[n[0]] || "normal")}</label>${extra(n[0])}</details>` : ""}`)}`);
  $("quietOn").onchange = (e) => setAlerts({ quiet: Object.assign({}, A.quiet, { on: e.target.checked }) });
  if ($("quietFrom")) $("quietFrom").onchange = (e) => setAlerts({ quiet: Object.assign({}, A.quiet, { from: +e.target.value }) });
  if ($("quietTo")) $("quietTo").onchange = (e) => setAlerts({ quiet: Object.assign({}, A.quiet, { to: +e.target.value }) });
  NOTIFY.forEach(([k]) => { const s = $("lvl-" + k); if (s) s.onchange = (e) => setAlerts({ level: Object.assign({}, A.level, { [k]: e.target.value }) }); });
  if ($("optRemind")) $("optRemind").onchange = (e) => setAlerts({ remind: e.target.value });
  if ($("optHours")) $("optHours").onchange = (e) => setAlerts({ wind: Object.assign({}, A.wind, { minHours: e.target.value ? +e.target.value : null }) });
  if ($("optDays")) $("optDays").onchange = (e) => setAlerts({ wind: Object.assign({}, A.wind, { days: +e.target.value }) });
  document.querySelectorAll("#notifyBox [data-sport]").forEach((b) => {
    b.onclick = () => {
      const cur2 = (A.wind.sports.length ? A.wind.sports : sports).slice(), i = cur2.indexOf(b.dataset.sport);
      if (i < 0) cur2.push(b.dataset.sport); else if (cur2.length > 1) cur2.splice(i, 1); else { say("Keep at least one sport."); return; }
      setAlerts({ wind: Object.assign({}, A.wind, { sports: cur2 }) });
    };
  });
  // keep an options panel open after a change redraws the list
  document.querySelectorAll("#notifyBox details.nopts").forEach((d) => {
    if (OPEN.has(d.dataset.k)) d.open = true;
    d.querySelector("summary").addEventListener("click", () => { if (d.open) OPEN.delete(d.dataset.k); else OPEN.add(d.dataset.k); });
  });
  const b = +(cur().budget || 5);
  put($("budgetBox"), html`<div class="tg"><span><b>Monthly limit</b><small>About €${Math.round(b * 0.92)}</small></span>
      <span class="seg small">${BUDGETS.map((x) => html`<button class="pill${x === b ? " on" : ""}" type="button" data-b="${x}" aria-pressed="${String(x === b)}">$${x}</button>`)}</span></div>
    ${TASKS.map((t) => toggle("tasks", t))}
    <p class="tg-note">The daily update and notes from the phone always run.</p>`);
  document.querySelectorAll("#v-settings input[data-g]").forEach((i) => { i.onchange = () => change(i.dataset.g, i.dataset.k, i.checked); });
  document.querySelectorAll("#budgetBox [data-b]").forEach((x) => { x.onclick = () => change("budget", null, +x.dataset.b); });
  drawStatus();
  paintAlert();
}

// The ntfy topic lives in the encrypted interests file (anyone who knows it can read the alerts).
function paintAlert() {
  const t = D.config && D.config.alerts && D.config.alerts.ntfy, el = $("alertLine");
  if (!el) return;
  if (!t) { el.hidden = true; return; }
  el.hidden = false;
  el.textContent = "";
  el.append("All alerts come through the free ntfy app: subscribe to ");
  const c = document.createElement("span"); c.className = "alert-topic"; c.textContent = t;
  el.append(c, ". Keep it to yourself: anyone with the topic can read the alerts.");
  const b = document.createElement("button");
  b.type = "button"; b.className = "btn ghost test-push"; b.id = "testPush"; b.textContent = "Send a test notification";
  b.onclick = () => testPush(t, b);
  el.append(document.createElement("br"), b);
}

// Settings › Send a test notification: the phone posts one short message to the topic (only on tap).
async function testPush(topic, b) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(topic)) { say("The alert topic looks wrong, so nothing was sent."); return; }
  b.disabled = true;
  try {
    const r = await fetchT("https://ntfy.sh/" + topic, { method: "POST", headers: { Title: "Radar test", Tags: "white_check_mark" },
      body: "Test from Radar: alerts reach this phone." }, 15000);
    say(r.ok ? "Sent. It should pop up within a few seconds; if not, check the ntfy app is subscribed to the topic above." : "ntfy didn't accept it (" + r.status + "). Try again in a minute.");
  } catch (e) { say("Couldn't reach ntfy. Check your connection and try again."); }
  b.disabled = false;
}

export function openSettings() {
  showTab("settings");
  drawSettings();
  loadStatus().then(drawStatus);
}

export function initSettings() {
  $("setBtn").onclick = openSettings;
  $("setBack").onclick = () => showTab("saved");
  $("replayBtn").onclick = () => { set(KEYS.welcomed, false); location.reload(); };
}
