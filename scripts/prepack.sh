#!/usr/bin/env bash
# Run by `npm pack` and `npm publish`: writes the patched ThorVG sources (thorvg-src/) and dist/
# from the current wasm build. Stops when src/wasm/ is missing or older than what it is built
# from, so a package never ships a stale engine: run `npm run build:wasm` first.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
wasm="$root/src/wasm/lordicon.wasm"
if [ ! -f "$wasm" ]; then
    echo "no src/wasm/lordicon.wasm: run npm run build:wasm" >&2
    exit 1
fi
newer=$(find "$root/core" "$root/wasm" "$root/thorvg/src" "$root/thorvg/inc" "$root/CMakeLists.txt" \
    "$root"/patches/*.patch -type f -newer "$wasm" -print -quit)
if [ -n "$newer" ]; then
    echo "src/wasm/lordicon.wasm is older than ${newer#"$root"/}: run npm run build:wasm" >&2
    exit 1
fi
"$root/scripts/vendor-thorvg.sh"
cd "$root" && npx vite build
