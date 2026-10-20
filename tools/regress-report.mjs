// Turns regress.mjs results into a CSV with one row per file that renders differently: class,
// metrics, the Lottie features that usually explain a difference, and a cause when known.
// Usage: node regress-report.mjs <out.csv> <results-dir>... [--input <dir|list>]
//        [--causes causes.tsv] [--all]
//
// Several results dirs: a later one overrides an earlier one per id (e.g. a second pass over the
// differing files). --input resolves ids to files for results that do not record a path.
// causes.tsv: `id<TAB>cause[<TAB>note]` per line, curated after looking at the strips; the cause
// is copied to the CSV as is. --all writes every file, not only those that differ.
//
// Classes, by the worst frame of runtime vs internal (shift metric, see diff.mjs; px = differing
// pixels at 192 px): ok = under 24 px, or <= 1.5% and under 100 px; minor <= 3%; visible
// <= 10% or 200+ px; major > 10% and 200+ px. error = the runtime failed; unverified = only the
// blurred area metric is known (a first-pass result over 2%).
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { listInput } from './input.mjs';

const args = process.argv.slice(2);
const flags = new Set(['--input', '--causes']);
const opt = (name, def) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : def;
};
const positional = args.filter((a, i) => !a.startsWith('--') && !flags.has(args[i - 1]));
const [csvPath, ...resultDirs] = positional;
const all = args.includes('--all');

