#include "lordicon.h"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <map>

#include <thorvg.h>
#include <thorvg_lottie.h>

// Own namespace: ThorVG instantiates rapidjson internally with its own settings.
#include "rapidjson-alloc.h"
#define RAPIDJSON_NAMESPACE lordicon_rj
#define RAPIDJSON_NAMESPACE_BEGIN namespace lordicon_rj {
#define RAPIDJSON_NAMESPACE_END }
#include "rapidjson/document.h"
#include "rapidjson/stringbuffer.h"
#include "rapidjson/writer.h"

namespace rj = lordicon_rj;

namespace lordicon {

namespace {

double nowMs()
{
    using namespace std::chrono;
    return duration<double, std::milli>(steady_clock::now().time_since_epoch()).count();
}

// ---- expression matching -------------------------------------------------------------
// Only the two standard bindings are recognized; anything else stays in place.

struct Cursor {
    std::string s;
    size_t i = 0;

    bool eat(const char* lit)
    {
        auto n = strlen(lit);
        if (s.compare(i, n, lit) != 0) return false;
        i += n;
        return true;
    }
    bool quoted(std::string* out = nullptr)
    {
        if (i >= s.size() || (s[i] != '\'' && s[i] != '"')) return false;
        auto q = s[i];
        auto end = s.find(q, i + 1);
        if (end == std::string::npos) return false;
        if (out) *out = s.substr(i + 1, end - i - 1);
        i = end + 1;
        return true;
    }
    bool number(double* out)
    {
        char* end = nullptr;
        *out = strtod(s.c_str() + i, &end);
        if (end == s.c_str() + i) return false;
        i = end - s.c_str();
        return true;
    }
    bool done()
    {
        eat(";");
        return i == s.size();
    }
};

Cursor normalize(const char* expr)
{
    Cursor c;
    for (auto p = expr; *p; ++p) {
        if (!isspace((unsigned char)*p)) c.s += *p;
    }
    if (c.s.compare(0, 10, "var$bm_rt;") == 0) c.s.erase(0, 10);
    return c;
}

// comp('<comp>').layer('control').effect('<name>')
bool controlEffect(Cursor& c, std::string* name, std::string* comp)
{
    return c.eat("comp(") && c.quoted(comp) && c.eat(").layer(") && c.quoted() && c.eat(").effect(") &&
           c.quoted(name) && c.eat(")");
}

// $bm_rt = comp(C).layer('control').effect('<name>')('Color');
bool matchColor(const char* expr, std::string* name, std::string* comp)
{
    auto c = normalize(expr);
    return c.eat("$bm_rt=") && controlEffect(c, name, comp) && c.eat("('Color')") && c.done();
}

// $bm_rt = [$bm_div(] $bm_mul($bm_div(value, D), comp(C).layer('control').effect('stroke')('Menu')) [, N)];
// Returns the factor applied to menu: width = value * menu * base.
bool matchStroke(const char* expr, double* base, std::string* comp)
{
    auto c = normalize(expr);
    if (!c.eat("$bm_rt=")) return false;
    auto wrapped = c.eat("$bm_div(");
    double d, n = 1;
    std::string name;
    if (!(c.eat("$bm_mul($bm_div(value,") && c.number(&d) && c.eat("),") && controlEffect(c, &name, comp) &&
          name == "stroke" && c.eat("('Menu'))")))
        return false;
    if (wrapped && !(c.eat(",") && c.number(&n) && c.eat(")"))) return false;
    if (!c.done() || d == 0 || n == 0) return false;
    *base = 1.0 / (d * n);
    return true;
}

// Legacy per-width layers:
// if (thisComp.layer('control').effect('stroke-layers')('Menu') == N) { $bm_rt = A; } else { $bm_rt = B; }
struct LayerSwitch {
    double menu, on, off;
};

bool matchStrokeLayers(const char* expr, LayerSwitch* out)
{
    auto c = normalize(expr);
    std::string name;
    return c.eat("if(thisComp.layer(") && c.quoted() && c.eat(").effect(") && c.quoted(&name) &&
           name == "stroke-layers" && c.eat(")('Menu')==") && c.number(&out->menu) && c.eat("){$bm_rt=") &&
           c.number(&out->on) && c.eat(";}else{$bm_rt=") && c.number(&out->off) && c.eat(";}") && c.done();
}

// ---- JSON helpers ---------------------------------------------------------------------

using Writer = rj::Writer<rj::StringBuffer>;

void writeScaled(Writer& w, const rj::Value& v, double f)
{
    if (v.IsNumber()) {
        w.Double(v.GetDouble() * f);
    } else if (v.IsArray()) {
        w.StartArray();
        for (auto& e : v.GetArray()) writeScaled(w, e, f);
        w.EndArray();
    } else if (v.IsObject()) {  // keyframe: scale only start/end values
        w.StartObject();
        for (auto& m : v.GetObject()) {
            w.Key(m.name.GetString(), m.name.GetStringLength());
            auto name = m.name.GetString();
            if (!strcmp(name, "s") || !strcmp(name, "e")) writeScaled(w, m.value, f);
            else m.value.Accept(w);
        }
        w.EndObject();
    } else {
        v.Accept(w);
    }
}

void scaleInPlace(rj::Value& v, double f)
{
    if (v.IsNumber()) {
        v.SetDouble(v.GetDouble() * f);
    } else if (v.IsArray()) {
        for (auto& e : v.GetArray()) scaleInPlace(e, f);
    } else if (v.IsObject()) {
        for (auto& m : v.GetObject()) {
            auto name = m.name.GetString();
            if (!strcmp(name, "s") || !strcmp(name, "e")) scaleInPlace(m.value, f);
        }
    }
}

std::string toLower(std::string s)
{
    for (auto& ch : s) ch = (char)tolower((unsigned char)ch);
    return s;
}

// ---- Own comp -------------------------------------------------------------------------
// Bindings name the icon's comp: comp('<comp>').layer('control'). A layer copied from another
// icon can still name that icon's comp, which this file does not have: the web player leaves
// such a property at its exported value (what the designer saw), so the core does too. The
// icon's own comp is the one most bindings name.

void countComps(const rj::Value& node, std::map<std::string, int>& counts)
{
    if (node.IsArray()) {
        for (auto& e : node.GetArray()) countComps(e, counts);
        return;
    }
    if (!node.IsObject()) return;
    auto x = node.FindMember("x");
    if (x != node.MemberEnd() && x->value.IsString()) {
        std::string name, comp;
        double base;
        if (matchColor(x->value.GetString(), &name, &comp) || matchStroke(x->value.GetString(), &base, &comp))
            ++counts[comp];
    }
    for (auto& m : node.GetObject()) {
        if (m.value.IsObject() || m.value.IsArray()) countComps(m.value, counts);
    }
}

std::string ownComp(const rj::Value& doc)
{
    std::map<std::string, int> counts;
    countComps(doc, counts);
    std::string best;
    int most = 0;
    for (auto& [name, n] : counts) {
        if (n > most) best = name, most = n;
    }
    return best;
}

// ---- Fill over groups -----------------------------------------------------------------
// A fill below two or more groups fills their paths as one compound path (After Effects,
// browsers): opposite windings cancel, so a frame keeps its hole. ThorVG draws a group that
// paints (a stroke of its own) as a separate shape, fills each such group on its own, and the
// hole comes out solid. The fill is replaced, in place, by a group that holds it and copies of
// the groups' geometry (paths, modifiers, transforms; no paint), which ThorVG merges into one
// path. Only when ThorVG would split the fill: a group above it paints (groups of bare paths are
// merged already), or a paint separates paths of the list itself with no modifier among them (a
// trim or round corners there applies to some of the paths only).

bool isType(const rj::Value& v, const char* ty)
{
    auto t = v.FindMember("ty");
    return t != v.MemberEnd() && t->value.IsString() && !strcmp(t->value.GetString(), ty);
}

bool hidden(const rj::Value& v)
{
    auto hd = v.FindMember("hd");
    return hd != v.MemberEnd() && hd->value.IsBool() && hd->value.GetBool();
}

bool isPath(const rj::Value& v)
{
    return isType(v, "sh") || isType(v, "rc") || isType(v, "el") || isType(v, "sr");
}

bool isPaint(const rj::Value& v)
{
    return isType(v, "fl") || isType(v, "st") || isType(v, "gf") || isType(v, "gs");
}

const rj::Value* items(const rj::Value& group)
{
    auto it = group.FindMember("it");
    return it != group.MemberEnd() && it->value.IsArray() ? &it->value : nullptr;
}

bool hasPath(const rj::Value& group)
{
    auto list = items(group);
    if (!list) return false;
    for (auto& v : list->GetArray()) {
        if (!v.IsObject() || hidden(v)) continue;
        if (isPath(v) || (isType(v, "gr") && hasPath(v))) return true;
    }
    return false;
}

// A group that paints (fill, stroke) is drawn as a shape of its own; groups of bare paths are
// merged by ThorVG already and fill right without help.
bool paints(const rj::Value& group)
{
    auto list = items(group);
    if (!list) return false;
    for (auto& v : list->GetArray()) {
        if (!v.IsObject() || hidden(v)) continue;
        if (isPaint(v) || (isType(v, "gr") && paints(v))) return true;
    }
    return false;
}

// The group's geometry without paint; false when no path is left.
bool geometry(const rj::Value& group, rj::Value& out, rj::Document::AllocatorType& a)
{
    rj::Value list(rj::kArrayType);
    bool any = false;
    for (auto& v : items(group)->GetArray()) {
        if (!v.IsObject() || hidden(v) || isPaint(v)) continue;
        if (isType(v, "gr")) {
            rj::Value sub;
            if (items(v) && geometry(v, sub, a)) {
                list.PushBack(sub, a);
                any = true;
            }
            continue;
        }
        any |= isPath(v);
        list.PushBack(rj::Value(v, a), a);
    }
    if (!any) return false;
    out.SetObject();
    out.AddMember("ty", "gr", a);
    out.AddMember("it", list, a);
    return true;
}

// A static number property of a shape item (`a` 0); false when animated or not a number.
bool staticNumber(const rj::Value& item, const char* key, double& out)
{
    auto m = item.FindMember(key);
    if (m == item.MemberEnd() || !m->value.IsObject()) return false;
    auto anim = m->value.FindMember("a");
    if (anim != m->value.MemberEnd() && anim->value.IsInt() && anim->value.GetInt() != 0) return false;
    auto k = m->value.FindMember("k");
    if (k == m->value.MemberEnd()) return false;
    auto& v = k->value.IsArray() && k->value.Size() == 1 ? k->value[0] : k->value;
    if (!v.IsNumber()) return false;
    out = v.GetDouble();
    return true;
}

// A trim that keeps whole paths (static 0-100%, offset a multiple of 360) cuts nothing. ThorVG
// still ends a shape at it: the paths on its two sides fill as separate shapes, and a fill that
// spans them loses its holes (Lordicon: the tambourine, the 2 and 3 on the medals).
bool noopTrim(const rj::Value& v)
{
    if (!isType(v, "tm") || hidden(v)) return false;
    double s, e, o = 0;
    if (!staticNumber(v, "s", s) || !staticNumber(v, "e", e)) return false;
    if (v.HasMember("o") && !staticNumber(v, "o", o)) return false;
    bool whole = (s <= 0 && e >= 100) || (s >= 100 && e <= 0);
    return whole && std::fmod(o, 360.0) == 0;
}

rj::Value identityTransform(rj::Document::AllocatorType& a)
{
    auto prop = [&](std::initializer_list<double> k) {
        rj::Value p(rj::kObjectType), arr(rj::kArrayType);
        for (auto x : k) arr.PushBack(x, a);
        p.AddMember("a", 0, a);
        if (k.size() == 1) p.AddMember("k", *k.begin(), a);
        else p.AddMember("k", arr, a);
        return p;
    };
    rj::Value tr(rj::kObjectType);
    tr.AddMember("ty", "tr", a);
    tr.AddMember("p", prop({0, 0}), a);
    tr.AddMember("a", prop({0, 0}), a);
    tr.AddMember("s", prop({100, 100}), a);
    tr.AddMember("r", prop({0}), a);
    tr.AddMember("o", prop({100}), a);
    return tr;
}

// Drops the trims that cut nothing from one list of shape items and the groups in it.
int dropNoopTrims(rj::Value& list)
{
    int n = 0;
    for (auto& v : list.GetArray()) {
        auto it = v.IsObject() ? v.FindMember("it") : v.MemberEnd();
        if (isType(v, "gr") && it != v.MemberEnd() && it->value.IsArray()) n += dropNoopTrims(it->value);
    }
    for (rj::SizeType i = list.Size(); i-- > 0;) {
        if (list[i].IsObject() && noopTrim(list[i])) {
            list.Erase(list.Begin() + i);
            ++n;
        }
    }
    return n;
}

// Rewrites one list of shape items (and the groups in it); returns the fills moved.
int mergeFills(rj::Value& list, rj::Document::AllocatorType& a)
{
    int n = 0;
    for (auto& v : list.GetArray()) {
        auto it = v.IsObject() ? v.FindMember("it") : v.MemberEnd();
        if (isType(v, "gr") && it != v.MemberEnd() && it->value.IsArray()) n += mergeFills(it->value, a);
    }

    // Paths above a fill come as groups or as paths of this list. ThorVG starts a new shape at
    // a group that paints and at a paint between paths, so either way the fill splits.
    std::vector<rj::SizeType> groups, paths;
    std::vector<rj::SizeType> moved;
    bool modifier = false, split = false, paint = false;
    for (rj::SizeType i = 0; i < list.Size(); ++i) {
        auto& v = list[i];
        if (!v.IsObject() || hidden(v)) continue;
        bool fill = isType(v, "fl") || isType(v, "gf");
        if (fill && groups.size() >= 2 && paths.empty()) {
            bool painted = false;
            for (auto g : groups) painted |= paints(list[g]);
            if (painted) moved.push_back(i);

        } else if (fill && groups.empty() && split && !modifier) {
            moved.push_back(i);
        }
        if (isPath(v)) {
            if (!paths.empty() && paint) split = true;
            paths.push_back(i);
            paint = false;
        } else if (isPaint(v)) {
            paint = true;
        } else if (isType(v, "gr")) {
            if (hasPath(v)) groups.push_back(i);
        } else if (!isType(v, "tr")) {
            modifier = true;  // trim, round corners... apply to some paths only
        }
    }
    if (moved.empty()) return n;

    // New groups, one per moved fill, with the geometry of the groups or paths above it.
    std::vector<rj::Value> added;
    for (auto f : moved) {
        rj::Value geo(rj::kArrayType);
        for (auto g : groups) {
            if (g > f) break;
            rj::Value copy;
            if (geometry(list[g], copy, a)) geo.PushBack(copy, a);
        }
        for (auto p : paths) {
            if (p > f) break;
            if (groups.empty()) geo.PushBack(rj::Value(list[p], a), a);
        }
        geo.PushBack(rj::Value(list[f], a), a);
        geo.PushBack(identityTransform(a), a);
        rj::Value group(rj::kObjectType);
        group.AddMember("ty", "gr", a);
        group.AddMember("nm", "fill over groups", a);
        group.AddMember("it", geo, a);
        added.push_back(std::move(group));
    }

    // Each moved fill replaced by its group, in place: the paint order stays.
    rj::Value out(rj::kArrayType);
    size_t next = 0;
    for (rj::SizeType i = 0; i < list.Size(); ++i) {
        if (next < moved.size() && moved[next] == i) out.PushBack(added[next++], a);
        else out.PushBack(list[i], a);
    }
    list = out;
    return n + (int)moved.size();
}

// The shape rewrites of a list of layers: trims that cut nothing dropped, then fills merged.
void rewriteShapes(rj::Value& layers, rj::Document::AllocatorType& a, LoadStats& st)
{
    if (!layers.IsArray()) return;
    for (auto& layer : layers.GetArray()) {
        auto shapes = layer.IsObject() ? layer.FindMember("shapes") : layer.MemberEnd();
        if (shapes == layer.MemberEnd() || !shapes->value.IsArray()) continue;
        st.noopTrims += dropNoopTrims(shapes->value);
        st.mergedFills += mergeFills(shapes->value, a);
    }
}

void setFrame(rj::Value& v, double frame)
{
    if (frame == std::floor(frame)) v.SetInt64((int64_t)frame);
    else v.SetDouble(frame);
}

// A file narrowed to one state (ip, op around it, as lordicon.com often gives it) still holds
// every state its markers name: its frames widen to them, as the Lordicon players do, before and
// after. Only when a marker starts outside the file, so a whole file stays as it is: a marker's
// end is not trusted for that (some public icons have one running far past op, dr 903 at op 281).
// A marker plays to tm + dr.
void widenToMarkers(rj::Document& doc)
{
    auto ip = doc.FindMember("ip"), op = doc.FindMember("op"), markers = doc.FindMember("markers");
    if (ip == doc.MemberEnd() || op == doc.MemberEnd() || markers == doc.MemberEnd()) return;
    if (!ip->value.IsNumber() || !op->value.IsNumber() || !markers->value.IsArray()) return;
    double first = ip->value.GetDouble(), last = op->value.GetDouble();
    bool outside = false;
    for (auto& m : markers->value.GetArray()) {
        auto tm = m.IsObject() ? m.FindMember("tm") : m.MemberEnd();
        if (tm == m.MemberEnd() || !tm->value.IsNumber()) continue;
        auto dr = m.FindMember("dr");
        double begin = tm->value.GetDouble();
        double end = begin + (dr != m.MemberEnd() && dr->value.IsNumber() ? dr->value.GetDouble() : 0) + 1;
        if (begin < ip->value.GetDouble() || begin >= op->value.GetDouble()) outside = true;
        first = std::min(first, begin);
        last = std::max(last, end);
    }
    if (!outside) return;
    setFrame(ip->value, first);
    setFrame(op->value, last);
}

}  // namespace

// ---- Model ----------------------------------------------------------------------------

namespace {
bool shared = false;

tvg::SwCanvas* threadCanvas()
{
    thread_local std::unique_ptr<tvg::SwCanvas> canvas(tvg::SwCanvas::gen());
    return canvas.get();
}
}  // namespace

void sharedCanvas(bool on) { shared = on; }

struct StrokeSlot {
    std::string sid;
    double base;      // width = original * menu * base
    rj::Value value;  // original "k"
};

struct Model::Impl {
    std::string json;  // what ThorVG got; must outlive the picture
    rj::Document store;  // owns StrokeSlot values

