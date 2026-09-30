#!/usr/bin/env python3
"""Safety check for app pages before they are published or pushed.

Blocking problems (exit 1):
  - secrets: API keys, tokens, private keys
  - scripts, stylesheets or network requests to hosts outside the allowlist
  - eval / new Function / document.write / string-based setTimeout
Warnings (printed, not blocking) for a human look:
  - HTML built by string concatenation with a bare variable (possible unescaped text)

Usage:
  python3 tools/safety_check.py FILE...          check the given files
  python3 tools/safety_check.py --hook           read a Claude Code PreToolUse payload on stdin;
                                                 exit 2 (blocks the publish) on problems
"""
import json
import pathlib
import re
import sys

ALLOWED_HOSTS = (
    "fonts.googleapis.com", "fonts.gstatic.com",
    "cdnjs.cloudflare.com", "cdn.jsdelivr.net", "unpkg.com",
    # Data APIs the Radar app reads on purpose (the two OpenStreetMap ones receive the
    # phone's location, only when "near me" / "where am I" is tapped):
    "api.open-meteo.com", "marine-api.open-meteo.com", "ntfy.sh",
    "overpass-api.de", "nominatim.openstreetmap.org",
    # Radar's "Look around here" / "Scout this city" fall back to two more public Overpass
    # (OpenStreetMap) mirrors when overpass-api.de is down, and ask Wikipedia's geosearch for
    # notable places. They receive the phone's coordinates, only when those buttons are tapped:
    "overpass.kumi.systems", "overpass.private.coffee", "en.wikipedia.org",
    # Radar sends notes (interests, feedback, city) as GitHub issues in the background, using a
    # token the owner pastes on the phone; it is kept in the phone's storage, never in the repo:
    "api.github.com",
    # Radar's /api/scout Cloudflare function asks the Claude API (with web search) to research a
    # city on the owner's tap; the key lives in Cloudflare, never in the repo or on the phone:
    "api.anthropic.com",
)

SECRETS = [
    (r"ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}", "GitHub token"),
    (r"sk-(?:ant-)?[A-Za-z0-9_-]{20,}", "API secret key"),
    (r"AKIA[0-9A-Z]{16}", "AWS access key"),
    (r"AIza[0-9A-Za-z_-]{35}", "Google API key"),
    (r"xox[abpr]-[A-Za-z0-9-]{10,}", "Slack token"),
    (r"-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----", "private key"),
    (r"""(?i)["']?(?:api[_-]?key|client[_-]?secret|access[_-]?token|auth[_-]?token|password)["']?\s*[:=]\s*["'][^"'\s]{12,}["']""", "hard-coded credential"),
]

DANGEROUS = [
    (r"\beval\s*\(", "eval()"),
    (r"\bnew\s+Function\s*\(", "new Function()"),
    (r"document\.write\s*\(", "document.write()"),
    (r"set(?:Timeout|Interval)\s*\(\s*[\"']", "setTimeout/setInterval with a code string"),
]

# Places a page loads code or data from: <script src>, <link href>, fetch(), XHR, WebSocket, import().
LOADS = re.compile(
    r"""<script[^>]+src=["']([^"']+)["']"""
    r"""|<link[^>]+rel=["']?(?:stylesheet|preload|modulepreload)["']?[^>]*href=["']([^"']+)["']"""
    r"""|<link[^>]+href=["']([^"']+)["'][^>]*rel=["']?(?:stylesheet|preload|modulepreload)"""
    r"""|\bfetch\s*\(\s*["'`]([^"'`]+)["'`]"""
    r"""|\.open\s*\(\s*["'][A-Z]+["']\s*,\s*["'`]([^"'`]+)["'`]"""
    r"""|new\s+WebSocket\s*\(\s*["'`]([^"'`]+)["'`]"""
    r"""|\bimport\s*\(\s*["'`]([^"'`]+)["'`]""",
    re.I,
)

# '<tag>' + something + '</tag>' where something is a bare variable, not an escaping call.
CONCAT = re.compile(r"""['"][^'"]*<[a-z][^'"]*['"]\s*\+\s*([A-Za-z_$][\w$]*(?:\.[\w$]+)*)\s*\+""", re.I)
SAFE_NAMES = re.compile(r"(?i)(escape|safe|html|svg|label|count|len|idx|index|size|kept|active)")


def host_of(url):
    m = re.match(r"(?i)(?:https?:|wss?:)?//([^/:?#]+)", url.strip())
    return m.group(1).lower() if m else None  # None = same site (relative URL)


def check_text(name, text):
    problems, warnings = [], []
    lines = text.splitlines()

    def line_no(pos):
        return text.count("\n", 0, pos) + 1

    for pattern, label in SECRETS:
        for m in re.finditer(pattern, text):
            problems.append("%s:%d: looks like a %s" % (name, line_no(m.start()), label))
    for pattern, label in DANGEROUS:
        for m in re.finditer(pattern, text):
            problems.append("%s:%d: uses %s" % (name, line_no(m.start()), label))
    for m in LOADS.finditer(text):
        url = next(g for g in m.groups() if g)
        host = host_of(url)
        if host and not any(host == h or host.endswith("." + h) for h in ALLOWED_HOSTS):
            problems.append("%s:%d: loads from a host that isn't on the allowlist: %s" % (name, line_no(m.start()), host))
    for i, line in enumerate(lines, 1):
        for m in CONCAT.finditer(line):
            var = m.group(1)
            if not SAFE_NAMES.search(var):
                warnings.append("%s:%d: HTML built with '%s' unescaped, check it can't carry markup" % (name, i, var))
    return problems, warnings


def check_files(paths):
    problems, warnings = [], []
    for p in paths:
        path = pathlib.Path(p)
        if not path.is_file() or path.suffix.lower() not in (".html", ".htm", ".js", ".json", ".css", ".md", ".webmanifest"):
            continue
        pr, wa = check_text(str(path), path.read_text(encoding="utf-8", errors="replace"))
        problems += pr
        warnings += wa
    return problems, warnings


def hook_paths(payload):
    ti = payload.get("tool_input") or {}
    paths = []
    if ti.get("asset"):
        return paths
    if ti.get("file_path"):
        paths.append(ti["file_path"])
    files = ti.get("files")
    root = pathlib.Path(ti.get("root") or ".")
    if isinstance(files, dict):
        for v in files.values():
            src = v.get("from") if isinstance(v, dict) else v
            if isinstance(src, str):
                paths.append(str(root / src) if not src.startswith("/") else src)
    elif isinstance(files, list):
        for v in files:
            if isinstance(v, dict) and isinstance(v.get("path"), str):
                paths.append(str(root / v["path"]))
    return paths


def main():
    if sys.argv[1:] == ["--hook"]:
        payload = json.load(sys.stdin)
        if payload.get("tool_input", {}).get("action", "publish") != "publish":
            return 0
        problems, warnings = check_files(hook_paths(payload))
        if problems:
            sys.stderr.write("Safety check blocked this publish:\n  " + "\n  ".join(problems) + "\n")
            return 2
        msg = "Safety check passed"
        if warnings:
            msg += " (%d thing%s to eyeball)" % (len(warnings), "" if len(warnings) == 1 else "s")
            sys.stderr.write("Safety check warnings:\n  " + "\n  ".join(warnings) + "\n")
        print(json.dumps({"systemMessage": msg}))
        return 0

    problems, warnings = check_files(sys.argv[1:])
    for w in warnings:
        print("warning: " + w)
    for p in problems:
        print("PROBLEM: " + p)
    print("%d problem(s), %d warning(s)" % (len(problems), len(warnings)))
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
