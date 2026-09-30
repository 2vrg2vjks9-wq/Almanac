// Live wind for the spots in interests.json (Open-Meteo, no key), the wind ribbons,
// the hourly chart, water temperature with a wetsuit hint, and the Today lead sentence.
import { $, html, put, pad, stamp } from "./util.js";
import { get, set, KEYS } from "./store.js";
import { D } from "./data.js";
import { showTab } from "./ui.js";

export const net = { wind: null, windAt: null };
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
function paintWater() {
  document.querySelectorAll("#windAll .spot").forEach((el) => {
    const sp = D.config.wind.spots.find((x) => x.id === el.dataset.spot), w = el.querySelector(".water");
    if (sp && w) w.textContent = waterText(sp);
  });
}
async function loadWater() {
  const sp = D.config.wind.spots.filter(isSea);
  if (!sp.length) return;
  const u = "https://marine-api.open-meteo.com/v1/marine?latitude=" + sp.map((s) => s.lat).join(",") + "&longitude=" + sp.map((s) => s.lon).join(",") +
    "&daily=sea_surface_temperature_max&timezone=Europe%2FAmsterdam&forecast_days=3";
  try {
    const r = await fetch(u);
    if (!r.ok) throw new Error(r.status);
    let res = await r.json();
    if (!Array.isArray(res)) res = [res];
    const out = {};
    sp.forEach((s, i) => {
      const v = ((res[i] && res[i].daily && res[i].daily.sea_surface_temperature_max) || []).find((x) => x != null);
      if (typeof v === "number") out[s.id] = v;
    });
    WATER = out; set(KEYS.water, out);
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
      ? html`<button class="rday${good ? " good" : ""}" data-i="${i}" type="button" aria-expanded="false" aria-label="${label}">${inner}</button>`
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
      put(det, html`${chart(Dy, spot, W)}<div class="chart-key" aria-hidden="true"><span><i class="ln"></i>Wind</span><span><i class="ln dash"></i>Gusts</span><span><i class="arr"></i>Blowing toward</span></div><p><strong>${dayName(Dy.day, true)}.</strong> ${t.join(" ")} ${spot.note || ""}</p>`);
      det.hidden = false;
    };
  });
}

function drawWind(res, stale) {
  const W = D.config.wind, sessions = [];
  const all = W.spots.map((spot, si) => {
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

  sessions.sort((a, b) => (a.Dy.day < b.Dy.day ? -1 : a.Dy.day > b.Dy.day ? 1 : b.r.len - a.r.len));
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
  put($("todayWind"), html`${W.spots.map((sp) => row(sp, false))}`);
  put($("windAll"), html`${W.spots.map((sp) => row(sp, true))}`);
}

export async function loadWind() {
  const sp = D.config.wind.spots;
  const u = "https://api.open-meteo.com/v1/forecast?latitude=" + sp.map((s) => s.lat).join(",") + "&longitude=" + sp.map((s) => s.lon).join(",") +
    "&hourly=wind_speed_10m,wind_gusts_10m,wind_direction_10m&wind_speed_unit=kn&timezone=Europe%2FAmsterdam&forecast_days=7";
  loadWater();
  try {
    const r = await fetch(u);
    if (!r.ok) throw new Error(r.status);
    let res = await r.json();
    if (!Array.isArray(res)) res = [res];
    net.wind = "live"; net.windAt = Date.now();
    set(KEYS.wind, { t: net.windAt, res });
    drawWind(res, false);
  } catch (e) {
    const c = get(KEYS.wind, null);
    if (c) { net.wind = "cache"; net.windAt = c.t; drawWind(c.res, true); }
    else { net.wind = null; $("lead").textContent = "The forecast needs a connection."; $("leadSub").textContent = "Radar tries again when you're back online."; }
  }
}

export function initWind() {
  const go = () => showTab("wind");
  $("todayWind").onclick = go;
  $("todayWind").onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } };
}
