// Live wind for the spots in interests.json (Open-Meteo, no key), the wind ribbons,
// the hourly chart, water temperature with a wetsuit hint, and the Today lead sentence.
import { $, html, put, pad, stamp, getJSON, km, kmText } from "./util.js";
import { get, set, KEYS, S, save } from "./store.js";
import { D, emit } from "./data.js";
import { showTab, openSheet, closeSheet, swipeRow, undoable, say } from "./ui.js";
import { track } from "./notes.js";

export const net = { wind: null, windAt: null, sessions: [] }; // sessions: rideable windows, soonest first
let WATER = get(KEYS.water, {});

const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
const dirName = (x) => COMPASS[Math.round(x / 22.5) % 16];
const dirOK = (x, ranges) => ranges.some((r) => x >= r[0] && x <= r[1]);
function circMean(ds) {
  let a = 0, b = 0;
  ds.forEach((x) => { a += Math.cos(x * Math.PI / 180); b += Math.sin(x * Math.PI / 180); });
  return (Math.atan2(b, a) * 180 / Math.PI + 360) % 360;
}
// The forecast is in Amsterdam time, so "today" for the spots is the Dutch day, even abroad.
function nowNL() {
  const o = {};
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Amsterdam", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date()).forEach((x) => { o[x.type] = x.value; });
  return { day: o.year + "-" + o.month + "-" + o.day, h: +o.hour };
}
const dayOffset = (k) => Math.round((new Date(k + "T00:00:00Z") - new Date(nowNL().day + "T00:00:00Z")) / 864e5);
function dayName(k, long) {
  const n = dayOffset(k);
  if (n === 0) return "Today";
  if (n === 1) return long ? "Tomorrow" : "Tmrw";
  return new Date(k + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: long ? "long" : "short", timeZone: "UTC" });
}

function hourClass(x, spot, W) {
  if (x.kn == null) return "";
  if (!dirOK(x.d, spot.good) && x.kn >= W.sports.wing.min) return "off";
  if (x.kn > W.sports.windsurf.max) return "over";
  if (x.kn >= W.sports.windsurf.min) return "surf";
  if (x.kn >= W.sports.wing.min) return "wing";
  return "";
}
function analyse(spot, hourly, W) {
  const days = {}, order = [], nl = nowNL();
  hourly.time.forEach((t, i) => {
    const k = t.slice(0, 10);
    if (!days[k]) { days[k] = []; order.push(k); }
    days[k].push({ h: +t.slice(11, 13), kn: hourly.wind_speed_10m[i], g: hourly.wind_gusts_10m[i], d: hourly.wind_direction_10m[i] });
  });
  return order.filter((k) => k >= nl.day).map((k) => {
    const hrs = days[k], light = hrs.filter((x) => x.h >= W.daylight[0] && x.h < W.daylight[1]);
    const usable = light.filter((x) => !(k === nl.day && x.h < nl.h));
    const run = (sport) => {
      const s = W.sports[sport]; let best = [], cur = [];
      usable.concat([{ kn: -1 }]).forEach((x) => {
        if (x.kn >= s.min && x.kn <= s.max && dirOK(x.d, spot.good)) cur.push(x);
        else { if (cur.length > best.length) best = cur; cur = []; }
      });
      return best.length >= W.minHours ? best : null;
    };
    const peak = light.reduce((m, x) => (x.kn > m.kn ? x : m), { kn: -1, h: 0, d: 0 });
    return { day: k, hours: hrs, light, wing: run("wing"), surf: run("windsurf"), peak };
  });
}
function runInfo(r) {
  const kn = r.reduce((a, x) => a + x.kn, 0) / r.length;
  return { from: pad(r[0].h) + ":00", to: pad(r[r.length - 1].h + 1) + ":00", kn: Math.round(kn), dir: dirName(circMean(r.map((x) => x.d))), len: r.length };
}

