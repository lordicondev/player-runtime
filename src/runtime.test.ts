import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { createRuntime, Events, type Runtime } from './index.ts';

const root = resolve(import.meta.dirname, '..');
const icon = (name: string) =>
    readFileSync(resolve(root, 'examples/icons', `${name}.json`), 'utf8');

let runtime: Runtime;

beforeAll(async () => {
    runtime = await createRuntime({ wasm: readFileSync(resolve(root, 'src/wasm/lordicon.wasm')) });
});

/** Sum of a frame's bytes: a cheap fingerprint. */
const sum = (pixels: Uint8ClampedArray) => pixels.reduce((a, b) => a + b, 0);

describe('Icon', () => {
    it('reads size, frames, markers, colours and stroke', () => {
        const lock = runtime.load(icon('lock'));
        expect(lock.width).toBe(430);
        // Narrowed to its default state (ip 200, op 260), widened to all its states.
        expect(lock.firstFrame).toBe(0);
        expect(lock.totalFrames).toBe(331);
        expect(lock.frameRate).toBe(60);
        expect(lock.markers.map((m) => m.name)).toEqual([
            'in-reveal',
            'hover-locked',
            'default:morph-unlocked',
            'hover-unlocked',
        ]);
        expect(Object.keys(lock.colors)).toEqual(['primary', 'secondary']);
        expect(lock.stroke).toBe(2);
        lock.destroy();
    });

    it('widens a file narrowed to one state to all its states', () => {
        // lock.json is narrowed to its default state (ip 200, op 260), as lordicon.com gives a
        // file with a state chosen; the others are in it, as its markers say.
        const lock = runtime.load(icon('lock'));
        lock.seek(60); // in-reveal, outside the narrowed frames
        const reveal = sum(lock.render(48, 48));
        lock.seek(230); // morph-unlocked
        expect(reveal).toBeGreaterThan(0);
        expect(sum(lock.render(48, 48))).not.toBe(reveal);
        lock.destroy();
        // A whole file stays as it is, also with its last marker ending a frame after `op`.
        const whole = runtime.load(icon('wired-flat-24-approved-checked-hover-pinch'));
        expect([whole.firstFrame, whole.totalFrames]).toEqual([0, 60]);
        whole.destroy();
    });

    it('renders frames', () => {
        const lock = runtime.load(icon('lock'));
        lock.seek(220);
        const pixels = lock.render(96, 96);
        expect(pixels.length).toBe(96 * 96 * 4);
        expect(sum(pixels)).toBeGreaterThan(0);
        lock.seek(205);
        expect(sum(lock.render(96, 96))).not.toBe(sum(pixels));
        lock.destroy();
    });

    it('changes colour and stroke without reloading, and back', () => {
        const lock = runtime.load(icon('lock'));
        lock.seek(220);
        const before = sum(lock.render(96, 96));
        const { primary } = lock.colors;

        expect(lock.setColor('primary', '#ff0000')).toBe(true);
        expect(lock.colors.primary).toBe('#ff0000');
        expect(sum(lock.render(96, 96))).not.toBe(before);
        expect(lock.setStroke(3)).toBe(true);
        const bold = sum(lock.render(96, 96));

        lock.setColor('primary', primary);
        lock.setStroke(2);
        expect(sum(lock.render(96, 96))).toBe(before);
        expect(bold).not.toBe(before);
        expect(lock.setColor('nonexistent', '#ff0000')).toBe(false);
        lock.destroy();
    });

    it('plays a marker to its end, in absolute frames', () => {
        const lock = runtime.load(icon('lock'));
        const morph = lock.markers.find((m) => m.name === 'default:morph-unlocked')!;
        expect(morph.begin).toBe(200);
        lock.segment(morph.begin, morph.end);
        lock.playback({ speed: 1 });
        lock.play();
        let events = 0;
        for (let i = 0; i < 120 && lock.playing; i++) events |= lock.tick(1 / 60);
        expect(events & Events.complete).toBeTruthy();
        expect(events & Events.frame).toBeTruthy();
        expect(lock.frame).toBe(morph.end);
        lock.destroy();
    });

    it('loops', () => {
        const lock = runtime.load(icon('lock'));
        lock.segment(200, 210);
        lock.playback({ loop: true });
        lock.play();
        let events = 0;
        for (let i = 0; i < 30; i++) events |= lock.tick(1 / 60);
        expect(events & Events.loop).toBeTruthy();
        expect(lock.playing).toBe(true);
        lock.destroy();
    });

    it('rests on the last frame between loop rounds', () => {
        const lock = runtime.load(icon('lock'));
        lock.segment(200, 210);
        lock.playback({ loop: true, rest: 0.5 });
        lock.play();
        let ticks = 0;
        while (!(lock.tick(1 / 60) & Events.loop) && ticks++ < 100);
        expect(lock.frame).toBe(210);
        lock.render(16, 16);
        let quiet = 0;
        while (lock.tick(1 / 60) === 0 && quiet < 100) quiet++;
        expect(quiet).toBeGreaterThanOrEqual(28);
        expect(quiet).toBeLessThanOrEqual(31);
        expect(lock.frame).toBeLessThan(212);

        // Loop off during the rest: playback ends there.
        while (!(lock.tick(1 / 60) & Events.loop) && ticks++ < 200);
        lock.playback({ loop: false, rest: 0.5 });
        expect(lock.tick(1 / 60) & Events.complete).toBeTruthy();
        expect(lock.playing).toBe(false);
        lock.destroy();
    });

    it('tints the whole icon, alpha kept', () => {
        const lock = runtime.load(icon('lock'));
        lock.seek(220);
        const plain = lock.render(48, 48);
        lock.setTint('#ff0000');
        const red = lock.render(48, 48);
        let opaque = 0;
        for (let i = 0; i < red.length; i += 4) {
            expect(red[i + 3]).toBe(plain[i + 3]);
            if (!red[i + 3]) continue;
            opaque++;
            expect([red[i], red[i + 1], red[i + 2]]).toEqual([255, 0, 0]);
        }
        expect(opaque).toBeGreaterThan(0);
        lock.setTint(null);
        expect(lock.render(48, 48)).toEqual(plain);
        expect(() => lock.setTint('red')).toThrow();
        lock.destroy();
    });

    it('throws once destroyed', () => {
        const lock = runtime.load(icon('lock'));
        lock.destroy();
        expect(() => lock.totalFrames).toThrow();
    });

    it('rejects what is not Lottie', () => {
        expect(() => runtime.load('{"hello": 1}')).toThrow();
    });
});

