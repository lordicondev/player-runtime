# Contributing

## Building

```sh
git clone --recurse-submodules git@github.com:lordicondev/player-runtime.git
npm install

npm run build:wasm      # src/wasm/lordicon.{js,wasm}; needs emsdk (EMSDK, default ~/tools/emsdk)
npm test                # vitest, the wasm module in Node
npm start               # the examples, at http://localhost:8080
npm run build           # dist/
npm run check           # types, lint and formatting

# native: tvgicon, memtest, threadtest, capitest, goldens
cmake -B build/native -G Ninja -DCMAKE_BUILD_TYPE=Release && cmake --build build/native
build/native/tvgicon icon.json --frames 0,30 --size 192 --out frame-%d.png
build/native/tvgicon icon.json --bench 5      # load and render timings, memory
build/native/capitest examples/icons          # the C API: playback, events, rendering
```

Android: the same `CMakeLists.txt` with the NDK toolchain (`-DLORDICON_SHARED=ON` builds
`liblordicon.so` with the C API only).

## Tests

- `npm test`: the TypeScript API on the wasm module, and the golden frames
  ([test/golden](test/golden/README.md)): what the runtime draws for a set of icons, frames,
  colours and strokes, checked for the wasm and (in CI) the native build.
- `capitest`: the C API as the players use it.
- `threadtest`: icons loaded and rendered on four threads at once, against a sequential run.
- Sanitizers: `-DLORDICON_SANITIZE=address` (with undefined behaviour) or `thread` builds the
  tools instrumented; CI runs `capitest`, `goldens` and `threadtest` under both. Leaks:
  `LSAN_OPTIONS=suppressions=cli/lsan.supp` (ThorVG keeps a pool per thread that rendered).
- The examples outside the browser (`examples/node`, `examples/native`) run in CI.

## Tools

`tools/` (its own `npm install`) compares what the runtime draws with the current web player,
`@lordicon/internal` in headless Chromium. Use it after a ThorVG update or a change to a patch
or the core. Every tool takes a set of files the same way (`input.mjs`): a directory of `.json`
files or a list, one `path<TAB>id` per line. The tools know nothing else about where the files
come from.

```sh
node tools/regress.mjs icons/ out/regress --shard 0/8          # ... up to --shard 7/8
node tools/regress-report.mjs out/report.csv out/regress       # one row per differing file
node tools/bisect.mjs icons/a.json 30 --out out/bisect-a       # which layers differ, and why
node tools/bisect.mjs --batch frames.tsv out/bisect.jsonl      # the same over many files
node tools/side.mjs icon.json 30 256 out/side.png              # one frame side by side
node tools/measure.mjs icons/ build/native/tvgicon 200 out/timings.json   # load and render times
```

- `regress.mjs` renders every file with the runtime and the reference at 12 frames and diffs
  them. Shards run in parallel, and a rerun skips what is done. It writes a strip
  (reference / runtime) for every file that differs.
- The reference is `@lordicon/internal`, the web player the runtime replaces: icons were designed
  and approved with it, so the runtime aims to draw what it draws.
- `--look custom` renders every file with other colours and stroke weight: the references get
  the file rewritten by `@lordicon/utils-lottie`, the runtime the same values through its slots.
- Metric (`diff.mjs`, `shift`): drawn pixels with no similar colour within 2 px in the other
  image, as a share and a count, worst frame. Ignores 1–2 px shifts, keeps missing, extra,
  recoloured or moved shapes. Classes (`regress-report.mjs`): ok (under 24 px, or up to 1.5% and
  under 100 px), minor (up to 3%), visible (up to 10% or 200+ px), major.
- `--bin` points any tool at another `tvgicon` build, e.g. one with a patch under work; `--ids`
  reruns a subset, such as the files that differed in a first pass.
- `bisect.mjs` draws each layer alone (with its matte and parents) and prints a signature of the
  layers that differ: shape items, modifiers, matte, mask, per-dimension easing...

## Updating ThorVG

Move the `thorvg/` submodule to a new commit, run `scripts/prepare-thorvg.sh build/check`, fix the
patches in `patches/` that no longer apply, then run the tests and the reference comparison.
`npm pack` writes the patched sources into `thorvg-src/` (`scripts/vendor-thorvg.sh`).

## Releasing

From a clone with emsdk, on a clean `main`:

```sh
npm run build:wasm      # the engine from the current sources
npm publish             # checks, tests, then thorvg-src/ and dist/, then the upload
```

`npm publish` stops before uploading when:

- `src/wasm/` is missing or older than what it is built from (`core/`, `wasm/`, `thorvg/`,
  `patches/`, `CMakeLists.txt`): `scripts/prepack.sh`, also run by `npm pack`;
- types, lint, formatting or tests fail (`prepublishOnly`).

Before it: the version in `package.json` and the heading in `CHANGELOG.md`, committed, and the
native tests and golden frames as in [Tests](#tests). After it: a tag `v<version>`.
