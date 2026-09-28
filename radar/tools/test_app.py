"""Tests for Radar. Serves the repo locally, mocks every live API (Open-Meteo forecast and marine,
Overpass and its mirrors, Wikipedia, Nominatim, /api/note, the GitHub API, Google Fonts), and checks:

  - static: JSON files parse, JS modules pass `node --check`, safety check passes (radar + note.js)
  - every tab in light and dark at 390x844, no JS errors, no horizontal scroll at 320 px
  - welcome, wind ribbons + hourly chart + water temperature, filters, reactions notice,
    detail sheet + .ics, offline copy
  - notes: POST /api/note on the Cloudflare site, offline outbox that sends when back online,
    GitHub token fallback on github.io/localhost
  - Look around here: results grouped, Overpass down (Wikipedia still shows), location denied
  - Scout this city: instant city guide + the "I'm in <city>" note sent

    python3 radar/tools/test_app.py [screenshot-dir]

The Cloudflare site is simulated with the host name radar.localhost (Chromium maps *.localhost to
127.0.0.1 and treats it as a secure context), so the app takes its /api/note path; 127.0.0.1
stands in for github.io. Needs Playwright for Python.
Exits non-zero when something fails."""
import datetime, functools, glob, http.server, json, math, os, socketserver, subprocess, sys, tempfile, threading

from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = sys.argv[1] if len(sys.argv) > 1 else tempfile.mkdtemp(prefix="radar-test-")
os.makedirs(OUT, exist_ok=True)
JSONH = {"access-control-allow-origin": "*", "content-type": "application/json"}
CFG = json.load(open(os.path.join(ROOT, "radar", "interests.json")))
SPOTS = CFG["wind"]["spots"]
KYOTO = {"latitude": 35.0036, "longitude": 135.7785}
TABS = ("today", "wind", "explore", "work", "saved")

failures = []


def check(cond, msg):
    print(("ok   " if cond else "FAIL ") + msg)
    if not cond:
        failures.append(msg)


# --- Server ------------------------------------------------------------------------------------
def serve():
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    srv = socketserver.ThreadingTCPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=ROOT))
    srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, srv.server_address[1]


# --- Mock data -----------------------------------------------------------------------------------
def forecast():
    """Seven days of hourly wind per spot: calm, wingfoil, windsurf and offshore days."""
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
    days = [str(datetime.date.today() + datetime.timedelta(days=i)) for i in range(3)]
    return [{"daily": {"time": days, "sea_surface_temperature_max": [None, 15.4, 15.2] if i == 0 else [14.1] * 3}} for i, _ in enumerate(SPOTS)]


def osm(kind, name, lat, lon, **tags):
    t = {"name": name}
    t.update({k.replace("__", ":"): v for k, v in tags.items()})
    return {"type": kind, "id": abs(hash(name)) % 10 ** 8, "lat": lat, "lon": lon, "tags": t} if kind == "node" else \
        {"type": kind, "id": abs(hash(name)) % 10 ** 8, "center": {"lat": lat, "lon": lon}, "tags": t}


