// "Look around": one button, then a switch between walking distance (2.5 km) and the whole city.
// Finds the phone's position (only when tapped), then asks two open sources in parallel:
//   - OpenStreetMap through Overpass (three public mirrors, 20 s timeout each, simple GET)
//   - Wikipedia geosearch (notable places), so results still appear when Overpass is down.
// Results are merged, de-duplicated, ranked with interests.json + taste.json, and grouped.
// Away from home (more than 30 km from Den Haag) it names the city (Nominatim) and offers to ask
// Claude to research it: only when the owner taps that, "I'm in <city, country> until <date>" goes to
// Claude, whose hourly task adds curated items to the feed within the hour. At home nothing is sent.
// What leaves the phone: coordinates to OpenStreetMap, Wikipedia and (city view or away) Nominatim,
// only on tap; the city name and dates to Claude, only when asked.
import { $, html, put, km, kmText, getJSON, fetchT, mapUrl, safeUrl, hm, stamp, today, isoDay, d, longDate } from "./util.js";
import { S, save, get, set, KEYS } from "./store.js";
import { D, focusRegion } from "./data.js";
import { note, SERVER } from "./notes.js";
import { openSheet } from "./ui.js";
import { openItem } from "./detail.js";
import { emit } from "./data.js";

const OVERPASS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
const NEAR_M = 2500, CITY_M = 12000;
const HOME = { lat: 52.0799, lon: 4.3113 }, AWAY_KM = 30; // Den Haag; further than this counts as travelling

const GROUPS = [
  { id: "art", name: "Art & museums", icon: "M4 20h16M6 20V10M10 20V10M14 20V10M18 20V10M3 10l9-6 9 6z" },
  { id: "zen", name: "Zen & quiet places", icon: "M4 20h16M12 4c-2 3-6 4-6 8a6 6 0 0 0 12 0c0-4-4-5-6-8zM12 12v8" },
  { id: "food", name: "Food that may suit you", icon: "M7 3v8a2 2 0 0 0 2 2v8M11 3v8a2 2 0 0 1-2 2M9 3v6M17 21V3c-2 1-3 4-3 8h3" },
  { id: "nature", name: "Nature & viewpoints", icon: "M3 20l6-10 4 6 3-4 5 8zM16 6a2 2 0 1 0 0-.01" },
  { id: "landmark", name: "Landmarks & architecture", icon: "M5 21V8l7-5 7 5v13M9 21v-6h6v6M3 21h18" },
];
const GROUP = Object.fromEntries(GROUPS.map((g) => [g.id, g]));

// A = what the Around section shows right now.
let A = get(KEYS.around, null);
if (A) { A.restored = true; A.expanded = {}; A.scout = null; A.place = null; }

// --- Location -----------------------------------------------------------------------------
const WHERE_TEXT = {
  denied: "Radar isn't allowed to use your location. On iPhone open Settings › Privacy & Security › Location Services › Safari Websites and choose While Using the App, then try again.",
  timeout: "Your iPhone didn't find your location in time. Try again, ideally near a window or outside.",
  unavailable: "Your iPhone couldn't work out where you are. Check that Location Services is on, then try again.",
  unsupported: "This browser can't share your location with Radar.",
};
function locate() {
  return new Promise((ok, no) => {
    if (!("geolocation" in navigator) || window.isSecureContext === false) return no(new Error("unsupported"));
    let done = false;
    const guard = setTimeout(() => { if (!done) { done = true; no(new Error("timeout")); } }, 25000);
    navigator.geolocation.getCurrentPosition((p) => {
      if (done) return; done = true; clearTimeout(guard);
      S.here = { lat: p.coords.latitude, lon: p.coords.longitude, t: Date.now() }; save("here");
      ok(S.here);
    }, (e) => {
      if (done) return; done = true; clearTimeout(guard);
      no(new Error(e && e.code === 1 ? "denied" : e && e.code === 3 ? "timeout" : "unavailable"));
    }, { enableHighAccuracy: false, timeout: 20000, maximumAge: 300000 });
  });
}

