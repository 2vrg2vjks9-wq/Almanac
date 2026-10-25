// Cloudflare Pages Function: POST /api/note
// Lets the Radar app add a note (interest, feedback, city, bucket wish) as a GitHub issue
// without a token on the phone. The token lives in Cloudflare as the secret GITHUB_TOKEN.
// No login page: the phone proves it holds Radar's vault key by signing the request (see authorised()).
const REPO = "2vrg2vjks9-wq/Almanac";
const LABELS = ["radar-feedback", "radar-interest", "radar-location", "radar-bucket"];

export async function onRequestPost({ request, env }) {
  if (!env.RADAR_AUTH || !env.GITHUB_TOKEN) return json({ error: "not set up" }, 503);
  const text = await request.text();
  if (text.length > 70000) return json({ error: "too large" }, 413);
  if (!(await authorised(request, env, text))) return json({ error: "not allowed" }, 401);
  let n;
  try { n = JSON.parse(text); } catch (e) { return json({ error: "bad request" }, 400); }
  const title = String(n.title || "").slice(0, 200).trim();
  const body = String(n.body || "").slice(0, 60000); // sealed notes can carry Claude's instant picks
  const label = String(n.label || "");
  if (!title || LABELS.indexOf(label) < 0) return json({ error: "bad request" }, 400);

  const r = await fetch("https://api.github.com/repos/" + REPO + "/issues", {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + env.GITHUB_TOKEN,
      "Accept": "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "radar-app"
    },
    body: JSON.stringify({ title: title, body: body, labels: [label] })
  });
  return json({ ok: r.ok }, r.ok ? 201 : 502);
}

// The phone signs each request: X-Radar-Sig = HMAC-SHA256(proof key, time + "\n" + path + "\n" + body).
// The proof key is HMAC-SHA256(vault key, "radar-auth-v1"); Cloudflare holds it as RADAR_AUTH (64 hex
// characters, from `node radar/tools/vault.mjs auth`). It can check requests but can't open Radar's data.
// Requests more than 5 minutes off are refused.
export async function authorised(request, env, body) {
  const secret = String(env.RADAR_AUTH || "").trim().toLowerCase();
  const t = request.headers.get("X-Radar-Time") || "", sig = (request.headers.get("X-Radar-Sig") || "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(secret) || !/^[0-9a-f]{64}$/.test(sig) || !/^\d{9,11}$/.test(t)) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const key = await crypto.subtle.importKey("raw", bytes(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const msg = new TextEncoder().encode(t + "\n" + new URL(request.url).pathname + "\n" + body);
  return crypto.subtle.verify("HMAC", key, bytes(sig), msg);
}
function bytes(hex) { return new Uint8Array(hex.match(/../g).map((h) => parseInt(h, 16))); }

function json(obj, status) {
  return new Response(JSON.stringify(obj), { status: status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
