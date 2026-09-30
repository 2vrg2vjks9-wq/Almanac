// The vault: Radar's data files are committed encrypted (the repo is public). This derives the key
// from the owner's passphrase once (PBKDF2-SHA256 → AES-256-GCM, same as radar/tools/vault.mjs),
// keeps it only on this phone, opens the data files and seals notes before they leave the phone.
import { get, set, KEYS } from "./store.js";

const te = new TextEncoder(), td = new TextDecoder();
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64 = (u) => { let s = ""; new Uint8Array(u).forEach((c) => { s += String.fromCharCode(c); }); return btoa(s); };
const subtle = () => (window.crypto && window.crypto.subtle) || null;

let KEY = null;

async function meta() {
  const r = await fetch("vault.json?v=" + Date.now(), { cache: "no-store" });
  if (!r.ok) throw new Error("net");
  return r.json();
}
async function importRaw(raw) {
  return subtle().importKey("raw", unb64(raw), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
export async function open(box, name) {
  const pt = await subtle().decrypt({ name: "AES-GCM", iv: unb64(box.iv), additionalData: te.encode(name) }, KEY, unb64(box.ct));
  return td.decode(pt);
}
async function seal(text, name) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle().encrypt({ name: "AES-GCM", iv, additionalData: te.encode(name) }, KEY, te.encode(text));
  return { iv: b64(iv), ct: b64(ct) };
}

export const supported = () => !!subtle();
export const unlocked = () => !!KEY;

// Load the key kept on this phone. Returns true when Radar can open its data.
export async function restore() {
  const raw = get(KEYS.key, "");
  if (!raw || !supported()) return false;
  try { KEY = await importRaw(raw); return true; } catch (e) { return false; }
}

// Derive the key from the passphrase and check it against vault.json.
// Resolves "ok", "wrong" or "offline".
export async function unlock(pass) {
  pass = String(pass || "").trim().toLowerCase().replace(/\s+/g, "");
  if (!pass || !supported()) return "wrong";
  let m;
  try { m = await meta(); } catch (e) { return "offline"; }
  const base = await subtle().importKey("raw", te.encode(pass), "PBKDF2", false, ["deriveKey"]);
  const k = await subtle().deriveKey({ name: "PBKDF2", salt: unb64(m.salt), iterations: m.iter, hash: "SHA-256" },
    base, { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  const prev = KEY;
  KEY = k;
  try { if ((await open(m.check, "check")) !== "radar-ok") throw new Error("check"); }
  catch (e) { KEY = prev; return "wrong"; }
  set(KEYS.key, b64(await subtle().exportKey("raw", k)));
  set(KEYS.locked, false);
  KEY = await importRaw(get(KEYS.key, "")); // keep a non-extractable copy in memory
  return "ok";
}

// On the Cloudflare site (behind Cloudflare Access) the passphrase can come from /api/key, so the
// owner never has to type it. Anywhere else, or if that isn't set up, this quietly returns false.
export async function unlockFromServer() {
  if (get(KEYS.locked, false)) return false;
  try {
    const r = await fetch("/api/key", { credentials: "same-origin", cache: "no-store" });
    if (!r.ok) return false;
    const j = await r.json();
    return j && j.key ? (await unlock(j.key)) === "ok" : false;
  } catch (e) { return false; }
}

// Forget the key and every decrypted copy on this phone.
export function forget() {
  KEY = null;
  [KEYS.key, KEYS.cache, KEYS.around].forEach((k) => { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } });
  set(KEYS.locked, true);
}

// A note's text as it travels to GitHub: only Claude (with the passphrase) can read it.
export async function sealNote(text) {
  const b = await seal(String(text), "note");
  return "radar-sealed:v1:" + b.iv + "." + b.ct;
}
