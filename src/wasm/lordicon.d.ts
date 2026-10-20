// Types of the emscripten module built by scripts/build-wasm.sh (lordicon.js + lordicon.wasm).
// Functions mirror core/lordicon_c.h; pointers are numbers into HEAPU8.

export interface LordiconModule {
    HEAPU8: Uint8Array;
    HEAPF32: Float32Array;
    UTF8ToString(ptr: number): string;
    stringToUTF8(value: string, ptr: number, max: number): void;
    lengthBytesUTF8(value: string): number;
    _malloc(size: number): number;
    _free(ptr: number): void;

    _li_init(threads: number): number;
    _li_shared_canvas(on: number): void;
    _li_term(): void;
    _li_model_load(json: number, size: number, quality: number): number;
    _li_model_free(model: number): void;
    _li_icon_new(model: number): number;
    _li_load(json: number, size: number, quality: number): number;
    _li_free(icon: number): void;
    _li_width(icon: number): number;
    _li_height(icon: number): number;
    _li_frame_rate(icon: number): number;
    _li_total_frames(icon: number): number;
    _li_first_frame(icon: number): number;
    _li_marker_count(icon: number): number;
    _li_marker_name(icon: number, index: number): number;
    _li_marker_begin(icon: number, index: number): number;
    _li_marker_end(icon: number, index: number): number;
    _li_color_count(icon: number): number;
    _li_color_name(icon: number, index: number): number;
    _li_color(icon: number, index: number, rgb: number): void;
    _li_set_color(icon: number, name: number, r: number, g: number, b: number): number;
    _li_stroke(icon: number): number;
    _li_set_stroke(icon: number, value: number): number;
    _li_set_tint(icon: number, on: number, r: number, g: number, b: number): void;
    _li_segment(icon: number, begin: number, end: number): void;
    _li_playback(icon: number, speed: number, direction: number, loop: number, rest: number): void;
    _li_play(icon: number): void;
    _li_pause(icon: number): void;
    _li_playing(icon: number): number;
    _li_seek(icon: number, frame: number): void;
    _li_current_frame(icon: number): number;
    _li_tick(icon: number, dt: number): number;
    _li_render(icon: number, width: number, height: number): number;
    _li_render_into(
        icon: number,
        pixels: number,
        width: number,
        height: number,
        stride: number,
        premultiplied: number,
    ): number;
}

export interface ModuleOptions {
    locateFile?(path: string, prefix: string): string;
    wasmBinary?: ArrayBuffer | Uint8Array;
}

export default function createLordicon(options?: ModuleOptions): Promise<LordiconModule>;
