// Notes to Claude (new interest, bucket wish, feedback, "I'm in <city>"), filed as GitHub issues
// that the daily and hourly Claude tasks read.
// - On the Cloudflare site: POST /api/note (same origin, behind Cloudflare Access; the token lives
//   in Cloudflare, never on the phone). Body {title, body, label}.
// - On github.io / localhost: the GitHub Issues API with a token the owner pasted on this phone.
// Unsent notes wait in the outbox (radar-outbox) and retry when Radar is back online.
// Radar never opens GitHub in the browser.
import { $ } from "./util.js";
import { S, save } from "./store.js";
import { say } from "./ui.js";

const REPO_API = "https://api.github.com/repos/2vrg2vjks9-wq/Almanac";
const host = location.hostname;
export const SERVER = !/github\.io$/.test(host) && host !== "localhost" && host !== "127.0.0.1";

function postServer(n) {
  return fetch("/api/note", {
    method: "POST", credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: n.title, body: n.body, label: n.labels[0] }),
  }).then((r) => { if (!r.ok) throw new Error(r.status === 401 ? "signin" : "net"); return true; });
}
function postGitHub(n) {
  return fetch(REPO_API + "/issues", {
    method: "POST",
    headers: { Authorization: "Bearer " + S.ghKey, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
    body: JSON.stringify({ title: n.title, body: n.body, labels: n.labels }),
  }).then((r) => {
    if (r.status === 401) throw new Error("key");
    if (r.status === 403 || r.status === 404) throw new Error("perm");
    if (!r.ok) throw new Error("net");
    return true;
  });
}
const post = (n) => (SERVER ? postServer(n) : postGitHub(n));
const canSend = () => SERVER || !!S.ghKey;

function dropKey(msg) { S.ghKey = ""; save("ghKey"); say(msg); paintConn(); }
function handle(err) {
  const m = err && err.message;
  if (m === "key") dropKey("GitHub no longer accepts Radar's token (expired or revoked). Your note is kept; reconnect in Saved.");
  else if (m === "perm") dropKey("GitHub refused the note: the token needs access to Almanac with Issues set to read and write. Your note is kept.");
}

// Send what's waiting, oldest first. Stops at the first failure and keeps the rest.
let flushing = null;
export function flush() {
  if (flushing) return flushing;
  if (!canSend() || !S.outbox.length || !navigator.onLine) return Promise.resolve();
  flushing = (async () => {
    try {
      while (S.outbox.length) {
        await post(S.outbox[0]);
        S.outbox.shift(); save("outbox");
      }
    } catch (e) { handle(e); }
    finally { flushing = null; paintConn(); }
  })();
  return flushing;
}

// Returns "sent", "queued" (kept, retries when online) or "waiting" (needs Connect on github.io).
export async function note(title, body, label, doneText) {
  const n = { title: String(title).slice(0, 200), body, labels: [label] };
  if (!canSend()) {
    S.outbox.push(n); save("outbox"); paintConn();
    say("Saved on this phone. It sends once Radar is connected (Saved tab).");
    return "waiting";
  }
  if (!navigator.onLine || S.outbox.length) {
    S.outbox.push(n); save("outbox");
    if (navigator.onLine) await flush();
    if (!S.outbox.includes(n)) { if (doneText) say(doneText); return "sent"; }
    paintConn();
    say("Saved on this phone. It goes out when you're back online.");
    return "queued";
  }
  try {
    await post(n);
    if (doneText) say(doneText);
    return "sent";
  } catch (e) {
    S.outbox.push(n); save("outbox"); handle(e); paintConn();
    const m = e && e.message;
    if (m !== "key" && m !== "perm") say(m === "signin" ? "Saved on this phone. Open Radar in Safari to sign in again, then it sends." : "Saved on this phone. It goes out when Radar can reach the server.");
    return "queued";
  }
}

// --- "Send in the background" section in Saved (github.io only) -------------------------
export function paintConn() {
  const box = $("connBox");
  if (!box) return;
  const waiting = S.outbox.length;
  const w = $("outboxLine");
  if (w) { w.hidden = !waiting; w.textContent = waiting === 1 ? "1 note is waiting to send." : waiting + " notes are waiting to send."; }
  if (SERVER) { box.hidden = true; return; }
  box.hidden = false;
  $("connState").textContent = S.ghKey
    ? "Connected. Notes go straight to Claude."
    : "Not connected. Notes wait on this phone until you connect.";
  $("connOpen").hidden = !!S.ghKey;
  $("connOff").hidden = !S.ghKey;
  $("connForm").hidden = true;
  $("connBtns").hidden = false;
}
export function initNotes() {
  $("connOpen").onclick = () => { $("connForm").hidden = false; $("connBtns").hidden = true; $("connKey").focus(); };
  $("connCancel").onclick = paintConn;
  $("connOff").onclick = () => { S.ghKey = ""; save("ghKey"); paintConn(); say("Disconnected. The token is removed from this phone."); };
  $("connSave").onclick = async () => {
    const k = ($("connKey").value || "").trim();
    if (!k) return;
    $("connState").textContent = "Checking the token…";
    try {
      const r = await fetch(REPO_API, { headers: { Authorization: "Bearer " + k, Accept: "application/vnd.github+json" } });
      if (!r.ok) { $("connState").textContent = "That token can't reach the Almanac repository. Give it access to Almanac only, with Issues read and write."; return; }
      S.ghKey = k; save("ghKey"); $("connKey").value = "";
      paintConn(); say("Connected. Notes now send in the background.");
      flush();
    } catch (e) { $("connState").textContent = "Radar couldn't reach GitHub. Try again when you're online."; }
  };
  window.addEventListener("online", () => flush());
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") flush(); });
  paintConn();
  flush();
}
