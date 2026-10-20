# The C API from a CMake project of your own: the runtime as a subdirectory, one target to link.
#   cmake -S examples/native -B build/example-native -G Ninja && cmake --build build/example-native
#   build/example-native/render examples/icons/download.json out
cmake_minimum_required(VERSION 3.22)
project(lordicon_native_example C CXX)

# In your project: the path of @lordicon/runtime (node_modules/@lordicon/runtime) or a clone.
add_subdirectory(${CMAKE_CURRENT_SOURCE_DIR}/../.. lordicon)

add_executable(render main.c)
target_link_libraries(render PRIVATE lordicon_core)