    Colors colors;  // as loaded
    std::vector<std::string> boundColors;  // colors that have a slot
    std::vector<StrokeSlot> strokes;
    std::vector<LayerSwitch> switches;  // legacy stroke-layers, sid "s.<idx>"
    float strokeValue = 0;  // as loaded
    std::string comp;       // the comp the bindings name, see ownComp()
    std::vector<Marker> markers;

    tvg::LottieAnimation* animation = nullptr;
    tvg::Picture* picture = nullptr;
    tvg::SwCanvas* canvas = nullptr;
    float w = 0, h = 0;
    float ip = 0;  // first frame: ThorVG counts frames from it, we count absolute ones
    float fr = 0;  // frame rate, as the file says

    uint32_t* target = nullptr;
    uint32_t tw = 0, th = 0, ts = 0;
    bool premultiplied = false;

    // Look slots of the model's icons, by their JSON: ThorVG codes a slot by a hash of its JSON,
    // so equal looks share one slot, deleted with its last user.
    struct Slot {
        uint32_t id;
        int users;
    };
    std::map<std::string, Slot> slots;
    // The look on the ThorVG model: keys of the applied slots, "" for the loaded values. Stale
    // once a slot is deleted, which puts its targets back to the loaded values.
    std::string shownColors, shownStroke;
    bool stale = false;

