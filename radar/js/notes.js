// Notes to Claude (new interest, bucket wish, feedback, "I'm in <city>"), filed as GitHub issues
// that the daily and hourly Claude tasks read. The repo is public, so a note leaves the phone
// sealed: the issue title is generic ("Radar note") and the body is encrypted with the vault key
// (radar-sealed:v1:…); only the Claude tasks, which hold the passphrase, can read it.
// - On the Cloudflare site: POST /api/note (same origin, signed with the vault's proof key, see signed()
//   in vault.js; the GitHub token lives in Cloudflare, never on the phone). Body {title, body, label}.
// - On github.io / localhost: the GitHub Issues API with a token the owner pasted on this phone.
// Unsent notes wait in the outbox (radar-outbox) and retry when Radar is back online.
// Radar never opens GitHub in the browser.
import { $ } from "./util.js";
import { S, save } from "./store.js";
import { say } from "./ui.js";
import { sealNote, unlocked, signed } from "./vault.js";

const REPO_API = "https://api.github.com/repos/2vrg2vjks9-wq/Almanac";
const host = location.hostname;
export const SERVER = !/github\.io$/.test(host) && host !== "localhost" && host !== "127.0.0.1";

// While Cloudflare Access is still in front of the site, an expired sign-in turns the site's own requests into redirects to the
// login page: Radar can't update, send notes or research. Show the "Sign in" bar (index.html #signin).
// (Radar's own functions answer 401 with JSON when the owner check fails; that's a setup problem, not a sign-in.)
export const authFailed = (r) => SERVER && (r.type === "opaqueredirect" ||
  ((r.status === 401 || r.status === 403) && !/json/.test(r.headers.get("content-type") || "")));
export function signedOut(yes) {
  const b = $("signin");
  if (!b) return;
  b.hidden = !yes;
  $("signinBtn").onclick = () => { location.href = location.pathname + "?signin=" + Date.now(); };
}

