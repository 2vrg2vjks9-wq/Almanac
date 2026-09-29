// Cloudflare Pages Function: GET /api/key
// Hands Radar its vault passphrase so the owner doesn't have to type it on each device.
// Optional: without the RADAR_KEY secret it answers 404 and the app asks for the passphrase.
// Cloudflare Access sits in front of the whole site; OWNER_EMAIL is checked as a second lock.
export async function onRequestGet({ request, env }) {
  const who = request.headers.get("Cf-Access-Authenticated-User-Email") || "";
  if (!env.OWNER_EMAIL || who.toLowerCase() !== env.OWNER_EMAIL.toLowerCase()) {
    return json({ error: "not signed in" }, 401);
  }
  if (!env.RADAR_KEY) return json({ error: "not set up" }, 404);
  return json({ key: env.RADAR_KEY }, 200);
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}