OVERPASS = {"elements": [
    osm("way", "Kyoto National Museum", 34.9899, 135.7732, tourism="museum", wikidata="Q1057393"),
    osm("node", "Gallery Nichinichi", 35.0060, 135.7760, tourism="gallery", website="https://example.org/nichinichi"),
    osm("node", "Wave form", 35.0071, 135.7790, tourism="artwork", artwork_type="sculpture"),
    osm("way", "Kennin-ji", 35.0005, 135.7736, amenity="place_of_worship", religion="buddhist", denomination="rinzai", wikidata="Q1136418"),
    osm("way", "Murin-an", 35.0117, 135.7883, leisure="garden", **{"garden__style": "japanese"}),
    osm("node", "Green leaf café", 35.0040, 135.7770, amenity="cafe", cuisine="coffee_shop", opening_hours="Tu-Su 09:00-17:00",
        **{"diet__vegan": "only", "diet__gluten_free": "yes"}),
    osm("node", "Hoshino noodle bar", 35.0080, 135.7700, amenity="restaurant", cuisine="noodle", **{"diet__vegetarian": "yes"}),
    osm("node", "Plain diner", 35.0081, 135.7701, amenity="restaurant"),
    osm("node", "Shogunzuka viewpoint", 35.0020, 135.7900, tourism="viewpoint"),
    osm("way", "Maruyama Park", 35.0037, 135.7810, leisure="park", wikidata="Q1066890"),
]}
WIKI = {"batchcomplete": True, "query": {"pages": [
    {"pageid": 1, "title": "Kyoto National Museum", "description": "Art museum in Kyoto, Japan", "coordinates": [{"lat": 34.9900, "lon": 135.7730}]},
    {"pageid": 2, "title": "Ryōan-ji", "description": "Zen temple in Kyoto, Japan", "coordinates": [{"lat": 35.0345, "lon": 135.7182}]},
    {"pageid": 3, "title": "Kamo River", "description": "River in Kyoto Prefecture, Japan", "coordinates": [{"lat": 35.0050, "lon": 135.7710}]},
    {"pageid": 4, "title": "Kyoto Station", "description": "Railway station in Kyoto, Japan", "coordinates": [{"lat": 34.9858, "lon": 135.7588}]},
    {"pageid": 5, "title": "Kyoto Tower", "description": "Observation tower in Kyoto, Japan", "coordinates": [{"lat": 34.9875, "lon": 135.7593}]},
    {"pageid": 6, "title": "Nanzen-ji", "description": "Buddhist temple in Kyoto, Japan", "coordinates": [{"lat": 35.0110, "lon": 135.7940}]},
    {"pageid": 7, "title": "Gion", "description": "District of Kyoto, Japan", "coordinates": [{"lat": 35.0037, "lon": 135.7750}]},
]}}
NOMINATIM = {"lat": "35.0116", "lon": "135.7681", "address": {"city": "Kyoto", "state": "Kyoto Prefecture", "country": "Japan"}}


class Mocks:
    """Routes every outside request of a page; records notes sent to /api/note and GitHub."""

    def __init__(self, page, overpass_up=True):
        self.notes, self.github, self.overpass_hits = [], [], []
        self.overpass_up = overpass_up
        r = page.route
        r("**/api.open-meteo.com/**", lambda x: x.fulfill(status=200, headers=JSONH, body=json.dumps(forecast())))
        r("**/marine-api.open-meteo.com/**", lambda x: x.fulfill(status=200, headers=JSONH, body=json.dumps(marine())))
        for host in ("overpass-api.de", "overpass.kumi.systems", "overpass.private.coffee"):
            r("**/%s/**" % host, self.overpass)
        r("**/en.wikipedia.org/**", lambda x: x.fulfill(status=200, headers=JSONH, body=json.dumps(WIKI)))
        r("**/nominatim.openstreetmap.org/**", lambda x: x.fulfill(status=200, headers=JSONH, body=json.dumps(NOMINATIM)))
        r("**/api/note", self.note)
        r("**/api.github.com/**", self.gh)
        r("**/fonts.googleapis.com/**", lambda x: x.fulfill(status=200, headers={"content-type": "text/css", "access-control-allow-origin": "*"}, body=""))
        r("**/fonts.gstatic.com/**", lambda x: x.abort())

    def overpass(self, route):
        self.overpass_hits.append(route.request.url.split("/")[2])
        if not self.overpass_up:
            return route.fulfill(status=504, headers=JSONH, body="{}")
        route.fulfill(status=200, headers=JSONH, body=json.dumps(OVERPASS))

    def note(self, route):
        if route.request.method != "POST":
            return route.fulfill(status=405, body="")
        self.notes.append(json.loads(route.request.post_data or "{}"))
        route.fulfill(status=201, headers=JSONH, body='{"ok":true}')

    def gh(self, route):
        req = route.request
        if req.method == "POST":
            self.github.append({"auth": req.headers.get("authorization"), "body": json.loads(req.post_data or "{}")})
            return route.fulfill(status=201, headers=JSONH, body="{}")
        route.fulfill(status=200, headers=JSONH, body='{"full_name":"x/Almanac"}')


