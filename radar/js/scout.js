// Wind › Windsurf trips: scouts trips from the Netherlands that combine good wind, warmth (14 °C or more by day)
// and low travel costs. Destinations live in ../trips.json (public spot data with rough travel costs). The phone asks
// Open-Meteo for 16 days of hourly wind plus daily highs for all of them in one request (cached 3 hours), then finds:
//   - Weekends by car: the next two weekends (Saturday and Sunday ride, Friday to drive), spots up to 900 km away.
//   - 4–7 day trips by plane or car: the best window for each spot, starting the day after tomorrow at the earliest.
// Travel costs are estimates: fuel and tolls for the car, typical fares for a flight (trips.json). The daily Claude task
// runs tools/trips.py with the same rules and checks live fares for the top 3 flight trips (interests.fares); a live fare
// replaces the estimate when it matches the spot and dates. Swipe left hides a spot for two weeks (radar-scout-hidden).
// What leaves the phone: the destinations' public coordinates, to Open-Meteo. Nothing personal.
import { $, html, put, getJSON, mapUrl, safeUrl } from "./util.js";
import { get, set } from "./store.js";
import { D } from "./data.js";
import { openSheet, swipeRow, undoable } from "./ui.js";

const WX_KEY = "radar-scout-wx", HIDE_KEY = "radar-scout-hidden";
const MIN_TEMP = 14, WEEKEND_KM = 900, HIDE_DAYS = 14;
const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
const dirName = (x) => COMPASS[Math.round(x / 22.5) % 16];
const dirOK = (x, ranges) => ranges.some((r) => x >= r[0] && x <= r[1]);
const addDays = (k, n) => new Date(Date.parse(k + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const dow = (k) => new Date(k + "T12:00:00Z").getUTCDay();
const short = (k) => new Date(k + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const range = (a, b) => (a.slice(0, 7) === b.slice(0, 7)
  ? new Date(a + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", timeZone: "UTC" }) + " – " + short(b)
  : short(a) + " – " + short(b));
const euro = (n) => "€" + Math.round(n / 5) * 5;
const todayNL = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Amsterdam" }).format(new Date());

let SPOTS = null, FUEL = 0.13, last = null;

function hidden() {
  const h = get(HIDE_KEY, {}), now = Date.now(), out = {};
  Object.keys(h || {}).forEach((k) => { if (h[k] > now) out[k] = h[k]; });
  return out;
}

// One day at one spot: the longest windsurf run in daylight (local time there) with a good direction.
function dayInfo(spot, hourly, daily, W) {
  const days = {};
  (hourly.time || []).forEach((t, i) => {
    const k = t.slice(0, 10), h = +t.slice(11, 13);
    if (h < W.daylight[0] || h >= W.daylight[1]) return;
    (days[k] = days[k] || []).push({ kn: hourly.wind_speed_10m[i], d: hourly.wind_direction_10m[i] });
  });
  const tmax = {};
  (daily.time || []).forEach((k, i) => { tmax[k] = (daily.temperature_2m_max || [])[i]; });
  const need = Math.max(3, W.minHours || 2);
  const run = (s, hrs) => {
    let best = [], cur = [];
    hrs.concat([{ kn: -1 }]).forEach((x) => {
      if (x.kn != null && x.kn >= s.min && x.kn <= s.max && dirOK(x.d, spot.good)) cur.push(x);
      else { if (cur.length > best.length) best = cur; cur = []; }
    });
    return best.length >= need ? best : null;
  };
  const out = {};
  Object.keys(days).forEach((k) => {
    const hrs = days[k], surf = run(W.sports.windsurf, hrs), wing = surf ? null : run(W.sports.wing, hrs);
    const r = surf || wing, peak = hrs.reduce((m, x) => Math.max(m, x.kn || 0), 0);
    out[k] = { day: k, surf: !!surf, wing: !!wing, t: tmax[k],
      kn: r ? Math.round(r.reduce((a, x) => a + x.kn, 0) / r.length) : Math.round(peak),
      dir: r ? dirName(r[Math.floor(r.length / 2)].d) : "", hours: r ? r.length : 0 };
  });
  return out;
}

const month = (k) => +k.slice(5, 7);
function flies(spot, k) { return !spot.season || spot.season.includes(month(k)); }
function costOf(spot, out) {
  if (spot.by === "car") return { eur: spot.km * 2 * FUEL + (spot.toll || 0) * 2, how: "car", text: "fuel and tolls" };
  const peak = (spot.peak || []).includes(month(out));
  return { eur: spot.fare[peak ? 1 : 0], how: "plane", text: "typical return fare" };
}
function liveFare(spot, out) {
  const F = (D.config && D.config.fares) || {};
  if (!F.at || (Date.now() - Date.parse(F.at)) / 864e5 > 3) return null;
  return (F.items || []).find((x) => x && x.spot === spot.id && typeof x.price === "number" && x.out &&
    Math.abs(Date.parse(x.out) - Date.parse(out)) <= 864e5) || null;
}
const avg = (a) => a.reduce((s, x) => s + x, 0) / (a.length || 1);

function trip(spot, days, from, to, rideDays) {
  const list = [];
  for (let k = from; k <= to; k = addDays(k, 1)) if (days[k]) list.push(days[k]);
  const ride = rideDays ? list.filter((x) => rideDays.includes(x.day)) : list;
  const surf = ride.filter((x) => x.surf).length, wing = ride.filter((x) => x.wing).length;
  const temps = list.map((x) => x.t).filter((t) => typeof t === "number");
  const temp = temps.length ? avg(temps) : null;
  const cost = costOf(spot, from), live = cost.how === "plane" ? liveFare(spot, from) : null;
  const eur = live ? live.price : cost.eur;
  const good = list.filter((x) => x.surf);
  const score = surf * 25 + wing * 6 + Math.min(Math.max((temp || 0) - MIN_TEMP, 0), 10) * 3 - eur / 12 - (spot.hours || 0) * 2;
  return { spot, from, to, list, ride, surf, wing, temp, cost, live, eur, score,
    kn: good.length ? Math.round(avg(good.map((x) => x.kn))) : 0, dir: good.length ? good[0].dir : "" };
}

export function scoutTrips(res, W, today) {
  const hide = hidden(), weekends = [], weeks = [];
  // the next two weekends: Friday (drive) to Sunday; from today when it's already Friday to Sunday
  const fris = [];
  for (let i = 0; i < 16 && fris.length < 2; i++) {
    const k = addDays(today, i), wd = dow(k);
    if (wd === 5) fris.push(k);
    else if (i === 0 && (wd === 6 || wd === 0)) fris.push(addDays(k, wd === 6 ? -1 : -2));
  }
  SPOTS.forEach((spot, si) => {
    if (hide[spot.id]) return;
    const r = res[si] || {}, days = dayInfo(spot, r.hourly || {}, r.daily || {}, W);
    if (spot.by === "car" && spot.km <= WEEKEND_KM) {
      fris.forEach((fri) => {
        const sat = addDays(fri, 1), sun = addDays(fri, 2), ride = [sat, sun].filter((k) => k >= today);
        if (!ride.length || !ride.every((k) => days[k])) return;
        const t = trip(spot, days, fri < today ? today : fri, sun, ride);
        if (t.surf >= 1 && t.temp != null && t.temp >= MIN_TEMP) weekends.push(t);
      });
    }
    // 4–7 day trips starting the day after tomorrow at the earliest
    let best = null;
    for (let s = 2; s <= 12; s++) {
      const from = addDays(today, s);
      if (spot.by === "plane" && !flies(spot, from)) continue;
      for (let len = 4; len <= 7; len++) {
        const to = addDays(from, len - 1);
        if (!days[to]) break;
        const t = trip(spot, days, from, to);
        if (t.surf < 3 || t.surf / len < 0.5 || t.temp == null || t.temp < MIN_TEMP) continue;
        const v = t.score - len * 4; // prefer dense windows over long ones
        if (!best || v > best.v) best = Object.assign(t, { v, far: s + len - 1 > 8 });
      }
    }
    if (best) weeks.push(best);
  });
  weekends.sort((a, b) => b.score - a.score);
  weeks.sort((a, b) => b.score - a.score);
  return { weekends: weekends.slice(0, 3), weeks: weeks.slice(0, 5) };
}

// ---- drawing ----
function costLine(t) {
  if (t.live) return html`<b>${euro(t.live.price)}</b> return from ${t.live.from || "NL"}, checked ${short(String(t.live.at || D.config.fares.at).slice(0, 10))}`;
  return t.cost.how === "car" ? html`~${euro(t.eur)} ${t.cost.text} · ${t.spot.km} km` : html`~${euro(t.eur)} ${t.cost.text} to ${t.spot.air}`;
}
function rowHTML(t, i, kind) {
  const days = kind === "weekend" ? t.ride.length : t.list.length;
  return html`<article class="item trip" data-i="${String(i)}" data-k="${kind}" data-id="${t.spot.id}">
    <div class="meta"><span class="dot ${t.cost.how === "car" ? "k-trip-car" : "k-trip-air"}"></span><span>${t.cost.how === "car" ? "By car" : "By plane"}</span><span>${range(t.from, t.to)}</span>${t.far ? html`<span class="flag soft">Long range</span>` : ""}</div>
    <h3><button class="open" type="button" aria-haspopup="dialog">${t.spot.name}</button></h3>
    <div class="where">${t.spot.area}</div>
    <p class="trip-facts"><span class="tf-wind">${t.surf} of ${days} days windsurf${t.kn ? html`, ~${t.kn} kn ${t.dir}` : ""}</span>
      <span>${Math.round(t.temp)} °C</span><span>${costLine(t)}</span></p>
  </article>`;
}
function flightUrl(t) {
  return "https://www.google.com/travel/flights?q=" + encodeURIComponent("Flights from Amsterdam to " + t.spot.air + " on " + t.from + " through " + t.to);
}
function detail(t) {
  openSheet(() => html`<h2 class="sheet-title" id="sheetTitle">${t.spot.name}</h2>
    <p class="lede">${t.spot.area} · ${range(t.from, t.to)}</p>
    <ul class="trip-days">${t.list.map((x) => html`<li class="${x.surf ? "surf" : x.wing ? "wing" : ""}"><span>${short(x.day)}</span>
      <span>${x.surf ? "Windsurf" : x.wing ? "Wingfoil" : "Light"} ${x.kn} kn${x.dir ? " " + x.dir : ""}${x.hours ? html` · ${x.hours} h` : ""}</span>
      <span>${typeof x.t === "number" ? Math.round(x.t) + " °C" : ""}</span></li>`)}</ul>
    <p class="lede">${t.cost.how === "car"
      ? html`About ${euro(t.eur)} for fuel and tolls, there and back (${t.spot.km} km each way, ~${t.spot.hours} h).`
      : t.live ? html`${euro(t.live.price)} return from ${t.live.from || "a Dutch airport"}${t.live.airline ? " with " + t.live.airline : ""}, seen on a fare page in the daily check. Board bag or rental not included.`
        : html`A typical return fare to ${t.spot.air} is around ${euro(t.eur)} (an estimate, not a live price). Board bag or rental not included; about ${t.spot.hours} h door to door.`}</p>
    ${t.spot.note ? html`<p class="fine">${t.spot.note}.</p>` : ""}
    ${t.far ? html`<p class="fine">Part of this window is more than 8 days out, where forecasts are rough. Check again closer to the time.</p>` : ""}
    <div class="sheet-acts">${t.cost.how === "plane" ? html`<a class="btn" href="${(t.live && safeUrl(t.live.url)) || flightUrl(t)}" target="_blank" rel="noopener">Find flights</a>` : ""}
      <a class="btn ghost" href="${mapUrl(t.spot.lat, t.spot.lon)}" target="_blank" rel="noopener">Map</a></div>`, null, t.spot.name + " trip");
}

function draw() {
  const box = $("windTrips");
  if (!box || !last) return;
  const { weekends, weeks } = last, nh = Object.keys(hidden()).length;
  const sec = (title, list, kind, empty) => html`<h3 class="trip-h">${title}</h3>${list.length
    ? html`<div class="sheet trip-list" data-k="${kind}">${list.map((t, i) => rowHTML(t, i, kind))}</div>`
    : html`<p class="fine tight">${empty}</p>`}`;
  put(box, html`${sec("Weekends by car", weekends, "weekend", "No weekend by car with windsurf wind and 14 °C or more in the next two weekends.")}
    ${sec("4–7 days, by plane or car", weeks, "week", "No 4–7 day window with at least 3 windsurf days and 14 °C or more in the next two weeks.")}
    ${nh ? html`<button class="more small" type="button" id="tripUnhide">Show ${String(nh)} hidden ${nh === 1 ? "spot" : "spots"}</button>` : ""}`);
  box.querySelectorAll(".trip").forEach((el) => {
    const t = (el.dataset.k === "weekend" ? weekends : weeks)[+el.dataset.i];
    el.querySelector(".open").onclick = () => detail(t);
    swipeRow(el, () => detail(t), () => {
      const h = get(HIDE_KEY, {}), before = Object.assign({}, h);
      h[t.spot.id] = Date.now() + HIDE_DAYS * 864e5; set(HIDE_KEY, h); redo();
      undoable(t.spot.name + " hidden for two weeks", () => { set(HIDE_KEY, before); redo(); });
    }, ["Details", "Hide spot"]);
  });
  const u = $("tripUnhide");
  if (u) u.onclick = () => { const before = get(HIDE_KEY, {}); set(HIDE_KEY, {}); redo(); undoable("Hidden spots are back", () => { set(HIDE_KEY, before); redo(); }); };
}
let lastRes = null;
function redo() { if (lastRes) { last = scoutTrips(lastRes, D.config.wind, todayNL()); draw(); } }

export async function loadScout() {
  const box = $("windTrips");
  if (!box || !D.config || !D.config.wind) return;
  try {
    if (!SPOTS) { const j = await getJSON("trips.json", 15000); SPOTS = j.spots || []; FUEL = j.fuel || FUEL; }
  } catch (e) { put(box, html`<p class="fine tight">The trip list needs a connection the first time.</p>`); return; }
  const c = get(WX_KEY, null);
  let res = c && c.n === SPOTS.length && Date.now() - c.t < 3 * 36e5 ? c.res : null;
  if (!res) {
    if (!box.querySelector(".trip")) put(box, html`<p class="fine tight">Checking ${String(SPOTS.length)} windsurf spots…</p>`);
    const u = "https://api.open-meteo.com/v1/forecast?latitude=" + SPOTS.map((s) => s.lat).join(",") + "&longitude=" + SPOTS.map((s) => s.lon).join(",") +
      "&hourly=wind_speed_10m,wind_direction_10m&daily=temperature_2m_max&wind_speed_unit=kn&timezone=auto&forecast_days=16";
    try {
      res = await getJSON(u, 25000);
      if (!Array.isArray(res)) res = [res];
      set(WX_KEY, { t: Date.now(), n: SPOTS.length, res });
    } catch (e) {
      res = c && c.n === SPOTS.length ? c.res : null;
      if (!res) { put(box, html`<p class="fine tight">The trip scout needs a connection. Radar tries again when you're back online.</p>`); return; }
    }
  }
  lastRes = res; redo();
}
