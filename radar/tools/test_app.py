"""Tests for Radar. Builds a throwaway copy of the site with made-up data encrypted under a test
passphrase (never the owner's data or key), serves it, mocks every live API (Open-Meteo forecast and
marine, Overpass and its mirrors, Wikipedia, Nominatim, /api/note, /api/key, the GitHub API, Google
Fonts), and checks:

  - static: JSON files parse, no plain data files in radar/, data files are encrypted, JS modules pass
    `node --check`, safety check passes (radar + functions)
  - vault: lock screen, wrong and right passphrase, lock again; notes leave the phone sealed
  - Do: decide yes/no/later, yes list, filters, Hague-first rule (far ideas need a high fit)
  - every tab in light and dark at 390x844, no JS errors, no horizontal scroll at 320 px
  - welcome, wind ribbons + hourly chart + water temperature, filters, reactions notice,
    detail sheet + .ics, offline copy
  - notes: POST /api/note on the Cloudflare site, offline outbox that sends when back online,
    GitHub token fallback on github.io/localhost
  - Look around here: results grouped, Overpass down (Wikipedia still shows), location denied
  - Look around away from home: Whole city guide, offer to ask Claude, note sent only on tap; at home no offer

    python3 radar/tools/test_app.py [screenshot-dir]

The Cloudflare site is simulated with the host name radar.localhost (Chromium maps *.localhost to
127.0.0.1 and treats it as a secure context), so the app takes its /api/note path; 127.0.0.1
stands in for github.io. Needs Playwright for Python.
Exits non-zero when something fails."""
import base64, datetime, functools, glob, hashlib, http.server, json, math, os, shutil, socketserver, subprocess, sys, tempfile, threading

from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = sys.argv[1] if len(sys.argv) > 1 else tempfile.mkdtemp(prefix="radar-test-")
os.makedirs(OUT, exist_ok=True)
JSONH = {"access-control-allow-origin": "*", "content-type": "application/json"}
KYOTO = {"latitude": 35.0036, "longitude": 135.7785}
TABS = ("today", "do", "wind", "explore", "saved")
DAY = lambda n: str(datetime.date.today() + datetime.timedelta(days=n))


