import createLordicon, { type LordiconModule } from './wasm/lordicon.js';

export type { LordiconModule };

export interface RuntimeOptions {
    /**
     * The `.wasm`: a URL, or its bytes. By default it loads from next to this package's code,
     * where bundlers (Vite, webpack) find and copy it.
     */
    wasm?: string | URL | ArrayBuffer | Uint8Array;
}

export interface LoadOptions {
    /** Effect quality (blur, shadow), 0..100; ThorVG's default is 50. */
    quality?: number;
}

/** A marker of the icon file: `default:hover-pinch`, `in-reveal`, `morph-select:0.5`. */
export interface Marker {
    name: string;
    /** First and last frame. */
    begin: number;
    end: number;
}

export interface Playback {
    speed?: number;
    /** 1 forward, -1 backward. */
    direction?: 1 | -1;
    loop?: boolean;
    /**
     * Seconds on the last frame between loop rounds. Pausing holds the rest; turning the loop
     * off during it ends playback.
     */
    rest?: number;
}

/** Flags returned by `Icon.tick()`. */
export const Events = {
    /** The segment ended (not looping). */
    complete: 1,
    /** A loop round ended. */
    loop: 2,
    /** The frame or the looks changed: render it. */
    frame: 4,
} as const;

/** Loads the wasm module. One runtime serves any number of icons. */
export async function createRuntime(options: RuntimeOptions = {}): Promise<Runtime> {
    const { wasm } = options;
    const module = await createLordicon(
        wasm instanceof ArrayBuffer || wasm instanceof Uint8Array
            ? { wasmBinary: wasm }
            : {
                  locateFile: () =>
                      String(
                          wasm ?? new URL(/* @vite-ignore */ './lordicon.wasm', import.meta.url),
                      ),
              },
    );
    module._li_init(0);
    // One ThorVG canvas for all icons of this (single-threaded) module.
    module._li_shared_canvas(1);
    return new Runtime(module);
}

export class Runtime {
    readonly #module: LordiconModule;
    readonly #encoder = new TextEncoder();

    constructor(module: LordiconModule) {
        this.#module = module;
    }

    /**
     * Parses an icon (its Lottie JSON as text or object) and resolves Lordicon's colour and
     * stroke bindings, so `setColor()` and `setStroke()` work without reloading.
     */
    load(icon: string | object, options: LoadOptions = {}): Icon {
        const model = this.model(icon, options);
        const loaded = model.icon();
        model.destroy(); // the icon keeps it
        return loaded;
    }

    /**
     * Parses an icon once, for any number of icons drawn from it (`model.icon()`), each with
     * a frame and a look of its own: one copy in memory however many show it.
     */
    model(icon: string | object, { quality = -1 }: LoadOptions = {}): Model {
        const M = this.#module;
        const bytes = this.#encoder.encode(typeof icon === 'string' ? icon : JSON.stringify(icon));
        const buffer = M._malloc(bytes.length);
        M.HEAPU8.set(bytes, buffer);
        const handle = M._li_model_load(buffer, bytes.length, quality);
        M._free(buffer);
        if (!handle) throw new Error('Not a Lottie icon');
        return new Model(M, handle);
    }
}

/** A parsed icon, shared by the icons drawn from it. */
export class Model {
    readonly #M: LordiconModule;
    #handle: number;

    constructor(module: LordiconModule, handle: number) {
        this.#M = module;
        this.#handle = handle;
    }