// --- Water temperature (Open-Meteo Marine); lakes and failures show nothing -------------
const suit = (c) => (c >= 22 ? "boardshorts or a shorty" : c >= 18 ? "3/2 wetsuit" : c >= 15 ? "4/3 wetsuit" : c >= 12 ? "5/4 wetsuit and boots" : c >= 9 ? "5/4 or 6/5 with boots and gloves" : "6/5 hooded, boots and gloves");
const isSea = (s) => (s.water != null ? !!s.water : !/\blake\b/i.test((s.sub || "") + " " + s.name));
const waterText = (spot) => { const c = WATER[spot.id]; return c == null ? "" : "Water " + Math.round(c) + "°C, " + suit(c); };
// Surf layer: daily max wave height, period and main direction per sea spot (Open-Meteo Marine), shown as a row of
// numbers under the ribbon on Wind (bold when it looks surfable: 0.8 m+ and 7 s+) and in the day details.
let WAVES = {}; // {spotId: {YYYY-MM-DD: {h, p, d}}}
const surfable = (w) => !!(w && w.h >= 0.8 && w.p >= 7);
function waveText(spotId, day) {
  const w = (WAVES[spotId] || {})[day];
  return w ? "Waves up to " + w.h.toFixed(1) + " m, " + Math.round(w.p) + " s, from the " + dirName(w.d) + (surfable(w) ? ": worth a surf check." : ".") : "";
}
function paintWater() {
  document.querySelectorAll("#windAll .spot").forEach((el) => {
    const sp = spots().find((x) => x.id === el.dataset.spot), w = el.querySelector(".water");
    if (sp && w) w.textContent = waterText(sp);
    const row = el.querySelector(".waves"), W = sp && WAVES[sp.id];
    if (!row || !W) return;
    const cells = [...el.querySelectorAll(".rday")].map((b) => {
      const x = W[b.dataset.day];
      return html`<span class="wv${surfable(x) ? " on" : ""}">${x ? x.h.toFixed(1) + " m" : "–"}</span>`;
    });
    row.setAttribute("aria-label", "Highest waves per day; bold when it looks surfable");
    put(row, html`${cells}`);
    row.hidden = false;
  });
}
async function loadWater() {
  const sp = spots().filter(isSea);
  if (!sp.length) return;
  const u = "https://marine-api.open-meteo.com/v1/marine?latitude=" + sp.map((s) => s.lat).join(",") + "&longitude=" + sp.map((s) => s.lon).join(",") +
    "&daily=sea_surface_temperature_max,wave_height_max,wave_period_max,wave_direction_dominant&timezone=Europe%2FAmsterdam&forecast_days=7";
  try {
    const r = await fetch(u);
    if (!r.ok) throw new Error(r.status);
    let res = await r.json();
    if (!Array.isArray(res)) res = [res];
    const out = {}, waves = {};
    sp.forEach((s, i) => {
      const D2 = (res[i] && res[i].daily) || {};
      const v = (D2.sea_surface_temperature_max || []).find((x) => x != null);
      if (typeof v === "number") out[s.id] = v;
      (D2.time || []).forEach((day, j) => {
        const h = (D2.wave_height_max || [])[j], p = (D2.wave_period_max || [])[j], d = (D2.wave_direction_dominant || [])[j];
        if (typeof h === "number") (waves[s.id] = waves[s.id] || {})[day] = { h, p: p || 0, d: d || 0 };
      });
    });
    WATER = out; set(KEYS.water, out); WAVES = waves;
  } catch (e) { /* keep the last reading */ }
  paintWater();
}

// --- Drawing ------------------------------------------------------------------------------
const SCALE = 32; // knots at full bar height
const pct = (kn) => Math.max(5, Math.min(100, (kn || 0) / SCALE * 100)).toFixed(0);