    ~Impl()
    {
        delete canvas;
        delete animation;
    }

    bool preprocess(rj::Document& doc, const LoadOptions& opts, LoadStats& st);
    void walk(rj::Value& node, rj::Document& doc, const LoadOptions& opts, LoadStats& st,
              std::map<std::string, size_t>& strokeIndex);
    std::string colorSlot(const Colors& values) const;
    std::string strokeSlot(float value) const;
    bool acquire(const std::string& key);
    void release(const std::string& key);
    void show(const std::string& colors, const std::string& stroke);
    bool render(uint32_t* buffer, uint32_t w, uint32_t h, uint32_t stride, bool premultiplied);
};

bool Model::Impl::preprocess(rj::Document& doc, const LoadOptions& opts, LoadStats& st)
{
    // Control layer: color controls and the stroke menu.
    auto layers = doc.FindMember("layers");
    if (layers == doc.MemberEnd() || !layers->value.IsArray()) return false;
    for (auto& layer : layers->value.GetArray()) {
        auto nm = layer.FindMember("nm");
        if (nm == layer.MemberEnd() || !nm->value.IsString() || strcmp(nm->value.GetString(), "control")) continue;
        auto ef = layer.FindMember("ef");
        if (ef == layer.MemberEnd() || !ef->value.IsArray()) break;
        for (auto& effect : ef->value.GetArray()) {
            if (!effect.HasMember("nm") || !effect["nm"].IsString() || !effect.HasMember("ef")) continue;
            auto& inner = effect["ef"];
            if (!inner.IsArray() || inner.Empty() || !inner[0].HasMember("v")) continue;
            auto& k = inner[0]["v"]["k"];
            auto name = toLower(effect["nm"].GetString());
            if (name == "stroke" || name == "stroke-layers") {
                if (k.IsNumber()) strokeValue = (float)k.GetDouble();
            } else if (k.IsArray() && k.Size() >= 3 && k[0].IsNumber()) {
                colors.push_back({name, {(float)k[0].GetDouble(), (float)k[1].GetDouble(), (float)k[2].GetDouble()}});
            } else if (k.IsArray() && k.Size() > 0 && k[0].IsObject() && k[0].HasMember("s")) {
                auto& s = k[0]["s"];  // animated control: report the first keyframe
                colors.push_back({name, {(float)s[0].GetDouble(), (float)s[1].GetDouble(), (float)s[2].GetDouble()}});
            }
        }
        break;
    }
    for (auto& [name, value] : opts.colors) {
        for (auto& c : colors) {
            if (c.first == name) c.second = value;
        }
    }
    if (opts.stroke > 0 && strokeValue > 0) strokeValue = opts.stroke;

    comp = ownComp(doc);
    std::map<std::string, size_t> strokeIndex;
    walk(doc, doc, opts, st, strokeIndex);

    auto& a = doc.GetAllocator();
    rewriteShapes(layers->value, a, st);
    auto assets = doc.FindMember("assets");
    if (assets != doc.MemberEnd() && assets->value.IsArray()) {
        for (auto& asset : assets->value.GetArray()) {
            auto inner = asset.IsObject() ? asset.FindMember("layers") : asset.MemberEnd();
            if (inner != asset.MemberEnd()) rewriteShapes(inner->value, a, st);
        }
    }
    st.strokeSlots = (int)(strokes.size() + switches.size());
    return true;
}

void Model::Impl::walk(rj::Value& node, rj::Document& doc, const LoadOptions& opts, LoadStats& st,
                      std::map<std::string, size_t>& strokeIndex)
{
    if (node.IsArray()) {
        for (auto& e : node.GetArray()) walk(e, doc, opts, st, strokeIndex);
        return;
    }
    if (!node.IsObject()) return;

    auto x = node.FindMember("x");
    if (x != node.MemberEnd() && x->value.IsString() && node.HasMember("k")) {
        auto& a = doc.GetAllocator();
        std::string name, from;
        double base;
        LayerSwitch sw;
        if (matchColor(x->value.GetString(), &name, &from) && from == comp) {
            const Rgb* value = nullptr;
            for (auto& c : colors) {
                if (c.first == name) value = &c.second;
            }
            if (value) {
                rj::Value k(rj::kArrayType);
                k.PushBack(value->r, a).PushBack(value->g, a).PushBack(value->b, a).PushBack(1, a);
                node["k"] = k;
                node.RemoveMember("x");
                node.RemoveMember("a");
                auto sid = "c." + name;
                node.AddMember("sid", rj::Value(sid.c_str(), (rj::SizeType)sid.size(), a), a);
                bool known = false;
                for (auto& b : boundColors) known |= b == name;
                if (!known) boundColors.push_back(name);
                ++st.colorBindings;
                return;
            }
        } else if (matchStroke(x->value.GetString(), &base, &from) && from == comp && strokeValue > 0) {
            auto& k = node["k"];
            // Same original value + factor -> same slot.
            rj::StringBuffer key;
            Writer kw(key);
            k.Accept(kw);
            std::string id = std::string(key.GetString()) + "|" + std::to_string(base);
            auto it = strokeIndex.find(id);
            size_t idx;
            if (it == strokeIndex.end()) {
                idx = strokes.size();
                strokeIndex[id] = idx;
                strokes.push_back({"w." + std::to_string(idx), base, rj::Value(k, store.GetAllocator())});
            } else {
                idx = it->second;
            }
            if (k.IsArray() && k.Size() > 0 && k[0].IsObject()) ++st.animatedStrokes;
            scaleInPlace(k, strokeValue * base);
            node.RemoveMember("x");
            auto& sid = strokes[idx].sid;
            node.AddMember("sid", rj::Value(sid.c_str(), (rj::SizeType)sid.size(), a), a);
            ++st.strokeBindings;
            return;
        } else if (matchStrokeLayers(x->value.GetString(), &sw) && strokeValue > 0) {
            size_t idx = 0;
            while (idx < switches.size() && (switches[idx].menu != sw.menu || switches[idx].on != sw.on ||
                                            switches[idx].off != sw.off))
                ++idx;
            if (idx == switches.size()) switches.push_back(sw);
            node["k"].SetDouble(strokeValue == sw.menu ? sw.on : sw.off);
            node.RemoveMember("x");
            node.RemoveMember("a");
            auto sid = "s." + std::to_string(idx);
            node.AddMember("sid", rj::Value(sid.c_str(), (rj::SizeType)sid.size(), a), a);
            ++st.strokeBindings;
            return;
        }
        ++st.otherExpressions;
    }
    for (auto& m : node.GetObject()) {
        if (m.value.IsObject() || m.value.IsArray()) walk(m.value, doc, opts, st, strokeIndex);
    }
}

// The colour slot of a look: every bound colour.
std::string Model::Impl::colorSlot(const Colors& values) const
{
    rj::StringBuffer buf;
    Writer w(buf);
    w.StartObject();
    for (auto& bound : boundColors) {
        for (auto& c : values) {
            if (c.first != bound) continue;
            auto sid = "c." + bound;
            w.Key(sid.c_str());
            w.StartObject();
            w.Key("p");
            w.StartObject();
            w.Key("k");
            w.StartArray();
            w.Double(c.second.r);
            w.Double(c.second.g);
            w.Double(c.second.b);
            w.Double(1);
            w.EndArray();
            w.EndObject();
            w.EndObject();
        }
    }
    w.EndObject();
    return buf.GetString();
}

// The stroke slot of a width: rescaled widths and the layer switches.
std::string Model::Impl::strokeSlot(float value) const
{
    rj::StringBuffer buf;
    Writer w(buf);
    w.StartObject();
    for (auto& s : strokes) {
        w.Key(s.sid.c_str());
        w.StartObject();
        w.Key("p");
        w.StartObject();
        w.Key("k");
        writeScaled(w, s.value, value * s.base);
        w.EndObject();
        w.EndObject();
    }
    for (size_t i = 0; i < switches.size(); ++i) {
        auto& s = switches[i];
        w.Key(("s." + std::to_string(i)).c_str());
        w.StartObject();
        w.Key("p");
        w.StartObject();
        w.Key("k");
        w.Double(value == s.menu ? s.on : s.off);
        w.EndObject();
        w.EndObject();
    }
    w.EndObject();
    return buf.GetString();
}

// One more user of a look slot, generated on first use. False when ThorVG makes no slot of it.
bool Model::Impl::acquire(const std::string& key)
{
    auto found = slots.find(key);
    if (found != slots.end()) {
        ++found->second.users;
        return true;
    }
    auto id = animation->gen(key.c_str());
    if (!id) return false;
    slots[key] = {id, 1};
    return true;
}

void Model::Impl::release(const std::string& key)
{
    auto found = slots.find(key);
    if (found == slots.end() || --found->second.users > 0) return;
    animation->del(found->second.id);
    slots.erase(found);
    stale = true;
}

// Puts a look on the ThorVG model, unless it shows it already.
void Model::Impl::show(const std::string& colors, const std::string& stroke)
{
    if (!stale && shownColors == colors && shownStroke == stroke) return;
    if (stale || (colors.empty() && !shownColors.empty()) || (stroke.empty() && !shownStroke.empty())) {
        animation->apply(0);  // every slot target back to the loaded value
        shownColors.clear();
        shownStroke.clear();
        stale = false;
    }
    if (shownColors != colors) {
        animation->apply(slots[colors].id);
        shownColors = colors;
    }
    if (shownStroke != stroke) {
        animation->apply(slots[stroke].id);
        shownStroke = stroke;
    }
}

bool Model::Impl::render(uint32_t* buffer, uint32_t w, uint32_t h, uint32_t stride, bool premultiplied)
{
    if (!canvas) {
        // Shared canvas: attach the picture for this render only.
        auto shared = threadCanvas();
        auto cs = premultiplied ? tvg::ColorSpace::ABGR8888 : tvg::ColorSpace::ABGR8888S;
        if (shared->target(buffer, stride, w, h, cs) != tvg::Result::Success) return false;
        if (w != tw || h != th) {
            picture->size((float)w, (float)h);
            tw = w;
            th = h;
        }
        shared->add(picture);
        auto ok = shared->update() == tvg::Result::Success && shared->draw(true) == tvg::Result::Success &&
                  shared->sync() == tvg::Result::Success;
        shared->remove(picture);
        return ok;
    }
    if (buffer != target || w != tw || h != th || stride != ts || premultiplied != this->premultiplied) {
        auto cs = premultiplied ? tvg::ColorSpace::ABGR8888 : tvg::ColorSpace::ABGR8888S;
        if (canvas->target(buffer, stride, w, h, cs) != tvg::Result::Success) return false;
        this->premultiplied = premultiplied;
        picture->size((float)w, (float)h);
        target = buffer;
        tw = w;
        th = h;
        ts = stride;
    }
    if (canvas->update() != tvg::Result::Success) return false;
    if (canvas->draw(true) != tvg::Result::Success) return false;
    return canvas->sync() == tvg::Result::Success;
}

Model::Model(Impl* impl) : impl(impl) {}
Model::~Model() { delete impl; }

std::shared_ptr<Model> Model::load(const char* json, size_t size, const LoadOptions& opts, LoadStats* stats)
{
    LoadStats local;
    auto& st = stats ? *stats : local;
    st = {};
    st.jsonBytes = size;

    auto impl = new Impl;
    std::shared_ptr<Model> model(new Model(impl));

    if (opts.preprocess) {
        auto t0 = nowMs();
        rj::Document doc;
        doc.Parse(json, size);
        if (doc.HasParseError() || !doc.IsObject()) return nullptr;
        auto t1 = nowMs();
        widenToMarkers(doc);
        if (doc.HasMember("ip") && doc["ip"].IsNumber()) impl->ip = (float)doc["ip"].GetDouble();
        if (doc.HasMember("fr") && doc["fr"].IsNumber()) impl->fr = (float)doc["fr"].GetDouble();
        if (!impl->preprocess(doc, opts, st)) return nullptr;
        rj::StringBuffer out;
        Writer w(out);
        doc.Accept(w);
        impl->json.assign(out.GetString(), out.GetSize());
        auto t2 = nowMs();
        st.parseMs = t1 - t0;
        st.preprocessMs = t2 - t1;
    } else {
        impl->json.assign(json, size);
        rj::Document doc;
        doc.Parse(json, size);
        if (!doc.HasParseError() && doc.IsObject() && doc.HasMember("ip") && doc["ip"].IsNumber())
            impl->ip = (float)doc["ip"].GetDouble();
        if (!doc.HasParseError() && doc.IsObject() && doc.HasMember("fr") && doc["fr"].IsNumber())
            impl->fr = (float)doc["fr"].GetDouble();
    }
    st.outBytes = impl->json.size();

    auto t0 = nowMs();
    impl->animation = tvg::LottieAnimation::gen();
    impl->picture = impl->animation->picture();
    // copy = true: ThorVG owns the text and frees it once parsed. A borrowed buffer would stay
    // alive for the icon's lifetime and be a cache key by address.
    if (impl->picture->load(impl->json.data(), (uint32_t)impl->json.size(), "lottie+json", nullptr, true) !=
        tvg::Result::Success)
        return nullptr;
    impl->picture->size(&impl->w, &impl->h);
    if (opts.quality >= 0) impl->animation->quality((uint8_t)opts.quality);
    impl->animation->totalFrame();  // waits for the parse when threaded
    st.loadMs = nowMs() - t0;
    if (!opts.keepSource) std::string().swap(impl->json);

    for (uint32_t i = 0, n = impl->animation->markersCnt(); i < n; ++i) {
        float b, e;
        if (auto name = impl->animation->marker(i, &b, &e)) impl->markers.push_back({name, b, e});
    }

    if (!shared) {
        impl->canvas = tvg::SwCanvas::gen();
        impl->canvas->add(impl->picture);
    }
    return model;
}

float Model::width() const { return impl->w; }
float Model::height() const { return impl->h; }
float Model::frameRate() const
{
    // The file's own: totalFrame / duration is a float off (59.999996 for 331 frames at 60).
    return impl->fr > 0 ? impl->fr : impl->animation->totalFrame() / impl->animation->duration();
}
float Model::totalFrames() const { return impl->animation->totalFrame(); }
float Model::firstFrame() const { return impl->ip; }
const std::vector<Marker>& Model::markers() const { return impl->markers; }
const Colors& Model::colors() const { return impl->colors; }
float Model::stroke() const { return impl->strokeValue; }
const std::string& Model::source() const { return impl->json; }

// ---- Icon -----------------------------------------------------------------------------

namespace {

// Every pixel takes the colour, keeping its alpha.
void tint(uint32_t* buffer, uint32_t w, uint32_t h, uint32_t stride, bool premultiplied, Rgb color)
{
    auto channel = [](float v) { return (uint32_t)std::lround(std::clamp(v, 0.0f, 1.0f) * 255); };
    uint32_t r = channel(color.r), g = channel(color.g), b = channel(color.b);
    for (uint32_t y = 0; y < h; ++y) {
        auto row = buffer + (size_t)y * stride;
        for (uint32_t x = 0; x < w; ++x) {
            uint32_t a = row[x] >> 24;
            if (!a) continue;
            if (premultiplied)
                row[x] = a << 24 | ((b * a + 127) / 255) << 16 | ((g * a + 127) / 255) << 8 | ((r * a + 127) / 255);
            else
                row[x] = a << 24 | b << 16 | g << 8 | r;
        }
    }
}

}  // namespace

struct Icon::Impl {
    std::shared_ptr<Model> model;
    Colors colors;
    float stroke = 0;
    // The model's look slots this icon holds; "" for the loaded values (no slot).
    std::string colorKey, strokeKey;
    float frame = 0;
    bool tinted = false;
    Rgb tint{0, 0, 0};

