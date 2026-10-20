#!/usr/bin/env bash
# Builds the wasm module with emscripten (emcc on PATH, else EMSDK, default ~/tools/emsdk) into
# src/wasm/, where the TypeScript package and the tests pick it up. Prints raw and compressed sizes.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
command -v emcc >/dev/null || source "${EMSDK:-$HOME/tools/emsdk}/emsdk_env.sh" >/dev/null 2>&1
emcmake cmake -S "$root" -B "$root/build/wasm" -G Ninja -DCMAKE_BUILD_TYPE=Release >/dev/null
cmake --build "$root/build/wasm"
mkdir -p "$root/src/wasm"
# The glue's own default URL would make bundlers emit the .wasm a second time: the package
# always passes the location itself (src/index.ts).
sed 's|new URL("lordicon.wasm",import.meta.url).href|""|' "$root/build/wasm/lordicon.js" > "$root/src/wasm/lordicon.js"
grep -q 'new URL("lordicon.wasm"' "$root/src/wasm/lordicon.js" && { echo "glue changed: check build-wasm.sh" >&2; exit 1; }
cp "$root/build/wasm/lordicon.wasm" "$root/src/wasm/"
for f in lordicon.wasm lordicon.js; do
    printf '%-14s raw %7d  gzip %7d  brotli %7d\n' $f "$(stat -c %s "$root/src/wasm/$f")" \
        "$(gzip -9c "$root/src/wasm/$f" | wc -c)" "$(brotli -c -q 11 "$root/src/wasm/$f" | wc -c)"
done
