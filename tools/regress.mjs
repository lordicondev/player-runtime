// Visual regression over a set of Lottie files: each file is rendered by the runtime (tvgicon) and
// by the reference, @lordicon/internal (the web player the runtime replaces) in headless
// Chromium, and the two are diffed.
//
// Usage: node regress.mjs <input> <out-dir> [--shard 0/4] [--size 192] [--frames 12]
//        [--only id-substring] [--ids ids.txt] [--bin path/to/tvgicon] [--strip-min 0.015]
//        [--runtime-input <input>] [--look default|custom]
//
// <input>: a directory (every *.json below it; id = path relative to it) or a list file, one
// `path[<TAB>id]` per line (relative paths resolve against the list's directory; id defaults to
// the path). --ids keeps only the ids listed in a file (one per line), e.g. for a second pass.
// --runtime-input gives the runtime other files for some ids (same formats), e.g. a rewrite under
// test, while the references keep rendering the originals.
// --look custom: every file with other colours (and a stroke weight, when it has the control):
// the reference renders it rewritten by customizeIcon() of @lordicon/utils-lottie, the runtime
// gets the same values through its slots. Checks that colours and stroke change live as they do
// in the web player.
// Writes <out-dir>/results-<shard>.jsonl (one file per line; reruns skip ids already there) and
// <out-dir>/strips/<id>.png when they differ by more than --strip-min (rows: internal, runtime).
// regress-report.mjs turns the results into a CSV.
import { customizeIcon, readControls } from '@lordicon/utils-lottie';
import { execFileSync } from 'node:child_process';
import {
    appendFileSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
    statSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { createChromium } from './chromium.mjs';
import { listInput } from './input.mjs';
import { areaDiff, blurred, frameName, shiftStats, strip } from './diff.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, def) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : def;
};
const [input, outDir] = args;
const [shard, shards] = opt('--shard', '0/1').split('/').map(Number);
const size = +opt('--size', 192);
const frameCount = +opt('--frames', 12);
const only = opt('--only', null);
const bin = opt('--bin', join(here, '../build/native/tvgicon'));
const stripMin = +opt('--strip-min', 0.015);
const ids = opt('--ids', null) && new Set(readFileSync(opt('--ids'), 'utf8').trim().split('\n'));
const runtimeInput = opt('--runtime-input', null);
const runtimePaths = new Map(
    runtimeInput ? listInput(runtimeInput).map((i) => [i.id, i.path]) : [],
);
const look = opt('--look', 'default');
const TIMEOUT = 60_000;

// --look custom: the colours, and stroke 1 or 3 (by id, so a rerun picks the same).
const CUSTOM_COLORS = ['#e5484d', '#3e63dd', '#f5a524', '#12a594', '#8e4ec6'];
function customLook(data, id) {
    const controls = readControls(data);
    const names = controls.filter((c) => c.type === 'color').map((c) => c.name);
    const colors = Object.fromEntries(
        names.slice(0, CUSTOM_COLORS.length).map((name, i) => [name, CUSTOM_COLORS[i]]),
    );
    const hasStroke = controls.some((c) => c.name === 'stroke' || c.name === 'stroke-layers');
    const stroke = [...id].reduce((s, c) => s + c.charCodeAt(0), 0) % 2 ? 1 : 3;
    const args = ['--slots'];
    if (names.length)
        args.push(
            '--colors',
            Object.entries(colors)
                .map(([k, v]) => `${k}:${v}`)
                .join(','),
        );
    if (hasStroke) args.push('--stroke', String(stroke));
    return { data: customizeIcon(data, { colors, ...(hasStroke ? { stroke } : {}) }), args };
}

const icons = listInput(input)
    .filter((icon) => (!only || icon.id.includes(only)) && (!ids || ids.has(icon.id)))
    .filter((_, i) => i % shards === shard);

mkdirSync(join(outDir, 'strips'), { recursive: true });
const resultsPath = join(outDir, `results-${shard}.jsonl`);
const done = new Set(
    existsSync(resultsPath)
        ? readFileSync(resultsPath, 'utf8')
              .trim()
              .split('\n')
              .filter(Boolean)
              .map((l) => JSON.parse(l).id)
        : [],
);

let ref = null;
const closeRef = async () => {
    if (!ref) return;
    await Promise.allSettled([ref.close()]);
    ref = null;
};

const withTimeout = (promise, what) =>
    Promise.race([
        promise,
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`${what}: timeout`)), TIMEOUT),
        ),
    ]);

