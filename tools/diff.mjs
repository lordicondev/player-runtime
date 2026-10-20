// Pixel metrics and strips for regress.mjs and bisect.mjs. Images are square RGBA PNGs
// (pngjs) of the same size.
import { PNG } from 'pngjs';

// The name tvgicon gives frame f for `--out %d.png`: printf %g (6 significant digits).
export const frameName = (f) => String(+f.toPrecision(6));

// Composited on white, 5x5 box blur: 1 px edge shifts fade, area differences stay.
export function blurred(img) {
    const size = img.width,
        n = size * size,
        src = new Float32Array(n * 3),
        tmp = new Float32Array(n * 3),
        out = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
        const a = img.data[i * 4 + 3] / 255;
        for (let k = 0; k < 3; k++) src[i * 3 + k] = img.data[i * 4 + k] * a + 255 * (1 - a);
    }
    const pass = (from, to, dx, dy) => {
        for (let y = 0; y < size; y++)
            for (let x = 0; x < size; x++)
                for (let k = 0; k < 3; k++) {
                    let s = 0,
                        c = 0;
                    for (let d = -2; d <= 2; d++) {
                        const xx = x + d * dx,
                            yy = y + d * dy;
                        if (xx < 0 || yy < 0 || xx >= size || yy >= size) continue;
                        s += from[(yy * size + xx) * 3 + k];
                        c++;
                    }
                    to[(y * size + x) * 3 + k] = s / c;
                }
    };
    pass(src, tmp, 1, 0);
    pass(tmp, out, 0, 1);
    return out;
}

// Pixels covered (alpha > 8) in either image.
export function covered(a, b) {
    let n = 0;
    for (let i = 3; i < a.data.length; i += 4) if (a.data[i] > 8 || b.data[i] > 8) n++;
    return n;
}

// area: share of covered pixels whose blurred colour differs by more than 20/255. Pass blurred()
// results to reuse them across pairs.
export function areaDiff(a, b, ba = blurred(a), bb = blurred(b)) {
    const n = a.width * a.height;
    let area = 0;
    for (let i = 0; i < n; i++) {
        const d = Math.max(
            Math.abs(ba[i * 3] - bb[i * 3]),
            Math.abs(ba[i * 3 + 1] - bb[i * 3 + 1]),
            Math.abs(ba[i * 3 + 2] - bb[i * 3 + 2]),
        );
        if (d > 20) area++;
    }
    const c = covered(a, b);
    return c ? area / c : 0;
}

// Rows of images, one column per frame. Transparent -> white.
export function strip(rows) {
    const size = rows[0][0].width;
    const cols = rows[0].length;
    const png = new PNG({ width: size * cols, height: size * rows.length });
    rows.forEach((row, r) =>
        row.forEach((img, c) => {
            for (let y = 0; y < size; y++) {
                for (let x = 0; x < size; x++) {
                    const s = (y * size + x) * 4;
                    const d = ((r * size + y) * size * cols + c * size + x) * 4;
                    const a = img.data[s + 3] / 255;
                    for (let k = 0; k < 3; k++)
                        png.data[d + k] = Math.round(img.data[s + k] * a + 255 * (1 - a));
                    png.data[d + 3] = 255;
                }
            }
        }),
    );
    return PNG.sync.write(png);
}

// Composited on white, as RGB floats.
function onWhite(img) {
    const n = img.width * img.height,
        out = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
        const a = img.data[i * 4 + 3] / 255;
        for (let k = 0; k < 3; k++) out[i * 3 + k] = img.data[i * 4 + k] * a + 255 * (1 - a);
    }
    return out;
}

// shift: share of ink pixels (not white in either image) with no similar colour (max channel
// delta <= tol) within `radius` px in the other image, counted both ways. Tolerates small
// position differences (sub-pixel easing, thin strokes moved by 1-2 px) that `area` reports;
// keeps shapes that are missing, extra, recoloured or moved further. `rgb` takes onWhite() or
// strip pixels directly.
export function shiftDiff(a, b, options) {
    return shiftStats(a, b, options).ratio;
}

// shiftDiff with the absolute count: { ratio, px }. A thin line along an edge is a small share of
// a large dark icon but still a visible artefact; a few pixels on an almost empty frame are not.
export function shiftStats(a, b, { radius = 2, tol = 48 } = {}) {
    const size = a.width;
    const ca = a.rgb ?? onWhite(a),
        cb = b.rgb ?? onWhite(b);
    const ink = (c, i) => 255 * 3 - c[i * 3] - c[i * 3 + 1] - c[i * 3 + 2] > tol;
    const near = (from, to, x, y) => {
        const i = (y * size + x) * 3;
        for (let dy = -radius; dy <= radius; dy++)
            for (let dx = -radius; dx <= radius; dx++) {
                const xx = x + dx,
                    yy = y + dy;
                if (xx < 0 || yy < 0 || xx >= size || yy >= size) continue;
                const j = (yy * size + xx) * 3;
                if (
                    Math.abs(from[i] - to[j]) <= tol &&
                    Math.abs(from[i + 1] - to[j + 1]) <= tol &&
                    Math.abs(from[i + 2] - to[j + 2]) <= tol
                )
                    return true;
            }
        return false;
    };
    let inked = 0,
        bad = 0;
    for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++) {
            const i = y * size + x;
            if (!ink(ca, i) && !ink(cb, i)) continue;
            inked++;
            if (!near(ca, cb, x, y) || !near(cb, ca, x, y)) bad++;
        }
    return { ratio: inked ? bad / inked : 0, px: bad };
}

// Cells of a strip written by strip(): rows x cols images of size px, as { width, rgb }.
export function stripCells(png, size) {
    const rows = png.height / size,
        cols = png.width / size;
    return Array.from({ length: rows }, (_, r) =>
        Array.from({ length: cols }, (_, c) => {
            const rgb = new Float32Array(size * size * 3);
            for (let y = 0; y < size; y++)
                for (let x = 0; x < size; x++) {
                    const s = ((r * size + y) * png.width + c * size + x) * 4;
                    const d = (y * size + x) * 3;
                    rgb[d] = png.data[s];
                    rgb[d + 1] = png.data[s + 1];
                    rgb[d + 2] = png.data[s + 2];
                }
            return { width: size, height: size, rgb };
        }),
    );
}