function ribbon(spot, days, W, interactive) {
  const wingLine = pct(W.sports.wing.min), surfLine = pct(W.sports.windsurf.min);
  const cols = days.map((Dy, i) => {
    const good = !!(Dy.wing || Dy.surf);
    const bars = Dy.light.map((x) => html`<i class="bar ${hourClass(x, spot, W)}" style="height:${pct(x.kn)}%;animation-delay:${i * 50}ms"></i>`);
    const label = dayName(Dy.day, true) + ": " + (good
      ? [Dy.wing && "wingfoil " + runInfo(Dy.wing).from + " to " + runInfo(Dy.wing).to, Dy.surf && "windsurf " + runInfo(Dy.surf).from + " to " + runInfo(Dy.surf).to].filter(Boolean).join(", ")
      : "nothing rideable, strongest " + Math.round(Dy.peak.kn) + " knots");
    const inner = html`<span class="bars" aria-hidden="true">${bars}</span><span class="rlab" aria-hidden="true">${dayName(Dy.day)}</span>`;
    return interactive
      ? html`<button class="rday${good ? " good" : ""}" data-i="${i}" data-day="${Dy.day}" type="button" aria-expanded="false" aria-label="${label}">${inner}</button>`
      : html`<span class="rday${good ? " good" : ""}">${inner}</span>`;
  });
  return html`<div class="ribbon grow" style="--wing:${wingLine}%;--surf:${surfLine}%">${cols}</div>`;
}
function verdict(days) {
  for (const Dy of days) for (const k of ["surf", "wing"]) if (Dy[k]) {
    const r = runInfo(Dy[k]);
    return html`<b>${dayName(Dy.day, true)}</b> ${k === "wing" ? "wing" : "windsurf"} <span class="nw">~${r.kn} kn</span>`;
  }
  return html`<span class="quiet">Nothing rideable</span>`;
}
function spotHTML(spot, days, W, interactive) {
  return html`<div class="spot" data-spot="${spot.id}">
    <div class="spot-top"><span class="spot-name">${spot.name}</span><span class="spot-verdict">${verdict(days)}</span></div>
    ${interactive ? html`<div class="spot-sub"><span>${spot.sub || ""}</span><span class="water${isSea(spot) ? " sea" : ""}">${waterText(spot)}</span></div>` : ""}
    ${ribbon(spot, days, W, interactive)}
    ${interactive && isSea(spot) ? html`<div class="waves" hidden></div>` : ""}
    ${interactive ? html`<div class="detail" hidden></div>` : ""}
  </div>`;
}

