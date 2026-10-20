// Finds the layers behind a difference: renders every layer of a file alone (with its matte
// source and parents) at one frame in the reference and the runtime, and lists the layers that
// differ, worst first, with a signature of each (shape items, modifiers, matte, mask...).
// Usage: node bisect.mjs <file.json> <frame> [--out dir]
//        node bisect.mjs --batch <list.tsv> <out.jsonl>
//        common: [--size 192] [--bin path/to/tvgicon]
//
// The frame counts from ip, as in regress.mjs. --out keeps a reference/runtime strip per layer.
// --batch: one `path<TAB>id<TAB>frame` per line; writes one JSON line per file (reruns skip ids
// already in out.jsonl).
import { execFileSync } from 'node:child_process';
import {
    appendFileSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { createChromium } from './chromium.mjs';
import { frameName, shiftDiff, strip } from './diff.mjs';
import { signature } from './signature.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, def) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : def;
};
const size = +opt('--size', 192);
const bin = opt('--bin', join(here, '../build/native/tvgicon'));

// A parent kept only for its transform: a null layer (hidden layers are dropped as parents by
// some players).
function asNull(l) {
    const {
        shapes,
        refId,
        tm,
        w,
        h,
        sc,
        sw,
        sh,
        t,
        ef,
        masksProperties,
        hasMask,
        tt,
        tp,
        td,
        ...rest
    } = l;
    return { ...rest, ty: 3 };
}

// Layers of `layers` to keep for `inds`: the layers, matte sources of kept layers, and parents
// (as nulls: transform only).
function closure(layers, inds) {
    const byInd = new Map(layers.map((l) => [l.ind, l]));
    const keep = new Set(inds);
    for (const ind of inds) {
        const i = layers.findIndex((l) => l.ind === ind);
        const l = layers[i];
        if (l.tt && (l.tp != null || i > 0)) keep.add(l.tp != null ? l.tp : layers[i - 1].ind);
    }
    const parents = new Set();
    for (const ind of [...keep]) {
        let p = byInd.get(ind)?.parent;
        while (p != null && byInd.has(p)) {
            if (!keep.has(p)) parents.add(p);
            p = byInd.get(p).parent;
        }
    }
    return layers
        .filter((l) => keep.has(l.ind) || parents.has(l.ind))
        .map((l) => (parents.has(l.ind) ? asNull(l) : l));
}

// Variant of the file that draws only `layer` of comp `compId`: in that comp the layer with its
// matte and parents, in the comps above it only the precomp layers leading to it.
function isolate(data, compId, layer) {
    const copy = structuredClone(data);
    const all = [
        { id: 'root', layers: copy.layers },
        ...(copy.assets ?? []).filter((a) => a.layers),
    ];
    const set = (id, layers) => {
        if (id === 'root') copy.layers = layers;
        else copy.assets.find((a) => a.id === id).layers = layers;
    };
    set(compId, closure(all.find((c) => c.id === compId).layers, [layer.ind]));
    let path = new Set([compId]);
    for (let depth = 0; depth < 8 && !path.has('root'); depth++) {
        const next = new Set();
        for (const c of all) {
            if (path.has(c.id)) continue;
            const refs = c.layers.filter((l) => l.ty === 0 && path.has(l.refId)).map((l) => l.ind);
            if (!refs.length) continue;
            const control = c.layers.filter((l) => l.nm === 'control').map((l) => l.ind);
            set(c.id, closure(c.layers, [...refs, ...control]));
            next.add(c.id);
        }
        if (!next.size) break;
        path = next;
    }
    return copy;
}

function runtimeFrame(json, frame) {
    const dir = mkdtempSync(join(tmpdir(), 'bisect-'));
    try {
        writeFileSync(join(dir, 'icon.json'), JSON.stringify(json));
        const abs = frame + (json.ip ?? 0);
        execFileSync(
            bin,
            [
                join(dir, 'icon.json'),
                '--frames',
                String(abs),
                '--size',
                String(size),
                '--out',
                join(dir, '%d.png'),
            ],
            { stdio: ['ignore', 'ignore', 'pipe'], timeout: 60_000 },
        );
        return PNG.sync.read(readFileSync(join(dir, `${frameName(abs)}.png`)));
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

// Layers of `data` that differ alone at `frame`: [{ comp, ind, nm, d, signature }], worst first.
async function bisect(ref, data, frame, outDir) {
    const assets = new Map((data.assets ?? []).filter((a) => a.layers).map((a) => [a.id, a]));
    const comps = [
        { id: 'root', layers: data.layers },
        ...(data.assets ?? []).filter((a) => a.layers),
    ];
    const rows = [];
    for (const comp of comps) {
        for (const layer of comp.layers) {
            // Matte sources, nulls and the control layer draw nothing themselves; precomp layers
            // are covered by their own layers.
            if (layer.td || layer.ty === 3 || layer.ty === 0 || layer.nm === 'control') continue;
            const json = isolate(data, comp.id, layer);
            const [a] = await ref.frames(json, [frame], { lead: 30 });
            let b;
            try {
                b = runtimeFrame(json, frame);
            } catch {
                rows.push({ comp: comp.id, ind: layer.ind, nm: layer.nm, d: 1, error: true });
                continue;
            }
            const d = shiftDiff(a, b);
            if (d <= 0.01) continue;
            rows.push({
                comp: comp.id,
                ind: layer.ind,
                nm: layer.nm,
                d: +d.toFixed(4),
                signature: signature(layer, comp.layers, assets),
            });
            if (outDir)
                writeFileSync(join(outDir, `${comp.id}-${layer.ind}.png`), strip([[a], [b]]));
        }
    }
    return rows.sort((x, y) => y.d - x.d);
}

const openRef = () => createChromium(size, { srgbFilters: true });
let ref = await openRef();
if (args[0] === '--batch') {
    const [, listPath, outPath] = args;
    const done = new Set(
        existsSync(outPath)
            ? readFileSync(outPath, 'utf8')
                  .split('\n')
                  .filter(Boolean)
                  .map((l) => JSON.parse(l).id)
            : [],
    );
    const lines = readFileSync(listPath, 'utf8')
        .split('\n')
        .filter((l) => l.trim() && !l.startsWith('#'));
    let n = 0;
    for (const line of lines) {
        const [path, id, frame] = line.split('\t');
        n++;
        if (done.has(id)) continue;
        let layers;
        try {
            layers = await bisect(ref, JSON.parse(readFileSync(path, 'utf8')), +frame);
        } catch (e) {
            // A crashed page: report this file and start a fresh browser for the next one.
            layers = [{ error: String(e.message ?? e).slice(0, 200) }];
            await ref.close().catch(() => {});
            ref = await openRef();
        }
        appendFileSync(outPath, JSON.stringify({ id, frame: +frame, layers }) + '\n');
        if (n % 20 === 0) console.log(`${n}/${lines.length}`);
    }
} else {
    const [path, frame] = args;
    const outDir = opt('--out', null);
    if (outDir) mkdirSync(outDir, { recursive: true });
    const rows = await bisect(ref, JSON.parse(readFileSync(path, 'utf8')), +frame, outDir);
    for (const r of rows)
        console.log(
            `${(r.d * 100).toFixed(1).padStart(6)}%  ${r.comp} #${r.ind} ${r.nm}  [${r.signature ?? 'error'}]`,
        );
    if (!rows.length) console.log('no single layer differs (> 1%): look at layer interaction');
}
await ref.close();
