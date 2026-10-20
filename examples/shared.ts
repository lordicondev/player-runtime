import wasm from '../src/wasm/lordicon.wasm?url';
import { createRuntime, Events, type Icon } from '../src/index.ts';

/** In the examples the wasm comes from src/; an installed package finds it by itself. */
export const runtime = await createRuntime({ wasm });

export async function loadIcon(name: string): Promise<Icon> {
    return runtime.load(await (await fetch(`/icons/${name}.json`)).text());
}

/** A canvas sized for the screen's pixel ratio. */
export function canvasFor(icon: Icon, size: number): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.className = 'icon';
    canvas.style.setProperty('--size', `${size}px`);
    canvas.width = canvas.height = Math.round(size * devicePixelRatio);
    canvas.dataset.frames = String(icon.totalFrames);
    return canvas;
}

export interface Item {
    icon: Icon;
    context: CanvasRenderingContext2D;
    onComplete?: () => void;
}

/** One requestAnimationFrame loop for all icons: tick, and draw only what changed. */
export class Clock {
    readonly items = new Set<Item>();
    renderMs = 0;
    renders = 0;
    #last = 0;

    constructor() {
        const frame = (now: number) => {
            const dt = this.#last ? (now - this.#last) / 1000 : 0;
            this.#last = now;
            for (const item of this.items) {
                const events = item.icon.tick(dt);
                if (events & Events.frame) {
                    const t0 = performance.now();
                    item.icon.draw(item.context);
                    this.renderMs += performance.now() - t0;
                    this.renders++;
                }
                if (events & Events.complete) item.onComplete?.();
            }
            requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
    }

    add(icon: Icon, canvas: HTMLCanvasElement, onComplete?: () => void): Item {
        const item = { icon, context: canvas.getContext('2d')!, onComplete };
        this.items.add(item);
        return item;
    }
}