function chart(Dy, spot, W) {
  const w = 340, h = 132, pl = 24, pr = 6, pt = 10, pb = 20, hrs = Dy.hours;
  const max = Math.max(32, ...hrs.map((x) => x.g || 0));
  const x = (i) => pl + (w - pl - pr) * i / 23, y = (v) => pt + (h - pt - pb) * (1 - v / max);
  const band = (s, c) => html`<rect x="${pl}" width="${w - pl - pr}" y="${y(s.max).toFixed(1)}" height="${(y(s.min) - y(s.max)).toFixed(1)}" fill="${c}" opacity=".16"/>`;
  const night = html`<rect x="${pl}" width="${(x(W.daylight[0]) - pl).toFixed(1)}" y="${pt}" height="${h - pt - pb}" fill="var(--ink)" opacity=".05"/><rect x="${x(W.daylight[1]).toFixed(1)}" width="${(w - pr - x(W.daylight[1])).toFixed(1)}" y="${pt}" height="${h - pt - pb}" fill="var(--ink)" opacity=".05"/>`;
  const path = (k) => hrs.map((v, i) => (i ? "L" : "M") + x(i).toFixed(1) + "," + y(v[k] || 0).toFixed(1)).join("");
  const ticks = [10, 20, 30].map((t) => html`<text x="2" y="${(y(t) + 3).toFixed(1)}" class="tk">${t}</text><line x1="${pl}" x2="${w - pr}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}" stroke="var(--rule)"/>`);
  const hours = [6, 9, 12, 15, 18, 21].map((t) => html`<text x="${x(t).toFixed(1)}" y="${h - 3}" text-anchor="middle" class="tk">${t}</text>`);
  const arrows = hrs.filter((v, i) => i % 2 === 0 && v.kn != null).map((v) => html`<g transform="translate(${x(v.h).toFixed(1)},${(y(v.kn) - 10).toFixed(1)}) rotate(${v.d + 180})"><path d="M0,-4.5 L3,3.2 L0,1.7 L-3,3.2Z" fill="${dirOK(v.d, spot.good) ? "var(--ink)" : "var(--flag)"}"/></g>`);
  return html`<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Hourly wind speed and gusts in knots, with the wingfoil and windsurf ranges shaded">${night}${band(W.sports.wing, "var(--kelp)")}${band(W.sports.windsurf, "var(--buoy)")}${ticks}${hours}<path d="${path("g")}" fill="none" stroke="var(--ink-3)" stroke-width="1.2" stroke-dasharray="2 3"/><path d="${path("kn")}" fill="none" stroke="var(--marine)" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>${arrows}</svg>`;
}
function wireDetail(root, spot, days, W) {
  const det = root.querySelector(".detail");
  root.querySelectorAll(".rday").forEach((b) => {
    b.onclick = () => {
      const i = +b.dataset.i, open = b.classList.contains("sel");
      root.querySelectorAll(".rday").forEach((x) => { x.classList.remove("sel"); x.setAttribute("aria-expanded", "false"); });
      if (open) { det.hidden = true; return; }
      b.classList.add("sel"); b.setAttribute("aria-expanded", "true");
      const Dy = days[i], t = [];
      if (Dy.wing) { const r = runInfo(Dy.wing); t.push("Wingfoil " + r.from + "–" + r.to + ", around " + r.kn + " kn from the " + r.dir + "."); }
      if (Dy.surf) { const s = runInfo(Dy.surf); t.push("Windsurf " + s.from + "–" + s.to + ", around " + s.kn + " kn from the " + s.dir + "."); }
      if (!t.length) t.push("No " + W.minHours + "-hour window in range from a good direction. Strongest: " + Math.round(Dy.peak.kn) + " kn from the " + dirName(Dy.peak.d) + " at " + pad(Dy.peak.h) + ":00.");
      put(det, html`${chart(Dy, spot, W)}<div class="chart-key" aria-hidden="true"><span><i class="ln"></i>Wind</span><span><i class="ln dash"></i>Gusts</span><span><i class="arr"></i>Blowing toward</span></div><p><strong>${dayName(Dy.day, true)}.</strong> ${t.join(" ")} ${waveText(spot.id, Dy.day)} ${spot.note || ""}</p>`);
      det.hidden = false;
    };
  });
}

