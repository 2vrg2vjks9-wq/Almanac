#!/usr/bin/env bash
# Claude Code PostToolUse hook for the Artifact tool.
# When an app's app.html has just been published as its Claude artifact, rebuild the
# home-screen version and push it to GitHub (main is what Pages serves).
set -euo pipefail

file=$(jq -r '.tool_input.file_path // empty')
case "$file" in
  */curiosity/app.html|curiosity/app.html) app=curiosity; label="Curiosity Almanac"; extra="" ;;
  */enso/app.html|enso/app.html)           app=enso;      label="Ensō";              extra="enso/poems.json" ;;
  */proxima/app.html|proxima/app.html)     app=proxima;   label="Proxima";           extra="" ;;
  */loam/app.html|loam/app.html)           app=loam;      label="Loam";              extra="" ;;
  *) exit 0 ;;
esac

cd "$(dirname "$0")/.."
python3 tools/build_app.py "$app" >/dev/null

git add "$app/app.html" "$app/index.html" $extra
if git diff --cached --quiet; then
  echo "{\"systemMessage\":\"$label: repo already up to date\"}"
  exit 0
fi

git commit -q -m "$label: update from artifact publish" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KcBgUkyvVhXdjcf3o66Xi1"

# Rebase on anything pushed from elsewhere, then push; retry briefly on network errors.
for delay in 0 2 4 8 16; do
  sleep "$delay"
  if git pull -q --rebase origin main && git push -q -u origin main; then
    echo "{\"systemMessage\":\"$label pushed to GitHub ($(git rev-parse --short HEAD))\"}"
    exit 0
  fi
done
echo "{\"systemMessage\":\"$label: built and committed, but the push to GitHub failed\"}"
exit 1
