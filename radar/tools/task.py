#!/usr/bin/env python3
"""Runs the parts of a Radar task that need the passphrase or GitHub, so Claude never gets either.

Used by .github/workflows/radar-tasks.yml around a Claude Code run (Claude edits radar/.plain/ only):

  python3 radar/tools/task.py prepare <task>   unlock the vault into radar/.plain/, put the open notes for
                                               this task in radar/.plain/notes.json (opened), write the
                                               task's instructions to $RUNNER_TEMP/prompt.txt and its model
                                               and run=true|false to $GITHUB_OUTPUT
  python3 radar/tools/task.py finish <task>    if Claude succeeded: validate, encrypt and commit
                                               radar/data/*.enc.json, close the handled notes with "Done.",
                                               send the final message to the phone (ntfy); always wipe radar/.plain/

Tasks and their instructions live encrypted in the vault (tasks.enc.json). Needs PK (or RADAR_KEY) and
GITHUB_TOKEN; finish also reads $RUNNER_TEMP/out.json (claude --output-format json).
The Actions log of this public repo is world-readable: this script prints counts and fixed words only.
"""
import base64, datetime, glob, hashlib, json, os, re, shutil, subprocess, sys, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
VAULT = os.path.join(ROOT, "radar", "tools", "vault.mjs")
PLAIN = os.path.join(ROOT, "radar", ".plain")
TMP = os.environ.get("RUNNER_TEMP") or "/tmp"
REPO = os.environ.get("GITHUB_REPOSITORY", "2vrg2vjks9-wq/Almanac")
DATA = ["interests", "feed", "taste", "things", "gear"]  # what a task may change (not "tasks")
SPEND = os.path.join(ROOT, "radar", "spend.json")  # API spend per month (amounts only, nothing personal)

# Low-cost mode (the owner's limit: about 5 euro a month on the API key). Haiku is cheap per token, so the
# real cost is web searches (1 cent each): every task gets a search allowance, a hard cap per run
# (claude --max-budget-usd) and a monthly budget paced over the month, so the total can't pass BUDGET.
# With the subscription token (CLAUDE_CODE_OAUTH_TOKEN) nothing is billed per use: the task's own model
# is used and the budget guard is off.
BUDGET = float(os.environ.get("RADAR_BUDGET_USD") or 5.0)
CHEAP = "claude-haiku-5-5"
LOW = {  # task: (cap per run in USD, web searches allowed; 0 = WebSearch switched off)
    "daily": (0.14, 7),
    "inbox": (0.08, 4),
    "finds": (0.06, 0),
    "concerts": (0.06, 4),
    "work": (0.10, 5),
    "bucket": (0.08, 4),
}
STATUS = os.path.join(ROOT, "radar", "status.json")  # public run status for the app (dates, outcomes, spend; nothing personal)
# When the month's money runs low, these give way first, so the daily refresh and the work search keep running:
# a low-priority run only goes ahead while it leaves RESERVE of the paced budget for the others.
LOW_PRIORITY = {"finds", "concerts", "inbox"}
RESERVE = 0.25
SWITCHABLE = {"finds", "concerts", "work", "bucket"}  # tasks the owner can switch off in Settings (daily and inbox stay on)

