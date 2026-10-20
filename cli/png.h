// Minimal RGBA PNG writer: stored (uncompressed) deflate blocks, no dependencies.
#pragma once

#include <cstdint>
#include <cstdio>
#include <vector>

namespace png {

inline uint32_t crc(const uint8_t* p, size_t n, uint32_t c = 0xffffffffu)
{
    static uint32_t table[256];
    if (!table[1]) {
        for (uint32_t i = 0; i < 256; ++i) {
            uint32_t v = i;
            for (int k = 0; k < 8; ++k) v = v & 1 ? 0xedb88320u ^ (v >> 1) : v >> 1;
            table[i] = v;
        }
    }
    for (size_t i = 0; i < n; ++i) c = table[(c ^ p[i]) & 0xff] ^ (c >> 8);
    return c;
}

inline void be32(std::vector<uint8_t>& v, uint32_t x)
{
    v.push_back(x >> 24);
    v.push_back(x >> 16);
    v.push_back(x >> 8);
    v.push_back(x);
}

inline void chunk(FILE* f, const char* type, const std::vector<uint8_t>& data)
{
    std::vector<uint8_t> buf;
    be32(buf, (uint32_t)data.size());
    buf.insert(buf.end(), type, type + 4);
    buf.insert(buf.end(), data.begin(), data.end());
    auto c = crc(buf.data() + 4, buf.size() - 4) ^ 0xffffffffu;
    be32(buf, c);
    fwrite(buf.data(), 1, buf.size(), f);
}

// rgba: w*h*4 bytes, rows tightly packed.
inline bool write(const char* path, const uint8_t* rgba, uint32_t w, uint32_t h)
{
    FILE* f = fopen(path, "wb");
    if (!f) return false;
    static const uint8_t sig[] = {137, 80, 78, 71, 13, 10, 26, 10};
    fwrite(sig, 1, 8, f);

    std::vector<uint8_t> ihdr;
    be32(ihdr, w);
    be32(ihdr, h);
    ihdr.insert(ihdr.end(), {8, 6, 0, 0, 0});
    chunk(f, "IHDR", ihdr);

    std::vector<uint8_t> raw;
    raw.reserve((size_t)(w * 4 + 1) * h);
    for (uint32_t y = 0; y < h; ++y) {
        raw.push_back(0);
        raw.insert(raw.end(), rgba + (size_t)y * w * 4, rgba + (size_t)(y + 1) * w * 4);
    }

    std::vector<uint8_t> z = {0x78, 0x01};
    uint32_t a = 1, b = 0;
    for (auto byte : raw) {
        a = (a + byte) % 65521;
        b = (b + a) % 65521;
    }
    for (size_t pos = 0; pos < raw.size() || pos == 0;) {
        size_t n = raw.size() - pos < 65535 ? raw.size() - pos : 65535;
        z.push_back(pos + n == raw.size() ? 1 : 0);
        z.push_back(n & 0xff);
        z.push_back(n >> 8);
        z.push_back(~n & 0xff);
        z.push_back((~n >> 8) & 0xff);
        z.insert(z.end(), raw.begin() + pos, raw.begin() + pos + n);
        pos += n;
        if (n == 0) break;
    }
    be32(z, (b << 16) | a);
    chunk(f, "IDAT", z);
    chunk(f, "IEND", {});
    return fclose(f) == 0;
}

}  // namespace png
