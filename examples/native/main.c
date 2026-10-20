/*
 * The C API as a player uses it: a model parsed once, two icons drawn from it with their own
 * look and playback, a clock that ticks them, frames rendered into a buffer (here saved as PNG).
 * Usage: render <icon.json> <out-dir>
 */
#include <lordicon_c.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static void save_png(const char* path, const uint8_t* rgba, int w, int h);

static char* read_file(const char* path, size_t* size)
{
    FILE* f = fopen(path, "rb");
    if (!f) return NULL;
    fseek(f, 0, SEEK_END);
    *size = (size_t)ftell(f);
    fseek(f, 0, SEEK_SET);
    char* data = malloc(*size);
    if (fread(data, 1, *size, f) != *size) *size = 0;
    fclose(f);
    return data;
}

int main(int argc, char** argv)
{
    if (argc < 3) {
        fprintf(stderr, "usage: %s <icon.json> <out-dir>\n", argv[0]);
        return 1;
    }
    size_t size = 0;
    char* json = read_file(argv[1], &size);
    if (!json || !size) return fprintf(stderr, "cannot read %s\n", argv[1]), 1;

    li_init(0);
    li_shared_canvas(1); /* one ThorVG canvas per thread for all icons */

    /* Parse once; each icon has its own frame, colours and playback. */
    li_model* model = li_model_load(json, size, -1);
    free(json);
    if (!model) return fprintf(stderr, "not a Lottie icon\n"), 1;
    li_icon* icons[2] = {li_icon_new(model), li_icon_new(model)};
    li_model_free(model); /* the icons keep it */

    li_set_color(icons[1], "primary", 0.24f, 0.39f, 0.87f);
    li_set_stroke(icons[1], 3);

    /* The whole file, the second icon looping backwards with a rest between rounds. */
    int first = li_first_frame(icons[0]);
    int last = first + li_total_frames(icons[0]) - 1;
    for (int i = 0; i < 2; i++) li_segment(icons[i], first, last);
    li_playback(icons[1], 1.0f, -1, 1, 0.25f);
    li_seek(icons[1], last); /* backwards: from the end */
    li_play(icons[0]);
    li_play(icons[1]);

    /* The platform clock: 60 ticks a second for two seconds; render when a frame changed. */
    enum { W = 192, H = 192 };
    static uint32_t pixels[W * H]; /* RGBA8: bytes R, G, B, A */
    for (int tick = 0; tick < 120; tick++) {
        for (int i = 0; i < 2; i++) {
            int events = li_tick(icons[i], 1.0f / 60);
            if (events & LI_EVENT_COMPLETE) printf("icon %d: complete at tick %d\n", i, tick);
            if ((events & LI_EVENT_FRAME) && tick % 30 == 0) {
                li_render_into(icons[i], pixels, W, H, W, 0 /* straight alpha */);
                char path[512];
                snprintf(path, sizeof path, "%s/icon%d-tick%03d.png", argv[2], i, tick);
                save_png(path, (const uint8_t*)pixels, W, H);
                printf("%s (frame %.1f)\n", path, li_current_frame(icons[i]));
            }
        }
    }

    li_free(icons[0]);
    li_free(icons[1]);
    li_term();
    return 0;
}

/* A minimal PNG: stored (uncompressed) deflate blocks, no dependencies. */
static uint32_t crc_table[256];

static uint32_t crc(const uint8_t* p, size_t n, uint32_t c)
{
    if (!crc_table[1])
        for (uint32_t i = 0; i < 256; i++) {
            uint32_t v = i;
            for (int k = 0; k < 8; k++) v = v & 1 ? 0xedb88320u ^ (v >> 1) : v >> 1;
            crc_table[i] = v;
        }
    for (size_t i = 0; i < n; i++) c = crc_table[(c ^ p[i]) & 0xff] ^ (c >> 8);
    return c;
}

static void put32(FILE* f, uint32_t v)
{
    uint8_t b[4] = {v >> 24, v >> 16, v >> 8, v};
    fwrite(b, 1, 4, f);
}

static void chunk(FILE* f, const char* type, const uint8_t* data, uint32_t n)
{
    put32(f, n);
    fwrite(type, 1, 4, f);
    fwrite(data, 1, n, f);
    put32(f, crc(data, n, crc((const uint8_t*)type, 4, 0xffffffffu)) ^ 0xffffffffu);
}

static void save_png(const char* path, const uint8_t* rgba, int w, int h)
{
    FILE* f = fopen(path, "wb");
    if (!f) return;
    const size_t row = (size_t)w * 4 + 1, raw = row * h, blocks = (raw + 65534) / 65535;
    uint8_t* z = malloc(2 + raw + blocks * 5 + 4);
    uint8_t* p = z;
    *p++ = 0x78, *p++ = 0x01;
    uint32_t a = 1, b = 0;
    size_t done = 0;
    while (done < raw) {
        size_t n = raw - done < 65535 ? raw - done : 65535;
        *p++ = done + n == raw;
        *p++ = n & 0xff, *p++ = n >> 8, *p++ = ~n & 0xff, *p++ = (~n >> 8) & 0xff;
        for (size_t i = 0; i < n; i++, done++) {
            size_t y = done / row, x = done % row;
            uint8_t v = x == 0 ? 0 : rgba[y * w * 4 + x - 1];
            *p++ = v;
            a = (a + v) % 65521, b = (b + a) % 65521;
        }
    }
    *p++ = b >> 8, *p++ = b, *p++ = a >> 8, *p++ = a;
    static const uint8_t signature[8] = {0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'};
    fwrite(signature, 1, 8, f);
    uint8_t header[13] = {w >> 24, w >> 16, w >> 8, w, h >> 24, h >> 16, h >> 8, h, 8, 6, 0, 0, 0};
    chunk(f, "IHDR", header, 13);
    chunk(f, "IDAT", z, (uint32_t)(p - z));
    chunk(f, "IEND", NULL, 0);
    free(z);
    fclose(f);
}
