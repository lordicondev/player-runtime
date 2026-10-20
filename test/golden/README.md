# Golden frames

What the runtime draws for the cases in `cases.txt`: icons from `examples/icons` at a few frames,
sizes, colours and strokes. `src/golden.test.ts` checks the WebAssembly build against these PNG
files on every `npm test`, and the native build too when given its frames. CI does both, so a
ThorVG update, a patch or a change in the core that alters a frame fails until the PNG files are
updated on purpose.

The native build is the reference (`cli/goldens` renders through the C API, as the players do):

```sh
cmake -B build/native -G Ninja -DCMAKE_BUILD_TYPE=Release && cmake --build build/native
mkdir -p build/golden && build/native/goldens test/golden/cases.txt examples/icons build/golden

LORDICON_NATIVE_FRAMES=build/golden npx vitest run src/golden.test.ts           # check
LORDICON_NATIVE_FRAMES=build/golden LORDICON_UPDATE_GOLDEN=1 npx vitest run src/golden.test.ts   # update
```

Before updating, look at the changed frames: an update says the new drawing is the right one.
New cases: a line in `cases.txt`, then update.
