"""Radar's morning reminders, without Claude (so they cost nothing). Runs after the wind alert.

- Deadlines: for every Work lead the owner marked "interested" on the phone (interests.tracked, applied by
  task.py apply), one push 3 days and one push 1 day before its deadline. Stateless: it pushes on those exact days.
- Weekend planner (Thursdays): rideable wind windows for Saturday and Sunday plus the best things to do that
  weekend from the Do list (Den Haag first), in one push.

Each can be switched off in Radar's Settings (interests.settings.notify.deadlines / .weekend).
The Actions log is public: it prints counts only."""
import datetime, json, math, os, subprocess, sys, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
AMS = datetime.timezone(datetime.timedelta(hours=1))
APP = "https://almanac-dgf.pages.dev/radar/"


def show(name):
    r = subprocess.run(["node", os.path.join(HERE, "vault.mjs"), "show", name], capture_output=True, text=True)
    if r.returncode:
        sys.exit("Couldn't open the encrypted %s file." % name)
    return json.loads(r.stdout)


def push(topic, title, body, tags):
    req = urllib.request.Request("https://ntfy.sh/" + topic, data=body.encode(), method="POST", headers={
        "Title": title.encode("utf-8").decode("latin-1", "ignore"), "Tags": tags, "Click": APP})
    urllib.request.urlopen(req, timeout=30)


def on(cfg, key):
    return ((cfg.get("settings") or {}).get("notify") or {}).get(key) is not False


def deadlines(cfg, today):
    out = []
    for lead in (cfg.get("tracked") or {}).values():
        if not isinstance(lead, dict) or lead.get("state") != "interested":
            continue
        try:
            d = datetime.date.fromisoformat(str(lead.get("deadline") or "")[:10])
        except ValueError:
            continue
        left = (d - today).days
        if left in (3, 1):
            out.append((left, d, lead))
    return sorted(out, key=lambda x: x[1])


# ---- weekend wind (same rules as wind_alert.py) ----
COMP = "N NNE NE ENE E ESE SE SSE S SSW SW WSW W WNW NW NNW".split()


def windows(cfg, days):
    W = cfg.get("wind") or {}
    spots = W.get("spots") or []
    if not spots:
        return []
    q = urllib.parse.urlencode({
        "latitude": ",".join(str(s["lat"]) for s in spots), "longitude": ",".join(str(s["lon"]) for s in spots),
        "hourly": "wind_speed_10m,wind_gusts_10m,wind_direction_10m", "wind_speed_unit": "kn",
        "timezone": "Europe/Amsterdam", "forecast_days": 5})
    res = json.load(urllib.request.urlopen("https://api.open-meteo.com/v1/forecast?" + q, timeout=30))
    if isinstance(res, dict):
        res = [res]
    out = []
    for spot, r in zip(spots, res):
        h = r["hourly"]
        byday = {}
        for i, t in enumerate(h["time"]):
            if t[:10] in days:
                byday.setdefault(t[:10], []).append((int(t[11:13]), h["wind_speed_10m"][i], h["wind_gusts_10m"][i], h["wind_direction_10m"][i]))
        for day, hrs in byday.items():
            light = [x for x in hrs if W["daylight"][0] <= x[0] < W["daylight"][1] and x[1] is not None]
            for s in W["sports"].values():
                best, cur = [], []
                for x in light + [(99, -1, 0, 0)]:
                    if s["min"] <= x[1] <= s["max"] and any(a <= x[3] <= b for a, b in spot["good"]):
                        cur.append(x)
                    else:
                        if len(cur) > len(best):
                            best = cur
                        cur = []
                if len(best) >= W.get("minHours", 2):
                    kn = round(sum(x[1] for x in best) / len(best))
                    xs = sum(math.cos(math.radians(x[3])) for x in best); ys = sum(math.sin(math.radians(x[3])) for x in best)
                    d = COMP[round(((math.degrees(math.atan2(ys, xs)) + 360) % 360) / 22.5) % 16]
                    out.append((day, best[0][0], "%s %s %02d–%02dh ~%d kn %s" % (
                        spot["name"], s.get("label", ""), best[0][0], best[-1][0] + 1, kn, d)))
    return sorted(out)


def weekend_things(things, sat, sun):
    picks = []
    for x in (things.get("ideas") or []):
        if not isinstance(x, dict) or not x.get("title"):
            continue
        a = str(x.get("start") or "")[:10]; b = str(x.get("end") or a)[:10]
        if not a or not (a <= sun.isoformat() and b >= sat.isoformat()):
            continue
        home = 0 if str(x.get("city", "")).lower() in ("den haag", "the hague", "scheveningen") else 1
        picks.append((home, -int(x.get("fit") or 3), x))
    picks.sort(key=lambda p: (p[0], p[1]))
    return [p[2] for p in picks[:3]]


def main():
    cfg = show("interests")
    topic = os.environ.get("NTFY_TOPIC") or (cfg.get("alerts") or {}).get("ntfy")
    if not topic:
        sys.exit("No ntfy topic.")
    today = datetime.datetime.now(AMS).date()
    sent = 0
    if on(cfg, "deadlines"):
        for left, d, lead in deadlines(cfg, today):
            body = "%s%s\nApply by %s." % (lead.get("title", "A lead you marked"), (" · " + lead["org"]) if lead.get("org") else "",
                                            d.strftime("%a %d %b"))
            push(topic, "Deadline %s" % ("tomorrow" if left == 1 else "in 3 days"), body, "briefcase")
            sent += 1
    if on(cfg, "weekend") and today.weekday() == 3:  # Thursday
        sat = today + datetime.timedelta(days=2); sun = today + datetime.timedelta(days=3)
        try:
            wind = windows(cfg, {sat.isoformat(), sun.isoformat()})
        except Exception:
            wind = []
        try:
            things = weekend_things(show("things"), sat, sun)
        except SystemExit:
            things = []
        lines = []
        for day, _, w in wind[:4]:
            lines.append(("Sat" if day == sat.isoformat() else "Sun") + " · " + w)
        if not wind:
            lines.append("No rideable wind forecast yet.")
        for x in things:
            lines.append("· " + x["title"] + (" (" + x["city"] + ")" if x.get("city") else ""))
        push(topic, "Your weekend", "\n".join(lines), "calendar")
        sent += 1
    print("Sent %d reminder(s)." % sent)  # the Actions log is public: counts only


if __name__ == "__main__":
    if not (os.environ.get("RADAR_KEY") or os.environ.get("PK")):
        sys.exit("RADAR_KEY (or PK) is not set.")
    main()
