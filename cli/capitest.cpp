// capitest: the C API (lordicon_c.h) as the platforms use it: loading, metadata, playback and
// its events (with rests between loop rounds), colours, stroke and tint, icons sharing a model,
// rendering into a caller's buffers. Run in CI, also under the sanitizers (LORDICON_SANITIZE).
// Usage: capitest <examples/icons dir>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

#include "lordicon_c.h"

static int failures = 0;
static const char* current = "";

#define CHECK(cond)                                                                    \
    do {                                                                               \
        if (!(cond)) {                                                                 \
            fprintf(stderr, "FAIL %s: %s (%s:%d)\n", current, #cond, __FILE__, __LINE__); \
            ++failures;                                                                \
        }                                                                              \
    } while (0)

static bool near(float a, float b, float eps = 0.01f) { return std::fabs(a - b) <= eps; }

static std::string dir;

static std::string read(const std::string& name)
{
    std::ifstream in(dir + "/" + name, std::ios::binary);
    std::stringstream s;
    s << in.rdbuf();
    return s.str();
}

static li_icon* load(const std::string& name)
{
    auto json = read(name);
    return li_load(json.data(), json.size(), -1);
}

/** Ticks until an event or `limit` ticks; returns the events of the last tick. */
static int tickUntil(li_icon* icon, int mask, double dt, int limit, int* ticks = nullptr)
{
    int events = 0, n = 0;
    while (n < limit && !((events = li_tick(icon, dt)) & mask)) ++n;
    if (ticks) *ticks = n + 1;
    return events;
}

static void testLoad()
{
    current = "load";
    const char* junk = "{\"hello\": 1}";
    CHECK(li_load(junk, strlen(junk), -1) == nullptr);
    CHECK(li_load("", 0, -1) == nullptr);
    CHECK(li_load("{", 1, -1) == nullptr);

    auto lock = load("lock.json");
    CHECK(lock != nullptr);
    if (!lock) return;
    // The file is narrowed to its default state: ip 200, op 260.
    CHECK(near(li_width(lock), 430));
    CHECK(near(li_first_frame(lock), 200));
    CHECK(near(li_total_frames(lock), 60));
    CHECK(near(li_frame_rate(lock), 60));
    CHECK(li_marker_count(lock) == 4);
    CHECK(strcmp(li_marker_name(lock, 2), "default:morph-unlocked") == 0);
    CHECK(li_color_count(lock) == 2);
    CHECK(strcmp(li_color_name(lock, 0), "primary") == 0);
    CHECK(near(li_stroke(lock), 2));
    li_free(lock);
}

static void testPlayback()
{
    auto lock = load("lock.json");
    if (!lock) return;
    const double dt = 1.0 / 60;  // one frame at 60 fps

    current = "playback: segment rests on its start";
    li_segment(lock, 200, 259);
    CHECK(near(li_current_frame(lock), 200));
    // FRAME: there is something to draw, until it is drawn.
    CHECK(li_tick(lock, dt) & LI_EVENT_FRAME);
    CHECK(li_tick(lock, dt) & LI_EVENT_FRAME);
    li_render(lock, 32, 32);
    CHECK(li_tick(lock, dt) == 0);  // paused and drawn: nothing to do

    current = "playback: plays to the end, once";
    li_playback(lock, 1, 1, 0, 0);
    li_play(lock);
    CHECK(li_playing(lock));
    int ticks = 0;
    int events = tickUntil(lock, LI_EVENT_COMPLETE, dt, 1000, &ticks);
    CHECK(events & LI_EVENT_COMPLETE);
    CHECK(ticks >= 59 && ticks <= 61);
    CHECK(!li_playing(lock));
    CHECK(near(li_current_frame(lock), 259));
    li_render(lock, 32, 32);
    CHECK(li_tick(lock, dt) == 0);

    current = "playback: twice as fast";
    li_seek(lock, 200);
    li_playback(lock, 2, 1, 0, 0);
    li_play(lock);
    tickUntil(lock, LI_EVENT_COMPLETE, dt, 1000, &ticks);
    CHECK(ticks >= 29 && ticks <= 31);

    current = "playback: backwards, from the end";
    li_playback(lock, 1, -1, 0, 0);
    li_segment(lock, 200, 259);
    CHECK(near(li_current_frame(lock), 259));
    li_play(lock);
    events = tickUntil(lock, LI_EVENT_COMPLETE, dt, 1000);
    CHECK(events & LI_EVENT_COMPLETE);
    CHECK(near(li_current_frame(lock), 200));

    current = "playback: loops, stays within the segment";
    li_playback(lock, 1, 1, 1, 0);
    li_segment(lock, 210, 220);
    li_play(lock);
    events = tickUntil(lock, LI_EVENT_LOOP, dt, 1000);
    CHECK(events & LI_EVENT_LOOP);
    CHECK(li_playing(lock));
    for (int i = 0; i < 100; ++i) {
        CHECK(!(li_tick(lock, dt) & LI_EVENT_COMPLETE));
        float f = li_current_frame(lock);
        CHECK(f >= 210 && f <= 220);
    }

    current = "playback: pause keeps the frame";
    li_pause(lock);
    float frame = li_current_frame(lock);
    li_tick(lock, dt);
    CHECK(near(li_current_frame(lock), frame));
    CHECK(!li_playing(lock));

    current = "playback: a large dt (frames skipped) still completes";
    li_playback(lock, 1, 1, 0, 0);
    li_segment(lock, 200, 259);
    li_play(lock);
    CHECK(li_tick(lock, 10.0) & LI_EVENT_COMPLETE);
    CHECK(near(li_current_frame(lock), 259));
    li_free(lock);
}

static void testLooks()
{
    auto lock = load("lock.json");
    if (!lock) return;
    current = "looks: colours and stroke by name";
    CHECK(li_set_color(lock, "primary", 1, 0, 0) == 1);
    float rgb[3] = {};
    li_color(lock, 0, rgb);
    CHECK(near(rgb[0], 1) && near(rgb[1], 0) && near(rgb[2], 0));
    CHECK(li_set_color(lock, "no-such-colour", 1, 0, 0) == 0);
    CHECK(li_set_stroke(lock, 3) == 1);
    CHECK(near(li_stroke(lock), 3));
    li_free(lock);
}

static uint32_t checksum(const std::vector<uint32_t>& pixels)
{
    uint32_t sum = 0;
    for (auto p : pixels) sum = sum * 31 + p;
    return sum;
}

static void testRenderInto()
{
    auto lock = load("lock.json");
    if (!lock) return;
    const uint32_t size = 64;
    std::vector<uint32_t> a(size * size), b(size * size);
    li_seek(lock, 230);

    current = "render into: draws, then only when something changed";
    CHECK(li_render_into(lock, a.data(), size, size, size, 1) == 1);
    auto drawn = checksum(a);
    CHECK(drawn != checksum(std::vector<uint32_t>(size * size)));
    CHECK(li_render_into(lock, a.data(), size, size, size, 1) == 0);

    current = "render into: another buffer (double buffering) is always drawn";
    CHECK(li_render_into(lock, b.data(), size, size, size, 1) == 1);
    CHECK(checksum(b) == drawn);
    CHECK(li_render_into(lock, a.data(), size, size, size, 1) == 1);

    current = "render into: a colour, a seek, a new segment redraw";
    CHECK(li_render_into(lock, a.data(), size, size, size, 1) == 0);
    li_set_color(lock, "primary", 1, 0, 0);
    CHECK(li_render_into(lock, a.data(), size, size, size, 1) == 1);
    CHECK(checksum(a) != drawn);
    li_seek(lock, 240);
    CHECK(li_render_into(lock, a.data(), size, size, size, 1) == 1);
    li_segment(lock, 200, 259);
    CHECK(li_render_into(lock, a.data(), size, size, size, 1) == 1);

    current = "render into: a stride wider than the image leaves the rest alone";
    const uint32_t stride = size + 8;
    std::vector<uint32_t> wide(stride * size, 0xdeadbeef);
    li_seek(lock, 230);
    CHECK(li_render_into(lock, wide.data(), size, size, stride, 1) == 1);
    bool untouched = true;
    for (uint32_t y = 0; y < size; ++y)
        for (uint32_t x = size; x < stride; ++x) untouched &= wide[y * stride + x] == 0xdeadbeef;
    CHECK(untouched);

    current = "render into: premultiplied alpha";
    li_set_color(lock, "primary", 1, 1, 1);
    CHECK(li_render_into(lock, a.data(), size, size, size, 1) == 1);
    bool premultiplied = true;
    for (auto p : a) {
        uint32_t r = p & 255, g = (p >> 8) & 255, bl = (p >> 16) & 255, alpha = p >> 24;
        premultiplied &= r <= alpha && g <= alpha && bl <= alpha;
    }
    CHECK(premultiplied);
    li_free(lock);
}

static void testRest()
{
    auto lock = load("lock.json");
    if (!lock) return;
    const double dt = 1.0 / 60;

    current = "rest: a round ends on its last frame and holds it";
    li_segment(lock, 210, 220);
    li_playback(lock, 1, 1, 1, 0.5f);
    li_play(lock);
    CHECK(tickUntil(lock, LI_EVENT_LOOP, dt, 1000) & LI_EVENT_LOOP);
    CHECK(near(li_current_frame(lock), 220));
    li_render(lock, 32, 32);
    int quiet = 0;
    while (quiet < 100 && li_tick(lock, dt) == 0) ++quiet;
    CHECK(quiet >= 28 && quiet <= 31);  // half a second: nothing to draw
    CHECK(li_current_frame(lock) < 212);  // then the next round, from the start

    current = "rest: pause holds the rest";
    CHECK(tickUntil(lock, LI_EVENT_LOOP, dt, 1000) & LI_EVENT_LOOP);
    for (int i = 0; i < 10; ++i) li_tick(lock, dt);
    li_pause(lock);
    for (int i = 0; i < 100; ++i) li_tick(lock, dt);
    li_play(lock);
    li_render(lock, 32, 32);
    quiet = 0;
    while (quiet < 100 && li_tick(lock, dt) == 0) ++quiet;
    CHECK(quiet >= 18 && quiet <= 21);  // what was left of it

    current = "rest: loop off ends playback at once";
    CHECK(tickUntil(lock, LI_EVENT_LOOP, dt, 1000) & LI_EVENT_LOOP);
    li_playback(lock, 1, 1, 0, 0.5f);
    CHECK(li_tick(lock, dt) & LI_EVENT_COMPLETE);
    CHECK(!li_playing(lock));
    CHECK(near(li_current_frame(lock), 220));

    current = "rest: a seek ends the rest";
    li_playback(lock, 1, 1, 1, 10);
    li_play(lock);
    CHECK(tickUntil(lock, LI_EVENT_LOOP, dt, 1000) & LI_EVENT_LOOP);
    li_seek(lock, 212);
    li_tick(lock, dt);
    CHECK(li_current_frame(lock) > 212);
    li_free(lock);
}

/** The pixels of `icon` at `frame`, `size` square, premultiplied. */
static std::vector<uint32_t> draw(li_icon* icon, float frame, uint32_t size = 64)
{
    std::vector<uint32_t> pixels(size * size);
    li_seek(icon, frame);
    li_render_into(icon, pixels.data(), size, size, size, 1);
    return pixels;
}

static void testSharedModel()
{
    auto json = read("lock.json");
    current = "model: icons of one model draw as icons of their own";
    auto model = li_model_load(json.data(), json.size(), -1);
    CHECK(model != nullptr);
    if (!model) return;
    li_icon* shared[3] = {li_icon_new(model), li_icon_new(model), li_icon_new(model)};
    li_icon* own[3] = {load("lock.json"), load("lock.json"), load("lock.json")};
    li_model_free(model);  // the icons keep it
    for (auto set : {shared, own}) {
        li_set_color(set[1], "primary", 1, 0, 0);
        li_set_stroke(set[1], 3);
        li_set_color(set[2], "secondary", 0, 0, 1);
        li_set_tint(set[2], 1, 0, 0.5f, 0);
    }
    // Interleaved, so each icon puts its look and frame back on the model.
    for (int round = 0; round < 2; ++round) {
        for (int i = 0; i < 3; ++i) {
            float frame = 215 + 10 * i + round;
            CHECK(draw(shared[i], frame) == draw(own[i], frame));
        }
    }
    CHECK(checksum(draw(shared[0], 230)) != checksum(draw(shared[1], 230)));

    current = "model: a look back to the icon's own, after others";
    float rgb[3];
    li_icon* fresh = load("lock.json");
    li_color(fresh, 0, rgb);
    li_set_color(shared[1], "primary", rgb[0], rgb[1], rgb[2]);
    li_set_stroke(shared[1], li_stroke(fresh));
    CHECK(draw(shared[1], 230) == draw(fresh, 230));
    CHECK(draw(shared[2], 230) == draw(own[2], 230));
    for (int i = 0; i < 3; ++i) {
        li_free(shared[i]);
        li_free(own[i]);
    }
    li_free(fresh);
}

static void testSameFrameLook()
{
    // ThorVG cached layer transforms by frame; a slot switching layers (legacy stroke layers)
    // on the same frame showed from the next frame only (patches/06).
    current = "look on the same frame: stroke layers switch at once";
    auto icon = load("morph-select.json");
    auto fresh = load("morph-select.json");
    if (!icon || !fresh) return;
    float frame = li_first_frame(icon) + 10;
    li_set_stroke(icon, 1);
    draw(icon, frame);
    li_set_stroke(icon, 3);
    li_set_stroke(fresh, 3);
    CHECK(draw(icon, frame) == draw(fresh, frame));
    li_free(icon);
    li_free(fresh);
}

static void testTint()
{
    auto lock = load("lock.json");
    if (!lock) return;
    current = "tint: every pixel in the colour, alpha kept";
    auto plain = draw(lock, 230);
    li_set_tint(lock, 1, 1, 0, 0);
    auto red = draw(lock, 230);
    bool kept = true, tinted = true;
    int opaque = 0;
    for (size_t i = 0; i < red.size(); ++i) {
        uint32_t a = red[i] >> 24;
        kept &= a == plain[i] >> 24;
        if (!a) continue;
        ++opaque;
        tinted &= (red[i] & 255) == a && ((red[i] >> 8) & 255) == 0 && ((red[i] >> 16) & 255) == 0;
    }
    CHECK(kept);
    CHECK(tinted);
    CHECK(opaque > 0);

    current = "tint: off draws the icon's colours again";
    li_set_tint(lock, 0, 0, 0, 0);
    CHECK(draw(lock, 230) == plain);
    li_free(lock);
}

static void testEveryExample()
{
    const char* icons[] = {"coins.json", "download.json", "lock-alt.json", "lock.json",
        "morph-account.json", "morph-select.json", "morph-shopping.json", "puzzle.json", "trash.json",
        "wired-flat-24-approved-checked-hover-pinch.json",
        "wired-gradient-3094-marketing-letter-hover-pinch.json",
        "wired-outline-489-rocket-space-hover-flying.json"};
    std::vector<uint32_t> pixels(48 * 48);
    for (auto name : icons) {
        current = name;
        auto icon = load(name);
        CHECK(icon != nullptr);
        if (!icon) continue;
        float first = li_first_frame(icon), total = li_total_frames(icon);
        CHECK(total > 0);
        for (int i = 0; i < 5; ++i) {
            li_seek(icon, first + (total - 1) * i / 4);
            CHECK(li_render_into(icon, pixels.data(), 48, 48, 48, 1) == 1);
        }
        li_free(icon);
    }
}

int main(int argc, char** argv)
{
    if (argc < 2) {
        fprintf(stderr, "usage: capitest <examples/icons dir>\n");
        return 2;
    }
    dir = argv[1];
    li_init(0);
    li_shared_canvas(1);  // as on Android and iOS
    testLoad();
    testPlayback();
    testLooks();
    testRenderInto();
    testRest();
    testSharedModel();
    testSameFrameLook();
    testTint();
    testEveryExample();
    li_term();
    if (failures) {
        fprintf(stderr, "%d check(s) failed\n", failures);
        return 1;
    }
    printf("capitest: all checks passed\n");
    return 0;
}
