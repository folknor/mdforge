#!/bin/sh
# Runs check-electron-render.cjs with debug logging, killing it after 60s so a
# hang shows up as a timeout instead of blocking forever.
#
# Usage: ./scripts/check-electron-render.sh [--display] [out.pdf]
#   --display  use the real display and GPU, like `pnpm desktop` does,
#              instead of headless ozone with the GPU disabled.
set -u
root=$(cd "$(dirname "$0")/.." && pwd)

mode=headless

if [ "${1:-}" = "--display" ]; then
  mode=display
  shift
fi

out=${1:-$root/electron-render.pdf}
cd "$root/packages/desktop" || exit 1

if [ "$mode" = display ]; then
  MDFORGE_DEBUG=1 timeout 60 ./node_modules/.bin/electron --no-sandbox \
    ../../scripts/check-electron-render.cjs "--out=$out"
else
  MDFORGE_DEBUG=1 timeout 60 env -u DISPLAY -u WAYLAND_DISPLAY \
    ./node_modules/.bin/electron --no-sandbox --ozone-platform=headless --disable-gpu \
    ../../scripts/check-electron-render.cjs "--out=$out"
fi

echo "exit: $?"
