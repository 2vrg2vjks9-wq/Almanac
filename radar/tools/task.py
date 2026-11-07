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
import base64, glob, json, os, shutil, subprocess, sys, urllib.request

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
    "daily": (0.12, 6),
    "inbox": (0.08, 4),
    "finds": (0.03, 0),
    "concerts": (0.06, 4),
    "work": (0.10, 5),
}
LASTRUN = os.path.join(ROOT, "radar", "last-run.json")  # date each task last ran (so missed schedules catch up)

# Tasks whose instructions live here instead of in the vault. Keep them free of personal details: they point
# at the encrypted interests for everything about the owner.
BUILTIN = {
    "work": {
        "prompt": """Radar's work search: find freelance and work opportunities for the owner of this Radar.

Read radar/.plain/interests.json: `about`, `work` and `freelance` describe who this is for and what to look
for (field, kind of assignments, rates, languages, places, what to avoid). Then update radar/.plain/feed.json.

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
4. Your final message is sent to the owner's phone: one or two plain sentences naming the best new leads,
   or exactly "No new work leads." when nothing new was added.""",
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


def prepare(name):
    vault("unlock")
    t = tasks().get(name) or BUILTIN.get(name)
    if not isinstance(t, dict):
        say("unknown task"); sys.exit(1)
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
    billed = os.environ.get("SUBSCRIPTION") != "true"
    cap, searches = LOW.get(name, (0.05, 2))
    prompt = t["prompt"]
    if billed:
        prompt = RULES.format(n=searches, off=" (WebSearch is switched off: open pages directly)" if not searches else "") + prompt
        if run:
            spent, allowed = budget_now()
            if spent + cap > allowed:
                say("budget: $%.2f of $%.2f used this month, $%.2f allowed so far: skipping this run" % (spent, BUDGET, allowed))
                run = False
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


def mark_run(name):
    """Note the day this task ran (a date only), so the hourly run can catch up a schedule GitHub skipped."""
    try:
        d = json.load(open(LASTRUN))
    except Exception:
        d = {}
    d[name] = subprocess.run(["date", "-u", "+%F"], capture_output=True, text=True).stdout.strip()
    json.dump(dict(sorted(d.items())), open(LASTRUN, "w"), indent=1)
    open(LASTRUN, "a").write("\n")


def month():
    return subprocess.run(["date", "-u", "+%Y-%m"], capture_output=True, text=True).stdout.strip()


def ledger():
    try:
        return json.load(open(SPEND))
    except Exception:
        return {}


def budget_now():
    """Spend so far this month, and how much may be spent by today (the budget paced evenly over the month,
    one day ahead), so a busy week can't use up the month."""
    import calendar, datetime
    d = datetime.datetime.utcnow()
    days = calendar.monthrange(d.year, d.month)[1]
    spent = float(ledger().get(month(), 0))
    return spent, min(BUDGET, BUDGET * (d.day + 1) / days)


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
    files = [f for f in ("radar/spend.json", "radar/last-run.json") if os.path.exists(os.path.join(ROOT, f))]
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


def notify(text):
    topic = os.environ.get("NTFY_TOPIC", "").strip()
    if not topic:
        try:
            topic = str(json.load(open(os.path.join(PLAIN, "interests.json"))).get("alerts", {}).get("ntfy", "")).strip()
        except Exception:
            topic = ""
    if not topic:
        return False
    req = urllib.request.Request("https://ntfy.sh/" + topic, data=text[:1000].encode(), method="POST",
                                 headers={"Title": "Radar", "Tags": "satellite"})
    try:
        urllib.request.urlopen(req, timeout=20)
        return True
    except Exception:
        return False


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
        if ran:
            mark_run(name)
        if not ran:
            say("Claude didn't run"); return
        if res is None and stopped_at_cap():
            res = ""  # stopped at its spending cap: keep what it saved so far (still validated below)
            say("stopped at the cost cap: saving what it finished")
        if res is None:
            say("Claude didn't finish: nothing saved, notes stay open")
            save_spend()
            notify("Radar's %s task didn't finish today; it tries again next time." % name)
            sys.exit(1)
        # validate what Claude left, then encrypt (only changed files are rewritten)
        for f in glob.glob(os.path.join(PLAIN, "*.json")):
            try:
                json.load(open(f))
            except Exception:
                say("a data file isn't valid JSON: nothing saved, notes stay open")
                save_spend()
                notify("Radar's %s task left broken data, so nothing was saved; it tries again next time." % name)
                sys.exit(1)
        # Claude may only change the data: its instructions (tasks.json) are never re-encrypted from what it
        # left, and only the known data files are committed; anything else it touched is thrown away.
        os.remove(os.path.join(PLAIN, "tasks.json"))
        stamp()
        vault("lock")
        files = ["radar/data/%s.enc.json" % n for n in DATA] + [f for f in ("radar/spend.json", "radar/last-run.json")
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
        quiet = res in (t.get("quiet") or []) or not res
        sent = False if quiet else notify(res)
        say("saved: %s; notes closed: %d; notification: %s" % ("yes" if changed else "no changes", closed, "sent" if sent else "none"))
    finally:
        shutil.rmtree(PLAIN, ignore_errors=True)


if __name__ == "__main__":
    if len(sys.argv) != 3 or sys.argv[1] not in ("prepare", "finish"):
        print(__doc__); sys.exit(2)
    if not (os.environ.get("PK") or os.environ.get("RADAR_KEY")):
        say("no passphrase: add the PK secret"); sys.exit(1)
    (prepare if sys.argv[1] == "prepare" else finish)(sys.argv[2])