# --- Static checks -----------------------------------------------------------------------------------
def static_checks():
    for f in ("feed.json", "taste.json", "interests.json", "manifest.webmanifest"):
        try:
            json.load(open(os.path.join(ROOT, "radar", f))); check(True, "%s is valid JSON" % f)
        except Exception as e:
            check(False, "%s is valid JSON (%s)" % (f, e))
    for f in sorted(glob.glob(os.path.join(ROOT, "radar", "js", "*.js"))):
        r = subprocess.run(["node", "--input-type=module", "--check"], stdin=open(f), capture_output=True, text=True)
        check(r.returncode == 0, "node --check %s %s" % (os.path.relpath(f, ROOT), r.stderr.strip()))
    r = subprocess.run(["node", "--check", os.path.join(ROOT, "radar", "sw.js")], capture_output=True, text=True)
    check(r.returncode == 0, "node --check radar/sw.js " + r.stderr.strip())
    idx = open(os.path.join(ROOT, "radar", "index.html")).read()
    check('var APP_VERSION="' in idx, "index.html carries the APP_VERSION line older copies look for")
    sw = open(os.path.join(ROOT, "radar", "sw.js")).read()
    missing = [os.path.relpath(f, os.path.join(ROOT, "radar")) for f in glob.glob(os.path.join(ROOT, "radar", "js", "*.js"))
               if '"%s"' % os.path.relpath(f, os.path.join(ROOT, "radar")) not in sw]
    check(not missing, "service worker precaches every module %s" % missing)
    safety = os.path.join(ROOT, "tools", "safety_check.py")
    files = sorted(glob.glob(os.path.join(ROOT, "radar", "*.html")) + glob.glob(os.path.join(ROOT, "radar", "*.css")) +
                   glob.glob(os.path.join(ROOT, "radar", "*.js")) + glob.glob(os.path.join(ROOT, "radar", "js", "*.js")) +
                   glob.glob(os.path.join(ROOT, "radar", "*.json")) + [os.path.join(ROOT, "functions", "api", "note.js")])
    r = subprocess.run([sys.executable, safety] + files, capture_output=True, text=True)
    check(r.returncode == 0 and "0 problem(s), 0 warning(s)" in r.stdout, "safety check: " + r.stdout.strip().splitlines()[-1])


# --- Browser helpers ------------------------------------------------------------------------------------
def new_page(browser, base, scheme="light", geo=True, welcomed=True, width=390, height=844):
    ctx = browser.new_context(viewport={"width": width, "height": height}, device_scale_factor=2, color_scheme=scheme,
                              service_workers="block", geolocation=KYOTO if geo else None,
                              permissions=["geolocation"] if geo else [], accept_downloads=True)
    if welcomed:
        ctx.add_init_script("try{localStorage.setItem('radar-welcomed','true')}catch(e){}")
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: m.type == "error" and errors.append(m.text))
    return ctx, page, errors


def real_errors(errors):
    return [e for e in errors if "net::ERR" not in e and "Failed to load resource" not in e]


def tab(page, name):
    page.click('.tab[data-v="%s"]' % name); page.wait_for_timeout(150)


def shot(page, name, full=True):
    page.screenshot(path=os.path.join(OUT, name), full_page=full)


