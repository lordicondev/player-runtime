# Lordicon runtime: ThorVG (cpu engine + lottie loader) with our patches and the core, built
# from a source list (no meson). Targets: lordicon_core (static), lordicon (shared, C API),
# tvgicon and tools (host), lordicon.js/.wasm (emscripten).
#
# ThorVG sources, in this order: -DTHORVG_SRC=<patched tree>; thorvg-src/ next to this file
# (scripts/vendor-thorvg.sh, which the npm package ships); else the thorvg/ submodule, exported
# and patched into the build directory by scripts/prepare-thorvg.sh.
cmake_minimum_required(VERSION 3.22)
project(lordicon_runtime VERSION 0.1.0 LANGUAGES CXX)

set(THORVG_SRC "" CACHE PATH "Patched ThorVG source tree")
if(NOT THORVG_SRC)
    if(EXISTS ${CMAKE_CURRENT_SOURCE_DIR}/thorvg-src/inc/thorvg.h)
        set(THORVG_SRC ${CMAKE_CURRENT_SOURCE_DIR}/thorvg-src)
    else()
        set(THORVG_SRC ${CMAKE_CURRENT_BINARY_DIR}/thorvg-src)
        execute_process(
            COMMAND ${CMAKE_CURRENT_SOURCE_DIR}/scripts/prepare-thorvg.sh ${THORVG_SRC}
            RESULT_VARIABLE prepared)
        if(NOT prepared EQUAL 0)
            message(FATAL_ERROR "Could not prepare ThorVG (git submodule update --init?)")
        endif()
    endif()
endif()

option(LORDICON_THREADS "ThorVG task scheduler threads" OFF)
option(LORDICON_SHARED "Build liblordicon (shared, C API only)" OFF)
# The npm package has no cli/: no tools there.
if(PROJECT_IS_TOP_LEVEL AND EXISTS ${CMAKE_CURRENT_SOURCE_DIR}/cli)
    set(tools_default ON)
else()
    set(tools_default OFF)
endif()
option(LORDICON_TOOLS "Build tvgicon, memtest, threadtest, capitest, goldens" ${tools_default})
# Sanitizers for the tools and tests (CI): address (with undefined behaviour) or thread.
set(LORDICON_SANITIZE "" CACHE STRING "Sanitizers: address, thread, or empty")
# Like ThorVG's own build: no unwind tables (-77 KB on arm64; poorer native crash backtraces).
option(LORDICON_NO_UNWIND "Drop unwind tables" ON)
option(LORDICON_LTO "Link-time optimization" OFF)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)
set(CMAKE_CXX_VISIBILITY_PRESET hidden)
set(flags -fno-exceptions -fno-rtti -fno-math-errno -ffunction-sections -fdata-sections -Wno-unknown-pragmas)
if(LORDICON_NO_UNWIND AND NOT LORDICON_SANITIZE)
    list(APPEND flags -fno-unwind-tables -fno-asynchronous-unwind-tables)
endif()
if(LORDICON_SANITIZE STREQUAL "address")
    # vptr needs RTTI, which the build leaves out; any finding fails the run.
    set(sanitize -fsanitize=address,undefined -fno-sanitize=vptr -fno-sanitize-recover=all)
elseif(LORDICON_SANITIZE STREQUAL "thread")
    set(sanitize -fsanitize=thread)
elseif(LORDICON_SANITIZE)
    message(FATAL_ERROR "LORDICON_SANITIZE: address, thread, or empty")
endif()
if(sanitize)
    add_compile_options(${sanitize} -g -fno-omit-frame-pointer)
    add_link_options(${sanitize})
endif()
if(LORDICON_LTO OR EMSCRIPTEN)
    list(APPEND flags -flto)
    add_link_options(-flto)
endif()
if(EMSCRIPTEN)
    list(APPEND flags -Os)
endif()

