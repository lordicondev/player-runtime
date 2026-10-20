import type { Icon } from '../src/index.ts';
import type { Command, Stats } from './render-worker.ts';
import { Clock, runtime } from './shared.ts';

const ICONS = [
    'lock',
    'coins',
    'trash',
    'download',
    'puzzle',
    'lock-alt',
    'morph-select',
    'morph-account',
    'wired-outline-489-rocket-space-hover-flying',
    'wired-flat-24-approved-checked-hover-pinch',
    'wired-gradient-3094-marketing-letter-hover-pinch',
];
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const texts = new Map(
    await Promise.all(
        ICONS.map(
            async (name) => [name, await (await fetch(`/icons/${name}.json`)).text()] as const,
        ),
    ),
);

/** A pool of render workers; each reports its own frame rate and render time. */
class Pool {
    readonly workers: Worker[] = [];
    readonly stats: (Stats | null)[] = [];

    async resize(count: number) {
        while (this.workers.length > count) this.workers.pop()!.terminate();
        this.stats.length = count;
        const started: Promise<void>[] = [];
        while (this.workers.length < count) {
            const index = this.workers.length;
            const worker = new Worker(new URL('./render-worker.ts', import.meta.url), {
                type: 'module',
            });
            started.push(
                new Promise((resolve) => {
                    worker.onmessage = ({ data }) => {
                        if (data.type === 'ready') resolve();
                        else this.stats[index] = data;
                    };
                }),
            );
            this.workers.push(worker);
        }
        await Promise.all(started);
        this.stats.fill(null);
    }

    send(worker: Worker, command: Command, transfer: Transferable[] = []) {
        worker.postMessage(command, transfer);
    }
}

const pool = new Pool();
const clock = new Clock(); // main-thread rendering, with 0 workers
let local: Icon[] = [];

async function build() {
    const count = Math.max(1, Math.min(400, +$<HTMLInputElement>('count').value));
    const size = +$<HTMLSelectElement>('size').value;
    const workers = +$<HTMLSelectElement>('workers').value;

    clock.items.clear();
    local.forEach((icon) => icon.destroy());
    local = [];
    for (const worker of pool.workers) pool.send(worker, { type: 'clear' });
    await pool.resize(workers);

    const canvases: HTMLCanvasElement[] = [];
    for (let i = 0; i < count; i++) {
        const json = texts.get(ICONS[i % ICONS.length])!;
        const canvas = document.createElement('canvas');
        canvas.className = 'icon';
        canvas.style.setProperty('--size', `${size}px`);
        canvas.width = canvas.height = Math.round(size * devicePixelRatio);
        canvases.push(canvas);
        if (workers === 0) {
            const icon = runtime.load(json);
            icon.playback({ loop: true });
            icon.seek(icon.firstFrame + ((i * 7) % icon.totalFrames));
            icon.play();
            clock.add(icon, canvas);
            local.push(icon);
        } else {
            const offscreen = canvas.transferControlToOffscreen();
            const worker = pool.workers[i % workers];
            pool.send(worker, { type: 'add', id: i, json, canvas: offscreen, offset: i * 7 }, [
                offscreen,
            ]);
        }
    }
    $('stage').replaceChildren(...canvases);
}

// The main thread's own frame rate, and the optional load that blocks it.
let frames = 0;
let since = performance.now();
function frame(now: number) {
    const busy = +$<HTMLSelectElement>('busy').value;
    const until = performance.now() + busy;
    while (performance.now() < until) {
        // Simulated work: layout, JavaScript, anything that holds the main thread.
    }
    frames++;
    if (now - since >= 1000) {
        const fps = (frames * 1000) / (now - since);
        const lines = [`main thread ${fps.toFixed(0)} fps`];
        if (pool.workers.length === 0) {
            const render = clock.renderMs / Math.max(1, clock.renders);
            lines.push(
                `${local.length} icons on the main thread · ${render.toFixed(3)} ms per icon`,
            );
            clock.renderMs = 0;
            clock.renders = 0;
        }
        pool.stats.forEach((s, i) => {
            if (s)
                lines.push(
                    `worker ${i + 1}: ${s.icons} icons · ${s.fps.toFixed(0)} fps · ${s.frameMs.toFixed(2)} ms per frame`,
                );
        });
        $('stats').innerHTML = lines.join('<br />');
        frames = 0;
        since = now;
    }
    requestAnimationFrame(frame);
}

for (const id of ['count', 'size', 'workers']) $(id).addEventListener('change', build);
await build();
requestAnimationFrame(frame);
