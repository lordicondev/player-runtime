// Golden frames (test/golden): the WebAssembly build draws every case like the PNG there; with
// LORDICON_NATIVE_FRAMES=<dir> (cli/goldens output), the native build too. Both builds come from
// the same C++, so a difference between them, or a change after a ThorVG update or a patch,
// shows up here. LORDICON_UPDATE_GOLDEN=1 writes the PNG files from the native frames instead.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { createRuntime, type Runtime } from './index.ts';
import { compare, decodePng, encodePng, readCases } from './testing/golden.ts';

const root = resolve(import.meta.dirname, '..');
const dir = resolve(root, 'test/golden');
const cases = readCases(resolve(dir, 'cases.txt'));
const native = process.env.LORDICON_NATIVE_FRAMES;
const update = !!process.env.LORDICON_UPDATE_GOLDEN;

// The WebAssembly and native (x86-64) builds draw the same bytes today; other compilers or SIMD
// may put a channel a step or two off on anti-aliased edges. A real change moves many pixels by
// much more.
const TOLERANCE = 8;
const MAX_PIXELS = 0.002; // share of the frame

let runtime: Runtime;

beforeAll(async () => {
    runtime = await createRuntime({ wasm: readFileSync(resolve(root, 'src/wasm/lordicon.wasm')) });
});

function nativeFrame(name: string): Uint8Array {
    if (!native) throw new Error('LORDICON_NATIVE_FRAMES: the directory of cli/goldens output');
    return new Uint8Array(readFileSync(resolve(native, `${name}.rgba`)));
}

function golden(name: string): Uint8Array {
    const path = resolve(dir, `${name}.png`);
    if (!existsSync(path)) throw new Error(`${name}.png missing: see test/golden/README.md`);
    return decodePng(readFileSync(path)).pixels;
}

function expectClose(frame: Uint8Array, name: string, size: number): void {
    const { max, pixels } = compare(frame, golden(name), TOLERANCE);
    expect(
        pixels,
        `${pixels} pixel(s) off by more than ${TOLERANCE} (max ${max})`,
    ).toBeLessThanOrEqual(Math.floor(size * size * MAX_PIXELS));
}

describe.skipIf(update)('golden frames', () => {
    it.each(cases)('$name: WebAssembly', (c) => {
        const icon = runtime.load(readFileSync(resolve(root, 'examples/icons', c.icon), 'utf8'));
        for (const item of c.colors?.split(',') ?? []) {
            const [name, value] = item.split(':');
            expect(icon.setColor(name, value)).toBe(true);
        }
        if (c.stroke !== null) expect(icon.setStroke(c.stroke as 1 | 2 | 3)).toBe(true);
        icon.seek(icon.firstFrame + Math.round(c.t * (icon.totalFrames - 1)));
        const frame = icon.render(c.size, c.size);
        icon.destroy();
        expectClose(new Uint8Array(frame), c.name, c.size);
    });

    it.skipIf(!native).each(cases)('$name: native', (c) => {
        expectClose(nativeFrame(c.name), c.name, c.size);
    });
});

describe.runIf(update)('golden frames: update from the native build', () => {
    it.each(cases)('$name', (c) => {
        const png = encodePng(nativeFrame(c.name), c.size, c.size);
        writeFileSync(resolve(dir, `${c.name}.png`), png);
        expect(decodePng(png).pixels).toEqual(nativeFrame(c.name));
    });
});