    /** An icon drawn from this model, with its own playback, colours, stroke and tint. */
    icon(): Icon {
        if (!this.#handle) throw new Error('The model was destroyed');
        return new Icon(this.#M, this.#M._li_icon_new(this.#handle));
    }

    /** Lets go of the model; it lives on while icons drawn from it do. */
    destroy(): void {
        if (this.#handle) this.#M._li_model_free(this.#handle);
        this.#handle = 0;
    }
}

export class Icon {
    readonly #M: LordiconModule;
    #handle: number;
    #image: ImageData | null = null;

    constructor(module: LordiconModule, handle: number) {
        this.#M = module;
        this.#handle = handle;
    }

    get width(): number {
        return this.#M._li_width(this.#live());
    }

    get height(): number {
        return this.#M._li_height(this.#live());
    }

    get frameRate(): number {
        return this.#M._li_frame_rate(this.#live());
    }

    /** Frames in the file (`op - ip`). */
    get totalFrames(): number {
        return this.#M._li_total_frames(this.#live());
    }

    /**
     * The file's first frame (`ip`). Frames are absolute, as markers count them:
     * `firstFrame` to `firstFrame + totalFrames - 1`.
     */
    get firstFrame(): number {
        return this.#M._li_first_frame(this.#live());
    }

    get markers(): Marker[] {
        const M = this.#M;
        const h = this.#live();
        return Array.from({ length: M._li_marker_count(h) }, (_, i) => ({
            name: M.UTF8ToString(M._li_marker_name(h, i)),
            begin: M._li_marker_begin(h, i),
            end: M._li_marker_end(h, i),
        }));
    }

    /** Colours of the icon's control layer, by name: `{ primary: '#121331', ... }`. */
    get colors(): Record<string, string> {
        const M = this.#M;
        const h = this.#live();
        const rgb = M._malloc(12);
        const colors: Record<string, string> = {};
        for (let i = 0; i < M._li_color_count(h); i++) {
            M._li_color(h, i, rgb);
            const channels = M.HEAPF32.subarray(rgb / 4, rgb / 4 + 3);
            colors[M.UTF8ToString(M._li_color_name(h, i))] =
                '#' +
                Array.from(channels, (v) =>
                    Math.round(v * 255)
                        .toString(16)
                        .padStart(2, '0'),
                ).join('');
        }
        M._free(rgb);
        return colors;
    }

    /** Sets a colour by name (`'#rrggbb'`); false when the icon has no such colour. */
    setColor(name: string, color: string): boolean {
        const value = /^#([0-9a-f]{6})$/i.exec(color);
        if (!value) return false;
        const v = parseInt(value[1], 16);
        const M = this.#M;
        const size = M.lengthBytesUTF8(name) + 1;
        const ptr = M._malloc(size);
        M.stringToUTF8(name, ptr, size);
        const ok = M._li_set_color(
            this.#live(),
            ptr,
            ((v >> 16) & 255) / 255,
            ((v >> 8) & 255) / 255,
            (v & 255) / 255,
        );
        M._free(ptr);
        return ok === 1;
    }

    /** Stroke width 1..3 (light, regular, bold); 0 for an icon without a stroke control. */
    get stroke(): number {
        return this.#M._li_stroke(this.#live());
    }

    setStroke(value: 1 | 2 | 3): boolean {
        return this.#M._li_set_stroke(this.#live(), value) === 1;
    }

    /**
     * The whole icon in one colour (`'#rrggbb'`), its alpha kept, like CSS `currentColor`;
     * `null` for its own colours again.
     */
    setTint(color: string | null): void {
        const value = color === null ? null : /^#([0-9a-f]{6})$/i.exec(color);
        if (color !== null && !value) throw new Error(`Not a colour: ${color}`);
        const v = value ? parseInt(value[1], 16) : 0;
        this.#M._li_set_tint(
            this.#live(),
            value ? 1 : 0,
            ((v >> 16) & 255) / 255,
            ((v >> 8) & 255) / 255,
            (v & 255) / 255,
        );
    }

    /** Plays `[begin, end]` (frames); the frame moves to the start in the play direction. */
    segment(begin: number, end: number): void {
        this.#M._li_segment(this.#live(), begin, end);
    }

    playback({ speed = 1, direction = 1, loop = false, rest = 0 }: Playback): void {
        this.#M._li_playback(this.#live(), speed, direction, loop ? 1 : 0, rest);
    }

    play(): void {
        this.#M._li_play(this.#live());
    }

    pause(): void {
        this.#M._li_pause(this.#live());
    }

    get playing(): boolean {
        return this.#M._li_playing(this.#live()) === 1;
    }

    get frame(): number {
        return this.#M._li_current_frame(this.#live());
    }

    seek(frame: number): void {
        this.#M._li_seek(this.#live(), frame);
    }

    /** Advances playback by `dt` seconds; returns `Events` flags. Render on `Events.frame`. */
    tick(dt: number): number {
        return this.#M._li_tick(this.#live(), dt);
    }

    /** The current frame as RGBA (straight alpha), `width * height * 4` bytes, a copy. */
    render(width: number, height: number): Uint8ClampedArray {
        const ptr = this.#M._li_render(this.#live(), width, height);
        return new Uint8ClampedArray(this.#M.HEAPU8.slice(ptr, ptr + width * height * 4).buffer);
    }

    /** Renders the current frame onto a 2D canvas context, its whole size by default. */
    draw(
        context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
        width = context.canvas.width,
        height = context.canvas.height,
    ): void {
        const ptr = this.#M._li_render(this.#live(), width, height);
        if (this.#image?.width !== width || this.#image.height !== height)
            this.#image = new ImageData(width, height);
        this.#image.data.set(this.#M.HEAPU8.subarray(ptr, ptr + width * height * 4));
        context.putImageData(this.#image, 0, 0);
    }

    /** Frees the icon. Using it afterwards throws. */
    destroy(): void {
        if (this.#handle) this.#M._li_free(this.#handle);
        this.#handle = 0;
    }

    #live(): number {
        if (!this.#handle) throw new Error('The icon was destroyed');
        return this.#handle;
    }
}