# --- Made-up data (the real data stays encrypted and is never read by the tests) ------------------
def fixtures():
    spots = [
        {"id": "beach", "name": "Test beach", "sub": "North Sea", "lat": 52.11, "lon": 4.28, "good": [[200, 360], [0, 20]], "note": "Test spot."},
        {"id": "lake", "name": "Test lake", "sub": "South beach, lake", "lat": 51.92, "lon": 4.07, "good": [[225, 360], [0, 90]]},
        {"id": "inland", "name": "Inland lake", "sub": "Lake", "lat": 52.89, "lon": 4.91, "good": [[0, 360]], "water": False},
    ]
    interests = {
        "home": "Netherlands",
        "wind": {"sports": {"wing": {"label": "Wingfoil", "min": 10, "max": 20}, "windsurf": {"label": "Windsurf", "min": 20, "max": 30}},
                 "daylight": [8, 20], "minHours": 2, "spots": spots},
        "museums": {"watch": ["Kyoto National Museum"]}, "culture": {"people": ["Isamu Noguchi"]},
        "focus": {"place": "Kyoto, Japan", "until": DAY(10), "since": DAY(-2)},
        "bucketlist": [{"id": "aurora", "title": "See the northern lights", "good_time": "dark skies", "where": "north", "added": DAY(-5)}],
        "alerts": {"ntfy": "radar-test-topic"},
    }
    it = lambda **k: dict({"region": "nl", "place": "", "city": "", "start": None, "end": None, "summary": "A test item.", "why": "test", "url": "https://example.org/", "found": DAY(-10)}, **k)
    feed = {"updated": DAY(0) + "T07:00:00+02:00", "note": "test", "items": [
        it(id="ex-1", kind="exhibition", title="Stone garden show", city="Den Haag", start=DAY(-20), end=DAY(5), lat=52.08, lon=4.31),
        it(id="ex-2", kind="exhibition", title="Light and space", city="Rotterdam", start=DAY(3), end=DAY(60), found=DAY(0)),
        it(id="co-1", kind="concert", title="Quiet band live", city="Utrecht", start=DAY(12)),
        it(id="re-1", kind="restaurant", title="Test kitchen", city="Den Haag", flags=["check oats"]),
        it(id="st-1", kind="story", title="A new short story collection", region="all", pick=True),
        it(id="me-1", kind="meditation", title="Silent Saturday", city="Den Haag", start=DAY(4)),
        it(id="jp-1", kind="exhibition", title="Kyoto garden show", region="jp", city="Kyoto", start=DAY(-3), end=DAY(20)),
        it(id="bk-1", kind="bucket", bucket="aurora", title="Aurora window", region="eu", why="Bucket list: See the northern lights"),
        it(id="wk-1", kind="work", title="Adaptation finance forum", region="eu", start=DAY(30)),
        it(id="test-freelance-later", kind="freelance", region="eu", title="Test lead, later deadline", end=DAY(40)),
        it(id="test-freelance-soon", kind="freelance", title="Test lead, deadline soon", end=DAY(9)),
    ]}
    taste = {"updated": DAY(-1), "learned": ["Likes quiet art."], "more": ["garden"], "less": ["crowds"]}
    idea = lambda **k: dict({"summary": "A test idea.", "why": "test", "url": "https://example.org/", "found": DAY(-5), "fit": 3}, **k)
    things = {"updated": DAY(0) + "T07:00:00+02:00", "note": "test", "ideas": [
        idea(id="do-garden", cat="calm", title="Moss garden open days", city="Den Haag", start=DAY(2), end=DAY(12), lat=52.09, lon=4.33, fit=5, major=True),
        idea(id="do-dance", cat="stage", title="Dance premiere", city="Den Haag", start=DAY(5), lat=52.077, lon=4.317, fit=4),
        idea(id="do-gig", cat="music", title="Small gig in a church", city="Den Haag", start=DAY(1), fit=2),
        idea(id="do-walk", cat="outdoors", title="Dawn in the dunes", city="Wassenaar", when="Any clear morning", fit=4, fresh=True),
        idea(id="do-kusama", cat="art", title="Infinity rooms retrospective", city="Amsterdam", start=DAY(-10), end=DAY(90), lat=52.358, lon=4.88, fit=5, travel="About 50 min by train"),
        idea(id="do-dance-ams", cat="music", title="Big dance festival", city="Amsterdam", start=DAY(20), end=DAY(24), lat=52.37, lon=4.9, fit=3),
        idea(id="do-utrecht", cat="festival", title="Adventurous music festival", city="Utrecht", start=DAY(35), end=DAY(38), lat=52.09, lon=5.11, fit=4),
        idea(id="do-past", cat="art", title="Closed show", city="Den Haag", start=DAY(-30), end=DAY(-1), fit=5),
    ]}
    return {"interests": interests, "feed": feed, "taste": taste, "things": things}


FIX = fixtures()
CFG = FIX["interests"]
SPOTS = CFG["wind"]["spots"]
SITE = None   # temp copy of the repo, built by build_site()
PASS = None   # test passphrase
KEYB64 = None # derived key, as the app stores it


def build_site():
    """Copy radar/ and functions/ into a temp dir and encrypt the made-up data there with a fresh test passphrase."""
    global SITE, PASS, KEYB64
    SITE = tempfile.mkdtemp(prefix="radar-site-")
    shutil.copytree(os.path.join(ROOT, "radar"), os.path.join(SITE, "radar"), ignore=shutil.ignore_patterns(".plain", "data", "vault.json", "__pycache__"))
    shutil.copytree(os.path.join(ROOT, "functions"), os.path.join(SITE, "functions"))
    tool = os.path.join(SITE, "radar", "tools", "vault.mjs")
    env = dict(os.environ); env.pop("RADAR_KEY", None)
    PASS = subprocess.run(["node", tool, "init"], capture_output=True, text=True, env=env, check=True).stdout.strip()
    plain = os.path.join(SITE, "radar", ".plain"); os.makedirs(plain)
    for n, v in FIX.items():
        json.dump(v, open(os.path.join(plain, n + ".json"), "w"))
    env["RADAR_KEY"] = PASS
    subprocess.run(["node", tool, "lock"], capture_output=True, text=True, env=env, check=True)
    shutil.rmtree(plain)
    meta = json.load(open(os.path.join(SITE, "radar", "vault.json")))
    KEYB64 = base64.b64encode(hashlib.pbkdf2_hmac("sha256", PASS.encode(), base64.b64decode(meta["salt"]), meta["iter"], 32)).decode()