// --- Sources --------------------------------------------------------------------------------
function overpassQuery(lat, lon, r, city) {
  const a = "(around:" + r + "," + lat.toFixed(5) + "," + lon.toFixed(5) + ")";
  const notable = city ? "[wikidata]" : "";
  return "[out:json][timeout:25];" +
    "(nwr[tourism~\"^(museum|gallery)$\"][name]" + a + ";nwr[amenity=arts_centre][name]" + a + ";)->.a;.a out center tags " + (city ? 80 : 40) + ";" +
    "nwr[tourism=artwork][name]" + notable + a + "->.w;.w out center tags " + (city ? 30 : 25) + ";" +
    "(nwr[amenity=place_of_worship][religion=buddhist][name]" + a + ";nwr[amenity=monastery][name]" + a + ";" +
    "nwr[leisure=garden][name][\"garden:style\"~\"japanese|zen\"]" + a + ";nwr[amenity=place_of_worship][religion=shinto][name][wikidata]" + a + ";)->.z;.z out center tags " + (city ? 50 : 30) + ";" +
    "nwr[amenity~\"^(restaurant|cafe)$\"][name][~\"^diet:\"~\"^(yes|only)$\"]" + a + "->.f;.f out center tags " + (city ? 60 : 40) + ";" +
    "(nwr[tourism=viewpoint]" + a + ";nwr[leisure=nature_reserve][name]" + a + ";nwr[natural=beach][name]" + a + ";nwr[leisure=park][name][wikidata]" + a + ";nwr[natural=peak][name][wikidata]" + a + ";)->.n;.n out center tags " + (city ? 40 : 30) + ";";
}
async function overpass(lat, lon, r, city, onTry) {
  const q = encodeURIComponent(overpassQuery(lat, lon, r, city));
  for (const base of OVERPASS) {
    onTry(new URL(base).hostname);
    try {
      const res = await fetchT(base + "?data=" + q, {}, 20000);
      if (!res.ok) throw new Error("HTTP " + res.status);
      const j = await res.json();
      if (!j || !Array.isArray(j.elements)) throw new Error("bad");
      return { host: new URL(base).hostname, elements: j.elements };
    } catch (e) { /* try the next mirror */ }
  }
  throw new Error("overpass down");
}
async function wikipedia(lat, lon, r) {
  const u = "https://en.wikipedia.org/w/api.php?action=query&generator=geosearch&ggscoord=" + lat.toFixed(5) + "%7C" + lon.toFixed(5) +
    "&ggsradius=" + Math.min(10000, r) + "&ggslimit=50&prop=coordinates%7Cdescription&coprimary=primary&format=json&formatversion=2&origin=*";
  const j = await getJSON(u, 20000);
  const q = (j && j.query) || {};
  // generator form (pages) or list=geosearch form (geosearch)
  const pages = Array.isArray(q.pages) ? q.pages : q.pages ? Object.values(q.pages) : [];
  const out = pages.map((p) => ({ title: p.title, desc: p.description || "", lat: p.coordinates && p.coordinates[0] && p.coordinates[0].lat, lon: p.coordinates && p.coordinates[0] && p.coordinates[0].lon }));
  (q.geosearch || []).forEach((g) => out.push({ title: g.title, desc: "", lat: g.lat, lon: g.lon }));
  return out.filter((p) => p.title && p.lat != null && p.lon != null);
}
async function cityName(lat, lon) {
  const g = await getJSON("https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&accept-language=en&lat=" + lat.toFixed(4) + "&lon=" + lon.toFixed(4), 12000);
  const a = (g && g.address) || {};
  const city = a.city || a.town || a.village || a.municipality || a.county || a.state || "";
  if (!city) throw new Error("no city");
  const cLat = parseFloat(g.lat), cLon = parseFloat(g.lon);
  return { city, country: a.country || "", lat: isFinite(cLat) ? cLat : lat, lon: isFinite(cLon) ? cLon : lon };
}

