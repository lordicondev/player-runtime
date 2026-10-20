// Golden frames (test/golden): the cases, PNG files (RGBA, 8 bits, written and read with
// node:zlib, no dependencies) and the comparison of two frames.
import { readFileSync } from 'node:fs';
import { deflateSync, inflateSync } from 'node:zlib';

export interface GoldenCase {
    name: string;
    icon: string;
    /** 0..1 over the file's frames, rounded to a whole frame. */
    t: number;
    size: number;
    /** `primary:#ff5a36,secondary:#3e63dd`, or null for the icon's own. */
    colors: string | null;
    stroke: number | null;
}

export function readCases(path: string): GoldenCase[] {
    return readFileSync(path, 'utf8')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'))
        .map((line) => {
            const [name, icon, t, size, colors, stroke] = line.split(/\s+/);
            return {
                name,
                icon,
                t: Number(t),
                size: Number(size),
                colors: colors === '-' ? null : colors,
                stroke: stroke === '-' ? null : Number(stroke),
            };
        });
}

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
    let c = 0xffffffff;
    for (const b of bytes) c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
    return Buffer.concat([head, data, crc]);
}

/** RGBA pixels (straight alpha, rows packed) as a PNG file. */
export function encodePng(pixels: Uint8Array, width: number, height: number): Buffer {
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header.set([8, 6, 0, 0, 0], 8); // 8 bits, RGBA, deflate, no filter method, no interlace
    const rows = Buffer.alloc((width * 4 + 1) * height);
    for (let y = 0; y < height; y++) {
        rows.set(pixels.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
    }
    return Buffer.concat([
        SIGNATURE,
        chunk('IHDR', header),
        chunk('IDAT', deflateSync(rows, { level: 9 })),
        chunk('IEND', new Uint8Array()),
    ]);
}

/** A PNG file of encodePng(): RGBA, 8 bits, not interlaced; any row filter. */
export function decodePng(file: Uint8Array): { pixels: Uint8Array; width: number; height: number } {
    const buf = Buffer.from(file);
    if (!buf.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG');
    let offset = 8;
    let width = 0;
    let height = 0;
    const data: Buffer[] = [];
    while (offset < buf.length) {
        const length = buf.readUInt32BE(offset);
        const type = buf.toString('ascii', offset + 4, offset + 8);
        const body = buf.subarray(offset + 8, offset + 8 + length);
        if (type === 'IHDR') {
            width = body.readUInt32BE(0);
            height = body.readUInt32BE(4);
            if (body[8] !== 8 || body[9] !== 6 || body[12] !== 0) {
                throw new Error('only 8-bit RGBA, not interlaced');
            }
        } else if (type === 'IDAT') {
            data.push(body);
        }
        offset += length + 12;
    }
    const raw = inflateSync(Buffer.concat(data));
    const stride = width * 4;
    const pixels = new Uint8Array(stride * height);
    for (let y = 0; y < height; y++) {
        const filter = raw[y * (stride + 1)];
        const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
        const out = pixels.subarray(y * stride, (y + 1) * stride);
        const up = y ? pixels.subarray((y - 1) * stride, y * stride) : new Uint8Array(stride);
        for (let x = 0; x < stride; x++) {
            const a = x >= 4 ? out[x - 4] : 0;
            const b = up[x];
            const c = x >= 4 ? up[x - 4] : 0;
            let v = row[x];
            if (filter === 1) v += a;
            else if (filter === 2) v += b;
            else if (filter === 3) v += (a + b) >> 1;
            else if (filter === 4) {
                const p = a + b - c;
                const pa = Math.abs(p - a);
                const pb = Math.abs(p - b);
                const pc = Math.abs(p - c);
                v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
            }
            out[x] = v & 255;
        }
    }
    return { pixels, width, height };
}

export interface Difference {
    /** The largest difference of a channel. */
    max: number;
    /** Pixels with a channel off by more than `tolerance`. */
    pixels: number;
}

/** How far two RGBA frames of the same size are apart. */
export function compare(a: Uint8Array, b: Uint8Array, tolerance: number): Difference {
    if (a.length !== b.length) return { max: 255, pixels: a.length / 4 };
    let max = 0;
    let pixels = 0;
    for (let i = 0; i < a.length; i += 4) {
        let worst = 0;
        for (let k = 0; k < 4; k++) worst = Math.max(worst, Math.abs(a[i + k] - b[i + k]));
        max = Math.max(max, worst);
        if (worst > tolerance) pixels++;
    }
    return { max, pixels };
}