# ThorVG's config.h: core/thorvg/config.h, shared with the podspec of @lordicon/react-native.
file(GLOB thorvg_sources
    ${THORVG_SRC}/src/common/*.cpp
    ${THORVG_SRC}/src/renderer/*.cpp
    ${THORVG_SRC}/src/renderer/cpu_engine/*.cpp
    ${THORVG_SRC}/src/loaders/lottie/*.cpp
    ${THORVG_SRC}/src/loaders/raw/*.cpp)
add_library(thorvg STATIC ${thorvg_sources})
target_include_directories(thorvg
    PUBLIC ${THORVG_SRC}/inc ${THORVG_SRC}/src/loaders/lottie
    PRIVATE core/thorvg ${THORVG_SRC}/src/common ${THORVG_SRC}/src/renderer
            ${THORVG_SRC}/src/renderer/cpu_engine ${THORVG_SRC}/src/loaders/raw)
target_compile_definitions(thorvg PUBLIC TVG_STATIC PRIVATE $<$<BOOL:${LORDICON_THREADS}>:THORVG_THREAD_SUPPORT=1>)
target_compile_options(thorvg PRIVATE ${flags})

# The core: preprocessing, slots, playback; C++ and C API.
add_library(lordicon_core STATIC core/lordicon.cpp core/lordicon_c.cpp)
target_include_directories(lordicon_core
    PUBLIC core
    PRIVATE ${THORVG_SRC}/src/loaders/lottie ${THORVG_SRC}/src/common) # rapidjson, its tvgCommon.h
target_compile_options(lordicon_core PRIVATE ${flags})
target_link_libraries(lordicon_core PUBLIC thorvg)

if(LORDICON_SHARED)
    add_library(lordicon SHARED core/lordicon_c.cpp)
    target_link_libraries(lordicon PRIVATE lordicon_core)
    target_link_options(lordicon PRIVATE -Wl,--gc-sections -Wl,--exclude-libs,ALL
        $<$<CXX_COMPILER_ID:Clang>:-Wl,--icf=all>)
endif()

if(EMSCRIPTEN)
    # Exported functions: every LI_API function of the C API.
    file(STRINGS core/lordicon_c.h api REGEX "^LI_API")
    set(exports _malloc,_free)
    foreach(line ${api})
        string(REGEX MATCH "(li_[a-z_]+)\\(" _ ${line})
        string(APPEND exports ",_${CMAKE_MATCH_1}")
    endforeach()
    add_executable(lordicon_wasm wasm/module.cpp)
    set_target_properties(lordicon_wasm PROPERTIES OUTPUT_NAME lordicon SUFFIX .js)
    target_link_libraries(lordicon_wasm PRIVATE lordicon_core)
    target_link_options(lordicon_wasm PRIVATE
        -Os -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createLordicon
        -sENVIRONMENT=web,worker -sFILESYSTEM=0 -sALLOW_MEMORY_GROWTH=1 -sMALLOC=emmalloc
        -sINCOMING_MODULE_JS_API=locateFile,wasmBinary
        -sEXPORTED_FUNCTIONS=${exports}
        -sEXPORTED_RUNTIME_METHODS=HEAPU8,HEAPF32,UTF8ToString,stringToUTF8,lengthBytesUTF8)
elseif(LORDICON_TOOLS)
    add_executable(tvgicon cli/main.cpp)
    target_link_libraries(tvgicon PRIVATE lordicon_core)
    add_executable(memtest cli/memtest.cpp)
    target_link_libraries(memtest PRIVATE lordicon_core)
    add_executable(threadtest cli/threadtest.cpp)
    target_link_libraries(threadtest PRIVATE lordicon_core)
    add_executable(capitest cli/capitest.cpp)
    target_link_libraries(capitest PRIVATE lordicon_core)
    add_executable(goldens cli/goldens.cpp)
    target_link_libraries(goldens PRIVATE lordicon_core)
endif()
