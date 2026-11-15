#!/bin/sh
# Runs check-electron-render.cjs with debug logging, killing it after 60s so a
# hang shows up as a timeout instead of blocking forever.
#
# Usage: ./scripts/check-electron-render.sh [--display] [out.pdf|out.html [in.md]]
#   out.html   renders HTML output instead of a PDF.
#   --display  use the real display and GPU, like `pnpm desktop` does,
#              instead of headless ozone with the GPU disabled.
#   in.md      the document to render; defaults to an example document.
set -u
root=$(cd "$(dirname "$0")/.." && pwd)

mode=headless

if [ "${1:-}" = "--display" ]; then
  mode=display
  shift
fi

# Relative paths are taken from the caller's directory, before the cd below.
absolute() {
  case $1 in
    /*) printf '%s\n' "$1" ;;
    *) printf '%s\n' "$PWD/$1" ;;
  esac
}

out=$(absolute "${1:-$root/electron-render.pdf}")
set -- "--out=$out" ${2:+"--in=$(absolute "$2")"}
cd "$root/packages/desktop" || exit 1

if [ "$mode" = display ]; then
  MDFORGE_DEBUG=1 timeout 60 ./node_modules/.bin/electron --no-sandbox \
    ../../scripts/check-electron-render.cjs "$@"
else
  MDFORGE_DEBUG=1 timeout 60 env -u DISPLAY -u WAYLAND_DISPLAY \
    ./node_modules/.bin/electron --no-sandbox --ozone-platform=headless --disable-gpu \
    ../../scripts/check-electron-render.cjs "$@"
fi

echo "exit: $?"