# Tasks whose instructions live here instead of in the vault. Keep them free of personal details: they point
# at the encrypted interests for everything about the owner.
BUILTIN = {
    "bucket": {
        "prompt": """Radar's bucket-list check: look for genuinely good moments for the owner's bucket-list wishes.

Read radar/.plain/interests.json: `about` says who this is for; `bucketlist` holds the wishes as
{id, title, good_time, where, added, checked?}. `good_time` says what would make it a good moment (season, price,
conditions, place); follow it closely.

1. Pick the 3 wishes whose `checked` date is oldest (missing = never checked; those first).
2. For each, find what's true right now: prices, seasons, dates, listings, openings, deals. Prefer opening pages
   directly with WebFetch (booking and flight-search pages, property listing searches, official season or event pages,
   organisers) and keep a short list of good pages per wish in `sources` ([{name, url}]) on the wish, so later runs
   can open them without searching. Use your web searches only to find those pages.
3. When something is a genuinely good moment, add a feed item to radar/.plain/feed.json: kind "bucket",
   bucket = the wish id, title, place, city, region, start/end when it applies, a summary with the concrete facts
   (price, dates, where), why = which part of good_time it meets, the url you opened, found = today, a unique id.
   Remove bucket items for these wishes that have passed or no longer hold. Don't invent: only what you opened.
4. Set `checked` = today (YYYY-MM-DD) on each wish you looked at, even when nothing was good. When a wish has a
   concrete price to watch (a flight, a ticket, a listing), keep the best one found as `price` = {amount, currency,
   what, at, url} on the wish. When a later check finds it clearly lower, that's a good moment: write a bucket item
   whose title starts with "Price drop:" and name the old and new price.
5. Your final message goes to the owner's phone: one or two plain sentences naming the good moments found, or exactly
   "No new bucket-list moments." when there were none.""",
        "quiet": ["No new bucket-list moments."],
    },
    "work": {
        "prompt": """Radar's work search: find freelance and work opportunities for the owner of this Radar.

Read radar/.plain/interests.json: `about`, `work` and `freelance` describe who this is for and what to look
for (field, kind of assignments, rates, languages, places, what to avoid). `settings.work` (when present) holds
the owner's own choices and wins over the rest: `order` (which kind matters most: freelance, job, call or event;
spend most effort there), `volume` (few = 2 to 3 new leads per run, fit 4+ only; mix = 3 to 5 per run, fit 3+;
wide = up to 8 per run), `formats` (remote, hybrid / onsite = in the Netherlands, abroad = only now and then, so
keep abroad roles rare and strong), `levels` (mid, senior; director = only when the fit is strong, at most one per
run) and `freelance` (time available: month = a few days a month, 1-2 or 3-5 days a week; skip assignments that need
more). Give every item a `fit` 1 to 5.
Always include regenerative economics (doughnut and wellbeing economy, circular and bioregional programmes, think
tanks and research roles) and regenerative finance (nature and biodiversity finance, regenerative agriculture funds,
community and ReFi funding, natural-capital roles) in the search: mark those items `theme: "regen"` and keep good
pages in `interests.freelance.sources` with what = "regenerative".
Startup-ecosystem work is part of the normal search too (skip it only when `settings.work.startups.on` is false; when
`settings.work.startups` is missing, use every role, organisation, place and cross-border option below): look for it and mark those items `eco: true` with
`eco_role` mentor | programme | jury | coach: mentor or expert-in-residence pools, programme lead or manager roles,
jury / judge / selection-panel calls (pitch days, challenges, grant selection) and investor-readiness or fundraising
coaching. `orgs`: accelerators = climate accelerators and incubators and their cohort calls; funds = climate funds
and VCs (venture partner, scout, platform roles); public = innovation agencies, development finance institutions and
EU programmes; corporate = corporate venturing and open-innovation challenges. `places`: nl, eu, jpeu (programmes
bridging Japanese and European startups), online (remote mentoring and juries anywhere). `xb` (cross-border
programmes, where the owner has run accelerator programmes for foreign climate startups before): entry = soft-landing
and go-to-Europe programmes for foreign startups (eco_role entry); agencies = calls from trade, investment and
innovation agencies (Japanese and European) for programme partners, mentors or experts; jpcorp = open-innovation,
venture-arm and partnership roles at Japanese companies in Europe; tenders = calls for organisations or experts to
design or run an accelerator or startup programme (eco_role tender). Keep good accelerator,
fund and programme pages in `interests.freelance.sources` with what = "startups" and open them each run; aim for
2 to 4 live `eco` items. Then update radar/.plain/feed.json.

1. Remove work and freelance items whose deadline (or `end`) has passed, or that are clearly filled.
2. Sources: `interests.freelance.sources` is a list of pages worth checking every time (freelance platforms,
   tender and assignment boards, interim agencies, funders' calls, networks and newsletters in the owner's
   field). Open each with WebFetch. If the list is missing or has fewer than 8 good sources, use your web
   searches to find more that fit the profile, and save the good ones there as {name, url, what} so later
   runs can open them without searching. Drop sources that no longer list anything useful.
3. Add new items (aim for at least 6 live `freelance` items and a few `work` items in total; don't duplicate
   by url or title). Freelance: kind "freelance", sub "freelance", `end` and `deadline` = the date to apply by
   (YYYY-MM-DD) when known, org, format (in person / online / hybrid), region (nl, be, de, eu, uk, jp, all),
   a short summary, a `why` that names the match with the profile, the url you opened, and found = today.
   Jobs, calls and grants that fit: kind "work" with sub job | call | grant. Only include things you opened
   and that are open now.
3b. Companies the owner tracks: `interests.companies` [{name, bell, careers?}]. For each, open its `careers`
   page with WebFetch (the jobs or vacancies page; when it is missing, find it with at most one web search per
   company, at most 2 such searches per run, and save it as `careers`). List every open role and freelance or
   interim assignment there as an item (kind/sub as above) with org = the company name exactly as tracked and
   company = the same name, and score each with `fit` 1 to 5 against the profile AND the company's `look_for`
   (when set: e.g. seniority, field, place). Only fit 4 or 5 counts as relevant: give those a `why` naming the
   match in one sentence. Fit 1 to 3: a short neutral `why`, no flags. Remove that company's items that are no
   longer listed. Set `checked` (today) on each company you opened.
4. Your final message is sent to the owner's phone: one or two plain sentences naming the best new leads,
   or exactly "No new work leads." when nothing new was added. Name new roles with fit 4+ at tracked
   companies with bell: true first ("New at <company>: <role>"); never name roles with fit 3 or lower at tracked
   companies, and don't name roles at companies with bell: false unless they are among the best new leads.""",
        "quiet": ["No new work leads."],
    },
}
RULES = """Cost rules for this run (they come before everything below):
- You are on a small monthly budget. Use at most {n} web searches in this run{off}. Web pages you open with
  WebFetch cost almost nothing: prefer opening known pages (venue agendas, organisers, marketplace search
  pages, artist tour pages) over searching.
- Read and change the data files with small, targeted commands (python or jq on radar/.plain/*.json); don't
  print whole files. Keep the files valid JSON after every change, so a stopped run still leaves good data.
- Do the most valuable work first: notes from the phone, then removing past items, then new items.
- Stop when the allowance is used. Fewer, solid items beat many thin ones.

"""


CONCERT_RULES = ("- Concerts: per artist keep only ONE concert item in feed.json, the nearest upcoming show (the app shows only\n"
                 "  that one); put the artist's other dates briefly in its summary (\"Also: 12 Mar Utrecht, 3 Apr Antwerp\") and\n"
                 "  set `artist` to the artist's name. When it passes, the next date becomes the item.\n"
                 "- Every show of an artist in interests.concertAlerts.artists that isn't in concertAlerts.notified yet\n"
                 "  (artist|YYYY-MM-DD|city): add it to notified and name it in your final message, which goes to the phone,\n"
                 "  as \"Concert: <artist>, <venue>, <city>, <date>\". Name the nearest show first.\n")
