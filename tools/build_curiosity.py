#!/usr/bin/env python3
"""Build curiosity/index.html (the home-screen app) from curiosity/app.html (the Claude artifact page).

app.html is exactly what gets published as the Claude artifact. The site version keeps the
home-screen wrapper already at the top of index.html (icons, manifest, service worker, the
one-time progress import) and swaps a few lines of wording that only make sense on a phone.
"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "curiosity" / "app.html"
OUT = ROOT / "curiosity" / "index.html"
START = "<title>Curiosity Almanac</title>"

# Artifact wording -> home-screen app wording.
REPLACEMENTS = [
    ("Kept facts are stored in this browser only", "Kept facts and progress are saved on this iPhone"),
]


def main():
    src = SRC.read_text(encoding="utf-8")
    old = OUT.read_text(encoding="utf-8")

    if START not in src or START not in old:
        sys.exit("build_curiosity: couldn't find %r in app.html and index.html" % START)

    wrapper = old[: old.index(START)]
    body = src[src.index(START):].rstrip()
    for before, after in REPLACEMENTS:
        body = body.replace(before, after)

    out = wrapper + body + "\n\n</body></html>"
    if out != old:
        OUT.write_text(out, encoding="utf-8")
        print("built curiosity/index.html")
    else:
        print("curiosity/index.html already up to date")


if __name__ == "__main__":
    main()
