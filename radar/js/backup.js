// Settings › Backup: an encrypted copy of what lives only on this phone (answers, saves, reactions, Work tracker,
// tracked companies, kept places, hidden items, ad ratings, settings), so it survives a new phone or cleared storage.
// Weekly by itself (and "Back up now"): the copy is gzipped when the browser can, sent as a sealed radar-backup note,
// and task.py apply stores it encrypted as data/backup.enc.json. "Restore from backup" (and a one-time offer on a phone
// with nothing saved) opens that file with the vault key and writes the keys back. Never backed up: the vault key,
// the decrypted data cache, the outbox, the GitHub token and forecast caches.
import { $, html, put, ago } from "./util.js";
import { get, set } from "./store.js";
import { open, unlocked } from "./vault.js";
import { D } from "./data.js";
import { note } from "./notes.js";
import { openSheet, closeSheet, say } from "./ui.js";

const KEYS = ["radar-saved", "radar-reactions", "radar-hidden", "radar-do", "radar-do-view", "radar-gear-hidden", "radar-work",
  "radar-settings", "radar-watch", "radar-go-seen", "radar-work-seen", "radar-places", "radar-wanted-edits", "radar-wind-place",
  "radar-follow", "radar-bucket-edits", "radar-bucket-sent", "radar-companies", "radar-scout-hidden", "radar-ad-votes", "radar-welcomed"];
const AT = "radar-backup-at", SENT = "radar-backup-sent", OFFERED = "radar-restore-offered", WEEK = 7 * 864e5;

function snapshot() {
  const data = {};
  KEYS.forEach((k) => { try { const v = localStorage.getItem(k); if (v != null) data[k] = v; } catch (e) { /* ignore */ } });
  return data;
}
const b64 = (u8) => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
async function gzip(text) {
  if (typeof CompressionStream === "undefined") return null;
  const s = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return b64(new Uint8Array(await new Response(s).arrayBuffer()));
}

export async function backup(quietly) {
  if (!unlocked()) return false;
  const data = snapshot(), at = new Date().toISOString().slice(0, 19) + "Z";
  const raw = JSON.stringify(data), gz = await gzip(raw).catch(() => null);
  const body = JSON.stringify(gz ? { v: 1, at, gz } : { v: 1, at, data });
  if (body.length > 45000) { if (!quietly) say("The backup is too big to send in one note; tell Claude so it can be split."); return false; }
  const r = await note("Radar backup", body, "radar-backup", quietly ? "" : "Backup sent. It's stored encrypted within a few minutes.");
  set(AT, Date.now()); set(SENT, true);
  drawBackup();
  return r;
}

// weekly, after the data has loaded (quiet: no notice unless something goes wrong)
export function backupIfDue() {
  let last = +get(AT, 0) || 0;
  if (!last) { last = Date.now() - WEEK + 864e5; set(AT, last); return; } // first one a day after Radar starts here
  if (unlocked() && Date.now() - last > WEEK) backup(true);
}

async function fetchBackup() {
  if (!(D.config && D.config.backupAt)) return null; // task.py sets it once a backup is stored
  const r = await fetch("data/backup.enc.json?v=" + Date.now(), { cache: "no-store" });
  if (!r.ok) return null;
  const j = JSON.parse(await open(await r.json(), "backup"));
  return j && typeof j.data === "object" ? j : null;
}

function writeBack(b) {
  let n = 0;
  Object.keys(b.data).forEach((k) => {
    if (!KEYS.includes(k) || typeof b.data[k] !== "string") return;
    try { JSON.parse(b.data[k]); localStorage.setItem(k, b.data[k]); n++; } catch (e) { /* skip anything that isn't JSON */ }
  });
  return n;
}

export async function restore() {
  let b;
  try { b = await fetchBackup(); } catch (e) { b = null; }
  if (!b) { say("No backup found yet. Tap Back up now on the phone that has your saves."); return; }
  openSheet(() => html`<h2 class="sheet-title" id="sheetTitle">Restore from backup?</h2>
    <p class="lede">The backup is from ${ago(b.at)}. It replaces what this phone has for answers, saves, reactions, the
      Work tracker, companies, places, hidden items and settings.</p>
    <div class="sheet-acts"><button class="btn" type="button" id="doRestore">Restore</button><button class="btn ghost" type="button" data-close>Cancel</button></div>`,
  (el) => {
    el.querySelector("#doRestore").onclick = () => {
      const n = writeBack(b);
      set(OFFERED, true); closeSheet();
      say("Restored " + n + " lists. Radar reloads now.");
      setTimeout(() => location.reload(), 900);
    };
  }, "Restore from backup");
}

// a phone with nothing saved yet (new phone, cleared storage): offer the backup once
export async function offerRestore() {
  if (!unlocked() || get(OFFERED, false)) return;
  const empty = ["radar-saved", "radar-do", "radar-reactions", "radar-work"].every((k) => {
    const v = get(k, null); return !v || (typeof v === "object" && !Object.keys(v).length);
  });
  if (!empty) return;
  let b = null;
  try { b = await fetchBackup(); } catch (e) { b = null; }
  set(OFFERED, true);
  if (b) restore();
}

export function drawBackup() {
  const box = $("backupBox");
  if (!box) return;
  const last = +get(AT, 0) || 0;
  const sent = last && get(SENT, false);
  put(box, html`<div class="tg"><span><b>Encrypted backup</b><small>${sent ? "Last sent " + ago(new Date(last).toISOString()) + ". Runs by itself every week." : "Not sent yet. Runs by itself every week."}</small></span></div>
    <div class="duo"><button class="btn ghost" type="button" id="backupNow">Back up now</button><button class="btn ghost" type="button" id="restoreNow">Restore from backup</button></div>
    <p class="tg-note">Your answers, saves, reactions, Work tracker, companies, places, hidden items, ad ratings and settings. Encrypted with your passphrase; the key itself is never in it.</p>`);
  $("backupNow").onclick = () => backup(false);
  $("restoreNow").onclick = restore;
}
