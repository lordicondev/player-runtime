// One frame side by side: reference (Chromium) | tvgicon builds; the frame counted from ip.
// Usage: node side.mjs <icon.json> <frame> <size> <out.png> [tvgicon...]   default ../build/native/tvgicon
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { createChromium } from './chromium.mjs';

const [path, frame, size, out, ...given] = process.argv.slice(2);
const bins = given.length ? given : [new URL('../build/native/tvgicon', import.meta.url).pathname];
const ip = JSON.parse(readFileSync(path, 'utf8')).ip ?? 0;
const s = +size;
const chromium = await createChromium(s, { srgbFilters: true });
const [ref] = await chromium.frames(JSON.parse(readFileSync(path, 'utf8')), [+frame]);
await chromium.close();
const imgs = [
    ref,
    ...bins.map((bin) => {
        execFileSync(bin, [
            path,
            '--frames',
            String(+frame + ip),
            '--size',
            size,
            '--out',
            `${out}.tmp.png`,
        ]);
        return PNG.sync.read(readFileSync(`${out}.tmp.png`));
    }),
];
const png = new PNG({ width: s * imgs.length, height: s });
imgs.forEach((img, c) => {
    for (let y = 0; y < s; y++)
        for (let x = 0; x < s; x++) {
            const i = (y * s + x) * 4,
                o = (y * s * imgs.length + c * s + x) * 4,
                a = img.data[i + 3] / 255;
            for (let k = 0; k < 3; k++)
                png.data[o + k] = Math.round(img.data[i + k] * a + 255 * (1 - a));
            png.data[o + 3] = 255;
        }
});
writeFileSync(out, PNG.sync.write(png));