def unseal(body):
    """Open a sealed note the way the Claude tasks do."""
    env = dict(os.environ, RADAR_KEY=PASS)
    return subprocess.run(["node", os.path.join(SITE, "radar", "tools", "vault.mjs"), "open", body], capture_output=True, text=True, env=env).stdout

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
    srv = socketserver.ThreadingTCPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=SITE))
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
        r("**/api/key", lambda x: x.fulfill(status=404, headers=JSONH, body='{"error":"not set up"}'))
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
    for f in ["vault.json", "manifest.webmanifest"] + ["data/%s.enc.json" % n for n in ("interests", "feed", "taste", "things")]:
        try:
            j = json.load(open(os.path.join(ROOT, "radar", f))); check(True, "%s is valid JSON" % f)
            if f.startswith("data/"):
                check(set(j) == {"v", "iv", "ct"}, "%s holds only ciphertext" % f)
        except Exception as e:
            check(False, "%s is valid JSON (%s)" % (f, e))
    plain = [f for f in ("interests.json", "feed.json", "taste.json", "things.json") if os.path.exists(os.path.join(ROOT, "radar", f))]
    check(not plain, "no plain data files in radar/ %s" % plain)
    ign = subprocess.run(["git", "-C", ROOT, "check-ignore", "-q", "radar/.plain/feed.json"]).returncode
    check(ign == 0, "radar/.plain/ is git-ignored")
    for f in sorted(glob.glob(os.path.join(ROOT, "radar", "js", "*.js"))):
        r = subprocess.run(["node", "--input-type=module", "--check"], stdin=open(f), capture_output=True, text=True)
        check(r.returncode == 0, "node --check %s %s" % (os.path.relpath(f, ROOT), r.stderr.strip()))
    for f in [os.path.join(ROOT, "radar", "tools", "vault.mjs")] + glob.glob(os.path.join(ROOT, "functions", "api", "*.js")):
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
                   glob.glob(os.path.join(ROOT, "radar", "*.json")) + glob.glob(os.path.join(ROOT, "functions", "api", "*.js")))
    r = subprocess.run([sys.executable, safety] + files, capture_output=True, text=True)
    check(r.returncode == 0 and "0 problem(s), 0 warning(s)" in r.stdout, "safety check: " + r.stdout.strip().splitlines()[-1])


