// tvgicon: renders frames of a Lordicon icon to PNG with the core, or benchmarks it.
#include <malloc.h>

#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

#include "../core/lordicon.h"
#include "png.h"

using namespace lordicon;

static const char* usage =
    "usage: tvgicon <icon.json> [options]\n"
    "  --frames 0,10,20     frames, absolute like markers; default the first (ip)\n"
    "  --size 96            output size in px\n"
    "  --colors a:#rrggbb,… colors by control name\n"
    "  --stroke 1|2|3       stroke menu value\n"
    "  --slots              apply colors/stroke via slots after load (default: bake at load)\n"
    "  --raw                no preprocessing (JSON as is)\n"
    "  --out out-%d.png     output path, %d = frame\n"
    "  --dump pre.json      write preprocessed JSON\n"
    "  --info               print size, frames, markers, colors, load stats (JSON)\n"
    "  --bench N            benchmark load (N runs) and render 96/192/288 px (JSON)\n"
    "  --threads N          ThorVG worker threads, default 0\n"
    "  --quality 0..100     ThorVG effect quality (blur, shadow), default 50\n";

static bool parseHex(const char* s, Rgb* out)
{
    if (*s == '#') ++s;
    if (strlen(s) != 6) return false;
    auto v = strtoul(s, nullptr, 16);
    *out = {((v >> 16) & 255) / 255.0f, ((v >> 8) & 255) / 255.0f, (v & 255) / 255.0f};
    return true;
}

static double nowMs()
{
    using namespace std::chrono;
    return duration<double, std::milli>(steady_clock::now().time_since_epoch()).count();
}

static size_t heapBytes() { return mallinfo2().uordblks; }

static void printStats(const LoadStats& s)
{
    printf("\"stats\":{\"jsonBytes\":%zu,\"outBytes\":%zu,\"parseMs\":%.3f,\"preprocessMs\":%.3f,\"loadMs\":%.3f,"
           "\"colorBindings\":%d,\"strokeBindings\":%d,\"strokeSlots\":%d,\"animatedStrokes\":%d,"
           "\"otherExpressions\":%d,\"mergedFills\":%d,\"noopTrims\":%d}",
           s.jsonBytes, s.outBytes, s.parseMs, s.preprocessMs, s.loadMs, s.colorBindings, s.strokeBindings,
           s.strokeSlots, s.animatedStrokes, s.otherExpressions, s.mergedFills, s.noopTrims);
}

static int bench(const std::string& json, const LoadOptions& opts, int runs)
{
    // Load: average over runs.
    LoadStats sum{}, st;
    for (int i = 0; i < runs; ++i) {
        auto icon = Icon::load(json.data(), json.size(), opts, &st);
        if (!icon) return 1;
        sum.parseMs += st.parseMs;
        sum.preprocessMs += st.preprocessMs;
        sum.loadMs += st.loadMs;
    }
    printf("{\"runs\":%d,\"parseMs\":%.3f,\"preprocessMs\":%.3f,\"loadMs\":%.3f,", runs, sum.parseMs / runs,
           sum.preprocessMs / runs, sum.loadMs / runs);
    printStats(st);

    // Memory: heap held by one icon after load and after rendering at 96 px (buffer excluded).
    auto h0 = heapBytes();
    auto icon = Icon::load(json.data(), json.size(), opts, nullptr);
    auto h1 = heapBytes();
    std::vector<uint32_t> buf(288 * 288);
    icon->frame(icon->firstFrame());
    icon->render(buf.data(), 96, 96, 96);
    auto h2 = heapBytes();
    printf(",\"heapLoad\":%zu,\"heapRender96\":%zu", h1 - h0, h2 - h0);

    // Render: every frame of the animation once, per size.
    auto total = (int)icon->totalFrames();
    printf(",\"frames\":%d,\"render\":{", total);
    int sizes[] = {96, 192, 288};
    for (int si = 0; si < 3; ++si) {
        auto s = sizes[si];
        icon->frame(icon->firstFrame());
        icon->render(buf.data(), s, s, s);  // warm-up, retarget
        double frameMs = 0, worst = 0;
        for (int f = 0; f < total; ++f) {
            auto t0 = nowMs();
            icon->frame(icon->firstFrame() + f);
            icon->render(buf.data(), s, s, s);
            auto dt = nowMs() - t0;
            frameMs += dt;
            if (dt > worst) worst = dt;
        }
        printf("%s\"%d\":{\"avgMs\":%.4f,\"maxMs\":%.4f}", si ? "," : "", s, frameMs / total, worst);
    }
    // Slot changes: color and stroke on a loaded icon.
    double colorMs = 0, strokeMs = 0;
    if (!icon->colors().empty()) {
        auto t0 = nowMs();
        icon->setColor(icon->colors()[0].first, {1, 0, 0});
        icon->render(buf.data(), 96, 96, 96);
        colorMs = nowMs() - t0;
    }
    if (icon->stroke() > 0) {
        auto t0 = nowMs();
        icon->setStroke(3);
        icon->render(buf.data(), 96, 96, 96);
        strokeMs = nowMs() - t0;
    }
    printf("},\"setColorMs\":%.3f,\"setStrokeMs\":%.3f}\n", colorMs, strokeMs);
    return 0;
}

