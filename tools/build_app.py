#!/usr/bin/env python3
"""Build <app>/index.html (the home-screen app) from <app>/app.html (the Claude artifact page).

app.html is exactly what gets published as the Claude artifact. The site version keeps the
home-screen wrapper already at the top of index.html (icons, manifest, service worker, and
for Curiosity the one-time progress import) and swaps any wording that only makes sense on a phone.

Usage: python3 tools/build_app.py curiosity|enso|proxima
"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

APPS = {
    "curiosity": {
        "start": "<title>Curiosity Almanac</title>",
        # Artifact wording -> home-screen app wording.
        "replacements": [
            ("Kept facts are stored in this browser only", "Kept facts and progress are saved on this iPhone"),
        ],
    },
    "enso": {
        "start": "<title>Ensō</title>",
        "replacements": [],
    },
    "proxima": {
        "start": "<title>Proxima</title>",
        "replacements": [],
    },
}


def build(name):
    cfg = APPS[name]
    src_path = ROOT / name / "app.html"
    out_path = ROOT / name / "index.html"
    start = cfg["start"]

    src = src_path.read_text(encoding="utf-8")
    old = out_path.read_text(encoding="utf-8")
    if start not in src or start not in old:
        sys.exit("build_app: couldn't find %r in %s/app.html and %s/index.html" % (start, name, name))

    wrapper = old[: old.index(start)]
    body = src[src.index(start):].rstrip()
    for before, after in cfg["replacements"]:
        body = body.replace(before, after)

    out = wrapper + body + "\n\n</body></html>"
    if out != old:
        out_path.write_text(out, encoding="utf-8")
        print("built %s/index.html" % name)
    else:
        print("%s/index.html already up to date" % name)


if __name__ == "__main__":
    if len(sys.argv) != 2 or sys.argv[1] not in APPS:
        sys.exit("usage: build_app.py " + "|".join(APPS))
    build(sys.argv[1])
