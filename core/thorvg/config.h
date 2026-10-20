/* ThorVG's build configuration: what its meson build generates as config.h, for every build of
 * the runtime (CMake, the React Native podspec). THORVG_THREAD_SUPPORT comes from the build
 * (CMake option LORDICON_THREADS). */
#pragma once
#define THORVG_VERSION_STRING "1.2.0"
#define THORVG_CPU_ENGINE_SUPPORT 1
#define THORVG_LOTTIE_LOADER_SUPPORT 1
#define THORVG_PARTIAL_RENDER_SUPPORT 1
#if defined(__aarch64__)
#define THORVG_NEON_SUPPORT 1
#endif
#define WIN32_LEAN_AND_MEAN 1