// Colour and stroke bindings resolved by the runtime; anything else is an expression it skips.
const STANDARD = [
    /^(\$bm_rt = )?comp\('[^']+'\)\.layer\('[^']+'\)\.effect\('[^']+'\)\('Color'\);?$/,
    /^(\$bm_rt = )?\$bm_mul\(\$bm_div\(value, [0-9.]+\), comp\('[^']+'\)\.layer\('[^']+'\)\.effect\('[^']+'\)\('[^']+'\)\);?$/,
];
function expressionKind(x) {
    if (x.includes('nullLayerNames') || x.includes('toComp')) return 'rig';
    if (x.includes('loopOut') || x.includes('loopIn')) return 'loop';
    if (
        /^(\$bm_rt = )?(\$bm_(neg|mul|div|sum|sub)\(|[0-9.]+, )*(thisComp\.layer\(|content\(|transform\.|effect\()/.test(
            x,
        )
    )
        return 'link';
    return 'other';
}

// Lottie features worth a column: the usual suspects when renderers disagree.
function featuresOf(data) {
    const f = new Set();
    const kinds = new Set();
    const dims = (v) => Array.isArray(v) && v.length > 1 && Math.abs(v[1] - v[0]) > 1e-3;
    const shapes = {
        gf: 'gradient',
        gs: 'gradient',
        rp: 'repeater',
        sr: 'star',
        mm: 'merge-paths',
        rd: 'round-corners',
        zz: 'zig-zag',
        op: 'offset-path',
        pb: 'pucker-bloat',
        tw: 'twist',
    };
    const visit = (node) => {
        if (Array.isArray(node)) return node.forEach(visit);
        if (!node || typeof node !== 'object') return;
        if (typeof node.x === 'string') {
            const x = node.x.replace(/^\s*var \$bm_rt;\s*/, '').trim();
            if (!STANDARD.some((re) => re.test(x))) kinds.add(expressionKind(x));
        }
        if ('t' in node && node.i && node.o && typeof node.i === 'object') {
            if (dims(node.i.x) || dims(node.i.y) || dims(node.o.x) || dims(node.o.y))
                f.add('ease-per-dimension');
        }
        if (shapes[node.ty]) f.add(shapes[node.ty]);
        if (node.ty === 'tm') f.add(node.m === 2 ? 'trim-individual' : 'trim');
        if (node.ty === 'st' && node.d) f.add('dash');
        if ((node.ty === 'fl' || node.ty === 'st') && node.bm) f.add('blend-shape');
        if (node.ty === 'st' && node.w?.a) f.add('animated-stroke');
        for (const v of Object.values(node)) if (v && typeof v === 'object') visit(v);
    };
    const layers = [...(data.layers ?? []), ...(data.assets ?? []).flatMap((a) => a.layers ?? [])];
    for (const l of layers) {
        if (l.tt === 1 || l.tt === 2) f.add('matte-alpha');
        if (l.tt === 3 || l.tt === 4) f.add('matte-luma');
        if (l.hasMask || l.masksProperties?.length) f.add('mask');
        if (l.bm) f.add('blend-layer');
        if (l.tm) f.add('time-remap');
        if (l.sr && l.sr !== 1) f.add('time-stretch');
        if (l.ty === 5) f.add('text');
        if (l.ty === 2) f.add('image');
        if (l.ddd) f.add('3d');
        if (l.ao) f.add('auto-orient');
        for (const ef of l.ef ?? []) {
            // Expression controls (colour, slider, menu, pseudo effects) carry no rendering.
            if (/Control$/.test(ef.mn ?? '') || ef.mn?.startsWith('Pseudo/')) continue;
            f.add(`effect:${(ef.mn ?? ef.nm ?? '?').replace(/^ADBE /, '')}`);
        }
    }
    visit(layers);
    return { features: [...f].sort(), expressions: [...kinds].sort() };
}

const results = new Map();
for (const dir of resultDirs)
    for (const file of readdirSync(dir).filter((f) => /^results-\d+\.jsonl$/.test(f)))
        for (const line of readFileSync(join(dir, file), 'utf8').split('\n').filter(Boolean)) {
            const r = JSON.parse(line);
            results.set(r.id, { ...r, dir });
        }
const input = opt('--input', null);
const paths = new Map((input ? listInput(input) : []).map((i) => [i.id, i.path]));
const causesPath = opt('--causes', null);
const causes = new Map(
    causesPath && existsSync(causesPath)
        ? readFileSync(causesPath, 'utf8')
              .split('\n')
              .filter((l) => l.trim() && !l.startsWith('#'))
              .map((l) => {
                  const [id, cause, note = ''] = l.split('\t');
                  return [id, { cause, note }];
              })
        : [],
);

// Severity from both the share of drawn pixels and their count (px, when recorded): a few pixels
// are noise, a long thin line in a large icon is not.
const classOf = (r) => {
    if (r.loadError || r.errors?.runtime || !r.runtimeVsInternal) return 'error';
    const p = r.runtimeVsInternal;
    if (!p.shift) return p.max <= 0.02 ? 'ok' : 'unverified';
    const v = p.shift.max;
    if (p.shift.px == null)
        return v <= 0.015 ? 'ok' : v <= 0.03 ? 'minor' : v <= 0.1 ? 'visible' : 'major';
    const px = p.shift.px;
    if (px < 24 || (v <= 0.015 && px < 100)) return 'ok';
    if (v > 0.1 && px >= 200) return 'major';
    if (v > 0.03 || px >= 200) return 'visible';
    return 'minor';
};

const pct = (v) => (v == null ? '' : (v * 100).toFixed(1));
const cell = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const header = [
    'id',
    'class',
    'runtime_vs_internal_pct',
    'px',
    'frame',
    'area_pct',
    'expressions',
    'features',
    'cause',
    'note',
    'errors',
    'strip',
];
const rows = [];
const counts = {};
for (const r of results.values()) {
    const cls = classOf(r);
    counts[cls] = (counts[cls] ?? 0) + 1;
    if (!all && cls === 'ok') continue;
    const path = r.path ?? paths.get(r.id);
    const info =
        path && existsSync(path)
            ? featuresOf(JSON.parse(readFileSync(path, 'utf8')))
            : { features: [], expressions: [] };
    const p = r.runtimeVsInternal;
    const strip = join(r.dir, 'strips', `${r.id.replaceAll('/', '_')}.png`);
    rows.push({
        sort: -(p?.shift?.max ?? p?.max ?? 1),
        cells: [
            r.id,
            cls,
            pct(p?.shift?.max),
            p?.shift?.px ?? '',
            p?.shift?.frame ?? p?.frame ?? '',
            pct(p?.max),
            info.expressions.join(' '),
            info.features.join(' '),
            causes.get(r.id)?.cause ?? '',
            causes.get(r.id)?.note ?? '',
            Object.entries(r.errors ?? {})
                .map(([k, v]) => `${k}: ${[v].flat().join(' | ')}`)
                .join('; ')
                .replace(/\s+/g, ' ')
                .slice(0, 300),
            existsSync(strip) ? relative(dirname(csvPath), strip) : '',
        ],
    });
}
rows.sort((a, b) => a.sort - b.sort);
writeFileSync(
    csvPath,
    [header, ...rows.map((r) => r.cells)].map((row) => row.map(cell).join(',')).join('\n') + '\n',
);
console.log(`${results.size} files:`, JSON.stringify(counts));
console.log(`${rows.length} rows -> ${csvPath}`);
