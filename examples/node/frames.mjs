// Frames of an icon to PNG files, in Node: for exports, previews, a server. The runtime is the
// same as in the browser, the .wasm passed as bytes; the canvas is a buffer from render().
// Usage: node examples/node/frames.mjs <icon.json> <out-dir> [size] [frames]   (after npm run build)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { createRuntime } from '../../dist/index.js';

const [file, out, size = '256', count = '8'] = process.argv.slice(2);
if (!file || !out) throw new Error('usage: frames.mjs <icon.json> <out-dir> [size] [frames]');

// In Node the .wasm goes in as bytes (it loads by URL only in browsers and bundlers).
const wasm = readFileSync(new URL('../../dist/lordicon.wasm', import.meta.url));
const runtime = await createRuntime({ wasm });
const icon = runtime.load(readFileSync(file, 'utf8'));
icon.setColor('primary', '#3e63dd'); // looks work as on screen: colours, stroke, tint
mkdirSync(out, { recursive: true });

// Evenly spread frames of the whole file (or of a state: its marker's begin and end).
const first = icon.firstFrame;
const last = first + icon.totalFrames - 1;
for (let i = 0; i < +count; i++) {
    const frame = Math.round(first + ((last - first) * i) / Math.max(1, +count - 1));
    icon.seek(frame);
    const pixels = icon.render(+size, +size); // RGBA, straight alpha
    writeFileSync(join(out, `frame-${frame}.png`), png(pixels, +size, +size));
    console.log(join(out, `frame-${frame}.png`));
}
icon.destroy();

/** A PNG of RGBA pixels: Node's zlib does the compression. */
function png(rgba, width, height) {
    const rows = Buffer.alloc((width * 4 + 1) * height);
    for (let y = 0; y < height; y++) {
        rows[y * (width * 4 + 1)] = 0; // no filter
        Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(
            rows,
            y * (width * 4 + 1) + 1,
        );
    }
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header.set([8, 6, 0, 0, 0], 8); // 8 bits, RGBA
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', header),
        chunk('IDAT', deflateSync(rows)),
        chunk('IEND', Buffer.alloc(0)),
    ]);
}

function chunk(type, data) {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
}

function crc32(bytes) {
    let c = 0xffffffff;
    for (const byte of bytes) {
        c ^= byte;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    return (c ^ 0xffffffff) >>> 0;
}
