#include "waterfall/core/DownloadManager.hpp"
#include "waterfall/server/ExtensionServer.hpp"
#include "waterfall/ui/UiManager.hpp"
#include <iostream>
#include <windows.h>

int main(int argc, char* argv[]) {
    // 0. Single-Instance Mutex Guard
    HANDLE h_mutex = CreateMutexW(nullptr, TRUE, L"Local\\WaterfallAccelerator_SingleInstance_Mutex");
    if (GetLastError() == ERROR_ALREADY_EXISTS) {
        std::cout << "[Core] Another instance of Waterfall is already running." << std::endl;
        HWND existing_hwnd = FindWindowW(nullptr, L"🌊 Waterfall Accelerator v2.0 (Native C++20)");
        if (existing_hwnd) {
            ShowWindow(existing_hwnd, SW_RESTORE);
            SetForegroundWindow(existing_hwnd);
        }
        if (h_mutex) CloseHandle(h_mutex);
        return 0;
    }

    std::cout << "=================================================" << std::endl;
    std::cout << "  🌊 WATERFALL DOWNLOAD ACCELERATOR v2.0 (C++20) " << std::endl;
    std::cout << "=================================================" << std::endl;

    // 1. Initialize SQLite State Engine
    if (!waterfall::core::DownloadManager::Instance().Initialize("waterfall.db")) {
        std::cerr << "Failed to initialize state database." << std::endl;
        return 1;
    }
    std::cout << "[Core] SQLite WAL state store initialized." << std::endl;

    // 2. Start Companion Extension Server (Port 4567)
    waterfall::server::ExtensionServer extension_server(4567);
    extension_server.Start();

    // 3. Initialize and run Native RmlUi User Interface
    waterfall::ui::UiManager ui_manager;
    if (ui_manager.Initialize(1180, 720)) {
        std::cout << "[UI] Native GPU interface started successfully." << std::endl;
        ui_manager.Run();
        ui_manager.Shutdown();
    } else {
        std::cerr << "[UI] Failed to start user interface." << std::endl;
    }

    // 4. Clean shutdown
    std::cout << "[Core] Shutting down extension server..." << std::endl;
    extension_server.Stop();
    std::cout << "[Core] Waterfall exited cleanly." << std::endl;

    if (h_mutex) {
        ReleaseMutex(h_mutex);
        CloseHandle(h_mutex);
    }

    return 0;
}
