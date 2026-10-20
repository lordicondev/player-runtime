#!/usr/bin/env bash
# Exports the ThorVG submodule (thorvg/) into <out-dir> and applies patches/*.patch in order.
# Usage: scripts/prepare-thorvg.sh <out-dir> [patch-prefix...]   default: all patches
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
mkdir -p "$1"
out=$(cd "$1" && pwd)  # absolute; no `realpath -m` on macOS
shift
if [ ! -f "$root/thorvg/inc/thorvg.h" ]; then
    echo "thorvg/ is empty: run git submodule update --init" >&2
    exit 1
fi
patches=("$root"/patches/*.patch)
if [ $# -gt 0 ]; then
    patches=()
    for p in "$@"; do patches+=("$root"/patches/"$p"*.patch); done
fi
rm -rf "$out"
mkdir -p "$out"
git -C "$root/thorvg" archive HEAD | tar -x -C "$out"
# The tree may sit inside this repository (build/): stop git from finding it, or `git apply`
# would take paths relative to the repository root and skip every file without a word.
export GIT_CEILING_DIRECTORIES=$(dirname "$out")
for p in "${patches[@]}"; do
    # The whole output first: `git apply ... | grep -q` fails at random under pipefail, when
    # git writes after grep has quit (SIGPIPE). "Applied patch" proves the files were found.
    if ! log=$(cd "$out" && git apply --verbose "$p" 2>&1) || ! grep -q "^Applied patch" <<<"$log"; then
        echo "patch did not apply: $(basename "$p")" >&2
        echo "$log" >&2
        exit 1
    fi
done
echo "ThorVG $(git -C "$root/thorvg" rev-parse --short HEAD) + ${#patches[@]} patches -> $out"