# --- Browser helpers ------------------------------------------------------------------------------------
def new_page(browser, base, scheme="light", geo=True, welcomed=True, width=390, height=844, unlocked=True, coords=None):
    ctx = browser.new_context(viewport={"width": width, "height": height}, device_scale_factor=2, color_scheme=scheme,
                              service_workers="block", geolocation=(coords or KYOTO) if geo else None,
                              permissions=["geolocation"] if geo else [], accept_downloads=True)
    if welcomed:
        ctx.add_init_script("try{localStorage.setItem('radar-welcomed','true')}catch(e){}")
    if unlocked:
        ctx.add_init_script("try{if(!sessionStorage.getItem('t-keyed')){localStorage.setItem('radar-key',JSON.stringify('%s'));sessionStorage.setItem('t-keyed','1')}}catch(e){}" % KEYB64)
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
    page.goto(site); page.wait_for_selector("#welcome.show", timeout=5000)
    shot(page, "welcome-%s.png" % scheme, False)
    page.click("#wSkip"); page.reload(); page.wait_for_timeout(500)
    check(not page.is_visible("#welcome"), "%s: welcome stays away after skipping" % scheme)

    page.wait_for_selector("#todayWind .spot:not(.skel)", timeout=5000)
    check("Reading the wind" not in page.inner_text("#lead"), "%s: lead sentence filled" % scheme)
    check(page.locator("#top .item").count() == 4, "%s: 4 items in Worth your attention" % scheme)
    check("updated" in page.inner_text("#fresh"), "%s: freshness line shown" % scheme)
    check(page.locator("#todayWind .bar.wing").count() > 0 and page.locator("#todayWind .bar.off").count() > 0, "%s: ribbons show wingfoil and wrong-direction hours" % scheme)
    check(page.locator("#todayDo .mini").count() >= 2 and "Moss garden" in page.inner_text("#todayDo"), "%s: Today lists what's coming up in Den Haag" % scheme)
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
    check(page.locator('.tab[data-v="saved"] .badge').count() == 1, "%s: You tab flags unsent reactions" % scheme)
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
    check("Radar version" in page.inner_text("#appVersion"), "%s: version line in You" % scheme)
    check("radar-test-topic" in page.inner_text("#alertLine"), "%s: wind alert topic shown from the encrypted interests" % scheme)
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
    page.route("**/radar/data/*", lambda r: r.abort())
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
    check(page.locator("#hereBtn").count() == 0, "%s: one Look around button, no separate Scout" % scheme)
    page.click("#nearBtn")
    page.wait_for_selector("#around .pgroup", timeout=8000)
    page.wait_for_selector("#scoutGo", timeout=5000); page.wait_for_timeout(300)
    check(len(m.notes) == 0, "%s: away from home Radar offers to ask Claude but sends nothing by itself" % scheme)
    check("You're in Kyoto" in page.inner_text("#around .scout"), "%s: the offer names the city" % scheme)
    page.click("#aCity"); page.wait_for_function("document.querySelector('#around h3') && document.querySelector('#around h3').innerText == 'Kyoto, Japan'", timeout=8000)
    page.wait_for_selector("#around .pgroup", timeout=8000); page.wait_for_timeout(300)
    check(page.locator("#around .place").count() >= 6, "%s: Whole city lists places right away" % scheme)
    check(len(m.notes) == 0, "%s: switching to Whole city sends nothing" % scheme)
    page.evaluate("document.querySelector('.sheet.around').scrollIntoView({block:'start'})"); page.wait_for_timeout(150)
    shot(page, "scout-%s-screen.png" % scheme, False)
    page.click("#scoutGo")
    page.wait_for_function("/Claude is researching Kyoto/.test(document.querySelector('#around').innerText)", timeout=5000)
    check(len(m.notes) == 1, "%s: asking Claude sends one note (%d)" % (scheme, len(m.notes)))
    if m.notes:
        n = m.notes[0]
        check(n.get("label") == "radar-location" and n.get("title") == "Radar note" and set(n) == {"title", "body", "label"},
              "%s: note is {title, body, label} with radar-location and a generic title: %s" % (scheme, n.get("title")))
        check(n["body"].startswith("radar-sealed:v1:") and "Kyoto" not in n["body"], "%s: the location note is sealed" % scheme)
        t = unseal(n["body"]).split("\n")[0].replace("Title: ", "")
        check(t.startswith("I'm in Kyoto, Japan until 20") and CFG["focus"]["until"] in t, "%s: sealed note names the city and the focus end date: %s" % (scheme, t))
    check("arrive within the hour" in page.inner_text("#around .scout"), "%s: says picks arrive within the hour" % scheme)
    page.locator(".sheet.around").screenshot(path=os.path.join(OUT, "scout-%s.png" % scheme))
    # changing the date sends one correction; looking again the same day does not resend
    page.fill("#scoutUntil", "2026-12-01"); page.dispatch_event("#scoutUntil", "change"); page.wait_for_timeout(500)
    check(len(m.notes) == 2 and "until 2026-12-01" in unseal(m.notes[-1]["body"]).split("\n")[0], "%s: changing the date sends an update" % scheme)
    page.click("#aNear"); page.wait_for_selector("#around .pgroup", timeout=8000); page.wait_for_timeout(600)
    check(len(m.notes) == 2 and "Claude is researching Kyoto" in page.inner_text("#around"), "%s: looking again the same day doesn't resend" % scheme)
    check(not real_errors(errors), "%s: no JS errors in Look around away %s" % (scheme, real_errors(errors)))
    ctx.close()


