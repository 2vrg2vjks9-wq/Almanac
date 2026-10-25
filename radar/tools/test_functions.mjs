#!/usr/bin/env node
// Tests the Cloudflare functions' request check (functions/api/note.js, scout.js) with a throwaway key:
// a correctly signed request gets through; a wrong, stale, unsigned or retargeted one, or a missing secret, doesn't.
// No network: GitHub and the Claude API are stubbed. Run: node radar/tools/test_functions.mjs
import { createHmac, randomBytes } from "node:crypto";
import { onRequestPost as note } from "../../functions/api/note.js";
import { onRequestPost as scout } from "../../functions/api/scout.js";

const vaultKey = randomBytes(32);
const RADAR_AUTH = createHmac("sha256", vaultKey).update("radar-auth-v1").digest("hex"); // = vault.mjs auth
let fails = 0, calls = [];
const check = (ok, what) => { console.log((ok ? "ok   " : "FAIL ") + what); if (!ok) fails++; };

globalThis.fetch = async (url, opts) => {
  calls.push(String(url));
  if (String(url).includes("api.github.com")) return new Response("{}", { status: 201 });
  const text = JSON.stringify({ items: [{ kind: "exhibition", title: "Test pick", url: "https://example.org/x" }] });
  return new Response(JSON.stringify({ stop_reason: "end_turn", content: [{ type: "text", text }] }), { status: 200 });
};

function req(path, body, { key = RADAR_AUTH, t = Math.floor(Date.now() / 1000), signPath = path, sign = true } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (sign) {
    headers["X-Radar-Time"] = String(t);
    headers["X-Radar-Sig"] = createHmac("sha256", Buffer.from(key, "hex")).update(t + "\n" + signPath + "\n" + body).digest("hex");
  }
  return new Request("https://almanac-dgf.pages.dev" + path, { method: "POST", headers, body });
}
const env = { RADAR_AUTH, GITHUB_TOKEN: "test-token", ANTHROPIC_API_KEY: "test-key" };
const nb = JSON.stringify({ title: "Radar note", body: "radar-sealed:v1:abc.def", label: "radar-interest" });

check((await note({ request: req("/api/note", nb), env })).status === 201 && calls.length === 1, "note: a signed request files an issue");
calls = [];
check((await note({ request: req("/api/note", nb, { sign: false }), env })).status === 401 && !calls.length, "note: unsigned is refused");
check((await note({ request: req("/api/note", nb, { key: randomBytes(32).toString("hex") }), env })).status === 401, "note: wrong key is refused");
check((await note({ request: req("/api/note", nb, { t: Math.floor(Date.now() / 1000) - 600 }), env })).status === 401, "note: a 10-minute-old signature is refused");
check((await note({ request: req("/api/note", nb, { signPath: "/api/scout" }), env })).status === 401, "note: a signature for another endpoint is refused");
const tampered = req("/api/note", nb); // signed for nb, sent with another body
check((await note({ request: new Request(tampered.url, { method: "POST", headers: tampered.headers, body: nb.replace("interest", "bucket") }), env })).status === 401, "note: a changed body is refused");
check((await note({ request: req("/api/note", nb), env: { GITHUB_TOKEN: "x" } })).status === 503, "note: without RADAR_AUTH nothing gets through");
check(!calls.length, "note: refused requests never reach GitHub");
check((await note({ request: req("/api/note", nb), env: Object.assign({}, env, { RADAR_AUTH: RADAR_AUTH.toUpperCase() + "\n" }) })).status === 201, "note: the secret may be pasted in capitals or with a newline");

const sb = JSON.stringify({ city: "Groet", country: "Netherlands", until: "2026-10-28", profile: {} });
calls = [];
check((await scout({ request: req("/api/scout", sb, { sign: false }), env })).status === 401 && !calls.length, "scout: unsigned is refused before Claude is asked");
check((await scout({ request: req("/api/scout", sb), env: { RADAR_AUTH } })).status === 404, "scout: without ANTHROPIC_API_KEY it says not set up");
const ok = await scout({ request: req("/api/scout", sb), env });
check(ok.status === 200 && (await ok.json()).items.length === 1, "scout: a signed request gets picks");

if (fails) { console.log(fails + " function check(s) failed"); process.exit(1); }
console.log("Function checks passed");
