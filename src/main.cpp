#include "waterfall/core/DownloadManager.hpp"
#include "waterfall/core/ConfigManager.hpp"
#include "waterfall/core/StorageRouter.hpp"
#include "waterfall/server/ExtensionServer.hpp"
#include "waterfall/ui/UiManager.hpp"
#include "waterfall/ui/WebViewUiManager.hpp"
#include <iostream>
#include <windows.h>
#include <string>

int main(int argc, char* argv[]) {
    setvbuf(stdout, NULL, _IONBF, 0);
    setvbuf(stderr, NULL, _IONBF, 0);
    std::cout << std::unitbuf;

    bool use_rmlui = false;
    bool force_console = false;
    bool start_minimized = false;
    for (int i = 1; i < argc; ++i) {
        std::string arg = argv[i];
        if (arg == "--rmlui") {
            use_rmlui = true;
        } else if (arg == "--console" || arg == "--debug") {
            force_console = true;
        } else if (arg == "--minimized" || arg == "-m") {
            start_minimized = true;
        }
    }

    // Hide debug console window by default on startup
    HWND consoleHwnd = GetConsoleWindow();
    if (consoleHwnd && !force_console) {
        ShowWindow(consoleHwnd, SW_HIDE);
    }

    // 0. Single-Instance Mutex Guard
    HANDLE h_mutex = CreateMutexW(nullptr, TRUE, L"Local\\WaterfallAccelerator_SingleInstance_Mutex");
    if (GetLastError() == ERROR_ALREADY_EXISTS) {
        std::cout << "[Core] Another instance of Waterfall is already running." << std::endl;
        HWND existing_hwnd = FindWindowW(L"Waterfall_WebView2_Class", nullptr);
        if (!existing_hwnd) {
            existing_hwnd = FindWindowW(nullptr, L"🌊 Waterfall Accelerator v2.0 (Native C++20)");
        }
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

    // 1. Initialize SQLite State Engine in %APPDATA%\Waterfall
    std::string db_path = (waterfall::core::StorageRouter::Instance().GetAppDataDir() / "waterfall.db").string();
    if (!waterfall::core::DownloadManager::Instance().Initialize(db_path)) {
        std::cerr << "Failed to initialize state database at: " << db_path << std::endl;
        return 1;
    }
    std::cout << "[Core] SQLite WAL state store initialized at: " << db_path << std::endl;

    // Show console window only if explicitly enabled in Settings or via CLI flag
    if (consoleHwnd && (force_console || waterfall::core::ConfigManager::Instance().GetConfig().show_console)) {
        ShowWindow(consoleHwnd, SW_SHOW);
    }

    // 2. Start Companion Extension Server & Static Web UI Host (Port 4567)
    waterfall::server::ExtensionServer extension_server(4567);
    extension_server.Start();

    // 3. Launch UI: WebView2 rich Web UI by default, with RmlUi fallback/flag
    if (use_rmlui) {
        std::cout << "[UI] Launching native RmlUi/OpenGL interface (--rmlui flag detected)..." << std::endl;
        waterfall::ui::UiManager ui_manager;
        if (ui_manager.Initialize(1480, 780)) {
            std::cout << "[UI] Native GPU interface started successfully." << std::endl;
            ui_manager.Run();
            ui_manager.Shutdown();
        }
    } else {
        std::cout << "[UI] Launching native WebView2 high-fidelity UI..." << std::endl;
        if (waterfall::ui::WebViewUiManager::Instance().Initialize(1480, 780, "http://127.0.0.1:4567/")) {
            std::cout << "[UI] Native WebView2 interface initialized." << std::endl;
            if (start_minimized) {
                waterfall::ui::WebViewUiManager::Instance().MinimizeToTray();
            }
            waterfall::ui::WebViewUiManager::Instance().Run();
            waterfall::ui::WebViewUiManager::Instance().Shutdown();
        } else {
            std::cerr << "[UI] WebView2 initialization failed. Falling back to native RmlUi..." << std::endl;
            waterfall::ui::UiManager ui_manager;
            if (ui_manager.Initialize(1180, 720)) {
                ui_manager.Run();
                ui_manager.Shutdown();
            }
        }
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
