#!/usr/bin/env bash
# Claude Code PostToolUse hook for the Artifact tool.
# When curiosity/app.html has just been published as the Curiosity Almanac artifact,
# rebuild the home-screen version and push both to GitHub (main is what Pages serves).
set -euo pipefail

file=$(jq -r '.tool_input.file_path // empty')
case "$file" in
  */curiosity/app.html|curiosity/app.html) ;;
  *) exit 0 ;;
esac

cd "$(dirname "$0")/.."
python3 tools/build_curiosity.py >/dev/null

git add curiosity/app.html curiosity/index.html
if git diff --cached --quiet; then
  echo '{"systemMessage":"Curiosity Almanac: repo already up to date"}'
  exit 0
fi

git commit -q -m "Curiosity: update from artifact publish" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KcBgUkyvVhXdjcf3o66Xi1"

# Rebase on anything pushed from elsewhere, then push; retry briefly on network errors.
for delay in 0 2 4 8 16; do
  sleep "$delay"
  if git pull -q --rebase origin main && git push -q -u origin main; then
    echo "{\"systemMessage\":\"Curiosity Almanac pushed to GitHub ($(git rev-parse --short HEAD))\"}"
    exit 0
  fi
done
echo '{"systemMessage":"Curiosity Almanac: built and committed, but the push to GitHub failed"}'
exit 1
