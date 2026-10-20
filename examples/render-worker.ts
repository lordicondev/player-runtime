// A render worker of 05-workers: its own wasm runtime, its own clock, icons drawn on canvases
// transferred from the page. The page only sends commands; nothing comes back per frame.
import wasm from '../src/wasm/lordicon.wasm?url';
import { createRuntime, Events, type Icon } from '../src/index.ts';

export type Command =
    | { type: 'add'; id: number; json: string; canvas: OffscreenCanvas; offset: number }
    | { type: 'clear' };

export interface Stats {
    type: 'stats';
    icons: number;
    fps: number;
    /** Average render + draw time per frame, all icons of this worker. */
    frameMs: number;
}

interface Item {
    icon: Icon;
    context: OffscreenCanvasRenderingContext2D;
}

const runtime = await createRuntime({ wasm });
const items = new Map<number, Item>();

self.onmessage = ({ data }: MessageEvent<Command>) => {
    if (data.type === 'clear') {
        for (const item of items.values()) item.icon.destroy();
        items.clear();
        return;
    }
    const icon = runtime.load(data.json);
    icon.playback({ loop: true });
    icon.seek(icon.firstFrame + (data.offset % icon.totalFrames)); // not in lockstep
    icon.play();
    items.set(data.id, { icon, context: data.canvas.getContext('2d')! });
};

// Workers have requestAnimationFrame in Chrome and Firefox; elsewhere a timer stands in.
const nextFrame: (callback: (now: number) => void) => void =
    'requestAnimationFrame' in self
        ? (callback) => self.requestAnimationFrame(callback)
        : (callback) => setTimeout(() => callback(performance.now()), 1000 / 60);

let last = 0;
let frames = 0;
let busyMs = 0;
let since = performance.now();

function frame(now: number) {
    const dt = last ? (now - last) / 1000 : 0;
    last = now;
    const t0 = performance.now();
    for (const { icon, context } of items.values()) {
        if (icon.tick(dt) & Events.frame) icon.draw(context);
    }
    busyMs += performance.now() - t0;
    frames++;
    if (now - since >= 1000) {
        const stats: Stats = {
            type: 'stats',
            icons: items.size,
            fps: (frames * 1000) / (now - since),
            frameMs: busyMs / frames,
        };
        self.postMessage(stats);
        frames = 0;
        busyMs = 0;
        since = now;
    }
    nextFrame(frame);
}
nextFrame(frame);

self.postMessage({ type: 'ready' });
