// Radar offline cache: always try the network first, fall back to the last copy.
const CACHE='radar-v2';
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(CACHE).then(c=>c.addAll(['./','index.html','interests.json','feed.json','taste.json','icon-180.png'])))});
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('fetch',e=>{const r=e.request;if(r.method!=='GET')return;const u=new URL(r.url);
 const font=/fonts\.(googleapis|gstatic)\.com$/.test(u.hostname);
 if(u.origin!==location.origin&&!font)return;
 const key=u.origin===location.origin?new Request(u.origin+u.pathname):r;
 e.respondWith(fetch(r).then(res=>{if(res.ok){const c=res.clone();caches.open(CACHE).then(x=>x.put(key,c))}return res}).catch(()=>caches.match(key).then(m=>m||caches.match('./'))));});
