# Changelog

## 0.2.0 (2026-10-21)

- A file narrowed to one state (`ip`, `op` around it, as lordicon.com often gives it) plays all
  its states: its frames are widened to its markers, as the Lordicon players do. Before, its
  markers named states outside its frames, which could not be shown. `firstFrame` and
  `totalFrames` of such a file change (`lock.json` of the examples: 0 and 331, was 200 and 60);
  a whole file stays as it is.
- `frameRate` (`li_frame_rate`) is the file's own `fr`: it was `totalFrame / duration`, a float
  off (59.999996 for 331 frames at 60).

## 0.1.0 (2026-10-20)

The first version: the engine of the coming Lordicon players.

- The core (C++): loads a Lordicon icon into ThorVG, resolves its colour and stroke bindings into
  values and slots (no JavaScript engine for expressions), plays a segment with speed,
  direction and loop on the caller's clock, renders frames into RGBA buffers. A C API on top.
- ThorVG with four patches for blend modes (multiply shading of `wired` icons), one that keeps
  it from replacing the global `operator new`/`delete` (in an iOS app it would replace them for
  the whole app), and one for a slot applied on the same frame: layers kept their cached
  transforms, so changing the stroke of a paused icon with legacy stroke layers drew the old one.
- ThorVG patches from a visual comparison of the public Lordicon icons with the current web player:
  per-dimension easing, "trim individually" order and over several groups, a path between an
  open and a closed keyframe, trims one after another, translucent shapes and scenes in mattes,
  blended shapes in mattes, a stroke subpath starting where the previous one ended (07–15, each
  with a minimal case in `patches/cases/`).
- The core fills paths that a fill spans over several groups as one compound path (holes stay
  holes), drops trims that cut nothing (ThorVG split fills at them), and binds colour and stroke
  only within the icon's own composition.
- WebAssembly with a TypeScript API: `createRuntime()`, `Runtime.load()`, `Runtime.model()`,
  `Model`, `Icon`.
- Models: an icon loaded once (`Model`, `li_model_load`) draws any number of icons
  (`model.icon()`, `li_icon_new`), each with its own playback and look; equal looks share one
  ThorVG slot. 50 icons of one model take what one does, instead of 50 times 50 to 470 KB.
- A rest between loop rounds (`playback({ rest })`, `li_playback(…, rest)`): the icon holds its
  last frame, a pause holds the rest, turning the loop off ends it.
- Tint (`setTint()`, `li_set_tint`): the whole icon in one colour, alpha kept.
- Builds with CMake from a source list: natively, for Android (NDK) and for WebAssembly.
- The package carries the native sources: the core, `CMakeLists.txt` and ThorVG already
  patched (`thorvg-src/`, written by `scripts/vendor-thorvg.sh` when packing).
- Examples: playback; colours, stroke and tint; loops with a rest and the events of `tick()`;
  models (an icon parsed once for many); render workers; frames to PNG in Node
  (`examples/node`); the C API from a CMake project (`examples/native`). CI runs the last two.
- `tvgicon` (frames to PNG, timings), examples (with rendering in a pool of Web Workers),
  reference comparison tools.
- Fixed: a Vite build of an app left `lordicon.wasm` out (the package's code kept a
  `@vite-ignore` comment on its URL); now Vite and webpack emit it.
- Tests: golden frames for the wasm and native builds (`test/golden`), `capitest` for the C
  API, `threadtest`; CI runs them, also under AddressSanitizer, UndefinedBehaviorSanitizer and
  ThreadSanitizer (`LORDICON_SANITIZE`).
