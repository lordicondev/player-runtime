// Reference frames in headless Chromium: @lordicon/internal, today's web player and the only
// reference, renders SVG in a real page and the frame is captured with a transparent background.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { PNG } from 'pngjs';

const require = createRequire(import.meta.url);

const PAGE = `<!doctype html><html><head><style>
html, body { margin: 0; background: transparent; }
#icon { width: var(--size); height: var(--size); }
/*SRGB*/
</style></head><body><div id="icon"></div>
<script type="module">
import lottie from '/internal.mjs';
let anim = null;
window.loadIcon = (data) => {
    anim?.destroy();
    anim = lottie.loadAnimation({ container: document.getElementById('icon'), animationData: data, loop: false, autoplay: false });
};
window.showFrame = (f) => anim.goToAndStop(f, true);
window.ready = true;
</script></body></html>`;

// srgbFilters: blur in sRGB instead of the browser default linearRGB (what ThorVG and AE do).
export async function createChromium(size, { srgbFilters = false } = {}) {
    const player = readFileSync(require.resolve('@lordicon/internal'), 'utf8');
    const page_ = srgbFilters
        ? PAGE.replace('/*SRGB*/', 'filter, feGaussianBlur { color-interpolation-filters: sRGB; }')
        : PAGE;
    const browser = await chromium.launch();
    const page = await browser.newPage({
        viewport: { width: size, height: size },
        deviceScaleFactor: 1,
    });
    await page.route('http://ref.local/**', (route) => {
        const url = route.request().url();
        if (url.endsWith('/internal.mjs'))
            return route.fulfill({ contentType: 'text/javascript', body: player });
        return route.fulfill({
            contentType: 'text/html',
            body: page_.replace('var(--size)', `${size}px`).replace('var(--size)', `${size}px`),
        });
    });
    let errors = [];
    page.on('pageerror', (e) => errors.push(String(e.message ?? e)));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.goto('http://ref.local/');
    await page.waitForFunction(() => window.ready);
    const icon = page.locator('#icon');

    return {
        // lead: play only the last `lead` frames before each one (faster for late frames; the
        // seek before them may leave layers that changed earlier in an older state).
        async frames(data, frames, { lead = Infinity } = {}) {
            await page.evaluate((d) => window.loadIcon(d), data);
            const out = [];
            let last = -1;
            for (const f of frames) {
                // Play up to the frame instead of seeking: after a long seek the players can
                // leave layers in an older state (a test artifact; playback goes frame by frame).
                await page.evaluate(
                    ([from, to]) => {
                        for (let i = from; i <= to; i++) window.showFrame(i);
                    },
                    [Math.max(f > last ? last + 1 : 0, f - lead), f],
                );
                last = f;
                out.push(
                    PNG.sync.read(
                        await icon.screenshot({ omitBackground: true, animations: 'disabled' }),
                    ),
                );
            }
            return out;
        },
        // Page errors and console errors since the last call.
        takeErrors() {
            const out = errors;
            errors = [];
            return out;
        },
        close: () => browser.close(),
    };
}
