# Third-party code

## ThorVG

The renderer. `thorvg/` is a git submodule of [thorvg/thorvg](https://github.com/thorvg/thorvg)
at commit `72a66415` (main, 1.2.0, 2026-10-13), built with the CPU engine and the Lottie
loader only. MIT License, Copyright (c) 2020 - 2026 ThorVG Project: `thorvg/LICENSE`.

We build ThorVG with the patches in `patches/`, applied in order by
`scripts/prepare-thorvg.sh`. Each patch starts with a header: what it fixes, where it comes
from, the base commit and the licence. Two of them are other people's work:

| Patch                                   | Origin                                                                                                                                                                                                                                                     |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `01-lottie-shape-blend`                 | Blend modes of fills: [thorvg/thorvg#4804](https://github.com/thorvg/thorvg/pull/4804) by Jinny You ([@tinyjin](https://github.com/tinyjin)), not merged upstream. Strokes added by Lordicon. Issue [#4817](https://github.com/thorvg/thorvg/issues/4817). |
| `02-sw-blend-transparent-target`        | [thorvg/thorvg#4884](https://github.com/thorvg/thorvg/pull/4884) by Shiny ([@ShinyChang](https://github.com/ShinyChang)), not merged upstream, ported by Lordicon to the current code. Issue [#4893](https://github.com/thorvg/thorvg/issues/4893).        |
| `03-sw-blend-translucent-shape`         | Lordicon.                                                                                                                                                                                                                                                  |
| `04-sw-matted-blend-translucent`        | Lordicon, following the approach of #4884.                                                                                                                                                                                                                 |
| `05-no-global-new`                      | Lordicon: the global `operator new`/`delete` replaced only with `THORVG_GLOBAL_NEW`.                                                                                                                                                                       |
| `06-lottie-slot-layer-cache`            | Lordicon: a slot applied on the same frame refreshes the layers' cached transforms (opacity switches of stroke layers).                                                                                                                                    |
| `07-lottie-per-dimension-easing`        | Lordicon: each dimension of a keyframe (scale, size...) eases with its own curve, as in After Effects.                                                                                                                                                     |
| `08-lottie-trim-individual-order`       | Lordicon: "trim individually" takes three or more paths in stacking order.                                                                                                                                                                                 |
| `09-sw-translucent-mask-edges`          | Lordicon: translucent shapes drawn into mattes and masks keep what is under their anti-aliased edges (C, AVX, NEON).                                                                                                                                       |
| `10-lottie-path-open-closed`            | Lordicon: a path interpolates between an open and a closed keyframe instead of holding.                                                                                                                                                                    |
| `11-lottie-trim-individual-over-groups` | Lordicon: "trim individually" takes the paths of several groups as one sequence.                                                                                                                                                                           |
| `12-sw-blend-mask-surface`              | Lordicon: shapes with a blend method draw into mattes and masks as normal shapes (coverage only).                                                                                                                                                          |
| `13-sw-translucent-image-mask`          | Lordicon: translucent scenes (fading precomps) composite over what is in a matte or mask.                                                                                                                                                                  |
| `14-sw-stroke-subpath-start`            | Lordicon: a stroke's subpath starting where the previous one ended keeps its first point (no sliver).                                                                                                                                                      |
| `15-lottie-trim-chained-wrap`           | Lordicon: a trim after another one wraps within the segment the earlier trim left.                                                                                                                                                                         |

The patches are under the MIT License, like ThorVG. `patches/cases/` holds minimal Lottie files
that show what they fix; `src/runtime.test.ts` checks them.

## RapidJSON

The core parses and rewrites icon JSON with the copy of [RapidJSON](https://rapidjson.org/)
that ThorVG ships (`thorvg/src/loaders/lottie/rapidjson`). MIT License, Copyright (C) 2015 THL
A29 Limited, a Tencent company, and Milo Yip: `thorvg/src/loaders/lottie/rapidjson/LICENSE`.

## Emscripten

`lordicon.wasm` and the glue code bundled in `dist/index.js` come from
[Emscripten](https://emscripten.org/), with its runtime and libc++ (MIT and University of
Illinois/NCSA Open Source License).