    ~Impl()
    {
        if (!colorKey.empty()) model->impl->release(colorKey);
        if (!strokeKey.empty()) model->impl->release(strokeKey);
    }

    // Holds the slot for a look in place of the one held: false when ThorVG makes none of it.
    bool hold(std::string& held, const std::string& key)
    {
        if (key == held) return true;
        auto m = model->impl;
        if (!key.empty() && !m->acquire(key)) return false;
        if (!held.empty()) m->release(held);
        held = key;
        return true;
    }
};

Icon::Icon(std::shared_ptr<Model> model) : impl(new Impl)
{
    impl->colors = model->colors();
    impl->stroke = model->stroke();
    impl->frame = model->firstFrame();
    impl->model = std::move(model);
}

Icon::~Icon() { delete impl; }

std::unique_ptr<Icon> Icon::load(const char* json, size_t size, const LoadOptions& opts, LoadStats* stats)
{
    auto model = Model::load(json, size, opts, stats);
    if (!model) return nullptr;
    return std::make_unique<Icon>(std::move(model));
}

const std::shared_ptr<Model>& Icon::model() const { return impl->model; }
float Icon::width() const { return impl->model->width(); }
float Icon::height() const { return impl->model->height(); }
float Icon::frameRate() const { return impl->model->frameRate(); }
float Icon::totalFrames() const { return impl->model->totalFrames(); }
float Icon::firstFrame() const { return impl->model->firstFrame(); }
float Icon::currentFrame() const { return impl->frame; }
const std::vector<Marker>& Icon::markers() const { return impl->model->markers(); }
const Colors& Icon::colors() const { return impl->colors; }
float Icon::stroke() const { return impl->stroke; }
const std::string& Icon::source() const { return impl->model->source(); }

bool Icon::setColor(const std::string& name, Rgb value)
{
    bool found = false;
    for (auto& c : impl->colors) {
        if (c.first == name) {
            c.second = value;
            found = true;
        }
    }
    if (!found) return false;

    auto m = impl->model->impl;
    bool loaded = true;
    for (size_t i = 0; i < impl->colors.size(); ++i) {
        auto& a = impl->colors[i].second;
        auto& b = m->colors[i].second;
        loaded &= a.r == b.r && a.g == b.g && a.b == b.b;
    }
    return impl->hold(impl->colorKey, loaded ? std::string() : m->colorSlot(impl->colors));
}

bool Icon::setStroke(float value)
{
    auto m = impl->model->impl;
    if ((m->strokes.empty() && m->switches.empty()) || value <= 0) return false;
    if (!impl->hold(impl->strokeKey, value == m->strokeValue ? std::string() : m->strokeSlot(value))) return false;
    impl->stroke = value;
    return true;
}

void Icon::setTint(bool on, Rgb color)
{
    impl->tinted = on;
    impl->tint = color;
}

bool Icon::frame(float no)
{
    if (!std::isfinite(no)) return false;
    impl->frame = no;
    return true;
}

bool Icon::render(uint32_t* buffer, uint32_t w, uint32_t h, uint32_t stride, bool premultiplied)
{
    auto m = impl->model->impl;
    m->show(impl->colorKey, impl->strokeKey);
    m->animation->frame(impl->frame - m->ip);  // ThorVG skips an unchanged frame
    if (!m->render(buffer, w, h, stride, premultiplied)) return false;
    if (impl->tinted) tint(buffer, w, h, stride, premultiplied, impl->tint);
    return true;
}

// ---- Playback ---------------------------------------------------------------------------

void Playback::segment(float b, float e)
{
    begin = b;
    end = e;
    frame = direction > 0 ? b : e;
    resting = 0;
}

int Playback::tick(double dt)
{
    if (!playing || end <= begin) return None;
    if (resting > 0) {
        // On the last frame between rounds; no longer looping, the rest ends playback.
        if (!loop) {
            resting = 0;
            playing = false;
            return Complete;
        }
        resting -= dt;
        if (resting > 0) return None;
        dt = -resting;
        resting = 0;
        frame = direction > 0 ? begin : end;
    }
    frame += (float)(dt * frameRate * speed * direction);
    if (frame >= begin && frame <= end) return None;
    if (loop && rest > 0) {
        frame = direction > 0 ? end : begin;
        resting = rest;
        return Loop;
    }
    if (loop) {
        auto len = end - begin;
        frame = direction > 0 ? begin + fmodf(frame - begin, len) : end - fmodf(end - frame, len);
        return Loop;
    }
    frame = direction > 0 ? end : begin;
    playing = false;
    return Complete;
}

bool init(unsigned threads) { return tvg::Initializer::init(threads) == tvg::Result::Success; }
void term() { tvg::Initializer::term(); }

}  // namespace lordicon
