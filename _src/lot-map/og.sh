#!/bin/sh
# Takes the share picture of the lot-map page: og.html at 1200x630, into ../../lot-map/og.png.
# Needs the site served from its root on port 8765 (python3 -m http.server 8765 --directory <site>) and Google Chrome.
set -e
here=$(cd "$(dirname "$0")" && pwd)
profile=$(mktemp -d)
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars \
  --force-device-scale-factor=1 --user-data-dir="$profile" --window-size=1200,630 --virtual-time-budget=4000 \
  --screenshot="$here/../../lot-map/og.png" "http://localhost:8765/_src/lot-map/og.html" >/dev/null 2>&1
rm -r "$profile"
ls -l "$here/../../lot-map/og.png"