# --- Suites -------------------------------------------------------------------------------------------------
def tabs_suite(browser, site, scheme):
    ctx, page, errors = new_page(browser, site, scheme, welcomed=False)
    m = Mocks(page)
    # Add freelance leads with deadlines so "Apply by" and deadline sorting are exercised.
    feed = json.load(open(os.path.join(ROOT, "radar", "feed.json")))
    soon, later = [str(datetime.date.today() + datetime.timedelta(days=n)) for n in (9, 40)]
    feed["items"] += [
        {"id": "test-freelance-later", "kind": "freelance", "region": "eu", "title": "Test lead, later deadline", "summary": "Paid review work.", "why": "test", "end": later, "found": "2026-09-20"},
        {"id": "test-freelance-soon", "kind": "freelance", "region": "nl", "title": "Test lead, deadline soon", "summary": "Paid advisory work.", "why": "test", "end": soon, "found": "2026-09-20"}]
    page.route("**/radar/feed.json*", lambda r: r.fulfill(status=200, headers=JSONH, body=json.dumps(feed)))
    page.goto(site); page.wait_for_selector("#welcome.show", timeout=5000)
    shot(page, "welcome-%s.png" % scheme, False)
    page.click("#wSkip"); page.reload(); page.wait_for_timeout(500)
    check(not page.is_visible("#welcome"), "%s: welcome stays away after skipping" % scheme)

    page.wait_for_selector("#todayWind .spot:not(.skel)", timeout=5000)
    check("Reading the wind" not in page.inner_text("#lead"), "%s: lead sentence filled" % scheme)
    check(page.locator("#top .item").count() == 4, "%s: 4 items in Worth your attention" % scheme)
    check("updated" in page.inner_text("#fresh"), "%s: freshness line shown" % scheme)
    check(page.locator("#todayWind .bar.wing").count() > 0 and page.locator("#todayWind .bar.off").count() > 0, "%s: ribbons show wingfoil and wrong-direction hours" % scheme)
    shot(page, "today-%s.png" % scheme)
    shot(page, "today-%s-top.png" % scheme, False)

    tab(page, "wind")
    check("°C" in page.inner_text("#windAll"), "%s: water temperature shown" % scheme)
    check("wetsuit" in page.inner_text("#windAll"), "%s: wetsuit hint shown" % scheme)
    page.locator("#windAll .spot").first.locator(".rday").nth(1).click(); page.wait_for_timeout(300)
    check(page.is_visible("#windAll .detail svg"), "%s: hourly chart opens" % scheme)
    shot(page, "wind-%s.png" % scheme, False)
    shot(page, "wind-%s-full.png" % scheme)

    tab(page, "explore")
    check(page.locator('#kinds .pill:has-text("Freelance")').count() == 0, "%s: work kinds live in Work, not Explore" % scheme)
    check(page.locator('#regions .pill:has-text("Japan")').count() == 1, "%s: Japan filter shows while the focus is Japan" % scheme)
    n_all = page.locator("#feed .item").count()
    page.click('#kinds .pill:has-text("Art")'); page.wait_for_timeout(150)
    check(0 < page.locator("#feed .item").count() < n_all + 1, "%s: Art filter narrows the feed" % scheme)
    page.click('#kinds .pill:has-text("Everything")'); page.wait_for_timeout(150)
    shot(page, "explore-%s.png" % scheme, False)

    tab(page, "work")
    check(page.locator("#workFeed .item").count() >= 1, "%s: Work tab lists opportunities" % scheme)
    page.click('#workKinds .pill:has-text("Freelance")'); page.wait_for_timeout(150)
    titles = page.locator("#workFeed .item h3").all_inner_texts()
    check(len(titles) >= 2 and titles[0] == "Test lead, deadline soon" and titles[1] == "Test lead, later deadline", "%s: Freelance sorted by deadline %s" % (scheme, titles[:2]))
    check("Apply by" in page.inner_text("#workFeed") and "days left" in page.inner_text("#workFeed"), "%s: Freelance shows Apply by and days left" % scheme)
    shot(page, "work-%s.png" % scheme, False)
    page.click('#workKinds .pill:has-text("Everything")')

    tab(page, "explore")
    page.locator("#feed [data-a=up]").first.click(); page.wait_for_timeout(350)
    check("show" in (page.get_attribute("#fbBar", "class") or ""), "%s: reaction pops the notice" % scheme)
    page.click("#fbClose"); page.wait_for_timeout(350)
    check("show" not in (page.get_attribute("#fbBar", "class") or ""), "%s: notice closes with x" % scheme)
    check(page.locator('.tab[data-v="saved"] .badge').count() == 1, "%s: Saved tab flags unsent reactions" % scheme)
    page.locator("#feed [data-a=up]").first.click(); page.wait_for_timeout(150)

    # Detail sheet with a dated item: calendar file, close by Escape and tap outside
    page.locator("#feed .item[data-cal] .open").first.click(); page.wait_for_selector("#sheet.show", timeout=3000); page.wait_for_timeout(450)
    check(page.locator("#sheetBody h2").count() == 1, "%s: detail sheet has a title" % scheme)
    check(page.locator("#sheetBody .react .ib").count() == 4, "%s: detail sheet has the four reaction buttons" % scheme)
    shot(page, "detail-%s.png" % scheme, False)
    page.click("#sheetBody [data-a=save]"); page.wait_for_timeout(150)
    check("Saved" in page.inner_text("#sheetBody .react"), "%s: saving from the sheet updates it" % scheme)
    with page.expect_download() as dl:
        page.click("#sheet [data-a=ics]")
    txt = open(dl.value.path()).read()
    check(txt.startswith("BEGIN:VCALENDAR") and "DTSTART;VALUE=DATE:" in txt and "END:VEVENT" in txt, "%s: .ics file is valid" % scheme)
    page.keyboard.press("Escape"); page.wait_for_timeout(400)
    check(not page.is_visible("#sheet .panel"), "%s: detail sheet closes with Escape" % scheme)
    page.locator("#feed .item .open").nth(1).click(); page.wait_for_timeout(450)
    page.mouse.click(195, 30); page.wait_for_timeout(400)
    check(not page.is_visible("#sheet .panel"), "%s: detail sheet closes on tap outside" % scheme)

    tab(page, "saved")
    check(page.locator("#savedList .item").count() == 1, "%s: saved item listed in Saved" % scheme)
    check(page.locator("#bucketList .bk").count() >= 1, "%s: bucket list shown" % scheme)
    check(page.locator("#learned li").count() >= 1, "%s: What Radar has learned shown" % scheme)
    check(page.is_hidden("#connBox"), "%s: GitHub connect hidden on the Cloudflare site" % scheme)
    check("Radar version" in page.inner_text("#appVersion"), "%s: version line in Saved" % scheme)
    shot(page, "saved-%s.png" % scheme, False)
    shot(page, "saved-%s-full.png" % scheme)

    page.set_viewport_size({"width": 320, "height": 640})
    for v in TABS:
        tab(page, v)
        w = page.evaluate("Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)")
        check(w <= 320, "%s: no horizontal scroll on %s at 320 px (%d)" % (scheme, v, w))
    tab(page, "today")
    shot(page, "today-%s-320.png" % scheme, False)
    page.set_viewport_size({"width": 390, "height": 844})

    # Offline: data and wind fail, cached copy shown and explained
    page.unroute("**/api.open-meteo.com/**"); page.route("**/api.open-meteo.com/**", lambda r: r.abort())
    page.route("**/radar/*.json*", lambda r: r.abort())
    page.click("#refresh"); page.wait_for_timeout(800)
    check("ffline" in page.inner_text("#fresh"), "%s: offline state explained" % scheme)
    check(page.locator("#todayWind .spot").count() == len(SPOTS), "%s: cached wind still shown offline" % scheme)
    check(not real_errors(errors), "%s: no JS errors %s" % (scheme, real_errors(errors)))
    ctx.close()


