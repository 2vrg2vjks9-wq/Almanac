"""Smoke test for Radar. Serves the repo locally, mocks the live APIs (Open-Meteo forecast
and marine, Overpass, Nominatim, Google Fonts), opens every tab in light and dark at 390x844,
checks for JS errors and a few behaviours, and saves screenshots.

    python3 radar/tools/test_app.py [output-dir]

Needs Playwright for Python (pip install playwright; playwright install chromium).
Exits non-zero when something fails."""
import datetime, functools, glob, http.server, json, math, os, socketserver, subprocess, sys, tempfile, threading

from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = sys.argv[1] if len(sys.argv) > 1 else tempfile.mkdtemp(prefix="radar-test-")
os.makedirs(OUT, exist_ok=True)
CORS = {"access-control-allow-origin": "*", "content-type": "application/json"}
CFG = json.load(open(os.path.join(ROOT, "radar", "interests.json")))
SPOTS = CFG["wind"]["spots"]


def serve():
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass
    handler = functools.partial(Quiet, directory=ROOT)
    srv = socketserver.TCPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, "http://127.0.0.1:%d/radar/" % srv.server_address[1]


def forecast():
    """Seven days of hourly wind per spot: a calm day, a wingfoil day, a windsurf day, an offshore day."""
    start = datetime.date.today()
    out = []
    for si, _ in enumerate(SPOTS):
        t, kn, g, d = [], [], [], []
        for day in range(7):
            base = [4, 14, 24, 15, 8, 17, 33][(day + si) % 7]
            direction = 90 if day == 4 else 250
            for h in range(24):
                t.append("%sT%02d:00" % (start + datetime.timedelta(days=day), h))
                v = max(1, base + 4 * math.sin((h - 6) / 24 * 2 * math.pi))
                kn.append(round(v, 1)); g.append(round(v * 1.35, 1)); d.append(direction)
        out.append({"hourly": {"time": t, "wind_speed_10m": kn, "wind_gusts_10m": g, "wind_direction_10m": d}})
    return out


def marine():
    days = [str(datetime.date.today() + datetime.timedelta(days=i)) for i in range(7)]
    out = []
    for s in SPOTS:
        lake = "lake" in (s.get("sub", "") + s["name"]).lower() and s["id"] == "amstelmeer"
        out.append({"daily": {"time": days, "sea_surface_temperature_max": [None if lake else 15.4] * 7}})
    return out


def mock(page):
    page.route("**/api.open-meteo.com/**", lambda r: r.fulfill(status=200, headers=CORS, body=json.dumps(forecast())))
    page.route("**/marine-api.open-meteo.com/**", lambda r: r.fulfill(status=200, headers=CORS, body=json.dumps(marine())))
    page.route("**/overpass-api.de/**", lambda r: r.fulfill(status=200, headers=CORS, body=json.dumps({"elements": [
        {"type": "node", "lat": 52.08, "lon": 4.31, "tags": {"tourism": "museum", "name": "Test museum"}}]})))
    page.route("**/nominatim.openstreetmap.org/**", lambda r: r.fulfill(status=200, headers=CORS, body=json.dumps({"address": {"city": "Test city", "country": "Netherlands"}})))
    page.route("**/fonts.googleapis.com/**", lambda r: r.fulfill(status=200, headers={"content-type": "text/css", "access-control-allow-origin": "*"}, body=""))
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())


failures = []


def check(cond, msg):
    print(("ok   " if cond else "FAIL ") + msg)
    if not cond:
        failures.append(msg)


def static_checks():
    for f in ("feed.json", "taste.json", "interests.json"):
        try:
            json.load(open(os.path.join(ROOT, "radar", f))); check(True, "%s is valid JSON" % f)
        except Exception as e:
            check(False, "%s is valid JSON (%s)" % (f, e))
    safety = os.path.join(ROOT, "tools", "safety_check.py")
    if os.path.exists(safety):
        files = sorted(glob.glob(os.path.join(ROOT, "radar", "*.html")) + glob.glob(os.path.join(ROOT, "radar", "*.js")) + glob.glob(os.path.join(ROOT, "radar", "*.json")))
        r = subprocess.run([sys.executable, safety] + files, capture_output=True, text=True)
        check(r.returncode == 0, "repo safety check passes" + ("" if r.returncode == 0 else "\n" + r.stdout + r.stderr))