def home_suite(browser, site):
    ctx, page, errors = new_page(browser, site, coords={"latitude": 52.0805, "longitude": 4.3120})
    m = Mocks(page)
    nomi = []
    page.route("**/nominatim.openstreetmap.org/**", lambda r: (nomi.append(1), r.fulfill(status=200, headers=JSONH, body=json.dumps(NOMINATIM))))
    page.goto(site); page.wait_for_selector("#todayWind .spot:not(.skel)", timeout=5000)
    page.click("#nearBtn"); page.wait_for_function("document.querySelector('#around .astatus') && !/Finding|Asking/.test(document.querySelector('#around .astatus').innerText)", timeout=8000)
    check(page.locator("#around .scout").count() == 0 and not nomi and not m.notes, "at home: no offer, no city lookup, nothing sent")
    check(not real_errors(errors), "at home: no JS errors %s" % real_errors(errors))
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
    check(len(m.notes) == 1 and m.notes[0]["label"] == "radar-interest" and m.notes[0]["title"] == "Radar note" and "Arnalds" not in json.dumps(m.notes[0]),
          "notes: Add an interest posts a sealed {title, body, label} to /api/note")
    check(m.notes and unseal(m.notes[0]["body"]).strip() == "Title: Add interest: Ólafur Arnalds concerts\n\nPlease add to Radar: Ólafur Arnalds concerts",
          "notes: the sealed note opens to the full text")
    # bucket wish
    page.click("#bucketBtn"); page.wait_for_selector("#sheet.show input"); page.wait_for_timeout(400)
    page.fill('#sheetBody input[name="t"]', "Walk the Kumano Kodo"); page.click('#sheetBody button[type=submit]'); page.wait_for_timeout(500)
    check(len(m.notes) == 2 and m.notes[1]["label"] == "radar-bucket", "notes: bucket wish posts radar-bucket")
    check("Walk the Kumano Kodo" in page.inner_text("#bucketList"), "notes: sent wish shows in the bucket list")
    # feedback
    tab(page, "explore"); page.locator("#feed [data-a=down]").first.click(); page.wait_for_timeout(200)
    tab(page, "saved"); page.click("#fbSend2"); page.wait_for_timeout(500)
    check(len(m.notes) == 3 and m.notes[2]["label"] == "radar-feedback" and "-1 |" in unseal(m.notes[2]["body"]), "notes: reactions post radar-feedback")
    # offline: queued in the outbox, sent when back online
    ctx.set_offline(True)
    page.click("#addBtn"); page.wait_for_selector("#sheet.show textarea"); page.wait_for_timeout(400)
    page.fill("#sheetBody textarea", "Sauna in Den Haag"); page.click('#sheetBody button[type=submit]'); page.wait_for_timeout(400)
    box = page.evaluate("JSON.parse(localStorage.getItem('radar-outbox')||'[]')")
    check(len(box) == 1 and box[0]["labels"] == ["radar-interest"], "outbox: offline note kept on the phone")
    check(page.is_visible("#outboxLine"), "outbox: Saved says a note is waiting")
    ctx.set_offline(False); page.evaluate("window.dispatchEvent(new Event('online'))"); page.wait_for_timeout(800)
    box = page.evaluate("JSON.parse(localStorage.getItem('radar-outbox')||'[]')")
    check(not box and len(m.notes) == 4 and "Add interest: Sauna in Den Haag" in unseal(m.notes[3]["body"]), "outbox: sent when back online")
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
    check(m.github and "Noguchi" not in json.dumps(m.github[0]["body"]) and "Noguchi" in unseal(m.github[0]["body"]["body"]), "github.io: the note is sealed")
    check(not real_errors(errors), "github.io: no JS errors %s" % real_errors(errors))
    ctx.close()


