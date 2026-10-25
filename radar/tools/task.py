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
    t = tasks().get(name)
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
    open(os.path.join(TMP, "prompt.txt"), "w").write(t["prompt"])
    run = bool(notes) or not t.get("needs_notes")
    output(model=t.get("model") or "claude-sonnet-5-5", run=str(run).lower())
    say("%d note(s); %s" % (len(notes), "running Claude" if run else "nothing to do"))


def result():
    try:
        out = json.load(open(os.path.join(TMP, "out.json")))
        if out.get("is_error") or out.get("subtype") != "success":
            return None
        return str(out.get("result") or "").strip()
    except Exception:
        return None


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
        t = tasks().get(name, {}) if os.path.exists(os.path.join(PLAIN, "tasks.json")) else {}
        ran = os.path.exists(os.path.join(TMP, "out.json"))
        if not ran:
            say("Claude didn't run"); return
        if res is None:
            say("Claude didn't finish: nothing saved, notes stay open")
            notify("Radar's %s task didn't finish today; it tries again next time." % name)
            sys.exit(1)
        # validate what Claude left, then encrypt (only changed files are rewritten)
        for f in glob.glob(os.path.join(PLAIN, "*.json")):
            try:
                json.load(open(f))
            except Exception:
                say("a data file isn't valid JSON: nothing saved, notes stay open")
                notify("Radar's %s task left broken data, so nothing was saved; it tries again next time." % name)
                sys.exit(1)
        # Claude may only change the data: its instructions (tasks.json) are never re-encrypted from what it
        # left, and only the known data files are committed; anything else it touched is thrown away.
        os.remove(os.path.join(PLAIN, "tasks.json"))
        vault("lock")
        files = ["radar/data/%s.enc.json" % n for n in DATA]
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
