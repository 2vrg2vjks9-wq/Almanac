// Radar offline cache: network first, fall back to the last copy.
// Caches only this site's own files (data stays encrypted in the cache) and Google Fonts; everything else (wind, maps, Wikipedia,
// OpenStreetMap, /api/note) goes straight to the network. Bump CACHE when files change.
const CACHE = "radar-v20";
const FILES = ["./", "index.html", "app.css", "manifest.webmanifest", "icon-180.png",
  "vault.json", "data/interests.enc.json", "data/feed.enc.json", "data/taste.enc.json", "data/things.enc.json",
  "js/main.js", "js/util.js", "js/store.js", "js/data.js", "js/ui.js", "js/wind.js",
  "js/feed.js", "js/detail.js", "js/notes.js", "js/saved.js", "js/around.js", "js/vault.js", "js/do.js"];

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).catch(() => {}));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith("radar-") && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const r = e.request;
  if (r.method !== "GET") return;
  const u = new URL(r.url);
  const same = u.origin === location.origin;
  const font = /^fonts\.(googleapis|gstatic)\.com$/.test(u.hostname);
  if (!same && !font) return;
  if (same && u.pathname.startsWith("/api/")) return;
  const key = same ? new Request(u.origin + u.pathname) : r;
  e.respondWith(fetch(r).then((res) => {
    if (res.ok) { const c = res.clone(); caches.open(CACHE).then((x) => x.put(key, c)); }
    return res;
  }).catch(() => caches.match(key).then((m) => m || (r.mode === "navigate" ? caches.match("./") : Response.error()))));
});