def lock_suite(browser, site, scheme):
    ctx, page, errors = new_page(browser, site, scheme, unlocked=False)
    Mocks(page)
    page.goto(site); page.wait_for_selector("#lock.show", timeout=5000)
    shot(page, "lock-%s.png" % scheme, False)
    check(page.locator("#todayWind .spot").count() == 0, "%s: nothing is shown while locked" % scheme)
    page.fill("#lockPass", "wrong-pass-word"); page.click("#lockGo")
    page.wait_for_function("/isn't the Radar passphrase/.test(document.querySelector('#lockMsg').textContent)", timeout=8000)
    check(page.is_visible("#lock"), "%s: a wrong passphrase keeps Radar locked" % scheme)
    page.fill("#lockPass", " " + PASS.upper() + " "); page.click("#lockGo")
    page.wait_for_selector("#todayWind .spot:not(.skel)", timeout=10000)
    check(not page.is_visible("#lock"), "%s: the right passphrase unlocks (spaces and capitals forgiven)" % scheme)
    stored = page.evaluate("JSON.parse(localStorage.getItem('radar-key'))")
    check(stored == KEYB64 and PASS not in json.dumps(page.evaluate("Object.assign({}, localStorage)")), "%s: the phone keeps the derived key, not the passphrase" % scheme)
    page.reload(); page.wait_for_selector("#todayWind .spot:not(.skel)", timeout=8000)
    check(not page.is_visible("#lock"), "%s: stays unlocked after a reload" % scheme)
    tab(page, "saved"); page.click("#lockBtn"); page.wait_for_selector("#lock.show", timeout=5000)
    left = page.evaluate("[localStorage.getItem('radar-key'), localStorage.getItem('radar-cache')]")
    check(left == [None, None], "%s: Lock removes the key and the decrypted copy" % scheme)
    check(not real_errors(errors), "%s: no JS errors in the lock flow %s" % (scheme, real_errors(errors)))
    ctx.close()


def server_key_suite(browser, site):
    ctx, page, errors = new_page(browser, site, unlocked=False)
    Mocks(page)
    page.route("**/api/key", lambda r: r.fulfill(status=200, headers=JSONH, body=json.dumps({"key": PASS})))
    page.goto(site); page.wait_for_selector("#todayWind .spot:not(.skel)", timeout=10000)
    check(not page.is_visible("#lock"), "Cloudflare: /api/key unlocks without typing")
    check(not real_errors(errors), "Cloudflare key: no JS errors %s" % real_errors(errors))
    ctx.close()


