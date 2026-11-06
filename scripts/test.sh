#!/usr/bin/env bash
# Runs tests/run.html in a headless browser. Needs only Chrome, Chromium or Edge.
# Set CHROME_BIN to choose a specific browser.
set -u
cd "$(dirname "$0")/.."

find_browser() {
  local candidates=(
    "${CHROME_BIN:-}"
    google-chrome google-chrome-stable chromium chromium-browser microsoft-edge
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
    "/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
    "/c/Program Files/Microsoft/Edge/Application/msedge.exe"
    "/c/Program Files/Google/Chrome/Application/chrome.exe"
  )
  local c
  for c in "${candidates[@]}"; do
    if [ -n "$c" ] && { [ -x "$c" ] || command -v "$c" >/dev/null 2>&1; }; then
      printf '%s\n' "$c"
      return 0
    fi
  done
  return 1
}

browser="$(find_browser)" || {
  echo "No browser found. Install Chrome, or set CHROME_BIN, or open tests/run.html by hand." >&2
  exit 2
}

profile="$(mktemp -d)"
trap 'rm -rf "$profile"' EXIT

if command -v cygpath >/dev/null 2>&1; then
  page="file:///$(cygpath -m "$PWD")/tests/run.html"
  profile_arg="$(cygpath -w "$profile")"
else
  page="file://$PWD/tests/run.html"
  profile_arg="$profile"
fi

flags=(--headless=new --disable-gpu --no-first-run --user-data-dir="$profile_arg" --virtual-time-budget=20000)
# Hosted CI machines block the browser's own sandbox.
if [ -n "${CI:-}" ]; then flags+=(--no-sandbox); fi

dom="$("$browser" "${flags[@]}" --dump-dom "$page" 2>/dev/null)"
summary="$(printf '%s' "$dom" | sed -n 's:.*<h1[^>]*>\(.*\)</h1>.*:\1:p' | head -1)"
echo "${summary:-The test page did not finish.}"
printf '%s\n' "$dom" | sed 's:</li>:</li>\n:g' | sed -n 's:.*<li class="fail">\(.*\)</li>.*:FAIL \1:p'

case "$summary" in
  All*passed) exit 0 ;;
  *) exit 1 ;;
esac