def run():
    static_checks()
    srv, base = serve()
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for scheme in ("light", "dark"):
            ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2,
                                      color_scheme=scheme, service_workers="block")
            page = ctx.new_page(); errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.on("console", lambda m: m.type == "error" and errors.append(m.text))
            mock(page)

            # First run shows the welcome, once.
            page.goto(base); page.wait_for_selector("#welcome.show", timeout=5000)
            page.screenshot(path=os.path.join(OUT, "welcome-%s.png" % scheme))
            page.click("#wSkip"); page.reload(); page.wait_for_timeout(600)
            check(not page.is_visible("#welcome"), "%s: welcome stays away after skipping" % scheme)

            page.wait_for_selector("#todayWind .spot", timeout=5000)
            check("Reading the wind" not in page.inner_text("#lead"), "%s: lead sentence filled" % scheme)
            check(page.locator("#top .item").count() <= 4, "%s: at most 4 items in Worth your attention" % scheme)
            check("updated" in page.inner_text("#fresh"), "%s: freshness line shown" % scheme)
            page.screenshot(path=os.path.join(OUT, "today-%s.png" % scheme), full_page=True)

            page.click('.tab[data-v="wind"]'); page.wait_for_timeout(200)
            check("°C" in page.inner_text("#windAll"), "%s: water temperature shown" % scheme)
            page.locator("#windAll .spot").first.locator(".rday").nth(1).click(); page.wait_for_timeout(300)
            check(page.is_visible("#windAll .detail.open svg"), "%s: hourly chart opens" % scheme)
            page.screenshot(path=os.path.join(OUT, "wind-%s.png" % scheme), full_page=True)

            page.click('.tab[data-v="explore"]'); page.wait_for_timeout(200)
            page.screenshot(path=os.path.join(OUT, "explore-%s.png" % scheme), full_page=True)
            check(page.locator('#kinds .pill:has-text("Freelance")').count() == 0, "%s: work kinds live in Work, not Explore" % scheme)

            # Work tab: work and freelance items, freelance filter
            page.click('.tab[data-v="work"]'); page.wait_for_timeout(200)
            check(page.locator("#workFeed .item").count() >= 1, "%s: Work tab lists opportunities" % scheme)
            page.click('#workKinds .pill:has-text("Freelance")'); page.wait_for_timeout(200)
            check(page.locator("#workFeed .item").count() >= 1, "%s: Freelance filter shows items" % scheme)
            page.screenshot(path=os.path.join(OUT, "work-freelance-%s.png" % scheme), full_page=True)
            page.click('#workKinds .pill:has-text("Everything")'); page.wait_for_timeout(200)
            page.click('.tab[data-v="explore"]'); page.wait_for_timeout(200)

            # Reactions notice pops up, closes with x, and the send button lives in Saved
            page.locator("#feed [data-a=up]").first.click(); page.wait_for_timeout(400)
            check("show" in (page.get_attribute("#fbBar", "class") or ""), "%s: reaction pops the notice" % scheme)
            page.click("#fbClose"); page.wait_for_timeout(400)
            check("show" not in (page.get_attribute("#fbBar", "class") or ""), "%s: notice closes with x" % scheme)
            check(page.locator('.tab[data-v="saved"] .badge').count() == 1, "%s: Saved tab flags unsent reactions" % scheme)
            page.locator("#feed [data-a=up]").first.click(); page.wait_for_timeout(200)  # undo, keeps later checks clean

            # Item detail sheet
            page.locator("#feed .item .open").first.click(); page.wait_for_selector("#sheet.show", timeout=3000)
            page.wait_for_timeout(400)
            check(page.locator("#sheetBody h2").count() == 1, "%s: detail sheet has a title" % scheme)
            page.screenshot(path=os.path.join(OUT, "detail-%s.png" % scheme))
            page.keyboard.press("Escape"); page.wait_for_timeout(400)
            check(not page.is_visible("#sheet .panel"), "%s: detail sheet closes with Escape" % scheme)
            # an item with a start date offers a calendar file
            ok = page.evaluate("""() => { var it = document.querySelector('#feed .item[data-cal]'); if (!it) return 'none';
                 it.querySelector('.open').click(); var b = document.querySelector('#sheet [data-a=ics]'); return b ? 'yes' : 'no' }""")
            check(ok == "yes", "%s: Add to calendar offered for dated items" % scheme)
            if ok == "yes":
                with page.expect_download() as dl:
                    page.click("#sheet [data-a=ics]")
                txt = open(dl.value.path()).read()
                check(txt.startswith("BEGIN:VCALENDAR") and "DTSTART;VALUE=DATE:" in txt, "%s: .ics file is valid" % scheme)
            page.mouse.click(195, 40); page.wait_for_timeout(400)
            check(not page.is_visible("#sheet .panel"), "%s: detail sheet closes on tap outside" % scheme)

            page.click('.tab[data-v="saved"]'); page.wait_for_timeout(200)
            page.screenshot(path=os.path.join(OUT, "saved-%s.png" % scheme), full_page=True)

            # Narrow screens: no horizontal scroll at 320 px on any tab
            page.set_viewport_size({"width": 320, "height": 640})
            for v in ("today", "wind", "explore", "work", "saved"):
                page.click('.tab[data-v="%s"]' % v); page.wait_for_timeout(100)
                w = page.evaluate("document.documentElement.scrollWidth")
                check(w <= 320, "%s: no horizontal scroll on %s at 320 px (%d)" % (scheme, v, w))
            page.set_viewport_size({"width": 390, "height": 844})

            # Offline: APIs fail, cached copy is used and the app says so
            page.click('.tab[data-v="today"]')
            page.unroute("**/api.open-meteo.com/**"); page.route("**/api.open-meteo.com/**", lambda r: r.abort())
            page.route("**/radar/*.json*", lambda r: r.abort())
            page.click("#refresh"); page.wait_for_timeout(800)
            check("ffline" in page.inner_text("#fresh"), "%s: offline state explained" % scheme)
            check(page.locator("#todayWind .spot").count() == len(SPOTS), "%s: cached wind still shown offline" % scheme)

            real = [e for e in errors if "net::ERR_FAILED" not in e and "Failed to load resource" not in e]
            check(not real, "%s: no JS errors %s" % (scheme, real))
            ctx.close()
        browser.close()
    srv.shutdown()
    print("\nScreenshots in " + OUT)
    if failures:
        print("%d check(s) failed" % len(failures)); sys.exit(1)


if __name__ == "__main__":
    run()
