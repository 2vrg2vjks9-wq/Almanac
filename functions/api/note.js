// Cloudflare Pages Function: POST /api/note
// Lets the Radar app add a note (interest, feedback, city, bucket wish) as a GitHub issue
// without a token on the phone. The token lives in Cloudflare as the secret GITHUB_TOKEN.
// Cloudflare Access sits in front of the whole site, so only the owner reaches this;
// OWNER_EMAIL is checked as a second lock.
const REPO = "2vrg2vjks9-wq/Almanac";
const LABELS = ["radar-feedback", "radar-interest", "radar-location", "radar-bucket"];

export async function onRequestPost({ request, env }) {
  const who = request.headers.get("Cf-Access-Authenticated-User-Email") || "";
  if (!env.OWNER_EMAIL || who.toLowerCase() !== env.OWNER_EMAIL.toLowerCase()) {
    return json({ error: "not signed in" }, 401);
  }
  let n;
  try { n = await request.json(); } catch (e) { return json({ error: "bad request" }, 400); }
  const title = String(n.title || "").slice(0, 200).trim();
  const body = String(n.body || "").slice(0, 5000);
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

function json(obj, status) {
  return new Response(JSON.stringify(obj), { status: status, headers: { "Content-Type": "application/json" } });
}
