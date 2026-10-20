#include "lordicon_c.h"

#include <cmath>
#include <vector>

#include "lordicon.h"

using namespace lordicon;

struct li_model {
    std::shared_ptr<Model> model;
};

struct li_icon {
    std::unique_ptr<Icon> icon;
    Playback playback;
    std::vector<uint32_t> buffer;
    bool dirty = true;  // frame or colors changed since the last render
    uint32_t* external = nullptr;  // last li_render_into target
    uint32_t ew = 0, eh = 0;
    bool externalDirty = true;
};

int li_init(unsigned threads) { return init(threads) ? 1 : 0; }
void li_term(void) { term(); }
void li_shared_canvas(int on) { sharedCanvas(on != 0); }

li_model* li_model_load(const char* json, size_t size, int quality)
{
    LoadOptions opts;
    opts.quality = quality;
    auto model = Model::load(json, size, opts);
    return model ? new li_model{std::move(model)} : nullptr;
}

void li_model_free(li_model* model) { delete model; }

li_icon* li_icon_new(li_model* model)
{
    auto li = new li_icon;
    li->icon = std::make_unique<Icon>(model->model);
    li->playback.frameRate = li->icon->frameRate();
    li->playback.segment(li->icon->firstFrame(), li->icon->firstFrame() + li->icon->totalFrames() - 1);
    return li;
}

li_icon* li_load(const char* json, size_t size, int quality)
{
    auto model = li_model_load(json, size, quality);
    if (!model) return nullptr;
    auto li = li_icon_new(model);
    li_model_free(model);
    return li;
}

void li_free(li_icon* li) { delete li; }

float li_width(li_icon* li) { return li->icon->width(); }
float li_height(li_icon* li) { return li->icon->height(); }
float li_frame_rate(li_icon* li) { return li->icon->frameRate(); }
float li_total_frames(li_icon* li) { return li->icon->totalFrames(); }
float li_first_frame(li_icon* li) { return li->icon->firstFrame(); }

int li_marker_count(li_icon* li) { return (int)li->icon->markers().size(); }
const char* li_marker_name(li_icon* li, int i) { return li->icon->markers()[i].name.c_str(); }
float li_marker_begin(li_icon* li, int i) { return li->icon->markers()[i].begin; }
float li_marker_end(li_icon* li, int i) { return li->icon->markers()[i].end; }

int li_color_count(li_icon* li) { return (int)li->icon->colors().size(); }
const char* li_color_name(li_icon* li, int i) { return li->icon->colors()[i].first.c_str(); }

void li_color(li_icon* li, int i, float* rgb)
{
    auto& c = li->icon->colors()[i].second;
    rgb[0] = c.r;
    rgb[1] = c.g;
    rgb[2] = c.b;
}

int li_set_color(li_icon* li, const char* name, float r, float g, float b)
{
    if (!li->icon->setColor(name, {r, g, b})) return 0;
    li->dirty = true;
    return 1;
}

float li_stroke(li_icon* li) { return li->icon->stroke(); }

int li_set_stroke(li_icon* li, float value)
{
    if (!li->icon->setStroke(value)) return 0;
    li->dirty = true;
    return 1;
}

void li_set_tint(li_icon* li, int on, float r, float g, float b)
{
    li->icon->setTint(on != 0, {r, g, b});
    li->dirty = true;
}

void li_segment(li_icon* li, float begin, float end)
{
    li->playback.segment(begin, end);
    li->dirty = true;
}

void li_playback(li_icon* li, float speed, int direction, int loop, float rest)
{
    li->playback.speed = speed;
    li->playback.direction = direction < 0 ? -1 : 1;
    li->playback.loop = loop != 0;
    li->playback.rest = rest > 0 ? rest : 0;
}

void li_play(li_icon* li) { li->playback.playing = true; }
void li_pause(li_icon* li) { li->playback.playing = false; }
int li_playing(li_icon* li) { return li->playback.playing ? 1 : 0; }

void li_seek(li_icon* li, float frame)
{
    li->playback.frame = frame;
    li->playback.resting = 0;
    li->dirty = true;
}

float li_current_frame(li_icon* li) { return li->playback.frame; }

int li_tick(li_icon* li, double dt)
{
    auto before = li->playback.frame;
    auto events = li->playback.tick(dt);
    if (li->playback.frame != before) li->dirty = true;
    return events | (li->dirty ? LI_EVENT_FRAME : 0);
}

uint8_t* li_render(li_icon* li, uint32_t w, uint32_t h)
{
    if (li->buffer.size() != (size_t)w * h) {
        li->buffer.assign((size_t)w * h, 0);
        li->dirty = true;
    }
    if (li->dirty) {
        li->icon->frame(li->playback.frame);
        li->icon->render(li->buffer.data(), w, h, w);
        li->dirty = false;
    }
    return reinterpret_cast<uint8_t*>(li->buffer.data());
}

int li_render_into(li_icon* li, uint32_t* pixels, uint32_t w, uint32_t h, uint32_t stride, int premultiplied)
{
    // A new target always redraws; the icon's own buffer is left for li_render.
    if (pixels != li->external || w != li->ew || h != li->eh) {
        li->external = pixels;
        li->ew = w;
        li->eh = h;
        li->externalDirty = true;
    }
    if (!li->dirty && !li->externalDirty) return 0;
    li->icon->frame(li->playback.frame);
    li->icon->render(pixels, w, h, stride, premultiplied != 0);
    li->dirty = false;
    li->externalDirty = false;
    return 1;
}
