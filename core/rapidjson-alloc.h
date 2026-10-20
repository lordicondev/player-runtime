// ThorVG's patched rapidjson allocates through tvg::malloc/realloc/free, declared in ThorVG's
// tvgCommon.h, which rapidjson.h includes (it must be on the include path). That header brings ThorVG's internals along, so this
// one takes its place: it claims its include guard and defines the three functions. Works with
// any include path order (one Xcode target compiles ThorVG and the core with the same paths).
// Internal linkage: must not collide with ThorVG's own definitions.
#pragma once
#include <cstdlib>

#define _TVG_COMMON_H_

namespace tvg {
static inline void* malloc(size_t size) { return std::malloc(size); }
static inline void* realloc(void* ptr, size_t size) { return std::realloc(ptr, size); }
static inline void free(void* ptr) { std::free(ptr); }
}  // namespace tvg
