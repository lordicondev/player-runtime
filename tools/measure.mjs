// Runs `tvgicon --bench` on a random sample of files and prints percentiles.
// Usage: node measure.mjs <input> <tvgicon> <count> <out.json> [--runs 5] [-- tvgicon args]
// <input>: a directory or a list, see input.mjs.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { listInput, shuffled } from './input.mjs';

const args = process.argv.slice(2);
const [input, bin, count, outPath] = args;
const runs = args.includes('--runs') ? args[args.indexOf('--runs') + 1] : '5';
const extra = args.includes('--') ? args.slice(args.indexOf('--') + 1) : [];

const sample = shuffled(listInput(input), 11).slice(0, +count);

const results = [];
for (const [i, icon] of sample.entries()) {
    const out = execFileSync(bin, [icon.path, '--bench', runs, ...extra], { encoding: 'utf8' });
    results.push({ id: icon.id, ...JSON.parse(out) });
    if ((i + 1) % 25 === 0) process.stderr.write(`${i + 1}/${sample.length}\n`);
}
writeFileSync(outPath, JSON.stringify(results, null, 1) + '\n');

const pct = (values, p) => {
    const v = [...values].sort((a, b) => a - b);
    return v[Math.min(v.length - 1, Math.floor((p / 100) * v.length))];
};
const row = (name, values, unit, digits = 2) =>
    console.log(
        `${name.padEnd(22)} p50 ${pct(values, 50).toFixed(digits)}  p90 ${pct(values, 90).toFixed(digits)}  max ${Math.max(...values).toFixed(digits)} ${unit}`,
    );

console.log(`icons: ${results.length}, runs per load: ${runs}`);
row(
    'json',
    results.map((r) => r.stats.jsonBytes / 1024),
    'KB',
    1,
);
row(
    'parse (rapidjson)',
    results.map((r) => r.parseMs),
    'ms',
);
row(
    'preprocess',
    results.map((r) => r.preprocessMs),
    'ms',
);
row(
    'load (ThorVG)',
    results.map((r) => r.loadMs),
    'ms',
);
row(
    'load total',
    results.map((r) => r.parseMs + r.preprocessMs + r.loadMs),
    'ms',
);
for (const s of ['96', '192', '288']) {
    row(
        `render ${s} avg`,
        results.map((r) => r.render[s].avgMs),
        'ms',
        3,
    );
    row(
        `render ${s} worst frame`,
        results.map((r) => r.render[s].maxMs),
        'ms',
        3,
    );
}
row(
    'heap after load',
    results.map((r) => r.heapLoad / 1024),
    'KB',
    0,
);
row(
    'heap after render 96',
    results.map((r) => r.heapRender96 / 1024),
    'KB',
    0,
);
row(
    'setColor + render 96',
    results.map((r) => r.setColorMs),
    'ms',
    3,
);
row(
    'setStroke + render 96',
    results.map((r) => r.setStrokeMs).filter((v) => v > 0),
    'ms',
    3,
);