EXTRA = {  # added to the cost rules, per task (generic: nothing about the owner)
    "finds": "- Web search is switched off for this task. Open the marketplaces' own search pages with WebFetch instead,\n"
             "  one per query in interests.wanted[].queries (when a search has none, e.g. after the owner edited it, write\n"
             "  2 or 3 short queries per site into it from its title and look_for first), and ask WebFetch\n"
             "  for every ad's title, price, location, date and link:\n"
             "    Marktplaats:   https://www.marktplaats.nl/q/<query>/\n"
             "    2dehands:      https://www.2dehands.be/q/<query>/\n"
             "    Kleinanzeigen: https://www.kleinanzeigen.de/s-<query>/k0   (words joined with -)\n"
             "  plus any `sources` pages a search lists. Their /lrp/api/ endpoints are off-limits (robots.txt).\n"
             "- Every ad's `url` must be the ad's own page (Marktplaats/2dehands: /v/... with a<id> or m<id>; Kleinanzeigen:\n"
             "  /s-anzeige/...), never the search page. When WebFetch leaves a link out, ask it again for just the href of\n"
             "  that ad by title, or open the search page sorted newest or a narrower query. Existing ads whose url is a\n"
             "  search page: find their own link first this run. Don't write notes about missing links.\n"
             "- Keep ads that still fit, drop ones no longer listed, add new ones. For every ad record `posted`\n"
             "  (YYYY-MM-DD; turn 'Vandaag'/'Heute'/'Gisteren'/'Gestern' into dates) and the price as a number, so the\n"
             "  app can show how long it has been for sale and compare prices.\n"
             "- interests.watch lists ads the owner watches for a price drop ({adId: {url, title, price, search}}).\n"
             "  Open each url every run; keep that ad in gear.json (same id) even if it no longer fits the filters. When\n"
             "  the price is lower than before, set `was` to the previous price; when the ad is gone, set `gone: true`.\n"
             "  Name every price drop in your final message (it goes to the phone).\n",
    "inbox": "- A note may carry \"Picked ideas\" (JSON that Radar's instant research already found). Open each url;\n"
             "  add the ones that hold up to radar/.plain/things.json `ideas` with a new unique id (\"m-\" + a short slug),\n"
             "  found = today, and drop the rest. Picked city items go to feed.json in the same way.\n",
}
EXTRA["inbox"] += ("- A radar-ask note holds JSON {\"ask\": \"bucket-brainstorm\", \"around\", \"have\"}: suggest 8 bucket-list wishes that\n"
                   "  fit the owner (interests `about`, sports, art, places, taste; a mix of big and small, near and far, some\n"
                   "  surprising; none already in `have` or bucketlist), each {title, good_time, where, why}, and write them to\n"
                   "  interests.suggestions.bucket = {at: now (ISO), around, items: [...]}. No web search needed for this.\n"
                   "- A \"Do: more ideas\" interest note: find 5 to 8 things to do now (Den Haag first, the note says what\n"
                   "  of, and where: a place or coordinates means there, not Den Haag; then set trip = true) and add them to\n"
                   "  things.json `ideas` with new unique ids, found = today, fresh = true.\n"
                   "- A \"Read & listen: more\" note: add 5 new feed items of the kinds it names (release, story, news,\n"
                   "  meditation) that fit the owner's taste, each with a url you opened and found = today.\n")
EXTRA["inbox"] += ("- A new bucket-list wish: add it to interests.bucketlist with a new id and do a first check right away\n"
                   "  (good moments now, a few good pages in `sources`, `checked` = today).\n")
EXTRA["inbox"] += ("- A city note (radar-location) or a Do request for a place away from home: also look for padel there (courts\n"
                   "  to book, open matches to join, on Playtomic or club pages) and add them as things ideas with cat \"sport\".\n")
EXTRA["inbox"] += ("- A \"Concert check: <artist>\" note (the owner just followed the artist or switched its alert on): make sure the\n"
                   "  artist is in interests.artists and concertAlerts.artists, find their upcoming shows (own concerts and festival\n"
                   "  slots) in the Netherlands, Belgium or Germany near the border, and follow the concert alert rules below.\n")
EXTRA["inbox"] += CONCERT_RULES
EXTRA["daily"] = EXTRA["inbox"]
EXTRA["concerts"] = CONCERT_RULES
# Which Settings switch silences a task's push (the owner turns them on and off on the phone).
PUSH = {"daily": "daily", "inbox": "daily", "finds": "finds", "concerts": "concerts", "work": "work", "bucket": "daily"}


def say(msg):
    print("radar-task: " + msg, flush=True)


def vault(*args, stdin=None):
    r = subprocess.run(["node", VAULT] + list(args), input=stdin, capture_output=True, text=True)
    if r.returncode:
        say("the vault refused (%s): check the PK secret" % args[0])
        sys.exit(1)
    return r.stdout


def gh(method, path, body=None):
    req = urllib.request.Request("https://api.github.com/repos/" + REPO + path, method=method,
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Authorization": "Bearer " + os.environ["GITHUB_TOKEN"],
                                          "Accept": "application/vnd.github+json", "User-Agent": "radar-task"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read() or b"null")


def output(**kv):
    with open(os.environ.get("GITHUB_OUTPUT", os.devnull), "a") as f:
        for k, v in kv.items():
            f.write("%s=%s\n" % (k, v))


def tasks():
    return json.load(open(os.path.join(PLAIN, "tasks.json")))


# Wind › Windsurf trips: the app estimates flight costs; the daily run checks live fares for the top 3 flight trips
# (tools/trips.py writes them to radar/.plain/trips.json with the app's rules) and the app shows them (interests.fares).
FARES = """Live fares for the Windsurf trips on the Wind tab (do this last, briefly):
radar/.plain/trips.json lists up to 3 windsurf trips by plane ({spot, name, air, out, back}). For each, find the
cheapest return fare for one person with hand luggage from a Dutch airport (AMS, RTM or EIN) to `air`, leaving `out`
and returning `back` (a day either side is fine; then use those dates). Prefer opening fare pages with WebFetch
(airline sites such as transavia.com, ryanair.com, klm.nl, vueling.com, or Google Flights / Skyscanner result pages);
use at most 1 web search for all three. Only record a price you saw on a page. Write interests.fares =
{"at": now (ISO), "items": [{"spot", "out", "back", "from": IATA code, "price": number in EUR, "airline", "url"}]}
(replace the old list; leave a trip out when no fare was found). Don't mention fares in your final message."""


