"""Windsurf trip scout for the daily task: the same rules as js/scout.js (Wind › Windsurf trips), for flight trips only.

Reads radar/trips.json (public destinations) and the wind ranges from radar/.plain/interests.json, asks Open-Meteo for
16 days, finds each spot's best 4-7 day window (at least 3 windsurf days, half the days or more, 14 °C or warmer by day)
and writes the top 3 by plane to radar/.plain/trips.json ({spot, name, air, out, back}) for Claude to look up live fares.
The Actions log is public: this prints a count only."""
import datetime, json, os, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
RADAR = os.path.dirname(HERE)
PLAIN = os.path.join(RADAR, ".plain")
MIN_TEMP = 14


def ok_dir(d, ranges):
    return any(r[0] <= d <= r[1] for r in ranges)


def main():
    spots = [s for s in json.load(open(os.path.join(RADAR, "trips.json")))["spots"] if s["by"] == "plane"]
    try:
        W = json.load(open(os.path.join(PLAIN, "interests.json")))["wind"]
    except (OSError, KeyError, ValueError):
        W = {"sports": {"windsurf": {"min": 20, "max": 30}}, "daylight": [8, 20], "minHours": 2}
    surf, light = W["sports"]["windsurf"], W["daylight"]
    need = max(3, W.get("minHours", 2))
    q = urllib.parse.urlencode({
        "latitude": ",".join(str(s["lat"]) for s in spots), "longitude": ",".join(str(s["lon"]) for s in spots),
        "hourly": "wind_speed_10m,wind_direction_10m", "daily": "temperature_2m_max", "wind_speed_unit": "kn",
        "timezone": "auto", "forecast_days": 16})
    with urllib.request.urlopen("https://api.open-meteo.com/v1/forecast?" + q, timeout=60) as r:
        res = json.loads(r.read())
    if not isinstance(res, list):
        res = [res]
    today = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=1))).date()
    found = []
    for sp, r in zip(spots, res):
        H, Dd = r.get("hourly") or {}, r.get("daily") or {}
        days = {}
        for i, t in enumerate(H.get("time") or []):
            if light[0] <= int(t[11:13]) < light[1]:
                days.setdefault(t[:10], []).append((H["wind_speed_10m"][i], H["wind_direction_10m"][i]))
        tmax = dict(zip(Dd.get("time") or [], Dd.get("temperature_2m_max") or []))
        good = {}
        for k, hrs in days.items():
            best = cur = 0
            for kn, d in hrs + [(-1, 0)]:
                if kn is not None and surf["min"] <= kn <= surf["max"] and ok_dir(d, sp["good"]):
                    cur += 1
                else:
                    best, cur = max(best, cur), 0
            good[k] = best >= need
        best = None
        for s in range(2, 13):
            start = today + datetime.timedelta(days=s)
            if sp.get("season") and start.month not in sp["season"]:
                continue
            for n in range(4, 8):
                ks = [str(start + datetime.timedelta(days=i)) for i in range(n)]
                if ks[-1] not in days:
                    break
                ride = sum(1 for k in ks if good.get(k))
                temps = [tmax[k] for k in ks if isinstance(tmax.get(k), (int, float))]
                if ride < 3 or ride / n < 0.5 or not temps or sum(temps) / len(temps) < MIN_TEMP:
                    continue
                temp = sum(temps) / len(temps)
                fare = sp["fare"][1 if start.month in sp.get("peak", []) else 0]
                score = ride * 25 + min(max(temp - MIN_TEMP, 0), 10) * 3 - fare / 12 - sp.get("hours", 0) * 2 - n * 4
                if not best or score > best[0]:
                    best = (score, {"spot": sp["id"], "name": sp["name"], "air": sp["air"], "out": ks[0], "back": ks[-1]})
        if best:
            found.append(best)
    found.sort(key=lambda x: -x[0])
    os.makedirs(PLAIN, exist_ok=True)
    json.dump([x[1] for x in found[:3]], open(os.path.join(PLAIN, "trips.json"), "w"), indent=1)
    print("trips: %d flight trips to check" % min(3, len(found)))


if __name__ == "__main__":
    main()