// What GitHub gets: a generic title and the sealed text (title + body).
async function sealed(n) {
  if (!unlocked()) throw new Error("locked");
  return { title: "Radar note", body: await sealNote("Title: " + n.title + "\n\n" + n.body) };
}
async function postServer(n) {
  const x = await sealed(n);
  const body = JSON.stringify({ title: x.title, body: x.body, label: n.labels[0] });
  return fetch("/api/note", {
    method: "POST", credentials: "same-origin", redirect: "manual",
    headers: Object.assign({ "Content-Type": "application/json" }, await signed("/api/note", body)),
    body,
  }).then((r) => {
    if (authFailed(r)) { signedOut(true); throw new Error("signin"); }
    if (r.status === 503) throw new Error("setup");
    if (r.status === 401) throw new Error("refused");
    if (r.status === 400 || r.status === 413) throw new Error("bad");
    if (r.status === 502) throw new Error("github");
    if (!r.ok) throw new Error("net");
    return true;
  });
}
async function postGitHub(n) {
  const x = await sealed(n);
  return fetch(REPO_API + "/issues", {
    method: "POST",
    headers: { Authorization: "Bearer " + S.ghKey, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
    body: JSON.stringify({ title: x.title, body: x.body, labels: n.labels }),
  }).then((r) => {
    if (r.status === 401) throw new Error("key");
    if (r.status === 403 || r.status === 404) throw new Error("perm");
    if (r.status === 422) throw new Error("bad");
    if (!r.ok) throw new Error("net");
    return true;
  });
}
const post = (n) => (SERVER ? postServer(n) : postGitHub(n));
const canSend = () => unlocked() && (SERVER || !!S.ghKey);

function dropKey(msg) { S.ghKey = ""; save("ghKey"); say(msg); paintConn(); }

// Why the last try failed, in plain words (kept for the "waiting" line in You). "" = nothing failed.
let lastWhy = "";
function why(m) {
  if (!navigator.onLine) return "It goes out when you're back online.";
  return ({
    signin: "Sign in again (the bar at the top) and it sends.",
    setup: "Radar's server isn't set up to send notes yet: the RADAR_AUTH and GITHUB_TOKEN secrets in Cloudflare.",
    refused: "Radar's server didn't accept this phone's signature: RADAR_AUTH in Cloudflare doesn't match the passphrase.",
    github: "Radar's server couldn't file it on GitHub: check the GITHUB_TOKEN secret in Cloudflare.",
    locked: "Unlock Radar and it sends.",
  })[m] || "Radar couldn't reach its server. It tries again when you open Radar.";
}
function handle(err) {
  const m = err && err.message;
  if (m === "key") dropKey("GitHub no longer accepts Radar's token (expired or revoked). Your note is kept; reconnect in Saved.");
  else if (m === "perm") dropKey("GitHub refused the note: the token needs access to Almanac with Issues set to read and write. Your note is kept.");
  return m;
}

// Send what's waiting, oldest first. A note the server rejects as malformed is dropped so it can't block
// the rest; any other failure stops and keeps the rest. Resolves to the failure reason ("" when all went).
let flushing = null;
export function flush() {
  if (flushing) return flushing;
  if (!S.outbox.length) { lastWhy = ""; return Promise.resolve(""); }
  if (!canSend() || !navigator.onLine) return Promise.resolve(navigator.onLine ? "locked" : "offline");
  flushing = (async () => {
    let fail = "";
    try {
      while (S.outbox.length) {
        try { await post(S.outbox[0]); }
        catch (e) { if (e && e.message === "bad") { S.outbox.shift(); save("outbox"); continue; } throw e; }
        S.outbox.shift(); save("outbox");
      }
    } catch (e) { fail = handle(e) || "net"; }
    finally { flushing = null; lastWhy = fail; paintConn(); }
    return fail;
  })();
  return flushing;
}

// Returns "sent", "queued" (kept, retries later) or "waiting" (needs Connect on github.io).
export async function note(title, body, label, doneText) {
  const n = { title: String(title).slice(0, 200), body, labels: [label] };
  S.outbox.push(n); save("outbox");
  if (!canSend()) {
    paintConn();
    if (doneText !== "") say(SERVER ? "Saved on this phone. " + why("locked") : "Saved on this phone. It sends once Radar is connected (Settings).");
    return "waiting";
  }
  const fail = await flush();
  if (!S.outbox.includes(n)) { if (doneText) say(doneText); return "sent"; }
  paintConn();
  if (fail !== "key" && fail !== "perm" && doneText !== "") say("Saved on this phone. " + why(fail === "offline" ? "" : fail));
  return "queued";
}

// --- "Send in the background" section in Saved (github.io only) -------------------------
// --- Settings and the Work tracker ---------------------------------------------------------------------
// Both travel as small sealed JSON notes that a script (task.py apply) merges into the encrypted interests,
// without Claude. Changes are gathered for a few seconds so a flurry of taps sends one note.
let pend = {}, pendTimer = null;
export function track(patch) {
  if (patch.bucket) patch = Object.assign({}, patch, { bucket: Object.assign({}, pend.bucket || {}, patch.bucket) });
  if (patch.spend) patch = Object.assign({}, patch, { spend: (pend.spend || 0) + patch.spend });
  Object.assign(pend, patch);
  clearTimeout(pendTimer);
  pendTimer = setTimeout(sendTracked, 4000);
}
function sendTracked() {
  const p = pend; pend = {};
  if (p.settings) note("Radar settings", JSON.stringify(p.settings), "radar-settings", "");
  const t = {};
  if (p.work) t.work = p.work;
  if (p.bucket) t.bucket = p.bucket;
  if (p.artists) t.artists = p.artists;
  if (p.spend) t.spend = p.spend;
  if (Object.keys(t).length) note("Radar tracker", JSON.stringify(t), "radar-track", "");
}
export const outboxCount = () => S.outbox.length;
export const outboxWhy = () => (lastWhy && lastWhy !== "key" && lastWhy !== "perm" ? why(lastWhy) : "");

export function paintConn() {
  const box = $("connBox");
  if (!box) return;
  const waiting = S.outbox.length;
  const w = $("outboxLine");
  if (w) {
    w.hidden = !waiting;
    w.textContent = (waiting === 1 ? "1 note is waiting to send." : waiting + " notes are waiting to send.") +
      (lastWhy && lastWhy !== "key" && lastWhy !== "perm" ? " " + why(lastWhy) : "");
  }
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
