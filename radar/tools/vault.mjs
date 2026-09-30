#!/usr/bin/env node
// Radar's vault: keeps the owner's data encrypted in this public repo. No dependencies (Node 18+).
//
// The data files (interests, feed, taste, things) are committed only as radar/data/<name>.enc.json,
// encrypted with AES-256-GCM (the file name is bound in as additional data). The key comes from a
// passphrase through PBKDF2-SHA256 with the salt and iteration count in radar/vault.json. The app
// derives the same key with WebCrypto once and keeps it on the phone.
//
// The passphrase is read from the RADAR_KEY environment variable. Never commit it.
//
//   node radar/tools/vault.mjs unlock        decrypt into radar/.plain/<name>.json (git-ignored)
//   node radar/tools/vault.mjs lock          encrypt radar/.plain/*.json back into radar/data/
//   node radar/tools/vault.mjs show feed     print one decrypted file
//   node radar/tools/vault.mjs open 'radar-sealed:v1:…'   decrypt a sealed note (an issue body); '-' reads stdin
//   node radar/tools/vault.mjs seal 'text'   make a sealed note (for tests)
//   node radar/tools/vault.mjs init          new salt + passphrase (printed once; re-encrypts existing data)
//
// `lock` only rewrites a file when its content changed, so unchanged data makes no commit noise.
import { pbkdf2Sync, randomBytes, randomInt, createCipheriv, createDecipheriv } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url))); // radar/
const META = join(ROOT, "vault.json");
const DATA = join(ROOT, "data");
const PLAIN = join(ROOT, ".plain");
export const NAMES = ["interests", "feed", "taste", "things"];
const SEAL = "radar-sealed:v1:";
const CHECK = "radar-ok";

const die = (m) => { console.error(m); process.exit(1); };
const b64 = (b) => Buffer.from(b).toString("base64");
const unb64 = (s) => Buffer.from(s, "base64");

export function derive(pass, meta) {
  return pbkdf2Sync(pass, unb64(meta.salt), meta.iter, 32, "sha256");
}
export function encrypt(k, text, aad) {
  const iv = randomBytes(12), c = createCipheriv("aes-256-gcm", k, iv);
  c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(text, "utf8"), c.final(), c.getAuthTag()]); // same layout as WebCrypto
  return { v: 1, iv: b64(iv), ct: b64(ct) };
}
export function decrypt(k, box, aad) {
  const all = unb64(box.ct), tag = all.subarray(all.length - 16), d = createDecipheriv("aes-256-gcm", k, unb64(box.iv));
  d.setAAD(Buffer.from(aad));
  d.setAuthTag(tag);
  return Buffer.concat([d.update(all.subarray(0, all.length - 16)), d.final()]).toString("utf8");
}

const meta = () => JSON.parse(readFileSync(META, "utf8"));
export function key(pass = process.env.RADAR_KEY) {
  pass = String(pass || "").trim();
  if (!pass) die("Set RADAR_KEY to the Radar passphrase first.");
  const m = meta(), k = derive(pass, m);
  try { decrypt(k, m.check, "check"); } catch (e) { die("RADAR_KEY is not the Radar passphrase (the check value doesn't open)."); }
  return k;
}

const file = (name) => join(DATA, name + ".enc.json");
export const read = (k, name) => decrypt(k, JSON.parse(readFileSync(file(name), "utf8")), name);
const same = (a, b) => JSON.stringify(JSON.parse(a)) === JSON.stringify(JSON.parse(b));
export function write(k, name, text) {
  JSON.parse(text); // refuse to seal broken JSON
  if (existsSync(file(name))) { try { if (same(read(k, name), text)) return false; } catch (e) { /* re-encrypt */ } }
  mkdirSync(DATA, { recursive: true });
  writeFileSync(file(name), JSON.stringify(encrypt(k, JSON.stringify(JSON.parse(text)), name)) + "\n");
  return true;
}
export function openNote(k, s) {
  const m = String(s).match(/radar-sealed:v1:([A-Za-z0-9+/=]+)\.([A-Za-z0-9+/=]+)/);
  return m ? decrypt(k, { iv: m[1], ct: m[2] }, "note") : String(s);
}
export function sealNote(k, text) { const b = encrypt(k, text, "note"); return SEAL + b.iv + "." + b.ct; }

function main(argv) {
  const [cmd, arg] = argv;
  if (cmd === "unlock") {
    const k = key();
    mkdirSync(PLAIN, { recursive: true });
    NAMES.filter((n) => existsSync(file(n))).forEach((n) => writeFileSync(join(PLAIN, n + ".json"), JSON.stringify(JSON.parse(read(k, n)), null, 1) + "\n"));
    console.log("Decrypted into radar/.plain/. Edit there, then run: node radar/tools/vault.mjs lock");
  } else if (cmd === "lock") {
    const k = key();
    const changed = NAMES.filter((n) => existsSync(join(PLAIN, n + ".json")) && write(k, n, readFileSync(join(PLAIN, n + ".json"), "utf8")));
    console.log("Encrypted: " + (changed.length ? changed.join(", ") : "nothing changed"));
  } else if (cmd === "show" && arg) {
    console.log(JSON.stringify(JSON.parse(read(key(), arg)), null, 1));
  } else if (cmd === "open" && arg) {
    console.log(openNote(key(), arg === "-" ? readFileSync(0, "utf8") : arg));
  } else if (cmd === "seal" && arg) {
    console.log(sealNote(key(), arg));
  } else if (cmd === "init") {
    let old = {};
    if (existsSync(META) && process.env.RADAR_KEY) {
      const k = key();
      NAMES.filter((n) => existsSync(file(n))).forEach((n) => { old[n] = read(k, n); });
    }
    const A = "abcdefghijkmnpqrstuvwxyz23456789";
    const pass = [...Array(5)].map(() => [...Array(4)].map(() => A[randomInt(A.length)]).join("")).join("-");
    const m = { v: 1, kdf: "PBKDF2-SHA256", iter: 600000, salt: b64(randomBytes(16)) };
    const k = derive(pass, m);
    m.check = encrypt(k, CHECK, "check");
    writeFileSync(META, JSON.stringify(m, null, 1) + "\n");
    Object.entries(old).forEach(([n, t]) => write(k, n, t));
    console.log(pass);
  } else {
    console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").filter((l) => l.startsWith("//")).map((l) => l.slice(3)).join("\n"));
    return 1;
  }
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = main(process.argv.slice(2));