// --- Classify ---------------------------------------------------------------------------------
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
function dietLabels(t) {
  const out = [];
  Object.keys(t).forEach((k) => {
    const m = /^diet:(.+)$/.exec(k);
    if (!m || !/^(yes|only)$/.test(t[k])) return;
    const what = m[1].replace(/_/g, "-");
    out.push({ what, only: t[k] === "only", text: t[k] === "only" ? "only " + what : what + " options" });
  });
  return out.sort((a, b) => b.only - a.only);
}
function fromOSM(e) {
  const t = e.tags || {}, name = t["name:en"] || t.name;
  const lat = e.lat != null ? e.lat : e.center && e.center.lat, lon = e.lon != null ? e.lon : e.center && e.center.lon;
  if (!name || lat == null) return null;
  let group, kind, diet = [];
  if (t.tourism === "museum") { group = "art"; kind = "Museum"; }
  else if (t.tourism === "gallery") { group = "art"; kind = "Gallery"; }
  else if (t.amenity === "arts_centre") { group = "art"; kind = "Arts centre"; }
  else if (t.tourism === "artwork") { group = "art"; kind = t.artwork_type ? cap(t.artwork_type.replace(/_/g, " ")) : "Artwork"; }
  else if (t.amenity === "place_of_worship" || t.amenity === "monastery") {
    group = "zen";
    kind = /zen|rinzai|soto|sōtō|obaku|ōbaku/i.test(t.denomination || "") ? "Zen temple" : t.religion === "shinto" ? "Shrine" : t.amenity === "monastery" ? "Monastery" : "Buddhist temple";
  } else if (t.leisure === "garden") { group = "zen"; kind = "Japanese garden"; }
  else if (t.amenity === "restaurant" || t.amenity === "cafe") {
    diet = dietLabels(t);
    if (!diet.length) return null;
    group = "food"; kind = (t.amenity === "cafe" ? "Café" : "Restaurant") + (t.cuisine ? ", " + t.cuisine.split(";")[0].replace(/_/g, " ") : "");
  } else if (t.tourism === "viewpoint") { group = "nature"; kind = "Viewpoint"; }
  else if (t.leisure === "nature_reserve") { group = "nature"; kind = "Nature reserve"; }
  else if (t.natural === "beach") { group = "nature"; kind = "Beach"; }
  else if (t.leisure === "park") { group = "nature"; kind = "Park"; }
  else if (t.natural === "peak") { group = "nature"; kind = "Peak" + (t.ele ? ", " + Math.round(+t.ele) + " m" : ""); }
  else return null;
  if (group === "nature" && t.tourism === "viewpoint" && !t.name) return null;
  const wp = /^en:(.+)$/.exec(t.wikipedia || "");
  return {
    name, local: t["name:en"] && t.name && t.name !== t["name:en"] ? t.name : "", group, kind, diet, lat, lon,
    hours: t.opening_hours || "", website: safeUrl(t.website || t["contact:website"] || ""),
    wiki: wp ? "https://en.wikipedia.org/wiki/" + encodeURIComponent(wp[1].replace(/ /g, "_")) : "",
    notable: !!(t.wikidata || t.wikipedia), src: "osm", desc: "",
  };
}
const ART = /museum|gallery|galerie|\bart\b|\barts\b|sculpture|installation|exhibition/i;
const ZEN = /temple|shrine|\bzen\b|monastery|buddhist|garden|meditation|tea house|pagoda/i;
const NATURE = /\bpark\b|mountain|\bhill\b|\blake\b|river|island|beach|forest|nature reserve|viewpoint|waterfall|dune|\bbay\b|valley|gorge|\bpeak\b|volcano|coast|lagoon|wetland|botanical/i;
const LANDMARK = /building|architect|tower|bridge|castle|palace|church|cathedral|basilica|library|\bhall\b|monument|landmark|skyscraper|mosque|synagogue|lighthouse|windmill|opera|theatre|theater|pavilion|memorial|fortress|\bfort\b/i;
const SKIP = /school|station|railway|company|neighbou?rhood|district|\bward\b|village|municipality|\btown\b|\bcity\b|street|\broad\b|avenue|hospital|university|college|hotel|football|stadium|constituency|airport|metro|subway|\bbus\b|highway|motorway|suburb|prefecture|province|county|business|\bbank\b|corporation|restaurant|shopping|office|residential|apartment|former/i;
function fromWiki(p) {
  const head = (p.desc || "").split(/ in | of | on |,| located /)[0];
  let text = head || p.title;
  if (head && SKIP.test(head)) return null;
  let group = ART.test(text) ? "art" : ZEN.test(text) ? "zen" : NATURE.test(text) ? "nature" : LANDMARK.test(text) ? "landmark" : null;
  if (!group && head) { text = p.title; group = ART.test(text) ? "art" : ZEN.test(text) ? "zen" : LANDMARK.test(text) ? "landmark" : null; }
  if (!group || (!head && SKIP.test(p.title))) return null;
  return {
    name: p.title, local: "", group, kind: head ? cap(head) : GROUP[group].name, diet: [], lat: p.lat, lon: p.lon, hours: "", website: "",
    wiki: "https://en.wikipedia.org/wiki/" + encodeURIComponent(p.title.replace(/ /g, "_")), notable: true, src: "wiki", desc: p.desc || "",
  };
}

