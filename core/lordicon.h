// Lordicon core: loads a Lordicon Lottie icon into ThorVG, resolves the standard
// expression bindings (control colors, stroke menu) into values + slots, and renders
// frames into an RGBA buffer. No clock: the platform calls tick(dt).
#pragma once

#include <cstddef>
#include <cstdint>
#include <memory>
#include <string>
#include <vector>

namespace lordicon {

struct Rgb {
    float r, g, b;  // 0..1
};

struct LoadOptions {
    bool preprocess = true;  // resolve standard bindings; false = feed JSON to ThorVG as is
    // Initial values baked during preprocessing (no slot apply needed).
    std::vector<std::pair<std::string, Rgb>> colors;
    float stroke = 0;  // 1..3, 0 = icon default
    int quality = -1;  // ThorVG effect quality 0..100 (blur, shadow), -1 = ThorVG default (50)
    bool keepSource = false;  // keep the preprocessed JSON for source(); otherwise freed after load
};

struct LoadStats {
    double parseMs = 0;       // rapidjson parse
    double preprocessMs = 0;  // resolve bindings + serialize
    double loadMs = 0;        // ThorVG load incl. full Lottie parse + first build
    size_t jsonBytes = 0;
    size_t outBytes = 0;          // JSON handed to ThorVG
    int colorBindings = 0;        // resolved color expressions
    int strokeBindings = 0;       // resolved stroke expressions
    int strokeSlots = 0;          // distinct stroke slots
    int animatedStrokes = 0;      // stroke bindings with keyframes
    int otherExpressions = 0;     // left in place (long tail)
    int mergedFills = 0;          // fills over groups rewritten to one compound path
    int noopTrims = 0;            // trims that cut nothing, dropped (they split fills in ThorVG)
};

struct Marker {
    std::string name;
    float begin, end;
};

using Colors = std::vector<std::pair<std::string, Rgb>>;

// A loaded icon: the ThorVG model, its markers, its own colours and stroke. Any number of Icons
// draw from one model, each with a frame and a look of its own. Like ThorVG, a model is not
// thread-safe: load it, draw its icons and let it go on one thread.
class Model {
public:
    static std::shared_ptr<Model> load(const char* json, size_t size, const LoadOptions& opts = {},
                                       LoadStats* stats = nullptr);
    ~Model();

    float width() const;
    float height() const;
    float frameRate() const;
    float totalFrames() const;  // op - ip
    float firstFrame() const;   // ip
    const std::vector<Marker>& markers() const;
    // Control layer colors and stroke as loaded (LoadOptions applied).
    const Colors& colors() const;
    float stroke() const;

    // Preprocessed JSON, only with LoadOptions::keepSource (debugging / diffing).
    const std::string& source() const;

    struct Impl;

private:
    friend class Icon;
    explicit Model(Impl* impl);
    Impl* impl;
};

// One drawing of a model: its frame and look (colours, stroke, tint). Before rendering, an icon
// puts its frame and look on the model (the look only when the model shows another one).
class Icon {
public:
    // An icon with a model of its own.
    static std::unique_ptr<Icon> load(const char* json, size_t size, const LoadOptions& opts = {},
                                      LoadStats* stats = nullptr);
    explicit Icon(std::shared_ptr<Model> model);
    ~Icon();

    const std::shared_ptr<Model>& model() const;
    float width() const;
    float height() const;
    float frameRate() const;
    float totalFrames() const;  // op - ip
    float firstFrame() const;   // ip
    const std::vector<Marker>& markers() const;

    // Control layer colors (name -> current value).
    const Colors& colors() const;
    bool setColor(const std::string& name, Rgb value);
    float stroke() const;
    bool setStroke(float value);  // 1..3, via slots, keyframes rescaled
    // The whole icon in one colour, alpha kept (like CSS currentColor); off by default.
    void setTint(bool on, Rgb color = {0, 0, 0});

    // Frames are absolute, like markers: firstFrame() .. firstFrame() + totalFrames() - 1. A file
    // narrowed to one state is widened to its markers (when preprocessed).
    bool frame(float no);
    float currentFrame() const;

    // Renders the current frame. Buffer: RGBA8 bytes (ABGR as uint32 on little endian), stride in
    // pixels; premultiplied alpha for platform bitmaps (Android, CoreGraphics), straight for canvas.
    bool render(uint32_t* buffer, uint32_t w, uint32_t h, uint32_t stride, bool premultiplied = false);

    // Preprocessed JSON, only with LoadOptions::keepSource (debugging / diffing).
    const std::string& source() const;

    struct Impl;

private:
    Impl* impl;
};

// Playback over a segment. Mirrors what @lordicon/web needs from lottie-web.
struct Playback {
    enum Event : int { None = 0, Complete = 1, Loop = 2 };

    float begin = 0, end = 0;  // inclusive frame range
    float frameRate = 60;
    float speed = 1;
    int direction = 1;
    bool loop = false;
    float rest = 0;  // seconds on the last frame between loop rounds
    bool playing = false;
    float frame = 0;
    double resting = 0;  // seconds left of the current rest

    void segment(float b, float e);
    // Advances by dt seconds; returns Event flags.
    int tick(double dt);
};

// Shared canvas: one ThorVG SwCanvas per thread instead of one per icon (less memory; an icon
// must then always render on the same thread). Set before loading icons.
void sharedCanvas(bool on);

bool init(unsigned threads = 0);
void term();

}  // namespace lordicon
