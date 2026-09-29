"""Daily wind check for Radar. Opens the encrypted interests file (RADAR_KEY, via vault.mjs),
asks Open-Meteo for the next 3 days, and sends one push via ntfy.sh when a spot has a rideable
window. The ntfy topic is secret (anyone with it can read the alerts): it comes from the
NTFY_TOPIC environment variable, or else from interests "alerts.ntfy"."""
import json, math, os, subprocess, sys, urllib.request, urllib.parse, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
if not os.environ.get("RADAR_KEY"):
    sys.exit("RADAR_KEY is not set: add it as a GitHub Actions secret (Settings, Secrets and variables, Actions).")
out = subprocess.run(["node", os.path.join(HERE, "vault.mjs"), "show", "interests"], capture_output=True, text=True)
if out.returncode:
    sys.exit(out.stderr.strip() or "Couldn't open the encrypted interests file.")
cfg = json.loads(out.stdout)
TOPIC = os.environ.get("NTFY_TOPIC") or (cfg.get("alerts") or {}).get("ntfy")
if not TOPIC:
    sys.exit("No ntfy topic: set interests alerts.ntfy or the NTFY_TOPIC secret.")
W = cfg["wind"]; spots = W["spots"]
q = urllib.parse.urlencode({
    "latitude": ",".join(str(s["lat"]) for s in spots),
    "longitude": ",".join(str(s["lon"]) for s in spots),
    "hourly": "wind_speed_10m,wind_gusts_10m,wind_direction_10m",
    "wind_speed_unit": "kn", "timezone": "Europe/Amsterdam", "forecast_days": 3})
res = json.load(urllib.request.urlopen("https://api.open-meteo.com/v1/forecast?" + q, timeout=30))
if isinstance(res, dict): res = [res]
COMP = "N NNE NE ENE E ESE SE SSE S SSW SW WSW W WNW NW NNW".split()
def ok_dir(d, rs): return any(a <= d <= b for a, b in rs)
def cmean(ds):
    x = sum(math.cos(math.radians(d)) for d in ds); y = sum(math.sin(math.radians(d)) for d in ds)
    return (math.degrees(math.atan2(y, x)) + 360) % 360
now = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=1)))
lines = []
for spot, r in zip(spots, res):
    h = r["hourly"]; days = {}
    for i, t in enumerate(h["time"]):
        days.setdefault(t[:10], []).append((int(t[11:13]), h["wind_speed_10m"][i], h["wind_gusts_10m"][i], h["wind_direction_10m"][i]))
    for day, hrs in sorted(days.items()):
        light = [x for x in hrs if W["daylight"][0] <= x[0] < W["daylight"][1] and x[1] is not None]
        for key, s in W["sports"].items():
            best, cur = [], []
            for x in light + [(99, -1, 0, 0)]:
                if s["min"] <= x[1] <= s["max"] and ok_dir(x[3], spot["good"]): cur.append(x)
                else:
                    if len(cur) > len(best): best = cur
                    cur = []
            if len(best) >= W["minHours"]:
                kn = round(sum(x[1] for x in best) / len(best)); g = round(max(x[2] for x in best))
                d = COMP[round(cmean([x[3] for x in best]) / 22.5) % 16]
                name = datetime.date.fromisoformat(day).strftime("%a %d %b")
                lines.append(f"{name} · {spot['name']}: {s['label']} {best[0][0]:02d}–{best[-1][0]+1:02d}h, ~{kn} kn {d} (gusts {g})")
if not lines:
    print("No rideable windows in the next 3 days."); raise SystemExit
body = "\n".join(lines[:8]) + ("\n…and more" if len(lines) > 8 else "")
req = urllib.request.Request("https://ntfy.sh/" + TOPIC, data=body.encode(), headers={
    "Title": "Wind on: " + lines[0].split(":")[0], "Tags": "surfer", "Priority": "default",
    "Click": "https://almanac-dgf.pages.dev/radar/"})
urllib.request.urlopen(req, timeout=30)
print("Sent %d window(s)." % len(lines))  # the Actions log is public: don't print spots or times