def do_suite(browser, site, scheme):
    ctx, page, errors = new_page(browser, site, scheme)
    m = Mocks(page)
    page.goto(site); page.wait_for_selector("#todayWind .spot:not(.skel)", timeout=5000)
    tab(page, "do")
    check(page.locator(".tab[data-v=do] .count").count() == 1, "%s: Do tab shows how many ideas wait" % scheme)
    all_text = page.inner_text("#v-do")
    check("Big dance festival" not in all_text, "%s: far idea with a low fit stays out (Hague first)" % scheme)
    check("Infinity rooms retrospective" in all_text, "%s: far idea with a high fit shows" % scheme)
    check("Closed show" not in all_text, "%s: past ideas stay out" % scheme)
    first = page.inner_text("#decide .dcard h3")
    check(first == "Moss garden open days", "%s: the strongest Hague idea comes first (%s)" % (scheme, first))
    shot(page, "do-%s.png" % scheme, False)
    shot(page, "do-%s-full.png" % scheme)
    page.click("#decide .yes"); page.wait_for_timeout(500)
    check(page.inner_text("#decide .dcard h3") != first, "%s: yes moves to the next idea" % scheme)
    check("Moss garden open days" in page.inner_text("#doPlan"), "%s: yes lands on the yes list" % scheme)
    nxt = page.inner_text("#decide .dcard h3")
    page.click("#decide .no"); page.wait_for_timeout(500)
    later = page.inner_text("#decide .dcard h3")
    page.click("#decide .dlater"); page.wait_for_timeout(300)
    check(page.inner_text("#decide .dcard h3") != later, "%s: later moves an idea to the back" % scheme)
    check(nxt not in page.inner_text("#doAll"), "%s: no hides the idea from the list" % scheme)
    page.click("#doNoBtn"); page.wait_for_timeout(150)
    check(nxt in page.inner_text("#doAll"), "%s: said-no ideas can be shown again" % scheme)
    page.click("#doNoBtn")
    # yes/no in a list row saves the answer without opening the idea
    row = page.locator('#doAll .idea:has-text("Dawn in the dunes")')
    row.locator(".vote.y").click(); page.wait_for_timeout(300)
    check(not page.is_visible("#sheet .panel"), "%s: yes in a list row doesn't open the idea" % scheme)
    check("Dawn in the dunes" in page.inner_text("#doPlan"), "%s: yes in a list row saves it" % scheme)
    page.locator('#doAll .idea:has-text("Dawn in the dunes") .vote.y').click(); page.wait_for_timeout(200)
    page.locator('#doAll .idea:has-text("Dawn in the dunes") .where').click(force=True); page.wait_for_timeout(450)
    check(page.is_visible("#sheet .panel"), "%s: tapping the row itself opens the idea" % scheme)
    page.keyboard.press("Escape"); page.wait_for_timeout(350)
    page.click('#doCity .pill:has-text("Amsterdam")'); page.wait_for_timeout(150)
    check(page.locator("#doAll .idea").count() == 1, "%s: city filter" % scheme)
    pills = page.locator("#doCity .pill").all_inner_texts()
    check(pills == ["All", "Den Haag", "Amsterdam", "Utrecht"], "%s: city filters come from the ideas, nearest first %s" % (scheme, pills))
    page.click('#doCity .pill:has-text("All")')
    page.click('#doWhen .pill:has-text("Always on")'); page.wait_for_timeout(150)
    check(page.locator("#doAll .idea").count() == 1 and "Dawn in the dunes" in page.inner_text("#doAll"), "%s: Always on shows undated ideas" % scheme)
    page.click('#doWhen .pill:has-text("Anytime")'); page.wait_for_timeout(150)
    # idea sheet with calendar
    page.locator('#doAll .idea:has-text("Infinity rooms") .open').click(); page.wait_for_selector("#sheet.show", timeout=3000); page.wait_for_timeout(400)
    check("Where" in page.inner_text("#sheetBody .facts") or "Date" in page.inner_text("#sheetBody .facts"), "%s: idea sheet shows facts" % scheme)
    with page.expect_download() as dl:
        page.click("#sheet [data-a=ics]")
    check(open(dl.value.path()).read().startswith("BEGIN:VCALENDAR"), "%s: idea goes to the calendar" % scheme)
    page.click("#sheetBody .vote.y"); page.wait_for_timeout(200)
    check("On my list" in page.inner_text("#sheetBody .react"), "%s: yes from the sheet updates it" % scheme)
    page.keyboard.press("Escape"); page.wait_for_timeout(350)
    check(page.locator("#doPlan .idea").count() == 2, "%s: yes list holds both" % scheme)
    # answers teach Claude, sealed
    tab(page, "saved")
    check(page.is_visible("#teachBox") and "answer" in page.inner_text("#teachText"), "%s: Do answers wait to teach Radar" % scheme)
    page.click("#fbSend2"); page.wait_for_timeout(600)
    body = unseal(m.notes[-1]["body"]) if m.notes else ""
    check(m.notes and m.notes[-1]["label"] == "radar-feedback" and "yes | do:calm | Moss garden open days" in body and "no | do:" in body, "%s: yes/no answers reach Claude sealed" % scheme)
    page.set_viewport_size({"width": 320, "height": 640}); tab(page, "do")
    w = page.evaluate("Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)")
    check(w <= 320, "%s: no horizontal scroll on Do at 320 px (%d)" % (scheme, w))
    shot(page, "do-%s-320.png" % scheme, False)
    check(not real_errors(errors), "%s: no JS errors in Do %s" % (scheme, real_errors(errors)))
    ctx.close()


def run():
    static_checks()
    build_site()
    srv, port = serve()
    site = "http://radar.localhost:%d/radar/" % port
    local = "http://127.0.0.1:%d/radar/" % port
    with sync_playwright() as p:
        try:
            browser = p.chromium.launch()
        except Exception:  # Playwright's own browser missing: use the preinstalled Chromium
            browser = p.chromium.launch(executable_path=os.environ.get("CHROMIUM_PATH", "/opt/pw-browsers/chromium"))
        for scheme in ("light", "dark"):
            lock_suite(browser, site, scheme)
            do_suite(browser, site, scheme)
            tabs_suite(browser, site, scheme)
            around_suite(browser, site, scheme)
            scout_suite(browser, site, scheme)
        overpass_down_suite(browser, site)
        denied_suite(browser, site)
        home_suite(browser, site)
        notes_suite(browser, site, local)
        server_key_suite(browser, site)
        browser.close()
    srv.shutdown()
    shutil.rmtree(SITE, ignore_errors=True)
    print("\nScreenshots in " + OUT)
    if failures:
        print("%d check(s) failed" % len(failures)); sys.exit(1)
    print("All checks passed")


if __name__ == "__main__":
    run()
