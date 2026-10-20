/* C API of the Lordicon core: what wasm, JNI and ObjC++ bind to.
 * One li_model = one loaded icon (the ThorVG model); one li_icon = a drawing of a model: its
 * playback, look and RGBA buffer. Like ThorVG, not thread-safe: a model and its icons are used
 * on one thread, the one that loaded the model. */
#pragma once

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#if defined(_WIN32)
#define LI_API
#else
#define LI_API __attribute__((visibility("default")))
#endif

typedef struct li_model li_model;
typedef struct li_icon li_icon;

enum { LI_EVENT_COMPLETE = 1, LI_EVENT_LOOP = 2, LI_EVENT_FRAME = 4 };

LI_API int li_init(unsigned threads);
/* One ThorVG canvas per thread instead of per icon (less memory). Call before li_load. */
LI_API void li_shared_canvas(int on);
LI_API void li_term(void);

/* Parses and preprocesses the JSON (copied). quality: ThorVG effect quality 0..100, -1 = default.
 * li_model_free drops the caller's hold; the model lives on while icons draw from it. */
LI_API li_model* li_model_load(const char* json, size_t size, int quality);
LI_API void li_model_free(li_model* model);
/* An icon drawing from the model, with a playback and look of its own. */
LI_API li_icon* li_icon_new(li_model* model);
/* An icon with a model of its own: li_model_load + li_icon_new. */
LI_API li_icon* li_load(const char* json, size_t size, int quality);
LI_API void li_free(li_icon* icon);

LI_API float li_width(li_icon* icon);
LI_API float li_height(li_icon* icon);
LI_API float li_frame_rate(li_icon* icon);
LI_API float li_total_frames(li_icon* icon);
/* Frames are absolute (like markers): li_first_frame .. li_first_frame + li_total_frames - 1. */
LI_API float li_first_frame(li_icon* icon);

/* Markers ("default:hover-pinch", ...) with [begin, end] frames. */
LI_API int li_marker_count(li_icon* icon);
LI_API const char* li_marker_name(li_icon* icon, int index);
LI_API float li_marker_begin(li_icon* icon, int index);
LI_API float li_marker_end(li_icon* icon, int index);

/* Control colors (0..1 RGB) and stroke (1..3, 0 = icon without stroke control). */
LI_API int li_color_count(li_icon* icon);
LI_API const char* li_color_name(li_icon* icon, int index);
LI_API void li_color(li_icon* icon, int index, float* rgb3);
LI_API int li_set_color(li_icon* icon, const char* name, float r, float g, float b);
LI_API float li_stroke(li_icon* icon);
LI_API int li_set_stroke(li_icon* icon, float value);
/* The whole icon in one colour (0..1 RGB), alpha kept, like CSS currentColor; on = 0 turns it off. */
LI_API void li_set_tint(li_icon* icon, int on, float r, float g, float b);

/* Playback: the platform clock calls li_tick(dt) and renders when it returns LI_EVENT_FRAME. */
LI_API void li_segment(li_icon* icon, float begin, float end);
/* rest: seconds on the last frame between loop rounds (pause holds it; loop off ends it). */
LI_API void li_playback(li_icon* icon, float speed, int direction, int loop, float rest);
LI_API void li_play(li_icon* icon);
LI_API void li_pause(li_icon* icon);
LI_API int li_playing(li_icon* icon);
LI_API void li_seek(li_icon* icon, float frame);
LI_API float li_current_frame(li_icon* icon);
LI_API int li_tick(li_icon* icon, double dt);

/* Renders the current frame into the icon's buffer: w*h RGBA8, straight alpha, rows packed.
 * The buffer stays valid until the next li_render with another size or li_free. */
LI_API uint8_t* li_render(li_icon* icon, uint32_t w, uint32_t h);

/* Renders into a caller's buffer (e.g. locked Android Bitmap pixels): RGBA8, stride in pixels.
 * Returns 1 when the frame was drawn, 0 when nothing changed since the last render into it. */
LI_API int li_render_into(li_icon* icon, uint32_t* pixels, uint32_t w, uint32_t h, uint32_t stride, int premultiplied);

#ifdef __cplusplus
}
#endif
