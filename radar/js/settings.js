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
const isOn = (group, k) => ((cur()[group] || {})[k]) !== false;

let status = null, statusAt = 0;
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
  track({ settings: { notify: s.notify || {}, tasks: s.tasks || {}, budget: s.budget || 5 } });
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
  put($("notifyBox"), html`${NOTIFY.map((n) => toggle("notify", n))}`);
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