describe('Model', () => {
    it('draws icons of their own looks, as icons of their own models', () => {
        const model = runtime.model(icon('lock'));
        const shared = [model.icon(), model.icon(), model.icon()];
        const own = [
            runtime.load(icon('lock')),
            runtime.load(icon('lock')),
            runtime.load(icon('lock')),
        ];
        model.destroy(); // the icons keep it
        for (const set of [shared, own]) {
            set[1].setColor('primary', '#ff0000');
            set[1].setStroke(3);
            set[2].setTint('#00aa00');
        }
        // Interleaved: each icon puts its own look and frame back on the model.
        for (const round of [0, 1]) {
            shared.forEach((one, i) => {
                one.seek(205 + 10 * i + round);
                own[i].seek(205 + 10 * i + round);
                expect(one.render(48, 48)).toEqual(own[i].render(48, 48));
            });
        }
        for (const one of [...shared, ...own]) one.destroy();
    });

    it('throws once destroyed, its icons live on', () => {
        const model = runtime.model(icon('lock'));
        const lock = model.icon();
        model.destroy();
        expect(() => model.icon()).toThrow();
        expect(lock.totalFrames).toBe(331);
        lock.destroy();
    });
});

describe('patches', () => {
    // patches/cases: gold rectangles, a 50% multiply fill over a normal one. Chromium (lottie-web)
    // gives 255,175,34; ThorVG without patches 01/03 gave 255,199,56 (the blend was ignored).
    const center = (name: string) => {
        const json = readFileSync(resolve(root, 'patches/cases', `${name}.json`), 'utf8');
        const item = runtime.load(json);
        const pixels = item.render(100, 100);
        item.destroy();
        const i = (50 * 100 + 50) * 4;
        return Array.from(pixels.slice(i, i + 4));
    };

    it.each([
        ['A-group', [255, 175, 34, 255]],
        ['B-layers', [255, 175, 34, 255]],
        ['G-group-in-matte', [255, 175, 34, 255]],
    ])('blends %s like the browser', (name, expected) => {
        center(name).forEach((v, k) => expect(Math.abs(v - expected[k])).toBeLessThanOrEqual(2));
    });

    // Alpha at (x, y) of a case at a frame, 100 x 100.
    const alpha = (name: string, frame: number, points: [number, number][]) => {
        const json = readFileSync(resolve(root, 'patches/cases', `${name}.json`), 'utf8');
        const item = runtime.load(json);
        item.seek(frame);
        const pixels = item.render(100, 100);
        item.destroy();
        return points.map(([x, y]) => pixels[(y * 100 + x) * 4 + 3]);
    };

    it('eases each dimension with its own curve (07)', () => {
        // Mid-way the square is wide and flat, as in the browser; with one curve it was square.
        expect(
            alpha('K-ease-per-dimension', 30, [
                [50, 50],
                [30, 50],
                [50, 30],
            ]),
        ).toEqual([255, 255, 0]);
    });

    it('keeps a matte whole under the edge of a translucent shape (09)', () => {
        // Inside the opaque middle ellipse the black content shows fully; the edge of the 86%
        // ellipse over it cut a crack into the matte (alpha down to ~40).
        const row = alpha(
            'M-matte-translucent-edge',
            0,
            Array.from({ length: 31 }, (_, i) => [40 + i, 50] as [number, number]),
        );
        expect(Math.min(...row)).toBeGreaterThanOrEqual(250);
    });

    it('interpolates a path from an open to a closed keyframe (10)', () => {
        // Half way the square is 50 wide (25 around the centre); held, it stayed 20 wide.
        expect(
            alpha('N-path-open-closed', 30, [
                [50, 50],
                [28, 50],
                [72, 50],
                [50, 22],
            ]),
        ).toEqual([255, 255, 255, 0]);
    });

    it("leaves a colour bound to another icon's comp as exported (core)", () => {
        // Both squares are green in the file; the left one names this icon's comp and takes the
        // control's blue, the right one names a comp the file does not have and stays green.
        const json = readFileSync(resolve(root, 'patches/cases/Q-binding-other-comp.json'), 'utf8');
        const item = runtime.load(json);
        const pixels = item.render(100, 100);
        item.destroy();
        const rgb = (x: number, y: number) =>
            Array.from(pixels.slice((y * 100 + x) * 4, (y * 100 + x) * 4 + 3));
        expect(rgb(25, 50)).toEqual([0, 0, 255]);
        expect(rgb(75, 50)).toEqual([0, 255, 0]);
    });

    it('fills paths of several groups as one compound path (core)', () => {
        // The inner circle runs the other way: a ring, with a hole. Filled group by group, solid.
        expect(
            alpha('O-fill-over-groups', 0, [
                [50, 50],
                [50, 18],
            ]),
        ).toEqual([0, 255]);
    });

    it('trims the paths of several groups individually as one sequence (11)', () => {
        // Lines at y 20, 40 (first group) and 60, 80; 40% of the four: the first line whole and
        // 60% of the second. Group by group, each group showed its own 40%.
        expect(
            alpha('P-trim-individual-over-groups', 0, [
                [20, 20],
                [80, 20],
                [20, 40],
                [80, 40],
                [50, 60],
            ]),
        ).toEqual([255, 255, 255, 0, 0]);
    });

    it('draws a matte that holds a blended shape (12)', () => {
        // The lines show through the matte; with the soft-light stroke on the matte, none did.
        expect(
            alpha('R-blend-in-matte', 0, [
                [50, 30],
                [50, 50],
                [50, 70],
            ]),
        ).toEqual([255, 255, 255]);
    });

    it('fills paths of groups with animated opacity as one compound path (core)', () => {
        expect(
            alpha('V-fill-over-groups-opacity', 0, [
                [50, 50],
                [50, 18],
            ]),
        ).toEqual([0, 255]);
    });

    it('fills paths separated by a stroke as one compound path (core)', () => {
        // The fill takes both circles (the stroke only the outer one): a ring with a hole.
        expect(
            alpha('S-fill-over-paths', 0, [
                [50, 50],
                [50, 18],
            ]),
        ).toEqual([0, 255]);
    });

    it('keeps a matte whole where a translucent precomp overlaps another (13)', () => {
        // (56, 39) is on the opaque second ring, inside the first (70%) ring's bounds: the
        // translucent scene mixed into the matte instead of compositing left a hole there.
        expect(alpha('T-translucent-precomp-matte', 0, [[56, 39]])).toEqual([255]);
    });

    it('strokes a subpath that starts where the previous one ended (14)', () => {
        // Two copies of one closed path: the stroke outline joined them with a sliver through
        // (85, 52), outside the shape.
        expect(alpha('U-stroke-repeated-subpath', 0, [[85, 52]])).toEqual([0]);
    });

    it('keeps the hole of a fill across a trim that cuts nothing (core)', () => {
        // Outer square, a 0-100% trim, inner square the other way round, one fill: the trim
        // split the squares into two shapes and the inner one filled the hole at (50, 50).
        expect(
            alpha('X-noop-trim-fill', 0, [
                [50, 50],
                [20, 50],
            ]),
        ).toEqual([0, 255]);
    });

    it('wraps a trim within the segment an earlier trim left (15)', () => {
        // The first trim leaves the top and right sides; the second one, offset by -90 degrees,
        // takes the end of the right side and the start of the top. Composed into one range it
        // wrapped around the whole square instead and drew the left side.
        expect(
            alpha('W-trim-chained-wrap', 0, [
                [25, 40],
                [75, 65],
            ]),
        ).toEqual([0, 255]);
    });

    it('trims three paths individually in stacking order (08)', () => {
        // The last third is the third path; the order 1, 3, 2 drew the second one.
        expect(
            alpha('L-trim-individual', 0, [
                [50, 80],
                [50, 50],
            ]),
        ).toEqual([255, 0]);
    });
});