int main(int argc, char** argv)
{
    if (argc < 2) {
        fputs(usage, stderr);
        return 2;
    }
    std::string path = argv[1], out, dump;
    std::vector<float> frames;
    uint32_t size = 96;
    unsigned threads = 0;
    bool slots = false, info = false;
    int benchRuns = 0;
    LoadOptions opts;
    std::vector<std::pair<std::string, Rgb>> colors;
    float stroke = 0;

    for (int i = 2; i < argc; ++i) {
        std::string a = argv[i];
        auto next = [&]() -> const char* {
            if (i + 1 >= argc) {
                fprintf(stderr, "missing value for %s\n", a.c_str());
                exit(2);
            }
            return argv[++i];
        };
        if (a == "--frames") {
            std::stringstream ss(next());
            std::string f;
            while (std::getline(ss, f, ',')) frames.push_back(strtof(f.c_str(), nullptr));
        } else if (a == "--size") size = atoi(next());
        else if (a == "--colors") {
            std::stringstream ss(next());
            std::string item;
            while (std::getline(ss, item, ',')) {
                auto colon = item.find(':');
                Rgb c;
                if (colon == std::string::npos || !parseHex(item.c_str() + colon + 1, &c)) {
                    fprintf(stderr, "bad color: %s\n", item.c_str());
                    return 2;
                }
                colors.push_back({item.substr(0, colon), c});
            }
        } else if (a == "--stroke") stroke = strtof(next(), nullptr);
        else if (a == "--slots") slots = true;
        else if (a == "--raw") opts.preprocess = false;
        else if (a == "--out") out = next();
        else if (a == "--dump") {
            dump = next();
            opts.keepSource = true;
        }
        else if (a == "--info") info = true;
        else if (a == "--bench") benchRuns = atoi(next());
        else if (a == "--threads") threads = atoi(next());
        else if (a == "--quality") opts.quality = atoi(next());
        else {
            fputs(usage, stderr);
            return 2;
        }
    }
    if (!slots) {
        opts.colors = colors;
        opts.stroke = stroke;
    }

    std::ifstream in(path, std::ios::binary);
    if (!in) {
        fprintf(stderr, "cannot read %s\n", path.c_str());
        return 1;
    }
    std::string json((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());

    init(threads);
    if (benchRuns > 0) {
        auto r = bench(json, opts, benchRuns);
        term();
        return r;
    }

    LoadStats st;
    auto icon = Icon::load(json.data(), json.size(), opts, &st);
    if (!icon) {
        fprintf(stderr, "load failed: %s\n", path.c_str());
        return 1;
    }
    if (slots) {
        for (auto& [name, c] : colors) {
            if (!icon->setColor(name, c)) fprintf(stderr, "setColor(%s) failed\n", name.c_str());
        }
        if (stroke > 0 && !icon->setStroke(stroke)) fprintf(stderr, "setStroke failed\n");
    }
    if (!dump.empty()) std::ofstream(dump, std::ios::binary) << icon->source();

    if (info) {
        printf("{\"w\":%g,\"h\":%g,\"ip\":%g,\"frames\":%g,\"fps\":%g,\"stroke\":%g,\"markers\":[", icon->width(), icon->height(),
               icon->firstFrame(), icon->totalFrames(), icon->frameRate(), icon->stroke());
        auto& ms = icon->markers();
        for (size_t i = 0; i < ms.size(); ++i)
            printf("%s{\"name\":\"%s\",\"begin\":%g,\"end\":%g}", i ? "," : "", ms[i].name.c_str(), ms[i].begin,
                   ms[i].end);
        printf("],\"colors\":{");
        auto& cs = icon->colors();
        for (size_t i = 0; i < cs.size(); ++i)
            printf("%s\"%s\":\"#%02x%02x%02x\"", i ? "," : "", cs[i].first.c_str(), (int)lroundf(cs[i].second.r * 255),
                   (int)lroundf(cs[i].second.g * 255), (int)lroundf(cs[i].second.b * 255));
        printf("},");
        printStats(st);
        printf("}\n");
    }

    if (frames.empty()) frames.push_back(icon->firstFrame());
    if (!out.empty()) {
        std::vector<uint32_t> buf(size * size);
        for (auto f : frames) {
            icon->frame(f);
            if (!icon->render(buf.data(), size, size, size)) {
                fprintf(stderr, "render failed\n");
                return 1;
            }
            char name[1024];
            auto pos = out.find("%d");
            if (pos != std::string::npos)
                snprintf(name, sizeof(name), "%s%g%s", out.substr(0, pos).c_str(), f, out.substr(pos + 2).c_str());
            else snprintf(name, sizeof(name), "%s", out.c_str());
            png::write(name, (const uint8_t*)buf.data(), size, size);
        }
    }
    icon.reset();
    term();
    return 0;
}
