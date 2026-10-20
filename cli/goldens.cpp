// goldens: renders the golden cases (test/golden/cases.txt) through the C API, as the platforms
// do, into raw RGBA files (straight alpha, rows packed): <out-dir>/<name>.rgba. The golden test
// (src/golden.test.ts) compares them with test/golden/*.png, and the WebAssembly build with the
// same files, so the native and wasm builds cannot drift apart unnoticed.
// Usage: goldens <cases.txt> <icons dir> <out dir>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <sstream>
#include <string>

#include "lordicon_c.h"

static std::string read(const std::string& path)
{
    std::ifstream in(path, std::ios::binary);
    std::stringstream s;
    s << in.rdbuf();
    return s.str();
}

/** `primary:#ff5a36,secondary:#008080` */
static bool applyColors(li_icon* icon, const std::string& text)
{
    std::stringstream items(text);
    std::string item;
    while (std::getline(items, item, ',')) {
        auto colon = item.find(':');
        if (colon == std::string::npos || item.size() - colon != 8 || item[colon + 1] != '#') return false;
        unsigned v = (unsigned)strtoul(item.c_str() + colon + 2, nullptr, 16);
        if (!li_set_color(icon, item.substr(0, colon).c_str(), ((v >> 16) & 255) / 255.f,
                ((v >> 8) & 255) / 255.f, (v & 255) / 255.f))
            return false;
    }
    return true;
}

int main(int argc, char** argv)
{
    if (argc < 4) {
        fprintf(stderr, "usage: goldens <cases.txt> <icons dir> <out dir>\n");
        return 2;
    }
    std::string iconsDir = argv[2], outDir = argv[3];
    li_init(0);
    li_shared_canvas(1);

    std::stringstream lines(read(argv[1]));
    std::string line;
    int count = 0, errors = 0;
    while (std::getline(lines, line)) {
        if (line.empty() || line[0] == '#') continue;
        std::stringstream fields(line);
        std::string name, file, colors, stroke;
        float t = 0;
        unsigned size = 0;
        if (!(fields >> name >> file >> t >> size >> colors >> stroke)) {
            fprintf(stderr, "bad line: %s\n", line.c_str());
            ++errors;
            continue;
        }
        auto json = read(iconsDir + "/" + file);
        auto icon = li_load(json.data(), json.size(), -1);
        if (!icon) {
            fprintf(stderr, "%s: cannot load %s\n", name.c_str(), file.c_str());
            ++errors;
            continue;
        }
        if (colors != "-" && !applyColors(icon, colors)) {
            fprintf(stderr, "%s: bad colours %s\n", name.c_str(), colors.c_str());
            ++errors;
        }
        if (stroke != "-" && !li_set_stroke(icon, strtof(stroke.c_str(), nullptr))) {
            fprintf(stderr, "%s: bad stroke %s\n", name.c_str(), stroke.c_str());
            ++errors;
        }
        // t: 0..1 over the file's frames, rounded to a whole frame.
        li_seek(icon, li_first_frame(icon) + std::round(t * (li_total_frames(icon) - 1)));
        auto pixels = li_render(icon, size, size);
        auto out = fopen((outDir + "/" + name + ".rgba").c_str(), "wb");
        if (!out || fwrite(pixels, 4, (size_t)size * size, out) != (size_t)size * size) {
            fprintf(stderr, "%s: cannot write\n", name.c_str());
            ++errors;
        }
        if (out) fclose(out);
        li_free(icon);
        ++count;
    }
    li_term();
    printf("goldens: %d case(s) rendered, %d error(s)\n", count, errors);
    return errors ? 1 : 0;
}