# Every task's final message becomes a push, so it has to be worth one (the owner's rule: no useless notifications).
PUSH_RULE = """The push rule (overrides any other wording about your final message): your final message is sent to the
owner's phone as a notification. Only write one when this run added something the owner would want to act on or know
today: name at most 3 new things by their title, each with a few words on why or by when. Otherwise answer exactly
"Nothing new." Never report routine work (past items removed, sources updated, pages checked, lists tidied, counts),
never repeat something an earlier push already named, and no greetings or sign-offs."""
QUIET = ("nothing new", "no new ", "no changes", "nothing to report", "all up to date")


def worth_pushing(name, res, key):
    """False for empty or 'nothing new' replies, and for a message already pushed today (same task, same text):
    a catch-up run and a late scheduled run can otherwise push twice. Only a short hash is kept (status.json is public)."""
    r = " ".join(str(res or "").split())
    if not r or r.lower().startswith(QUIET) or len(r) < 12:
        return False
    h = hashlib.sha1(r.lower().encode()).hexdigest()[:12]
    try:
        st = json.load(open(STATUS))
    except Exception:
        st = {}
    pushed = st.setdefault("pushed", {})
    today = datetime.date.today().isoformat()
    seen = pushed.get(key) if isinstance(pushed.get(key), dict) else {}
    if seen.get("day") == today and h in (seen.get("hashes") or []):
        return False
    seen = {"day": today, "hashes": ((seen.get("hashes") or []) if seen.get("day") == today else []) + [h]}
    pushed[key] = seen
    try:
        json.dump(st, open(STATUS, "w"), indent=1)
    except Exception:
        pass
    return True


def trip_fares():
    """Run the trip scout for the daily task; True when there are flight trips to price."""
    try:
        subprocess.run([sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), "trips.py")], check=True, timeout=120)
        return bool(json.load(open(os.path.join(PLAIN, "trips.json"))))
    except Exception:  # no forecast today: skip the fare check
        say("trip scout: no forecast, skipping fares")
        return False


def prepare(name):
    vault("unlock")
    t = tasks().get(name) or BUILTIN.get(name)
    if not isinstance(t, dict):
        say("unknown task"); sys.exit(1)
    if name == "inbox":  # requests from the app that need Claude now (brainstorm), when Cloudflare has no Claude key
        t = dict(t, labels=list(t.get("labels", [])) + ["radar-ask"])
    notes = []
    for label in t.get("labels", []):
        for i in gh("GET", "/issues?state=open&per_page=100&labels=" + label):
            if "pull_request" in i or any(n["number"] == i["number"] for n in notes):
                continue
            notes.append({"number": i["number"], "label": label, "text": vault("open", "-", stdin=i.get("body") or "").strip()})
    notes.sort(key=lambda n: n["number"])
    json.dump(notes, open(os.path.join(PLAIN, "notes.json"), "w"), indent=1, ensure_ascii=False)
    open(os.path.join(TMP, "notes.txt"), "w").write(" ".join(str(n["number"]) for n in notes))
    snap = {}
    for n in DATA:
        f = os.path.join(PLAIN, n + ".json")
        if os.path.exists(f):
            snap[n] = content_hash(json.load(open(f)))
    json.dump(snap, open(os.path.join(TMP, "snap.json"), "w"))
    run = bool(notes) or not t.get("needs_notes")
    fares = name == "daily" and trip_fares()
    billed = os.environ.get("SUBSCRIPTION") != "true"
    cap, searches = LOW.get(name, (0.05, 2))
    prompt = t["prompt"]
    if billed:
        rules = RULES.format(n=searches, off=" (WebSearch is switched off: open pages directly)" if not searches else "")
        prompt = rules.rstrip("\n") + "\n" + EXTRA.get(name, "") + "\n" + prompt
        if run:
            spent, allowed = budget_now()
            need = spent + cap + (allowed * RESERVE if name in LOW_PRIORITY and not notes else 0)
            if need > allowed:
                say("budget: $%.2f of $%.2f used this month, $%.2f allowed so far: skipping this run" % (spent, budget(), allowed))
                set_status(name, "skipped: budget")
                run = False
    if run and name in SWITCHABLE and settings().get("tasks", {}).get(name) is False:
        say("switched off in Settings")
        run = False
    if fares:
        prompt += "\n\n" + FARES
    prompt += "\n\n" + PUSH_RULE
    open(os.path.join(TMP, "prompt.txt"), "w").write(prompt)
    output(model=CHEAP if billed else (t.get("model") or "claude-sonnet-5-5"), run=str(run).lower(),
           cap=("%.2f" % cap) if billed else "", nosearch="true" if billed and not searches else "false")
    say("%d note(s); %s" % (len(notes), ("running Claude (%s)" % ("low-cost" if billed else "subscription")) if run else "nothing to do"))


STAMPED = ["feed", "things", "taste", "gear"]  # files whose `updated` the app shows ("updated 3 days ago")