def around_suite(browser, site, scheme):
    ctx, page, errors = new_page(browser, site, scheme)
    m = Mocks(page)
    page.goto(site); page.wait_for_selector("#todayWind .spot:not(.skel)", timeout=5000)
    page.click("#nearBtn")
    page.wait_for_selector("#around .pgroup", timeout=8000); page.wait_for_timeout(400)
    groups = page.locator("#around .pgroup h4").all_inner_texts()
    check(groups[:1] == ["Art & museums"] and "Zen & quiet places" in groups and "Food that may suit you" in groups and "Nature & viewpoints" in groups,
          "%s: Around me groups results %s" % (scheme, groups))
    txt = page.inner_text("#around")
    check("Plain diner" not in txt, "%s: restaurants without diet tags are left out" % scheme)
    check("Kyoto Station" not in txt and "Gion" not in txt, "%s: stations and districts from Wikipedia are left out" % scheme)
    check(txt.count("Kyoto National Museum") == 1, "%s: OpenStreetMap and Wikipedia duplicates merged" % scheme)
    check("Check with staff" in txt, "%s: food group says check with staff" % scheme)
    check(" m" in page.inner_text("#around .pl-km >> nth=0") or " km" in page.inner_text("#around .pl-km >> nth=0"), "%s: distances shown" % scheme)
    check("OpenStreetMap" in txt and "Wikipedia" in txt, "%s: sources named" % scheme)
    page.locator("#around .sheet, .sheet.around").first.scroll_into_view_if_needed()
    page.locator(".sheet.around").screenshot(path=os.path.join(OUT, "around-%s.png" % scheme))
    page.evaluate("document.querySelector('.sheet.around').scrollIntoView({block:'start'})"); page.wait_for_timeout(150)
    shot(page, "around-%s-screen.png" % scheme, False)
    # place sheet with a map link
    page.locator('#around .place:has-text("Green leaf")').click(); page.wait_for_timeout(450)
    href = page.get_attribute('#sheetBody a:has-text("Open in Maps")', "href") or ""
    check(href.startswith("https://www.google.com/maps/search/?api=1&query=35.004"), "%s: place sheet has a map link" % scheme)
    check("check with staff" in page.inner_text("#sheetBody"), "%s: food place sheet says check with staff" % scheme)
    shot(page, "place-%s.png" % scheme, False)
    page.keyboard.press("Escape"); page.wait_for_timeout(350)
    check(not real_errors(errors), "%s: no JS errors in Around me %s" % (scheme, real_errors(errors)))
    ctx.close()


