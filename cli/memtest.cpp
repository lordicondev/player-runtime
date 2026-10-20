// memtest: heap and render time per icon for N copies of one icon.
// Usage: memtest <icon.json> <count> <size> own|shared
#include <malloc.h>

#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <memory>
#include <string>
#include <vector>

#include "../core/lordicon.h"

using namespace lordicon;

int main(int argc, char** argv)
{
    if (argc < 5) return 2;
    std::ifstream in(argv[1], std::ios::binary);
    std::string json((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
    int count = atoi(argv[2]);
    uint32_t size = atoi(argv[3]);
    sharedCanvas(!strcmp(argv[4], "shared"));
    init(0);

    std::vector<std::vector<uint32_t>> buffers(count, std::vector<uint32_t>(size * size));
    auto h0 = mallinfo2().uordblks;
    std::vector<std::unique_ptr<Icon>> icons;
    for (int i = 0; i < count; ++i) icons.push_back(Icon::load(json.data(), json.size()));
    auto h1 = mallinfo2().uordblks;
    auto total = (int)icons[0]->totalFrames();
    auto t0 = std::chrono::steady_clock::now();
    int renders = 0;
    for (int f = 0; f < total; f += 4) {
        for (int i = 0; i < count; ++i) {
            icons[i]->frame(icons[i]->firstFrame() + f);
            icons[i]->render(buffers[i].data(), size, size, size, true);
            ++renders;
        }
    }
    auto ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
    auto h2 = mallinfo2().uordblks;
    printf("%s x%d @%upx: heap/icon after load %.0f KB, after rendering %.0f KB; render %.3f ms\n", argv[4], count,
           size, (h1 - h0) / 1024.0 / count, (h2 - h0) / 1024.0 / count, ms / renders);
    icons.clear();
    term();
    return 0;
}
