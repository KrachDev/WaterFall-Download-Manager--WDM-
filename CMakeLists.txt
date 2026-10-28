cmake_minimum_required(VERSION 3.20)
project(Waterfall VERSION 2.0.1 LANGUAGES CXX C)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# Enable multi-processor compilation on MSVC
if(MSVC)
    add_compile_options(/MP /W4 /permissive- /Zc:__cplusplus /utf-8)
    add_definitions(-D_CRT_SECURE_NO_WARNINGS -DNOMINMAX -DWIN32_LEAN_AND_MEAN)
endif()

include(FetchContent)

# 1. nlohmann_json
message(STATUS "Fetching nlohmann_json...")
FetchContent_Declare(
    nlohmann_json
    GIT_REPOSITORY https://github.com/nlohmann/json.git
    GIT_TAG        v3.11.3
    GIT_SHALLOW    TRUE
)
FetchContent_MakeAvailable(nlohmann_json)

# 2. cpp-httplib (for Chrome/Edge extension local bridge on port 4567)
message(STATUS "Fetching cpp-httplib...")
set(HTTPLIB_REQUIRE_OPENSSL OFF CACHE BOOL "" FORCE)
set(HTTPLIB_REQUIRE_ZLIB OFF CACHE BOOL "" FORCE)
FetchContent_Declare(
    httplib
    GIT_REPOSITORY https://github.com/yhirose/cpp-httplib.git
    GIT_TAG        v0.18.3
    GIT_SHALLOW    TRUE
)
FetchContent_MakeAvailable(httplib)

# 3. FreeType (required for RmlUi font engine)
message(STATUS "Fetching FreeType...")
set(FT_DISABLE_ZLIB TRUE CACHE BOOL "" FORCE)
set(FT_DISABLE_BZIP2 TRUE CACHE BOOL "" FORCE)
set(FT_DISABLE_PNG TRUE CACHE BOOL "" FORCE)
set(FT_DISABLE_HARFBUZZ TRUE CACHE BOOL "" FORCE)
set(FT_DISABLE_BROTLI TRUE CACHE BOOL "" FORCE)
FetchContent_Declare(
    freetype
    GIT_REPOSITORY https://github.com/freetype/freetype.git
    GIT_TAG        VER-2-13-3
    GIT_SHALLOW    TRUE
)
FetchContent_MakeAvailable(freetype)

# Define aliases/paths for RmlUi's CMake find_package(Freetype)
if(TARGET freetype)
    set(FREETYPE_FOUND TRUE CACHE BOOL "" FORCE)
    set(FREETYPE_INCLUDE_DIRS "${freetype_SOURCE_DIR}/include" CACHE PATH "" FORCE)
    set(FREETYPE_LIBRARIES freetype CACHE STRING "" FORCE)
    if(NOT TARGET Freetype::Freetype)
        add_library(Freetype::Freetype ALIAS freetype)
    endif()
endif()

# 4. RmlUi (C++ HTML/CSS native UI)
message(STATUS "Fetching RmlUi...")
set(RMLUI_TESTS OFF CACHE BOOL "" FORCE)
set(RMLUI_SAMPLES OFF CACHE BOOL "" FORCE)
set(RMLUI_BACKEND Win32_GL2 CACHE STRING "" FORCE)
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
FetchContent_Declare(
    rmlui
    GIT_REPOSITORY https://github.com/mikke89/RmlUi.git
    GIT_TAG        6.1
    GIT_SHALLOW    TRUE
)
FetchContent_MakeAvailable(rmlui)

# 5. SQLite3 (Embedded state engine)
add_library(sqlite3 STATIC
    vendor/sqlite3/sqlite3.c
    vendor/sqlite3/sqlite3.h
)
target_include_directories(sqlite3 PUBLIC vendor/sqlite3)
if(MSVC)
    target_compile_options(sqlite3 PRIVATE /W0) # Suppress warnings in SQLite C code
endif()

# Main Waterfall Executable
add_executable(waterfall
    src/main.cpp
    src/core/DownloadTask.cpp
    src/core/DownloadManager.cpp
    src/core/ChunkEngine.cpp
    src/core/StorageRouter.cpp
    src/core/ConfigManager.cpp
    src/core/ArchiveEngine.cpp
    src/core/MediaEngine.cpp
    src/core/CrawlerEngine.cpp
    src/core/ScriptEngine.cpp
    src/core/ShellIntegration.cpp
    src/core/QueueScheduler.cpp
    src/core/UpdateManager.cpp
    src/server/ExtensionServer.cpp
    src/ui/UiManager.cpp
    src/ui/WebViewUiManager.cpp
    ${rmlui_SOURCE_DIR}/Backends/RmlUi_Backend_Win32_GL2.cpp
    ${rmlui_SOURCE_DIR}/Backends/RmlUi_Platform_Win32.cpp
    ${rmlui_SOURCE_DIR}/Backends/RmlUi_Renderer_GL2.cpp
)

target_include_directories(waterfall PRIVATE
    include
    vendor/sqlite3
    vendor/webview2/build/native/include
    ${rmlui_SOURCE_DIR}/Backends
)

target_link_libraries(waterfall PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/vendor/webview2/build/native/x64/WebView2LoaderStatic.lib
    RmlUi::Core
    nlohmann_json::nlohmann_json
    httplib::httplib
    sqlite3
    opengl32
    gdi32
    user32
    shell32
    ole32
    oleaut32
    winhttp
    ws2_32
    dwmapi
    shlwapi
    bcrypt
    powrprof
)

# Copy UI assets and frontend next to binary on build
add_custom_command(TARGET waterfall POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy_directory
        ${CMAKE_CURRENT_SOURCE_DIR}/assets
        $<TARGET_FILE_DIR:waterfall>/assets
    COMMAND ${CMAKE_COMMAND} -E copy_directory
        ${CMAKE_CURRENT_SOURCE_DIR}/src/frontend
        $<TARGET_FILE_DIR:waterfall>/src/frontend
    COMMAND ${CMAKE_COMMAND} -E copy_directory
        ${CMAKE_CURRENT_SOURCE_DIR}/src/frontend
        $<TARGET_FILE_DIR:waterfall>/frontend
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
        ${CMAKE_CURRENT_SOURCE_DIR}/vendor/webview2/build/native/x64/WebView2Loader.dll
        $<TARGET_FILE_DIR:waterfall>/WebView2Loader.dll
)