def overpass_down_suite(browser, site):
    ctx, page, errors = new_page(browser, site)
    m = Mocks(page, overpass_up=False)
    page.goto(site); page.wait_for_timeout(600)
    page.click("#nearBtn")
    page.wait_for_function("document.querySelector('#around') && /Wikipedia only/.test(document.querySelector('#around').innerText)", timeout=10000)
    check(sorted(set(m.overpass_hits)) == ["overpass-api.de", "overpass.kumi.systems", "overpass.private.coffee"], "Overpass down: all three mirrors tried %s" % m.overpass_hits)
    check(page.locator("#around .place").count() >= 3, "Overpass down: Wikipedia results still show")
    page.locator(".sheet.around").screenshot(path=os.path.join(OUT, "around-overpass-down.png"))
    check(not real_errors(errors), "Overpass down: no JS errors %s" % real_errors(errors))
    ctx.close()


def denied_suite(browser, site):
    ctx, page, errors = new_page(browser, site, geo=False)
    Mocks(page)
    page.goto(site); page.wait_for_timeout(600)
    page.click("#nearBtn")
    page.wait_for_selector("#around .astatus.err", timeout=8000)
    t = page.inner_text("#around")
    check("Location Services" in t and "Safari Websites" in t, "location denied: says where to turn it on")
    check(page.is_enabled("#nearBtn"), "location denied: buttons usable again")
    page.locator(".sheet.around").screenshot(path=os.path.join(OUT, "around-denied.png"))
    ctx.close()


