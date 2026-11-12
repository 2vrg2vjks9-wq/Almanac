"""One place for Radar's pushes (ntfy.sh), used by wind_alert.py, remind.py and task.py.

The owner's Settings (interests.settings, from the phone):
- notify.<key> = False switches a kind of push off (wind, weekend, deadlines, work, concerts, daily, finds).
- alerts.level.<key> = "loud" | "normal" | "silent": ntfy priority 4 (high), 3 (default) or 2 (low: no sound).
- alerts.quiet = {"on": True, "from": 22, "to": 7}: a push sent in those hours (Amsterdam time) is scheduled by ntfy
  (`At` header) for the end of the quiet hours instead.
The topic comes from NTFY_TOPIC or interests alerts.ntfy. Nothing is printed: the Actions log is public."""
import datetime, os, urllib.request

try:
    from zoneinfo import ZoneInfo
    AMS = ZoneInfo("Europe/Amsterdam")
except Exception:  # very old Python: winter time all year
    AMS = datetime.timezone(datetime.timedelta(hours=1))

PRIORITY = {"loud": "4", "normal": "3", "silent": "2"}
APP = "https://almanac-dgf.pages.dev/radar/"


def _s(cfg):
    return (cfg or {}).get("settings") or {}


def on(cfg, key):
    return (_s(cfg).get("notify") or {}).get(key) is not False


def topic(cfg):
    return (os.environ.get("NTFY_TOPIC") or str(((cfg or {}).get("alerts") or {}).get("ntfy") or "")).strip()


def quiet_until(cfg, now=None):
    """Unix time the quiet hours end, when `now` falls inside them; else None."""
    q = (_s(cfg).get("alerts") or {}).get("quiet") or {}
    if not q.get("on"):
        return None
    try:
        a, b = int(q.get("from", 22)) % 24, int(q.get("to", 7)) % 24
    except (TypeError, ValueError):
        return None
    if a == b:
        return None
    now = now or datetime.datetime.now(AMS)
    h = now.hour
    inside = (a <= h or h < b) if a > b else (a <= h < b)
    if not inside:
        return None
    end = now.replace(hour=b, minute=0, second=0, microsecond=0)
    if end <= now:
        end += datetime.timedelta(days=1)
    return int(end.timestamp())


def headers(cfg, key, title, tags, click=APP, now=None):
    h = {"Title": title.encode("utf-8").decode("latin-1", "ignore"), "Tags": tags,
         "Priority": PRIORITY.get(((_s(cfg).get("alerts") or {}).get("level") or {}).get(key), "3")}
    if click:
        h["Click"] = click
    at = quiet_until(cfg, now)
    if at:
        h["At"] = str(at)
    return h


def send(cfg, key, title, body, tags, click=APP):
    """Push one message unless that kind is switched off; True when ntfy took it."""
    t = topic(cfg)
    if not t or not on(cfg, key):
        return False
    req = urllib.request.Request("https://ntfy.sh/" + t, data=body[:4000].encode(), method="POST",
                                 headers=headers(cfg, key, title, tags, click))
    try:
        urllib.request.urlopen(req, timeout=30)
        return True
    except Exception:
        return False