// --- Merge, rank -----------------------------------------------------------------------------------
const norm = (s) => String(s).normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\bthe\b/g, "").replace(/[^a-z0-9぀-ヿ一-鿿]/g, "");
function merge(list, maxKm) {
  const out = [];
  list.forEach((p) => {
    const n = norm(p.name);
    const twin = out.find((q) => {
      const m = norm(q.name);
      if (!n || !m) return false;
      const same = n === m || (Math.min(n.length, m.length) >= 6 && (n.includes(m) || m.includes(n)));
      return same && km(p.lat, p.lon, q.lat, q.lon) <= maxKm;
    });
    if (!twin) { out.push({ ...p }); return; }
    // Keep OpenStreetMap's tags and type; add Wikipedia's link and description.
    if (twin.src === "wiki" && p.src === "osm") { const w = { wiki: twin.wiki, desc: twin.desc }; Object.assign(twin, p, { wiki: twin.wiki || w.wiki, desc: w.desc, src: "both" }); }
    else { twin.wiki = twin.wiki || p.wiki; twin.desc = twin.desc || p.desc; twin.notable = twin.notable || p.notable; if (twin.src !== p.src) twin.src = "both"; }
  });
  return out;
}
function keywords() {
  const C = D.config || {}, T = D.taste || {};
  const clean = (list) => list.map((w) => String(w).toLowerCase().split(/[\/(]/)[0].trim()).filter((w) => w.length > 2);
  return {
    // names he follows count most; general taste words a little
    strong: clean([].concat((C.culture && C.culture.people) || [], (C.museums && C.museums.watch) || [])),
    soft: clean(["sculpture", "land art", "light", "zen", "garden", "architecture", "contemplative", "landscape"].concat(T.more || [])),
    less: clean(T.less || []),
  };
}
function rank(items, from, center, radiusKm, city) {
  const K = keywords();
  return items.filter((p) => km(center.lat, center.lon, p.lat, p.lon) <= radiusKm * 1.25).map((p) => {
    p.dist = km(from.lat, from.lon, p.lat, p.lon);
    const txt = (p.name + " " + p.kind + " " + p.desc + " " + p.diet.map((x) => x.text).join(" ")).toLowerCase();
    let s = p.notable ? 3 : 0;
    if (p.src === "both") s += 1;
    if (p.website) s += 0.5;
    if (p.group === "art" && /museum|gallery|arts centre/i.test(p.kind)) s += 1;
    K.strong.forEach((w) => { if (txt.includes(w)) s += 4; });
    K.soft.forEach((w) => { if (txt.includes(w)) s += 1.5; });
    K.less.forEach((w) => { if (txt.includes(w)) s -= 3; });
    if (p.group === "food" && p.diet.some((x) => x.only)) s += 2;
    if (p.kind === "Zen temple") s += 2;
    s -= p.dist * (city ? 0.25 : 1.4);
    p.score = s;
    return p;
  }).sort((a, b) => b.score - a.score);
}

// --- Running a search ---------------------------------------------------------------------------------
let run = 0;
async function search(mode) {
  const my = ++run;
  const alive = () => my === run;
  A = { mode, phase: "locating", items: [], osm: "pending", wiki: "pending", mirror: "", expanded: {}, at: Date.now(), label: mode === "city" ? "This city" : "Near you", scout: null, place: null };
  paint();
  let here;
  try { here = await locate(); }
  catch (e) {
    if (!alive()) return;
    const last = S.here && Date.now() - S.here.t < 6 * 36e5 && e.message !== "denied" ? S.here : null;
    A.phase = "error"; A.error = WHERE_TEXT[e.message] || WHERE_TEXT.unavailable; A.fallback = last; paint();
    return;
  }
  if (alive()) start(mode, here, my);
}
async function start(mode, here, my) {
  const alive = () => my === run;
  const city = mode === "city";
  A.mode = mode; A.phase = "searching"; A.from = { lat: here.lat, lon: here.lon }; A.at = Date.now(); A.error = ""; A.fallback = null;
  A.items = []; A.osm = A.wiki = "pending"; A.osmRaw = A.wikiRaw = null; A.expanded = {}; A.restored = false;
  A.away = km(HOME.lat, HOME.lon, here.lat, here.lon) > AWAY_KM;
  A.label = city ? "This city" : "Near you";
  let center = A.from;
  if (city || A.away) {
    if (city) { A.label = "Finding your city…"; paint(); }
    try {
      const c = A.place || await cityName(here.lat, here.lon);
      if (!alive()) return;
      A.place = c;
      if (city) { A.label = [c.city, c.country].filter(Boolean).join(", "); center = { lat: c.lat, lon: c.lon }; }
      if (A.away) offer(c);
    } catch (e) {
      if (!alive()) return;
      if (city) A.label = "This area";
    }
  }
  A.center = center;
  paint();
  const r = city ? CITY_M : NEAR_M;
  const osmP = overpass(center.lat, center.lon, r, city, (h) => { if (alive()) { A.mirror = h; paint(); } })
    .then((res) => { if (!alive()) return; A.osm = "ok"; A.mirror = res.host; A.osmRaw = res.elements.map(fromOSM).filter(Boolean); combine(); })
    .catch(() => { if (alive()) { A.osm = "fail"; combine(); } });
  const wikiP = wikipedia(center.lat, center.lon, r)
    .then((list) => { if (!alive()) return; A.wiki = "ok"; A.wikiRaw = list.map(fromWiki).filter(Boolean); combine(); })
    .catch(() => { if (alive()) { A.wiki = "fail"; combine(); } });
  await Promise.all([osmP, wikiP]);
  if (!alive()) return;
  A.phase = "done";
  paint();
  set(KEYS.around, { mode: A.mode, label: A.label, at: A.at, from: A.from, items: A.items, osm: A.osm, wiki: A.wiki, mirror: A.mirror, phase: "done" });
}
function combine() {
  const city = A.mode === "city";
  A.items = rank(merge([].concat(A.osmRaw || [], A.wikiRaw || []), city ? 0.8 : 0.4), A.from, A.center, (city ? CITY_M : NEAR_M) / 1000, city);
  paint();
}

// --- Scout: tell Claude which city ----------------------------------------------------------------------
function defaultUntil(c) {
  const prev = get(KEYS.scout, null);
  if (prev && prev.city === c.city && prev.until && d(prev.until) >= today()) return prev.until;
  const F = D.config && D.config.focus, fr = focusRegion();
  if (F && F.until && F.place && fr) {
    // focus.place is "City, Country" (what Scout sends) or just a country
    const P = String(F.place).toLowerCase().trim(), city = String(c.city || "").toLowerCase(), country = String(c.country || "").toLowerCase();
    if (P === country || P.split(",")[0].trim() === city || (country + " " + city).includes(P)) return F.until;
  }
  const t = today(); t.setDate(t.getDate() + 3); return isoDay(t);
}
// Away from home: show what Claude already knows, or offer to ask. Nothing is sent from here.
function offer(c) {
  const place = [c.city, c.country].filter(Boolean).join(", "), until = defaultUntil(c), prev = get(KEYS.scout, null);
  if (prev && prev.place === place && Date.now() - prev.t < 12 * 36e5 && prev.status === "sent") {
    A.scout = { status: "already", city: c.city, place, until: prev.until, sentAt: prev.t, c };
  } else A.scout = { status: "offer", city: c.city, place, until, c };
}
// What Claude gets for instant research: the owner's tastes from the (decrypted) interests, never a position.
function profile() {
  const C = D.config || {}, T = D.taste || {};
  return { artists: C.artists, museums: C.museums, culture: C.culture, stories: C.stories, meditation: C.meditation,
    food: { avoid: (C.diet && C.diet.avoid) || [], rule: C.restaurants && C.restaurants.rule }, learned: T.learned, more: T.more, less: T.less };
}
// Instant research on the Cloudflare site (/api/scout, Claude with web search, about a minute).
// Resolves the picks, or null when it isn't set up or fails (then the hourly task takes over).
async function instant(c, until) {
  if (!SERVER || !navigator.onLine) return null;
  try {
    const r = await fetchT("/api/scout", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ city: c.city, country: c.country, until, profile: profile() }) }, 180000);
    if (!r.ok) return null;
    const j = await r.json();
    return Array.isArray(j.items) && j.items.length ? j.items : null;
  } catch (e) { return null; }
}
async function scout(c, until) {
  const place = [c.city, c.country].filter(Boolean).join(", ");
  until = until || defaultUntil(c);
  const prev = get(KEYS.scout, null);
  A.scout = { status: "sending", city: c.city, place, until, c };
  if (prev && prev.place === place && prev.until === until && Date.now() - prev.t < 12 * 36e5 && prev.status === "sent") {
    A.scout.status = "already"; A.scout.sentAt = prev.t; paint(); return;
  }
  const fresh = !(prev && prev.place === place && Date.now() - prev.t < 12 * 36e5); // a date change doesn't research again
  let picks = null;
  if (fresh && SERVER) {
    A.scout.status = "researching"; paint();
    picks = await instant(c, until);
    if (!A.scout || A.scout.place !== place) return;
    if (picks) {
      const stamp = isoDay(new Date());
      picks = picks.map((p, i) => Object.assign({}, p, { id: "pick-" + place.toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-" + i, region: "all", found: stamp, picked: true }));
      set(KEYS.picks, { place, until, t: Date.now(), items: picks });
      emit("picks");
    }
  }
  paint();
  const body = "Radar: focus research on " + place + " until " + until + " (" + longDate(d(until)) + ").\nSent from Look around. City only; no exact location is shared." +
    (picks ? "\n\nClaude's instant picks, already on the phone (check them and keep the good ones in the feed; skip researching from scratch):\n" + JSON.stringify(picks) : "");
  const status = await note("I'm in " + place + " until " + until, body, "radar-location");
  if (!A.scout || A.scout.place !== place) return;
  A.scout.status = picks ? "picked" : status;
  set(KEYS.scout, { city: c.city, place, until, t: Date.now(), status: status === "sent" || picks ? "sent" : status });
  paint();
}

// --- Drawing ---------------------------------------------------------------------------------------------
const icon = (g) => html`<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="${GROUP[g].icon}"/></svg>`;
function scoutHTML() {
  const s = A.scout;
  if (!s) return "";
  if (s.status === "offer") {
    return html`<div class="scout"><p><b>You're in ${s.city}.</b> Ask Claude to research it? Curated picks for your stay arrive in Today and Explore within the hour. Only the city name and your dates are sent.</p>
      <label class="until"><span>Here until</span><input type="date" id="scoutUntil" value="${s.until}" min="${isoDay(today())}"></label>
      <div class="duo"><button class="btn" type="button" id="scoutGo">Ask Claude about ${s.city}</button></div></div>`;
  }
  const picks = get(KEYS.picks, null);
  const mine = picks && picks.place === s.place ? picks.items : null;
  if (s.status === "researching") return html`<div class="scout" role="status"><p><span class="pulse" aria-hidden="true"></span><b>Claude is researching ${s.city} now.</b> This takes about a minute; you can keep using Radar.</p></div>`;
  if (mine && (s.status === "picked" || s.status === "already" || s.status === "sent")) {
    return html`<div class="scout" role="status"><p><b>Claude's picks for ${s.city}</b>, researched just now. They're also in Explore.</p>
      <ul class="picks">${mine.map((p, i) => html`<li><button class="place" type="button" data-pick="${i}"><span class="pl-main"><b>${p.title}</b><small>${[p.place, p.flags && p.flags.length ? p.flags.join(", ") : ""].filter(Boolean).join(" · ")}</small></span></button></li>`)}</ul>
      <label class="until"><span>Here until</span><input type="date" id="scoutUntil" value="${s.until}" min="${isoDay(today())}"></label></div>`;
  }
  const msg = {
    sending: html`Telling Claude you're in ${s.city}…`,
    sent: html`<b>Claude is researching ${s.city}.</b> Curated picks arrive within the hour, in Today and Explore.`,
    already: html`<b>Claude is researching ${s.city}</b> (asked at ${hm(s.sentAt)}). Curated picks arrive within the hour, in Today and Explore.`,
    queued: html`<b>Your note about ${s.city} waits on this phone.</b> It goes out when Radar is back online; Claude's curated picks follow within the hour.`,
    waiting: html`<b>Connect Radar in Saved so Claude hears about ${s.city}.</b> Your note waits on this phone until then.`,
  }[s.status];
  return html`<div class="scout" role="status"><p>${msg}</p>
    <label class="until"><span>Here until</span><input type="date" id="scoutUntil" value="${s.until}" min="${isoDay(today())}"></label></div>`;
}
function rowHTML(p, i) {
  return html`<li><button class="place" type="button" data-p="${i}">
    <span class="pl-main"><b>${p.name}</b><small>${p.kind}${p.diet.length ? ", " + p.diet.map((x) => x.text).join(", ") : ""}${p.local ? html`, ${p.local}` : ""}</small></span>
    <span class="pl-km">${kmText(p.dist)}</span></button></li>`;
}
function groupsHTML() {
  const per = A.mode === "city" ? 6 : 5;
  return GROUPS.map((g) => {
    const list = A.items.filter((p) => p.group === g.id);
    if (!list.length) return "";
    const open = A.expanded[g.id], shown = open ? list : list.slice(0, per);
    return html`<section class="pgroup g-${g.id}"><h4>${icon(g.id)}<span>${g.name}</span></h4>
      ${g.id === "food" ? html`<p class="caution">Tagged by OpenStreetMap volunteers, not checked by Radar. Check with staff before you order.</p>` : ""}
      <ul>${shown.map((p) => rowHTML(p, A.items.indexOf(p)))}</ul>
      ${list.length > per ? html`<button class="more small" type="button" data-g="${g.id}">${open ? "Show fewer" : "Show all " + list.length}</button>` : ""}</section>`;
  });
}
function statusLine() {
  if (A.phase === "locating") return "Finding you…";
  if (A.phase === "error") return A.error;
  const radius = A.mode === "city" ? "about 10 km of the centre" : "2.5 km of you";
  if (A.phase === "searching") {
    const wait = [A.osm === "pending" && "OpenStreetMap" + (A.mirror ? " (" + A.mirror + ")" : ""), A.wiki === "pending" && "Wikipedia"].filter(Boolean);
    return (A.items.length ? A.items.length + " places so far. " : "Looking within " + radius + ". ") + (wait.length ? "Asking " + wait.join(" and ") + "…" : "");
  }
  if (!A.items.length) {
    if (A.osm === "fail" && A.wiki === "fail") return "Neither OpenStreetMap nor Wikipedia answered. Check your connection and try again.";
    return A.mode === "city" ? "Nothing notable tagged within " + radius + "." : "Nothing tagged within " + radius + ". Try Whole city for a wider look.";
  }
  const when = A.restored ? "Last search, " + stamp(A.at) + ". " : "";
  return when + A.items.length + (A.items.length === 1 ? " place" : " places") + " within " + radius + ", best first.";
}
function sourcesLine() {
  if (A.phase === "locating" || A.phase === "error") return "";
  const parts = [];
  if (A.osm === "ok") parts.push("OpenStreetMap" + (A.mirror ? " via " + A.mirror : ""));
  if (A.wiki === "ok") parts.push("Wikipedia");
  let t = parts.length ? "From " + parts.join(" and ") + ". Unrated; check opening times before you go." : "";
  if (A.osm === "fail" && A.wiki === "ok") t = "OpenStreetMap didn't answer, so these come from Wikipedia only (no food or small galleries). Try again later for more.";
  if (A.wiki === "fail" && A.osm === "ok") t += " Wikipedia didn't answer.";
  return t;
}
function paint() {
  const box = $("around");
  if (!box) return;
  $("nearBtn").disabled = !!(A && (A.phase === "locating" || A.phase === "searching"));
  if (!A) { put(box, ""); return; }
  const busy = A.phase === "locating" || A.phase === "searching", city = A.mode === "city", canSwitch = !!A.from && A.phase !== "locating";
  put(box, html`${canSwitch ? html`<div class="switch" role="group" aria-label="How far"><button type="button" id="aNear" aria-pressed="${!city}">Walking distance</button><button type="button" id="aCity" aria-pressed="${city}">Whole city</button></div>` : ""}
    <div class="around-head"><h3>${A.label}</h3>
      <p class="astatus${A.phase === "error" ? " err" : ""}" role="status" aria-live="polite">${busy ? html`<span class="pulse" aria-hidden="true"></span>` : ""}${statusLine()}</p>
      ${A.fallback ? html`<button class="btn ghost small" type="button" id="useLast">Use where you were at ${hm(A.fallback.t)}</button>` : ""}</div>
    ${scoutHTML()}
    ${busy && !A.items.length ? html`<div class="pskel" aria-hidden="true"><i></i><i></i><i></i></div>` : ""}
    ${groupsHTML()}
    ${sourcesLine() ? html`<p class="fine tight">${sourcesLine()}</p>` : ""}`);
  box.querySelectorAll(".place").forEach((b) => { b.onclick = () => openPlace(A.items[+b.dataset.p]); });
  box.querySelectorAll("[data-g]").forEach((b) => { b.onclick = () => { A.expanded[b.dataset.g] = !A.expanded[b.dataset.g]; paint(); }; });
  const u = $("useLast");
  if (u) u.onclick = () => { const m = A.mode; A = { ...A, restored: false }; start(m, A.fallback, ++run); };
  const inp = $("scoutUntil");
  if (inp) inp.onchange = () => {
    if (!inp.value || !A.scout || !A.scout.c || inp.value === A.scout.until) return;
    if (A.scout.status === "offer") A.scout.until = inp.value; // not sent yet: just remember the date
    else scout(A.scout.c, inp.value); // already asked: send the new date once
  };
  box.querySelectorAll("[data-pick]").forEach((b) => { b.onclick = () => { const P = get(KEYS.picks, null); if (P) openItem(P.items[+b.dataset.pick]); }; });
  const go = $("scoutGo");
  if (go) go.onclick = () => scout(A.scout.c, A.scout.until);
  const sw = (mode) => { if (A.mode === mode || busy) return; start(mode, A.from, ++run); };
  const n = $("aNear"), c = $("aCity");
  if (n) n.onclick = () => sw("near");
  if (c) c.onclick = () => sw("city");
}

// --- Place sheet -----------------------------------------------------------------------------------------
function openPlace(p) {
  if (!p) return;
  openSheet(() => html`<div class="meta"><span class="gicon g-${p.group}">${icon(p.group)}</span><span>${GROUP[p.group].name}</span><span>${kmText(p.dist)} away</span></div>
    <h2 class="sheet-title" id="sheetTitle">${p.name}</h2>
    ${p.local ? html`<div class="where">${p.local}</div>` : ""}
    <p class="full">${p.kind}${p.desc && p.desc.toLowerCase() !== p.kind.toLowerCase() ? html`. ${p.desc}` : ""}.</p>
    ${p.diet.length ? html`<div class="flags">${p.diet.map((x) => html`<span class="flag soft">${cap(x.text)}</span>`)}</div><p class="caution">These tags come from OpenStreetMap volunteers and can be out of date. Radar can't tell whether the kitchen suits you: check with staff before you order.</p>` : ""}
    ${p.hours ? html`<dl class="facts"><div><dt>Opening hours</dt><dd>${p.hours}</dd></div></dl>` : ""}
    <div class="sheet-acts">
      <a class="btn" href="${mapUrl(p.lat, p.lon)}" target="_blank" rel="noopener">Open in Maps</a>
      ${p.wiki ? html`<a class="btn ghost" href="${p.wiki}" target="_blank" rel="noopener">Read on Wikipedia</a>` : ""}
      ${p.website ? html`<a class="btn ghost" href="${p.website}" target="_blank" rel="noopener">Website</a>` : ""}
    </div>
    <p class="fine tight">${p.src === "wiki" ? "From Wikipedia." : p.src === "both" ? "From OpenStreetMap and Wikipedia." : "From OpenStreetMap."} Radar hasn't visited; check before you go.</p>`, null, p.name);
}

export function initAround() {
  $("nearBtn").onclick = () => search(A && A.mode === "city" ? "city" : "near");
  paint();
}