def scout_suite(browser, site, scheme):
    ctx, page, errors = new_page(browser, site, scheme)
    m = Mocks(page)
    page.goto(site); page.wait_for_selector("#todayWind .spot:not(.skel)", timeout=5000)
    page.click("#hereBtn")
    page.wait_for_selector("#around .pgroup", timeout=8000)
    page.wait_for_function("/Claude is researching Kyoto/.test(document.querySelector('#around').innerText)", timeout=5000)
    page.wait_for_timeout(300)
    check(page.inner_text("#around h3") == "Kyoto, Japan", "%s: Scout names the city" % scheme)
    check(len(m.notes) == 1, "%s: Scout sends one note (%d)" % (scheme, len(m.notes)))
    if m.notes:
        n = m.notes[0]
        check(n.get("label") == "radar-location" and n.get("title", "").startswith("I'm in Kyoto, Japan until 20") and set(n) == {"title", "body", "label"},
              "%s: note is {title, body, label} with radar-location: %s" % (scheme, n.get("title")))
        fp = CFG["focus"]["place"].lower().strip()
        focus_here = fp in ("japan", "kyoto, japan") or fp.split(",")[0].strip() == "kyoto"
        check(not focus_here or CFG["focus"]["until"] in n["title"] or CFG["focus"]["until"] < str(datetime.date.today()), "%s: note uses the focus end date when scouting the focus city" % scheme)
    check("arrive within the hour" in page.inner_text("#around .scout"), "%s: guide says picks arrive within the hour" % scheme)
    check(page.locator("#around .place").count() >= 6, "%s: city guide lists places right away" % scheme)
    page.evaluate("document.querySelector('.sheet.around').scrollIntoView({block:'start'})"); page.wait_for_timeout(150)
    shot(page, "scout-%s-screen.png" % scheme, False)
    page.locator(".sheet.around").screenshot(path=os.path.join(OUT, "scout-%s.png" % scheme))
    # changing the date sends one correction; tapping again the same day does not resend
    page.fill("#scoutUntil", "2026-12-01"); page.dispatch_event("#scoutUntil", "change"); page.wait_for_timeout(500)
    check(len(m.notes) == 2 and m.notes[-1]["title"].endswith("until 2026-12-01"), "%s: changing the date sends an update" % scheme)
    page.click("#hereBtn"); page.wait_for_selector("#around .pgroup", timeout=8000); page.wait_for_timeout(600)
    check(len(m.notes) == 2, "%s: scouting the same city again doesn't resend" % scheme)
    check(not real_errors(errors), "%s: no JS errors in Scout %s" % (scheme, real_errors(errors)))
    ctx.close()


