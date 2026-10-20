// threadtest: 4 threads, each loading and rendering its own icons at the same time, two icons of
// different looks per model; every frame's pixels are hashed and compared with a sequential run
// of the same work.
// Usage: threadtest <rounds> <icon.json>...
#include <atomic>
#include <cstdlib>
#include <cstdio>
#include <fstream>
#include <memory>
#include <string>
#include <thread>
#include <vector>

#include "../core/lordicon.h"

using namespace lordicon;

int main(int argc, char** argv)
{
    std::vector<std::string> files;
    int rounds = atoi(argv[1]);
    for (int i = 2; i < argc; ++i) {
        std::ifstream in(argv[i], std::ios::binary);
        files.emplace_back((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
    }
    sharedCanvas(true);
    init(0);
    std::atomic<int> renders{0}, failures{0};
    auto work = [&](int t) {
        uint64_t hash = 1469598103934665603ull;
        {
            std::vector<std::unique_ptr<Icon>> icons;
            for (int i = 0; i < 3; ++i) {
                auto& json = files[(t + i) % files.size()];
                auto model = Model::load(json.data(), json.size());
                if (!model) {
                    ++failures;
                    continue;
                }
                icons.push_back(std::make_unique<Icon>(model));
                icons.push_back(std::make_unique<Icon>(model));
            }
            if (icons.empty()) return hash;
            icons[0]->setColor("primary", {1, 0, 0});
            icons[1]->setStroke(3);
            std::vector<uint32_t> buffer(96 * 96);
            for (int f = 0; f < 60; f += 3) {
                for (auto& icon : icons) {
                    if (!icon) continue;
                    icon->frame(icon->firstFrame() + f);
                    if (icon->render(buffer.data(), 96, 96, 96, true)) ++renders;
                    else ++failures;
                    for (auto px : buffer) hash = (hash ^ px) * 1099511628211ull;
                }
            }
        }
        return hash;
    };
    uint64_t expected[4];
    for (int t = 0; t < 4; ++t) expected[t] = work(t);
    int mismatches = 0;
    for (int r = 0; r < rounds; ++r) {
        uint64_t got[4];
        std::vector<std::thread> threads;
        for (int t = 0; t < 4; ++t) threads.emplace_back([&, t] { got[t] = work(t); });
        for (auto& th : threads) th.join();
        for (int t = 0; t < 4; ++t) mismatches += got[t] != expected[t];
    }
    printf("rounds %d, renders %d, failures %d, mismatching thread results %d\n", rounds, renders.load(), failures.load(), mismatches);
    term();
    return failures || mismatches ? 1 : 0;
}
