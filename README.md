# Lordicon Runtime

The engine under Lordicon players. It takes an animated [Lordicon](https://lordicon.com/) icon
and turns it into pixels with [ThorVG](https://github.com/thorvg/thorvg), natively (C++) and in
WebAssembly, and it looks the same on every platform.

**This is for player authors.** The runtime knows frames, segments, colours and stroke. States,
triggers and components are the job of the players built on it. In an app, use a player:
[`@lordicon/react-native`](https://github.com/lordicondev/player-react-native) for React Native,
[`@lordicon/element`](https://www.npmjs.com/package/@lordicon/element) or
[`@lordicon/react`](https://www.npmjs.com/package/@lordicon/react) for the web.

What it adds to ThorVG:

- it resolves the expressions Lordicon icons use for colours and stroke into values and ThorVG
  slots, so ThorVG runs without a JavaScript engine and colours and stroke change live (animated
  stroke widths keep their keyframes),
- it plays a segment (speed, direction, loop, a rest between rounds) on your clock: call
  `tick(dt)`, and render when something changed,
- it parses an icon once for any number of drawings of it, each with its own frame and look,
- it renders into an RGBA buffer: a canvas on the web, a bitmap or a layer on mobile, a file,
- it ships ThorVG with patches that make icons play as they were designed in After Effects
  (blend modes, trims, easing, mattes; see [below](#thorvg-and-its-patches)).

## Install

```sh
npm install @lordicon/runtime
```

The package holds the TypeScript API with the WebAssembly (`dist/`), and the C++ sources for
native builds (`core/`, `CMakeLists.txt`, ThorVG already patched in `thorvg-src/`).

## The `.wasm` file

`lordicon.wasm` (about 140 KB gzipped) sits next to the code in `dist` and loads from there.

- **With a bundler** (Vite, webpack): nothing to do, it finds the file and copies it.
- **Served as it is**: serve `dist` from one place and import its `index.js`.
- **From elsewhere**: `createRuntime({ wasm: '/libs/lordicon.wasm' })`.
- **Node**, or bytes you have: `createRuntime({ wasm: readFileSync(path) })`.

Example: [frames of an icon to PNG in Node](examples/node/frames.mjs).

## Web: a first frame

```js
import { createRuntime, Events } from '@lordicon/runtime';

const runtime = await createRuntime();
const icon = runtime.load(await (await fetch('/icons/download.json')).text());

const hover = icon.markers.find((m) => m.name === 'default:hover-pinch');
icon.segment(hover.begin, hover.end);
icon.play();

const context = canvas.getContext('2d');
let last = 0;
requestAnimationFrame(function frame(now) {
    const events = icon.tick(last ? (now - last) / 1000 : 0);
    last = now;
    if (events & Events.frame) icon.draw(context);
    if (icon.playing) requestAnimationFrame(frame);
});
```

`load()` throws when the text is not a Lottie icon. Example: [01 Playback](examples/01-playback.ts);
all examples are listed [at the end](#examples).

## Icons and models

`runtime.load(json)` takes the icon's Lottie JSON, as text or an object, and returns an `Icon`.
For an icon shown in many places at once, parse it once into a model and draw icons from it: one
copy in memory (50 to 470 KB saved per icon after the first), no parsing for the next ones, and
each has its own playback and look.

```js
const model = runtime.model(json);
const icons = [model.icon(), model.icon()];
model.destroy(); // the icons keep the model
```

An `Icon`:

|                                                                     |                                                                               |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `width`, `height`                                                   | the composition size                                                          |
| `frameRate`, `totalFrames`, `firstFrame`                            | `totalFrames` is `op - ip`, `firstFrame` is `ip` (widened to the markers)     |
| `markers`                                                           | `[{ name: 'default:hover-pinch', begin, end }, ...]`                          |
| `colors`, `setColor(name, '#rrggbb')`                               | the icon's named colours; a change takes effect on the next frame             |
| `stroke`, `setStroke(1 \| 2 \| 3)`                                  | light, regular, bold; `stroke` is 0 for icons without a stroke control        |
| `setTint('#rrggbb' \| null)`                                        | the whole icon in one colour, alpha kept, like CSS `currentColor`             |
| `segment(begin, end)`, `playback({ speed, direction, loop, rest })` | what to play; `rest`: seconds on the last frame between loop rounds           |
| `play()`, `pause()`, `playing`, `seek(frame)`, `frame`              |                                                                               |
| `tick(dt)`                                                          | advances by `dt` seconds, returns `Events` flags: `complete`, `loop`, `frame` |
| `draw(context, width?, height?)`                                    | renders onto a 2D canvas context, its whole size by default                   |
| `render(width, height)`                                             | renders into a new `Uint8ClampedArray`, RGBA with straight alpha              |
| `destroy()`                                                         | frees the icon                                                                |

Markers name the icon's states: `default:` marks the default one, a suffix like `:0.5` the point
of a morph's turn. Frames are absolute, as markers count them: from `firstFrame` to
`firstFrame + totalFrames - 1`. A file narrowed to one state (`ip`, `op` around it, as
lordicon.com often gives it) still holds all its states: its frames are widened to its markers,
so every state plays, as in the Lordicon players.
Examples: [02 Colours, stroke and tint](examples/02-looks.ts),
[04 Models](examples/04-models.ts).

## Playback

```js
icon.segment(cycle.begin, cycle.end);
icon.playback({ loop: true, rest: 0.5 }); // half a second on the last frame between rounds
icon.play();

const events = icon.tick(dt);
if (events & Events.frame) icon.draw(context);
if (events & Events.loop) console.log('a round ended');
if (events & Events.complete) console.log('the segment ended');
```

The runtime has no clock: the caller ticks every icon with the time since the last tick, and
draws when `tick()` says there is a new frame. `pause()` holds a rest too; turning the loop off
ends the round in progress. Example: [03 Loops and events](examples/03-loops.ts).

## Threads and workers

A runtime and its icons belong to one thread. To render on several, create a runtime in each Web
Worker and hand canvases over with `transferControlToOffscreen()`: the main thread stays free,
and icons keep moving while it is busy. Example: [05 Workers](examples/05-workers.ts).

## Native

The core is C++ with a C API, [`core/lordicon_c.h`](core/lordicon_c.h), for JNI, Objective-C++
or anything that links C. `CMakeLists.txt` builds ThorVG and the core from a source list, with no
other build system:

```cmake
add_subdirectory(path/to/@lordicon/runtime lordicon)
target_link_libraries(your_target PRIVATE lordicon_core)
```

```c
li_init(0);
li_shared_canvas(1);                          /* one ThorVG canvas per thread */
li_model* model = li_model_load(json, size, -1);
li_icon* icon = li_icon_new(model);           /* or li_load(json, size, -1) for one */
li_model_free(model);                         /* the icon keeps it */
li_segment(icon, begin, end);
li_play(icon);

/* on every frame of the platform clock */
if (li_tick(icon, dt) & LI_EVENT_FRAME)
    li_render_into(icon, pixels, width, height, stride, 1 /* premultiplied */);
```

| Group     | Functions                                                                                                  |
| --------- | ---------------------------------------------------------------------------------------------------------- |
| setup     | `li_init`, `li_shared_canvas`, `li_term`                                                                   |
| loading   | `li_model_load`, `li_model_free`, `li_icon_new`, `li_load`, `li_free`                                      |
| the file  | `li_width`, `li_height`, `li_frame_rate`, `li_total_frames`, `li_first_frame`, `li_marker_*`               |
| looks     | `li_color_count`, `li_color_name`, `li_color`, `li_set_color`, `li_stroke`, `li_set_stroke`, `li_set_tint` |
| playback  | `li_segment`, `li_playback`, `li_play`, `li_pause`, `li_playing`, `li_seek`, `li_current_frame`, `li_tick` |
| rendering | `li_render` (the icon's own buffer), `li_render_into` (yours, straight or premultiplied alpha)             |

Threads: a model and its icons are used from one thread, always the same one with
`li_shared_canvas(1)`, also to free them. Different models can render on different threads at
the same time. Before rendering, an icon puts its frame and look on the model; equal looks share
one ThorVG slot.

The ThorVG sources come from, in this order: `-DTHORVG_SRC=<patched tree>`, `thorvg-src/` next to
`CMakeLists.txt` (in the npm package), or the `thorvg/` submodule of a clone, exported and patched
into the build directory. `core/thorvg/config.h` is ThorVG's build configuration for any build
system: `@lordicon/react-native` compiles the same files with CMake on Android and CocoaPods on
iOS. Size (stripped, core and ThorVG, C API only): about 375 KB on arm64 with `-Os` and the
shared C++ runtime, as in an Android app.

Example: [the C API from a CMake project](examples/native/main.c).

## Examples

`npm start` in a clone serves the web ones at http://localhost:8080.

| Example                                             | What                                                   |
| --------------------------------------------------- | ------------------------------------------------------ |
| [01 Playback](examples/01-playback.ts)              | states from markers, play, pause, loop, speed          |
| [02 Colours, stroke and tint](examples/02-looks.ts) | changed live, without reloading                        |
| [03 Loops and events](examples/03-loops.ts)         | a rest between rounds, the flags of `tick()`           |
| [04 Models](examples/04-models.ts)                  | an icon parsed once for many, one clock for all        |
| [05 Workers](examples/05-workers.ts)                | icons rendered on several threads                      |
| [Node](examples/node/frames.mjs)                    | frames of an icon to PNG files                         |
| [Native](examples/native/main.c)                    | a model, two icons, a clock, frames to PNG, from CMake |

## How faithful it is

Icons play as they do in the Lordicon web player. Small differences can show up, such as a line a
pixel off in fast motion. If an icon looks clearly wrong, please
[open an issue](https://github.com/lordicondev/player-runtime/issues) with the icon file.

Like the web player, the runtime applies the expressions Lordicon icons use for colours and
stroke, resolved when the icon loads. Any other expression keeps the value stored in the file.

## ThorVG and its patches

`patches/` holds our changes to ThorVG. Each patch starts with a header that says what it fixes
and where it comes from. Most of them make ThorVG draw icons the way After Effects does; two are
based on unmerged pull requests by ThorVG contributors. Each fix comes with a minimal Lottie file
in `patches/cases/` and a test. See [THIRD_PARTY.md](THIRD_PARTY.md) and, to update ThorVG,
[CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT, see [LICENSE.md](LICENSE.md). ThorVG, RapidJSON and Emscripten: see
[THIRD_PARTY.md](THIRD_PARTY.md).
