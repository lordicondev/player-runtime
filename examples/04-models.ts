import type { Icon, Model } from '../src/index.ts';
import { canvasFor, Clock, runtime } from './shared.ts';

const ICONS = [
    'lock',
    'coins',
    'trash',
    'download',
    'puzzle',
    'lock-alt',
    'morph-select',
    'morph-account',
    'morph-shopping',
];
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const clock = new Clock();
let icons: Icon[] = [];
let loadMs = 0;

const files = new Map<string, string>();
for (const name of ICONS) files.set(name, await (await fetch(`/icons/${name}.json`)).text());

async function build() {
    clock.items.clear();
    icons.forEach((icon) => icon.destroy());
    icons = [];
    const count = Math.max(1, Math.min(300, +$<HTMLInputElement>('count').value));
    const size = +$<HTMLSelectElement>('size').value;
    const shared = $<HTMLInputElement>('shared').checked;
    const models = new Map<string, Model>();
    const canvases: HTMLCanvasElement[] = [];
    const t0 = performance.now();
    for (let i = 0; i < count; i++) {
        const json = files.get(ICONS[i % ICONS.length])!;
        let icon: Icon;
        if (shared) {
            let model = models.get(json);
            if (!model) models.set(json, (model = runtime.model(json)));
            icon = model.icon();
        } else {
            icon = runtime.load(json);
        }
        icon.playback({ loop: true });
        icon.seek(icon.firstFrame + ((i * 7) % icon.totalFrames)); // not in lockstep
        icon.play();
        const canvas = canvasFor(icon, size);
        clock.add(icon, canvas);
        icons.push(icon);
        canvases.push(canvas);
    }
    loadMs = (performance.now() - t0) / count;
    // The icons keep their models: the page's own hold can go.
    models.forEach((model) => model.destroy());
    $('stage').replaceChildren(...canvases);
}

let frames = 0;
let since = performance.now();
function stats(now: number) {
    frames++;
    if (now - since > 1000) {
        const fps = (frames * 1000) / (now - since);
        const render = clock.renderMs / Math.max(1, clock.renders);
        $('stats').textContent =
            `${icons.length} icons · load ${loadMs.toFixed(2)} ms per icon · render + draw ${render.toFixed(3)} ms per icon · ${fps.toFixed(0)} fps`;
        frames = 0;
        since = now;
        clock.renderMs = 0;
        clock.renders = 0;
    }
    requestAnimationFrame(stats);
}

$('count').addEventListener('change', build);
$('size').addEventListener('change', build);
$('shared').addEventListener('change', build);
await build();
requestAnimationFrame(stats);