def content_hash(d):
    import hashlib
    d = dict(d) if isinstance(d, dict) else d
    if isinstance(d, dict):
        d.pop("updated", None)
    return hashlib.sha256(json.dumps(d, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def stamp():
    """Set `updated` to now on every shown data file whose content this run changed (Claude often forgets,
    and the app would keep saying "updated 39 days ago")."""
    import datetime
    try:
        snap = json.load(open(os.path.join(TMP, "snap.json")))
    except Exception:
        snap = {}
    now = datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    n = 0
    for name in STAMPED:
        f = os.path.join(PLAIN, name + ".json")
        if not os.path.exists(f):
            continue
        d = json.load(open(f))
        if isinstance(d, dict) and content_hash(d) != snap.get(name):
            d["updated"] = now
            json.dump(d, open(f, "w"), indent=1, ensure_ascii=False)
            open(f, "a").write("\n")
            n += 1
    say("stamped as updated: %d file(s)" % n)


def status():
    try:
        d = json.load(open(STATUS))
        return d if isinstance(d, dict) else {}
    except Exception:
        return {}


def set_status(name, result, cost=None):
    """Record a task's last run for the app's status card and the catch-up: when, how it went, what it cost.
    Only dates, fixed outcome words and amounts: the file is public."""
    import datetime
    d = status()
    now = datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    t = d.setdefault("tasks", {})
    e = {"at": now, "result": result}
    if cost is not None:
        e["cost"] = round(cost, 3)
    t[name] = e
    d["month"] = month()
    d["spent"] = round(float(ledger().get(month(), 0)), 3)
    d["budget"] = budget()
    d["mode"] = "subscription" if os.environ.get("SUBSCRIPTION") == "true" else "api"
    d["updated"] = now
    json.dump(d, open(STATUS, "w"), indent=1, sort_keys=True)
    open(STATUS, "a").write("\n")


def mark_run(name):
    """Kept for older callers: a run happened today (the catch-up reads status.json)."""
    pass


def month():
    return subprocess.run(["date", "-u", "+%Y-%m"], capture_output=True, text=True).stdout.strip()


def ledger():
    try:
        return json.load(open(SPEND))
    except Exception:
        return {}


def settings():
    """The owner's Settings (from the phone, applied by `task.py apply`): {notify:{...}, budget, tasks:{...}}."""
    try:
        return json.load(open(os.path.join(PLAIN, "interests.json"))).get("settings") or {}
    except Exception:
        return {}


def budget():
    try:
        b = float(settings().get("budget") or 0)
        if 1 <= b <= 100:
            return b
    except Exception:
        pass
    return BUDGET


def budget_now():
    """Spend so far this month, and how much may be spent by today (the budget paced evenly over the month,
    one day ahead), so a busy week can't use up the month."""
    import calendar, datetime
    d = datetime.datetime.utcnow()
    days = calendar.monthrange(d.year, d.month)[1]
    spent = float(ledger().get(month(), 0))
    b = budget()
    return spent, min(b, b * (d.day + 1) / days)


def record(cost):
    """Add a billed run's cost to the ledger and commit it (even when the run failed: the money is spent)."""
    led = ledger()
    led[month()] = round(float(led.get(month(), 0)) + cost, 4)
    led = {k: led[k] for k in sorted(led)[-12:]}
    json.dump(led, open(SPEND, "w"), indent=1)
    open(SPEND, "a").write("\n")


def run_facts():
    """Log only non-personal facts about Claude's run (outcome, turns, cost, error kind) so failures and
    spend can be seen in the public log without exposing anything Claude read or wrote."""
    try:
        out = json.load(open(os.path.join(TMP, "out.json")))
    except Exception:
        out = {}
    try:
        err = open(os.path.join(TMP, "claude.err")).read().lower()
    except Exception:
        err = ""
    text = (err + " " + str(out.get("result") or "")[:500]).lower()
    kind = "none"
    for k, words in (("credit", ("credit balance", "billing")), ("rate limit", ("rate_limit", "rate limit", "429")),
                     ("overloaded", ("overloaded", "529")), ("auth", ("authentication", "invalid x-api-key", "401")),
                     ("usage limit", ("usage limit",)), ("context", ("prompt is too long",)),
                     ("model", ("not_found_error", "model:", "invalid model", "issue with the selected model"))):
        failed = out.get("is_error") or out.get("subtype") != "success"
        if failed and any(w in text for w in words):
            kind = k
            break
    if kind == "none" and out.get("is_error") and out.get("num_turns", 9) <= 1 and not out.get("total_cost_usd"):
        # failed before Claude did any work: the message is an API or CLI error, never data, so it's safe to show
        kind = "api: " + " ".join(str(out.get("result") or err or "?").split())[:160]
    cost = out.get("total_cost_usd")
    say("run: outcome=%s turns=%s cost=%s error=%s" % (
        out.get("subtype", "no output"), out.get("num_turns", "?"),
        ("$%.2f" % cost) if isinstance(cost, (int, float)) else "?", kind))


def result():
    try:
        out = json.load(open(os.path.join(TMP, "out.json")))
        if out.get("is_error") or out.get("subtype") != "success":
            return None
        return str(out.get("result") or "").strip()
    except Exception:
        return None


def stopped_at_cap():
    try:
        out = json.load(open(os.path.join(TMP, "out.json")))
    except Exception:
        return False
    return "budget" in str(out.get("subtype", "")).lower()


def save_spend():
    """Commit only the spend ledger (used when a billed run failed and nothing else is saved)."""
    files = [f for f in ("radar/spend.json", "radar/status.json") if os.path.exists(os.path.join(ROOT, f))]
    if not files:
        return
    subprocess.run(["git", "add", "--"] + files, cwd=ROOT)
    if subprocess.run(["git", "diff", "--cached", "--quiet", "--"] + files, cwd=ROOT).returncode == 0:
        return
    subprocess.run(["git", "-c", "user.name=Radar", "-c", "user.email=radar@users.noreply.github.com",
                    "commit", "-q", "-m", "Radar spend"], cwd=ROOT)
    for _ in range(3):
        if git("pull", "-q", "--rebase", "origin", "main").returncode == 0 and git("push", "-q", "origin", "HEAD:main").returncode == 0:
            return


def git(*args):
    tok = base64.b64encode(("x-access-token:" + os.environ["GITHUB_TOKEN"]).encode()).decode()
    return subprocess.run(["git", "-c", "http.https://github.com/.extraheader=AUTHORIZATION: basic " + tok] + list(args),
                          cwd=ROOT, capture_output=True, text=True)


def notify(text, key="status"):
    """Push Claude's message (or a status notice) through push.py: honours the phone's on/off switch, importance
    and quiet hours for `key` (status notices use the default importance and can't be switched off)."""
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import push
    try:
        cfg = json.load(open(os.path.join(PLAIN, "interests.json")))
    except Exception:
        cfg = {}
    return push.send(cfg, key, "Radar", text[:1000], "satellite", click=None)


def finish(name):
    try:
        res = result()
        t = (tasks().get(name) if os.path.exists(os.path.join(PLAIN, "tasks.json")) else None) or BUILTIN.get(name, {})
        ran = os.path.exists(os.path.join(TMP, "out.json"))
        if ran:
            run_facts()
            if os.path.exists(os.path.join(TMP, "billed")):
                try:
                    cost = float(json.load(open(os.path.join(TMP, "out.json"))).get("total_cost_usd"))
                except Exception:
                    cost = float(os.environ.get("CAP") or 0.1)  # unknown: count the whole cap
                record(cost)
        cost_now = None
        if ran:
            try:
                cost_now = float(json.load(open(os.path.join(TMP, "out.json"))).get("total_cost_usd"))
            except Exception:
                cost_now = None
        if not ran:
            say("Claude didn't run"); return
        if res is None and stopped_at_cap():
            res = ""  # stopped at its spending cap: keep what it saved so far (still validated below)
            say("stopped at the cost cap: saving what it finished")
        if res is None:
            say("Claude didn't finish: nothing saved, notes stay open")
            set_status(name, "failed", cost_now)
            save_spend()
            notify("Radar's %s task didn't finish today; it tries again next time." % name)
            sys.exit(1)
        # validate what Claude left, then encrypt (only changed files are rewritten)
        for f in glob.glob(os.path.join(PLAIN, "*.json")):
            try:
                json.load(open(f))
            except Exception:
                say("a data file isn't valid JSON: nothing saved, notes stay open")
                set_status(name, "failed", cost_now)
                save_spend()
                notify("Radar's %s task left broken data, so nothing was saved; it tries again next time." % name)
                sys.exit(1)
        # Claude may only change the data: its instructions (tasks.json) are never re-encrypted from what it
        # left, and only the known data files are committed; anything else it touched is thrown away.
        os.remove(os.path.join(PLAIN, "tasks.json"))
        stamp()
        set_status(name, "ok", cost_now)
        worth = worth_pushing(name, res, PUSH.get(name, name))  # before the commit, so the push hash is saved
        vault("lock")
        files = ["radar/data/%s.enc.json" % n for n in DATA] + [f for f in ("radar/spend.json", "radar/status.json")
                                                                   if os.path.exists(os.path.join(ROOT, f))]
        subprocess.run(["git", "add", "--"] + files, cwd=ROOT, check=True)
        changed = subprocess.run(["git", "diff", "--cached", "--quiet", "--"] + files, cwd=ROOT).returncode != 0
        if changed:
            subprocess.run(["git", "-c", "user.name=Radar", "-c", "user.email=radar@users.noreply.github.com",
                            "commit", "-q", "-m", "Radar %s %s" % (name, subprocess.run(["date", "+%F"], capture_output=True, text=True).stdout.strip())],
                           cwd=ROOT, check=True)
            subprocess.run(["git", "reset", "-q", "--hard", "HEAD"], cwd=ROOT, check=True)
            subprocess.run(["git", "clean", "-fdq"], cwd=ROOT, check=True)
            ok = False
            for _ in range(3):
                if git("pull", "-q", "--rebase", "origin", "main").returncode == 0 and git("push", "-q", "origin", "HEAD:main").returncode == 0:
                    ok = True; break
            if not ok:
                say("couldn't push the update: notes stay open")
                notify("Radar's %s task couldn't save its update; it tries again next time." % name)
                sys.exit(1)
        closed = 0
        for num in open(os.path.join(TMP, "notes.txt")).read().split():
            gh("POST", "/issues/%s/comments" % num, {"body": "Done."})
            gh("PATCH", "/issues/%s" % num, {"state": "closed", "state_reason": "completed"})
            closed += 1
        quiet = res in (t.get("quiet") or []) or settings().get("notify", {}).get(PUSH.get(name, name)) is False \
            or not worth
        sent = False if quiet else notify(res, PUSH.get(name, name))
        say("saved: %s; notes closed: %d; notification: %s" % ("yes" if changed else "no changes", closed, "sent" if sent else "none"))
    finally:
        shutil.rmtree(PLAIN, ignore_errors=True)


APPLY_LABELS = ["radar-settings", "radar-track"]


def _name(x):
    return (x if isinstance(x, str) else (x.get("name") or x.get("artist") or "") if isinstance(x, dict) else "").strip()


def apply_artists(it, ch):
    """Follow or unfollow artists from the phone: {add: [names], remove: [names], alerts: {name: bool}}.
    interests.artists keeps its own shape (names or {name, ...}); concert alerts use concertAlerts.artists."""
    arts = it.get("artists") if isinstance(it.get("artists"), list) else []
    ca = it.get("concertAlerts") if isinstance(it.get("concertAlerts"), dict) else {}
    alerts = ca.get("artists") if isinstance(ca.get("artists"), list) else []
    low = lambda xs: {_name(x).lower() for x in xs}
    for n in [str(x).strip()[:80] for x in (ch.get("remove") or [])[:50] if str(x).strip()]:
        arts = [x for x in arts if _name(x).lower() != n.lower()]
        alerts = [x for x in alerts if _name(x).lower() != n.lower()]
    for n in [str(x).strip()[:80] for x in (ch.get("add") or [])[:50] if str(x).strip()]:
        if n.lower() not in low(arts):
            arts.append({"name": n} if arts and isinstance(arts[0], dict) else n)
        if n.lower() not in low(alerts):
            alerts.append({"name": n} if alerts and isinstance(alerts[0], dict) else n)
    for n, on in list((ch.get("alerts") or {}).items())[:50]:
        n = str(n).strip()[:80]
        if on and n.lower() not in low(alerts):
            alerts.append({"name": n} if alerts and isinstance(alerts[0], dict) else n)
        if not on:
            alerts = [x for x in alerts if _name(x).lower() != n.lower()]
    it["artists"] = arts
    ca["artists"] = alerts
    it["concertAlerts"] = ca


def apply_companies(it, ch):
    """Companies tracked in Work: {add: [{name, bell, url?, look_for?}], remove: [names], bell: {name: bool},
    edit: {oldName: {name, url, look_for}}}. interests.companies = [{name, bell, careers?, look_for?, added}]; the work
    task fills in `careers` when it finds the page. An edit with an empty url clears `careers` so the task finds it."""
    cos = [c for c in (it.get("companies") or []) if isinstance(c, dict) and c.get("name")]
    find = lambda n: next((c for c in cos if c["name"].lower() == n.lower()), None)
    for n in [str(x).strip()[:80] for x in (ch.get("remove") or [])[:50] if str(x).strip()]:
        cos = [c for c in cos if c["name"].lower() != n.lower()]
    for a in (ch.get("add") or [])[:50]:
        n = str((a or {}).get("name") or "").strip()[:80] if isinstance(a, dict) else ""
        if not n:
            continue
        c = find(n)
        if not c:
            c = {"name": n, "added": datetime.date.today().isoformat()}
            cos.append(c)
        c["bell"] = bool(a.get("bell", True))
        u = str(a.get("url") or "")[:300]
        if re.match(r"^https?://", u):
            c["careers"] = u
        if str(a.get("look_for") or "").strip():
            c["look_for"] = str(a["look_for"]).strip()[:400]
    for old, e in list((ch.get("edit") or {}).items())[:50]:
        c = find(str(old).strip()[:80])
        if not c or not isinstance(e, dict):
            continue
        n = str(e.get("name") or "").strip()[:80]
        if n and not (n.lower() != c["name"].lower() and find(n)):
            c["name"] = n
        u = str(e.get("url") or "")[:300]
        if re.match(r"^https?://", u):
            c["careers"] = u
        elif "url" in e:
            c.pop("careers", None)
        lf = str(e.get("look_for") or "").strip()[:400]
        if lf:
            c["look_for"] = lf
        elif "look_for" in e:
            c.pop("look_for", None)
    for n, on in list((ch.get("bell") or {}).items())[:50]:
        c = find(str(n).strip()[:80])
        if c:
            c["bell"] = bool(on)
    it["companies"] = cos


def apply():
    """Apply the phone's Settings and Work tracker notes without Claude: they are plain JSON, so a script can
    merge them into the encrypted interests (settings, tracked) and add the cost of instant research to the
    spend ledger. Runs at the start of every task run, and right away when such a note arrives."""
    notes = []
    for label in APPLY_LABELS:
        for i in gh("GET", "/issues?state=open&per_page=50&labels=" + label):
            if "pull_request" not in i:
                notes.append((i["number"], label, i.get("body") or ""))
    if not notes:
        return
    notes.sort()
    vault("unlock")
    try:
        f = os.path.join(PLAIN, "interests.json")
        it = json.load(open(f))
        spend = 0.0
        done = []
        for num, label, body in notes:
            text = vault("open", "-", stdin=body)
            j = None
            try:
                j = json.loads(text[text.index("{"):]) if "{" in text else None
            except Exception:
                j = None
            done.append(num)
            if not isinstance(j, dict):
                continue
            if label == "radar-settings":
                cur = it.get("settings") if isinstance(it.get("settings"), dict) else {}
                for k in ("notify", "tasks"):
                    if isinstance(j.get(k), dict):
                        cur[k] = {str(a)[:20]: bool(b) for a, b in list(j[k].items())[:20]}
                try:
                    b = float(j.get("budget"))
                    if 1 <= b <= 100:
                        cur["budget"] = round(b, 2)
                except Exception:
                    pass
                al = j.get("alerts")
                if isinstance(al, dict):  # Settings › notification options: fixed choices only (see push.py)
                    q = al.get("quiet") if isinstance(al.get("quiet"), dict) else {}
                    hr = lambda v, d: v if isinstance(v, int) and 0 <= v <= 23 else d
                    ws = al.get("wind") if isinstance(al.get("wind"), dict) else {}
                    cur["alerts"] = {
                        "quiet": {"on": bool(q.get("on")), "from": hr(q.get("from"), 22), "to": hr(q.get("to"), 7)},
                        "level": {str(k)[:20]: v for k, v in list((al.get("level") or {}).items())[:20] if v in ("loud", "normal", "silent")},
                        "remind": al.get("remind") if al.get("remind") in ("3-1", "7-2", "1", "7-3-1") else "3-1",
                        "wind": {"sports": [str(x)[:20] for x in (ws.get("sports") or [])[:6]],
                                 "minHours": ws.get("minHours") if ws.get("minHours") in (1, 2, 3, 4, 5, 6) else None,
                                 "days": ws.get("days") if ws.get("days") in (1, 2, 3) else 3},
                    }
                w = j.get("work")
                if isinstance(w, dict):  # Work › Your work search: fixed choices only
                    pick = lambda v, ok: v if v in ok else ""
                    cur["work"] = {
                        "order": pick(w.get("order"), ("date", "freelance", "job", "call", "event")) or "date",
                        "volume": pick(w.get("volume"), ("few", "mix", "wide")),
                        "freelance": pick(w.get("freelance"), ("month", "1-2", "3-5")),
                        "formats": [x for x in (w.get("formats") or []) if x in ("remote", "hybrid", "onsite", "abroad")],
                        "levels": [x for x in (w.get("levels") or []) if x in ("mid", "senior", "director")],
                    }
                    e = w.get("startups") if isinstance(w.get("startups"), dict) else {}
                    cur["work"]["startups"] = {
                        "on": bool(e.get("on")),
                        "roles": [x for x in (e.get("roles") or []) if x in ("mentor", "programme", "jury", "coach")],
                        "orgs": [x for x in (e.get("orgs") or []) if x in ("accelerators", "funds", "public", "corporate")],
                        "places": [x for x in (e.get("places") or []) if x in ("nl", "eu", "jpeu", "online")],
                        "xb": [x for x in (e.get("xb") or []) if x in ("entry", "agencies", "jpcorp", "tenders")],
                    }
                it["settings"] = cur
            else:
                if isinstance(j.get("work"), dict):
                    keep = {}
                    for k, v in list(j["work"].items())[:200]:
                        if isinstance(v, dict) and v.get("state") in ("interested", "applied", "skip"):
                            keep[str(k)[:80]] = {x: str(v.get(x) or "")[:300] for x in ("state", "title", "deadline", "url", "org", "at")}
                    it["tracked"] = keep
                if isinstance(j.get("bucket"), dict) and isinstance(it.get("bucketlist"), list):
                    for bid, ch in list(j["bucket"].items())[:50]:
                        if not isinstance(ch, dict):
                            continue
                        for w in it["bucketlist"]:
                            if isinstance(w, dict) and str(w.get("id")) == str(bid):
                                if ch.get("remove"):
                                    w["_remove"] = True
                                for k in ("title", "good_time", "where"):
                                    if isinstance(ch.get(k), str) and ch[k].strip():
                                        w[k] = ch[k].strip()[:400]
                    it["bucketlist"] = [w for w in it["bucketlist"] if not (isinstance(w, dict) and w.get("_remove"))]
                if isinstance(j.get("watch"), dict):
                    keep = {}
                    for k, v in list(j["watch"].items())[:50]:
                        if isinstance(v, dict) and str(v.get("url", "")).startswith("http"):
                            keep[str(k)[:80]] = {x: v.get(x) for x in ("url", "title", "price", "search", "t")}
                    it["watch"] = keep
                if isinstance(j.get("homeSpots"), dict) and isinstance(it.get("wind"), dict) and isinstance(it["wind"].get("spots"), list):
                    hs = j["homeSpots"]
                    rm = {str(x) for x in (hs.get("removed") or [])[:50]}
                    order = [str(x) for x in (hs.get("order") or [])[:50]]
                    sp = [x for x in it["wind"]["spots"] if isinstance(x, dict) and str(x.get("id")) not in rm]
                    if sp:  # never leave the alert without spots
                        sp.sort(key=lambda x: order.index(str(x.get("id"))) if str(x.get("id")) in order else 1000 + it["wind"]["spots"].index(x))
                        it["wind"]["spots"] = sp
                if isinstance(j.get("wanted"), dict) and isinstance(it.get("wanted"), list):
                    for wid, ch in list(j["wanted"].items())[:30]:
                        if not isinstance(ch, dict):
                            continue
                        for w in it["wanted"]:
                            if isinstance(w, dict) and str(w.get("id")) == str(wid):
                                if ch.get("remove"):
                                    w["_remove"] = True
                                for k in ("title", "look_for", "fit", "budget", "where"):
                                    if isinstance(ch.get(k), str) and ch[k].strip():
                                        w[k] = ch[k].strip()[:500]
                                if ch.get("look_for") or ch.get("title"):
                                    w.pop("queries", None)  # the finds task builds new queries from the new description
                    it["wanted"] = [w for w in it["wanted"] if not (isinstance(w, dict) and w.get("_remove"))]
                if isinstance(j.get("artists"), dict):
                    apply_artists(it, j["artists"])
                if isinstance(j.get("companies"), dict):
                    apply_companies(it, j["companies"])
                try:
                    c = float(j.get("spend") or 0)
                    if 0 < c < 2:
                        spend += c
                except Exception:
                    pass
        json.dump(it, open(f, "w"), indent=1, ensure_ascii=False)
        os.remove(os.path.join(PLAIN, "tasks.json"))
        vault("lock")
        if spend:
            record(spend)
        files = ["radar/data/interests.enc.json"] + (["radar/spend.json"] if os.path.exists(SPEND) else [])
        subprocess.run(["git", "add", "--"] + files, cwd=ROOT, check=True)
        if subprocess.run(["git", "diff", "--cached", "--quiet", "--"] + files, cwd=ROOT).returncode != 0:
            subprocess.run(["git", "-c", "user.name=Radar", "-c", "user.email=radar@users.noreply.github.com",
                            "commit", "-q", "-m", "Radar settings"], cwd=ROOT, check=True)
            ok = False
            for _ in range(3):
                if git("pull", "-q", "--rebase", "origin", "main").returncode == 0 and git("push", "-q", "origin", "HEAD:main").returncode == 0:
                    ok = True; break
            if not ok:
                say("couldn't save settings: notes stay open"); return
        for num in done:
            gh("POST", "/issues/%s/comments" % num, {"body": "Done."})
            gh("PATCH", "/issues/%s" % num, {"state": "closed", "state_reason": "completed"})
        say("applied %d settings or tracker note(s)" % len(done))
    finally:
        shutil.rmtree(PLAIN, ignore_errors=True)


if __name__ == "__main__":
    if not (len(sys.argv) == 3 and sys.argv[1] in ("prepare", "finish")) and sys.argv[1:] != ["apply"]:
        print(__doc__); sys.exit(2)
    if not (os.environ.get("PK") or os.environ.get("RADAR_KEY")):
        say("no passphrase: add the PK secret"); sys.exit(1)
    if sys.argv[1] == "apply":
        apply()
    else:
        (prepare if sys.argv[1] == "prepare" else finish)(sys.argv[2])