function drawWind(res, stale) {
  const W = D.config.wind, sessions = [];
  const all = spots().map((spot, si) => {
    const days = analyse(spot, (res[si] && res[si].hourly) || { time: [], wind_speed_10m: [], wind_gusts_10m: [], wind_direction_10m: [] }, W);
    days.forEach((Dy) => ["wing", "surf"].forEach((k) => { if (Dy[k]) sessions.push({ spot, Dy, k, r: runInfo(Dy[k]) }); }));
    return { spot, days };
  });
  put($("todayWind"), html`${all.map((a) => spotHTML(a.spot, a.days, W, false))}`);
  $("todayWind").setAttribute("aria-label", "Wind at your spots: " + all.map((a) => {
    const t = a.days.find((Dy) => Dy.wing || Dy.surf);
    return a.spot.name + ", " + (t ? (t.wing ? "wingfoil " : "windsurf ") + dayName(t.day, true).toLowerCase() : "nothing rideable");
  }).join("; ") + ". Opens the Wind tab.");
  const box = $("windAll");
  put(box, html`${all.map((a) => spotHTML(a.spot, a.days, W, true))}`);
  box.querySelectorAll(".spot").forEach((el, i) => wireDetail(el, all[i].spot, all[i].days, W));
  paintWater();

  sessions.sort((a, b) => (a.Dy.day < b.Dy.day ? -1 : a.Dy.day > b.Dy.day ? 1 : b.r.len - a.r.len));
  net.sessions = sessions;
  emit("wind");
  const n = sessions[0];
  if (n) {
    const until = dayOffset(n.Dy.day);
    const when = until <= 1 ? dayName(n.Dy.day, true) : new Date(n.Dy.day + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" });
    $("lead").textContent = until <= 1 ? when + " looks good at " + n.spot.name + "." : "Next good wind: " + when + " at " + n.spot.name + ".";
    $("leadSub").textContent = (n.k === "wing" ? "Wingfoil " : "Windsurf ") + n.r.from + "–" + n.r.to + ", around " + n.r.kn + " kn from the " + n.r.dir + "." + (until > 1 ? " That's " + until + " days away." : "");
  } else {
    $("lead").textContent = "No rideable wind in the next 7 days.";
    $("leadSub").textContent = "The morning alert tells you when that changes.";
  }
  $("windSub").textContent = stale ? "Offline. Forecast from " + stamp(net.windAt) + ", daylight hours." : "Next 7 days, daylight hours";
}

// Placeholder ribbons so nothing jumps when the forecast arrives.
export function skeleton() {
  if (document.querySelector("#todayWind .spot")) return;
  const W = D.config.wind;
  const row = (sp, sub) => {
    const cols = [...Array(7)].map(() => html`<span class="rday"><span class="bars">${[...Array(W.daylight[1] - W.daylight[0])].map(() => html`<i class="bar" style="height:10%"></i>`)}</span><span class="rlab">&nbsp;</span></span>`);
    return html`<div class="spot skel"><div class="spot-top"><span class="spot-name">${sp.name}</span><span class="spot-verdict quiet">Checking…</span></div>${sub ? html`<div class="spot-sub"><span>${sp.sub || ""}</span><span class="water${isSea(sp) ? " sea" : ""}"></span></div>` : ""}<div class="ribbon" aria-hidden="true">${cols}</div></div>`;
  };
  put($("todayWind"), html`${spots().map((sp) => row(sp, false))}`);
  put($("windAll"), html`${spots().map((sp) => row(sp, true))}`);
}

export async function loadWind() {
  const sp = spots();
  paintPlace();
  const u = "https://api.open-meteo.com/v1/forecast?latitude=" + sp.map((s) => s.lat).join(",") + "&longitude=" + sp.map((s) => s.lon).join(",") +
    "&hourly=wind_speed_10m,wind_gusts_10m,wind_direction_10m&wind_speed_unit=kn&timezone=Europe%2FAmsterdam&forecast_days=7";
  loadWater();
  try {
    const r = await fetch(u);
    if (!r.ok) throw new Error(r.status);
    let res = await r.json();
    if (!Array.isArray(res)) res = [res];
    net.wind = "live"; net.windAt = Date.now();
    if (place().mode === "home") set(KEYS.wind, { t: net.windAt, res }); // the offline copy is for the home spots
    drawWind(res, false);
  } catch (e) {
    const c = place().mode === "home" ? get(KEYS.wind, null) : null;
    if (c) { net.wind = "cache"; net.windAt = c.t; drawWind(c.res, true); }
    else { net.wind = null; $("lead").textContent = "The forecast needs a connection."; $("leadSub").textContent = "Radar tries again when you're back online."; }
  }
}

// --- Where the wind is for: home spots or a kept place ---------------------------------------------
// Each place found with Where I am or Search a place is kept as a chip next to Home spots (radar-places, on this
// phone), with the kite, windsurf and wingfoil spots OpenStreetMap knows within 20 km plus the place itself. Their
// good directions aren't known, so every direction counts there. Asking again within 5 km of a kept place opens it
// without searching. Edit removes and reorders spots (and removes a place); home edits go to the encrypted interests
// (radar-track `homeSpots`), so the morning alert follows them. What leaves the phone: the position or the search
// text, to OpenStreetMap, only when you tap.
const places = () => { const p = get(KEYS.places, []); return Array.isArray(p) ? p : []; };
const savePlaces = (p) => set(KEYS.places, p);
// older versions kept one place in radar-wind-place itself: turn it into a kept place once
(function migrate() {
  const W = get(KEYS.windPlace, null);
  const old = [W, W && W.last].filter((x) => x && (x.mode === "here" || x.mode === "search") && x.lat != null && Array.isArray(x.spots));
  if (!old.length) return;
  const P = places();
  old.forEach((x) => { if (!P.some((p) => km(p.lat, p.lon, x.lat, x.lon) <= 5)) P.push({ id: "pl" + Math.round(x.lat * 1e3) + "_" + Math.round(x.lon * 1e3), name: x.name, lat: x.lat, lon: x.lon, spots: x.spots, t: x.t || Date.now() }); });
  savePlaces(P);
  const keep = W.mode === "home" ? null : P.find((p) => km(p.lat, p.lon, W.lat, W.lon) <= 5);
  set(KEYS.windPlace, keep ? { mode: "saved", id: keep.id, t: W.t || Date.now() } : { mode: "home" });
})();
function place() {
  const W = get(KEYS.windPlace, null) || { mode: "home" };
  if (W.mode === "saved") { const p = places().find((x) => x.id === W.id); if (p) return Object.assign({ mode: "saved" }, p, { t: W.t }); }
  return { mode: "home" };
}
// Home spots with the phone's edits applied until the data shows them (settings.homeSpots: {order, removed})
function homeSpots() {
  const all = (D.config && D.config.wind && D.config.wind.spots) || [], h = (S.settings && S.settings.homeSpots) || {};
  const rm = new Set(h.removed || []), order = h.order || [];
  const pos = (x) => { const i = order.indexOf(x.id); return i < 0 ? 1e3 + all.indexOf(x) : i; };
  return all.filter((x) => !rm.has(x.id)).sort((a, b) => pos(a) - pos(b));
}
export function spots() {
  const P = place();
  return P.mode === "saved" && Array.isArray(P.spots) && P.spots.length ? P.spots : homeSpots();
}
const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://overpass.private.coffee/api/interpreter"];
async function nearbySpots(lat, lon) {
  // named kite, windsurf and wingfoil spots within 20 km; each mirror gets 9 s
  const q = '[out:json][timeout:8];nwr["sport"~"^(kitesurfing|windsurfing|wingfoiling|kiteboarding)$"][name](around:20000,' + lat.toFixed(4) + "," + lon.toFixed(4) + ");out center 12;";
  let els = null;
  for (const u of OVERPASS) {
    try { const j = await getJSON(u + "?data=" + encodeURIComponent(q), 9000); els = j.elements || []; break; } catch (e) { /* next mirror */ }
  }
  const seen = new Set(), out = [];
  (els || []).forEach((e) => {
    const la = e.lat != null ? e.lat : e.center && e.center.lat, lo = e.lon != null ? e.lon : e.center && e.center.lon;
    const nm = (e.tags && (e.tags.name || e.tags["name:en"])) || "";
    if (la == null || !nm || seen.has(nm.toLowerCase())) return;
    seen.add(nm.toLowerCase());
    out.push({ id: "p" + e.id, name: nm, sub: kmText(km(lat, lon, la, lo)) + " away · direction not checked", lat: la, lon: lo, good: [[0, 360]] });
  });
  out.sort((a, b) => km(lat, lon, a.lat, a.lon) - km(lat, lon, b.lat, b.lon));
  return { spots: out.slice(0, 3), answered: els !== null };
}
const placeSpot = (id, lat, lon, name) => ({ id: id + "-c", name: name, sub: "Forecast for the place · direction not checked", lat, lon, good: [[0, 360]] });
const nearKept = (lat, lon) => places().find((p) => km(p.lat, p.lon, lat, lon) <= 5);
function select(id) { set(KEYS.windPlace, id ? { mode: "saved", id, t: Date.now() } : { mode: "home" }); reload(); }
async function addPlace(lat, lon, name) {
  const kept = nearKept(lat, lon);
  if (kept) return select(kept.id); // already kept: open it, no search
  const id = "pl" + Date.now().toString(36);
  savePlaces(places().concat([{ id, name, lat, lon, spots: [placeSpot(id, lat, lon, name)], t: Date.now() }]));
  select(id); // the forecast for the place itself shows right away; nearby spots join when the search answers
  const r = await nearbySpots(lat, lon);
  const P = places(), me = P.find((x) => x.id === id);
  if (!me) return;
  if (r.spots.length) { me.spots = r.spots.concat(me.spots.filter((x) => x.id === id + "-c")).slice(0, 4); savePlaces(P); if (place().id === id) reload(); }
  else if (place().id === id) $("windSub").textContent = r.answered ? "OpenStreetMap knows no kite or wing spots within 20 km: this is the forecast for the place itself." : "Couldn't reach OpenStreetMap for nearby spots: this is the forecast for the place itself.";
}
export function reloadWind() { document.querySelectorAll("#todayWind .spot, #windAll .spot").forEach((x) => x.remove()); skeleton(); loadWind(); }
function reload() { reloadWind(); emit("change"); }
function paintPlace() {
  const P = place(), box = $("windPlace");
  if (!box) return;
  const chip = (k, label, on) => html`<button class="pill${on ? " on" : ""}" type="button" data-wp="${k}" aria-pressed="${String(on)}">${label}</button>`;
  put(box, html`${chip("home", "Home spots", P.mode === "home")}${places().map((p) => chip("p:" + p.id, p.name, P.id === p.id))}${chip("here", "Where I am", false)}${chip("search", "Search a place", false)}<button class="pill ghost" type="button" data-wp="edit">Edit</button>`);
  box.querySelectorAll("[data-wp]").forEach((b) => {
    const k = b.dataset.wp;
    b.onclick = () => (k === "home" ? select(null) : k === "here" ? whereIAm() : k === "search" ? searchPlace() : k === "edit" ? editSpots() : select(k.slice(2)));
  });
  const t = $("windTitle");
  if (t) t.previousElementSibling.textContent = P.mode === "home" ? "Your spots" : P.name;
}
async function whereIAm() {
  if (!navigator.geolocation) { $("windSub").textContent = "This phone can't share its location."; return; }
  $("windSub").textContent = "Finding where you are…";
  navigator.geolocation.getCurrentPosition(async (p) => {
    const lat = p.coords.latitude, lon = p.coords.longitude, kept = nearKept(lat, lon);
    if (kept) return select(kept.id); // roughly the same spot: no lookups at all
    let name = "Where you are";
    try {
      const g = await getJSON("https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&accept-language=en&lat=" + lat.toFixed(4) + "&lon=" + lon.toFixed(4), 6000);
      const a = g.address || {}; name = a.city || a.town || a.village || a.municipality || name;
    } catch (e) { /* keep the generic name */ }
    addPlace(lat, lon, name);
  }, () => { $("windSub").textContent = "Location is off for Safari: Settings, Privacy & Security, Location Services, Safari Websites."; }, { timeout: 15000, maximumAge: 300000 });
}
function searchPlace() {
  openSheet(() => html`<h2 class="sheet-title" id="sheetTitle">Wind somewhere else</h2>
    <form class="compose" id="wpForm" novalidate><label><span>Town or beach</span><input name="q" type="search" autocomplete="off" placeholder="Tarifa, Sotavento, Dakhla…"></label>
    <div class="sheet-acts"><button class="btn" type="submit">Search</button><button class="btn ghost" type="button" data-close>Cancel</button></div></form>
    <ul class="wp-res" id="wpRes"></ul>`, (el) => {
    const f = el.querySelector("#wpForm"), res = el.querySelector("#wpRes");
    setTimeout(() => f.elements.q.focus({ preventScroll: true }), 350);
    f.onsubmit = async (e) => {
      e.preventDefault();
      const q = f.elements.q.value.trim();
      if (!q) return;
      put(res, html`<li class="muted">Searching…</li>`);
      try {
        const r = await getJSON("https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&accept-language=en&q=" + encodeURIComponent(q), 12000);
        put(res, r.length ? html`${r.map((x, i) => html`<li><button class="mini" type="button" data-i="${i}"><span class="what"><b>${String(x.display_name).split(",")[0]}</b><small>${String(x.display_name).split(",").slice(1, 4).join(",")}</small></span></button></li>`)}`
          : html`<li class="muted">Nothing found. Try a town name.</li>`);
        res.querySelectorAll("[data-i]").forEach((b) => { b.onclick = () => { const x = r[+b.dataset.i]; closeSheet(); addPlace(+x.lat, +x.lon, String(x.display_name).split(",")[0]); }; });
      } catch (err) { put(res, html`<li class="muted">The search didn't answer. Try again.</li>`); }
    };
  }, "Wind somewhere else");
}

// --- Edit: remove and reorder the spots of the place on screen (and remove a kept place) --------------------
function editSpots() {
  const P = place(), home = P.mode === "home";
  const list = () => (home ? homeSpots() : (places().find((x) => x.id === P.id) || { spots: [] }).spots);
  const saveOrder = (ids, removedId) => {
    if (home) {
      const h = Object.assign({ order: [], removed: [] }, S.settings.homeSpots || {});
      h.order = ids;
      if (removedId && !h.removed.includes(removedId)) h.removed = h.removed.concat([removedId]);
      S.settings = Object.assign({}, S.settings, { homeSpots: h }); save("settings");
      track({ homeSpots: h }); // the encrypted interests follow, so the morning alert does too
    } else {
      const all = places(), me = all.find((x) => x.id === P.id);
      if (!me) return;
      me.spots = ids.map((id) => me.spots.find((x) => x.id === id)).filter(Boolean);
      savePlaces(all);
    }
    reload();
  };
  const draw = () => {
    const L = list();
    openSheet(() => html`<h2 class="sheet-title" id="sheetTitle">Edit ${home ? "home spots" : P.name}</h2>
      <p class="lede">Move a spot up or down, or remove it (swipe left works too).${home ? " Home changes also reach the morning wind alert." : ""}</p>
      <ul class="edit-spots">${L.map((x, i) => html`<li data-id="${x.id}"><span class="es-name">${x.name}</span>
        <button class="ib" type="button" data-up="${i}" aria-label="Move ${x.name} up"${i === 0 ? " disabled" : ""}>↑</button>
        <button class="ib" type="button" data-down="${i}" aria-label="Move ${x.name} down"${i === L.length - 1 ? " disabled" : ""}>↓</button>
        <button class="ib hide" type="button" data-rm="${i}" aria-label="Remove ${x.name}">×</button></li>`)}</ul>
      ${home ? "" : html`<button class="linkbtn danger" type="button" data-rmplace>Remove ${P.name} from Wind</button>`}
      <div class="sheet-acts"><button class="btn ghost" type="button" data-close>Done</button></div>`, (el) => {
      const ids = L.map((x) => x.id);
      const move = (i, d) => { const j = i + d; [ids[i], ids[j]] = [ids[j], ids[i]]; saveOrder(ids); draw(); };
      el.querySelectorAll("[data-up]").forEach((b) => { b.onclick = () => move(+b.dataset.up, -1); });
      el.querySelectorAll("[data-down]").forEach((b) => { b.onclick = () => move(+b.dataset.down, 1); });
      const remove = (i, li) => {
        if (L.length <= 1) { say("Keep at least one spot" + (home ? "." : ", or remove the whole place.")); return; }
        li.hidden = true;
        const id = ids[i];
        undoable("Removed " + L[i].name + ".", () => { li.hidden = false; }, () => { saveOrder(ids.filter((x) => x !== id), id); });
      };
      el.querySelectorAll("[data-rm]").forEach((b) => { b.onclick = () => remove(+b.dataset.rm, b.closest("li")); });
      el.querySelectorAll(".edit-spots li").forEach((li, i) => swipeRow(li, () => {}, () => remove(i, li), ["", "Remove"]));
      const rp = el.querySelector("[data-rmplace]");
      if (rp) rp.onclick = () => {
        closeSheet();
        const keep = places();
        savePlaces(keep.filter((x) => x.id !== P.id)); select(null);
        undoable(P.name + " removed.", () => { savePlaces(keep); select(P.id); });
      };
    }, "Edit spots");
  };
  draw();
}

export function initWind() {
  paintPlace();
  const go = () => showTab("wind");
  $("todayWind").onclick = go;
  $("todayWind").onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } };
}