async function reference(data, frames) {
    ref ??= await createChromium(size, { srgbFilters: true });
    try {
        const images = await withTimeout(ref.frames(structuredClone(data), frames), 'internal');
        return { images, errors: ref.takeErrors() };
    } catch (e) {
        // A hung or crashed page: start a fresh browser for the next icon.
        const errors = [...ref.takeErrors(), String(e.message ?? e)];
        await closeRef();
        return { images: null, errors };
    }
}

function runtimeFrames(path, frames, ip, extra) {
    const dir = mkdtempSync(join(tmpdir(), 'regress-'));
    try {
        execFileSync(
            bin,
            [
                path,
                '--frames',
                frames.map((f) => f + ip).join(','),
                '--size',
                String(size),
                '--out',
                join(dir, '%d.png'),
                ...extra,
            ],
            { stdio: ['ignore', 'ignore', 'pipe'], timeout: TIMEOUT },
        );
        return {
            images: frames.map((f) =>
                PNG.sync.read(readFileSync(join(dir, `${frameName(f + ip)}.png`))),
            ),
        };
    } catch (e) {
        return {
            images: null,
            errors: [
                String(e.stderr || e.message)
                    .trim()
                    .slice(0, 300),
            ],
        };
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

// Worst frame of a pair. shift (tolerates 1-2 px moves) is what classes use; area (blurred
// difference) is kept for comparison with M1.
function pair(a, b, ba, bb, frames) {
    if (!a || !b) return null;
    const worst = (values) => {
        const max = Math.max(...values);
        return {
            max: +max.toFixed(4),
            frame: frames[values.indexOf(max)],
            mean: +(values.reduce((s, v) => s + v, 0) / values.length).toFixed(4),
        };
    };
    const area = worst(frames.map((_, i) => areaDiff(a[i], b[i], ba[i], bb[i])));
    const stats = frames.map((_, i) => shiftStats(a[i], b[i]));
    return {
        ...area,
        shift: { ...worst(stats.map((s) => s.ratio)), px: Math.max(...stats.map((s) => s.px)) },
    };
}

const started = Date.now();
let n = 0;
for (const icon of icons) {
    n++;
    if (done.has(icon.id)) continue;
    let data;
    try {
        data = JSON.parse(readFileSync(icon.path, 'utf8'));
    } catch (e) {
        appendFileSync(
            resultsPath,
            JSON.stringify({ id: icon.id, path: icon.path, loadError: String(e) }) + '\n',
        );
        continue;
    }
    const ip = data.ip ?? 0;
    const total = Math.max(1, Math.round((data.op ?? 1) - ip));
    // Frames counted from ip: the web players' goToAndStop is relative to it; tvgicon takes
    // absolute frames.
    const frames = [
        ...new Set(
            Array.from({ length: frameCount }, (_, i) =>
                Math.round((i * (total - 1)) / Math.max(1, frameCount - 1)),
            ),
        ),
    ];

    const custom = look === 'custom' ? customLook(data, icon.id) : { data, args: [] };
    const internal = await reference(custom.data, frames);
    const runtime = runtimeFrames(runtimePaths.get(icon.id) ?? icon.path, frames, ip, custom.args);

    const blur = (r) => r.images?.map(blurred);
    const entry = {
        id: icon.id,
        path: icon.path,
        frames,
        ...(look === 'default' ? {} : { look }),
        runtimeVsInternal: pair(
            runtime.images,
            internal.images,
            blur(runtime),
            blur(internal),
            frames,
        ),
        errors: {
            ...(internal.errors.length
                ? { internal: [...new Set(internal.errors)].slice(0, 5) }
                : {}),
            ...(runtime.errors ? { runtime: runtime.errors } : {}),
        },
    };
    if ((entry.runtimeVsInternal?.shift.max ?? 1) > stripMin) {
        const blank = new PNG({ width: size, height: size });
        const row = (r) => r.images ?? frames.map(() => blank);
        writeFileSync(
            join(outDir, 'strips', `${icon.id.replaceAll('/', '_')}.png`),
            strip([row(internal), row(runtime)]),
        );
    }
    appendFileSync(resultsPath, JSON.stringify(entry) + '\n');
    if (n % 50 === 0) {
        const rate = (Date.now() - started) / 1000 / n;
        console.log(
            `[${shard}/${shards}] ${n}/${icons.length} ${rate.toFixed(2)} s/icon, ~${Math.round(((icons.length - n) * rate) / 60)} min left`,
        );
    }
}
await closeRef();
console.log(`[${shard}/${shards}] done: ${icons.length} icons -> ${resultsPath}`);