def notes_suite(browser, site, local):
    # Cloudflare site: add interest posts to /api/note
    ctx, page, errors = new_page(browser, site)
    m = Mocks(page)
    page.goto(site); page.wait_for_timeout(600)
    tab(page, "saved")
    page.click("#addBtn"); page.wait_for_selector("#sheet.show textarea"); page.wait_for_timeout(400)
    shot(page, "compose-light.png", False)
    page.fill("#sheetBody textarea", "Ólafur Arnalds concerts"); page.click('#sheetBody button[type=submit]'); page.wait_for_timeout(500)
    check(len(m.notes) == 1 and m.notes[0] == {"title": "Add interest: Ólafur Arnalds concerts", "body": "Please add to Radar: Ólafur Arnalds concerts", "label": "radar-interest"},
          "notes: Add an interest posts {title, body, label} to /api/note")
    # bucket wish
    page.click("#bucketBtn"); page.wait_for_selector("#sheet.show input"); page.wait_for_timeout(400)
    page.fill('#sheetBody input[name="t"]', "Walk the Kumano Kodo"); page.click('#sheetBody button[type=submit]'); page.wait_for_timeout(500)
    check(len(m.notes) == 2 and m.notes[1]["label"] == "radar-bucket", "notes: bucket wish posts radar-bucket")
    check("Walk the Kumano Kodo" in page.inner_text("#bucketList"), "notes: sent wish shows in the bucket list")
    # feedback
    tab(page, "explore"); page.locator("#feed [data-a=down]").first.click(); page.wait_for_timeout(200)
    tab(page, "saved"); page.click("#fbSend2"); page.wait_for_timeout(500)
    check(len(m.notes) == 3 and m.notes[2]["label"] == "radar-feedback" and "-1 |" in m.notes[2]["body"], "notes: reactions post radar-feedback")
    # offline: queued in the outbox, sent when back online
    ctx.set_offline(True)
    page.click("#addBtn"); page.wait_for_selector("#sheet.show textarea"); page.wait_for_timeout(400)
    page.fill("#sheetBody textarea", "Sauna in Den Haag"); page.click('#sheetBody button[type=submit]'); page.wait_for_timeout(400)
    box = page.evaluate("JSON.parse(localStorage.getItem('radar-outbox')||'[]')")
    check(len(box) == 1 and box[0]["labels"] == ["radar-interest"], "outbox: offline note kept on the phone")
    check(page.is_visible("#outboxLine"), "outbox: Saved says a note is waiting")
    ctx.set_offline(False); page.evaluate("window.dispatchEvent(new Event('online'))"); page.wait_for_timeout(800)
    box = page.evaluate("JSON.parse(localStorage.getItem('radar-outbox')||'[]')")
    check(not box and len(m.notes) == 4 and m.notes[3]["title"] == "Add interest: Sauna in Den Haag", "outbox: sent when back online")
    check(not real_errors(errors), "notes: no JS errors %s" % real_errors(errors))
    ctx.close()

    # github.io / localhost: waits for a token, then sends through the GitHub API
    ctx, page, errors = new_page(browser, local)
    m = Mocks(page)
    page.goto(local); page.wait_for_timeout(600)
    tab(page, "saved")
    check(page.is_visible("#connBox"), "github.io: Connect section shown")
    page.click("#addBtn"); page.wait_for_selector("#sheet.show textarea"); page.wait_for_timeout(400)
    page.fill("#sheetBody textarea", "Noguchi"); page.click('#sheetBody button[type=submit]'); page.wait_for_timeout(400)
    check(not m.notes and len(page.evaluate("JSON.parse(localStorage.getItem('radar-outbox')||'[]')")) == 1, "github.io: note waits without a token")
    page.click("#connOpen"); page.fill("#connKey", "test-token-not-real"); page.click("#connSave"); page.wait_for_timeout(800)
    check(len(m.github) == 1 and m.github[0]["auth"] == "Bearer test-token-not-real" and m.github[0]["body"]["labels"] == ["radar-interest"], "github.io: queued note sent with the phone's token")
    check(not real_errors(errors), "github.io: no JS errors %s" % real_errors(errors))
    ctx.close()


def run():
    static_checks()
    srv, port = serve()
    site = "http://radar.localhost:%d/radar/" % port
    local = "http://127.0.0.1:%d/radar/" % port
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for scheme in ("light", "dark"):
            tabs_suite(browser, site, scheme)
            around_suite(browser, site, scheme)
            scout_suite(browser, site, scheme)
        overpass_down_suite(browser, site)
        denied_suite(browser, site)
        notes_suite(browser, site, local)
        browser.close()
    srv.shutdown()
    print("\nScreenshots in " + OUT)
    if failures:
        print("%d check(s) failed" % len(failures)); sys.exit(1)
    print("All checks passed")


if __name__ == "__main__":
    run()
