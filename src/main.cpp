#include "waterfall/core/DownloadManager.hpp"
#include "waterfall/core/ConfigManager.hpp"
#include "waterfall/core/StorageRouter.hpp"
#include "waterfall/server/ExtensionServer.hpp"
#include "waterfall/ui/UiManager.hpp"
#include "waterfall/ui/WebViewUiManager.hpp"
#include <iostream>
#include <fstream>
#include <windows.h>
#include <shellapi.h>
#include <string>
#include <vector>

int RunWaterfall(int argc, char* argv[]) {
    std::ofstream bootLog("waterfall_boot.log", std::ios::trunc);
    bootLog << std::unitbuf;
    bootLog << "[Boot] RunWaterfall started, argc=" << argc << std::endl;
    bool use_rmlui = false;
    bool force_console = false;
    bool start_minimized = false;
    bool show_extension_guide = false;
    for (int i = 1; i < argc; ++i) {
        std::string arg = argv[i];
        if (arg == "--rmlui") {
            use_rmlui = true;
        } else if (arg == "--console" || arg == "--debug") {
            force_console = true;
        } else if (arg == "--minimized" || arg == "-m") {
            start_minimized = true;
        } else if (arg == "--extension-guide" || arg == "--guide") {
            show_extension_guide = true;
        }
    }

    HWND consoleWnd = GetConsoleWindow();
    if (consoleWnd && !force_console && !waterfall::core::ConfigManager::Instance().GetConfig().show_console) {
        ShowWindow(consoleWnd, SW_HIDE);
    }

    // Attach or allocate console ONLY if explicitly requested via flag or config
    if (force_console || waterfall::core::ConfigManager::Instance().GetConfig().show_console) {
        if (!consoleWnd) {
            if (!AttachConsole(ATTACH_PARENT_PROCESS)) {
                AllocConsole();
            }
            consoleWnd = GetConsoleWindow();
        }
        if (consoleWnd) {
            ShowWindow(consoleWnd, SW_SHOW);
        }
        FILE* fp = nullptr;
        freopen_s(&fp, "CONOUT$", "w", stdout);
        freopen_s(&fp, "CONOUT$", "w", stderr);
        freopen_s(&fp, "CONIN$", "r", stdin);
        setvbuf(stdout, NULL, _IONBF, 0);
        setvbuf(stderr, NULL, _IONBF, 0);
        std::cout << std::unitbuf;
        SetConsoleTitleW(L"Waterfall Accelerator — Debug Console");
    }

    // 0. Single-Instance Mutex Guard
    bootLog << "[Boot] Creating mutex..." << std::endl;
    HANDLE h_mutex = CreateMutexW(nullptr, TRUE, L"Local\\WaterfallAccelerator_SingleInstance_Mutex");
    if (GetLastError() == ERROR_ALREADY_EXISTS) {
        bootLog << "[Boot] Mutex ALREADY EXISTS -> Exiting duplicate instance!" << std::endl;
        std::cout << "[Core] Another instance of Waterfall is already running." << std::endl;
        HWND existing_hwnd = FindWindowW(L"Waterfall_WebView2_Class", nullptr);
        if (!existing_hwnd) {
            existing_hwnd = FindWindowW(nullptr, L"🌊 Waterfall Accelerator v2.0 (Native C++20)");
        }
        if (existing_hwnd) {
            ShowWindow(existing_hwnd, SW_RESTORE);
            SetForegroundWindow(existing_hwnd);
        }
        if (show_extension_guide) {
            ShellExecuteW(nullptr, L"open", L"http://127.0.0.1:4567/extension-guide.html", nullptr, nullptr, SW_SHOWNORMAL);
        }
        if (h_mutex) CloseHandle(h_mutex);
        return 0;
    }
    bootLog << "[Boot] Mutex acquired successfully." << std::endl;

    std::cout << "=================================================" << std::endl;
    std::cout << "  🌊 WATERFALL DOWNLOAD ACCELERATOR v2.0 (C++20) " << std::endl;
    std::cout << "=================================================" << std::endl;

    // 1. Initialize SQLite State Engine in %APPDATA%\Waterfall
    bootLog << "[Boot] Resolving DB path..." << std::endl;
    std::string db_path = (waterfall::core::StorageRouter::Instance().GetAppDataDir() / "waterfall.db").string();
    bootLog << "[Boot] DB path is " << db_path << ", initializing DownloadManager..." << std::endl;
    if (!waterfall::core::DownloadManager::Instance().Initialize(db_path)) {
        bootLog << "[Boot] DownloadManager::Initialize FAILED!" << std::endl;
        std::cerr << "Failed to initialize state database at: " << db_path << std::endl;
        return 1;
    }
    bootLog << "[Boot] DownloadManager initialized." << std::endl;
    std::cout << "[Core] SQLite WAL state store initialized at: " << db_path << std::endl;

    // 2. Start Companion Extension Server & Static Web UI Host (Port 4567)
    bootLog << "[Boot] Starting ExtensionServer on 4567..." << std::endl;
    waterfall::server::ExtensionServer extension_server(4567);
    extension_server.Start();
    bootLog << "[Boot] ExtensionServer started." << std::endl;

    // 3. Launch UI: WebView2 rich Web UI by default, with RmlUi fallback/flag
    if (use_rmlui) {
        bootLog << "[Boot] Using RmlUi" << std::endl;
        std::cout << "[UI] Launching native RmlUi/OpenGL interface (--rmlui flag detected)..." << std::endl;
        waterfall::ui::UiManager ui_manager;
        if (ui_manager.Initialize(1480, 780)) {
            std::cout << "[UI] Native GPU interface started successfully." << std::endl;
            ui_manager.Run();
            ui_manager.Shutdown();
        }
    } else {
        bootLog << "[Boot] Initializing WebViewUiManager..." << std::endl;
        std::cout << "[UI] Launching native WebView2 high-fidelity UI..." << std::endl;
        if (waterfall::ui::WebViewUiManager::Instance().Initialize(1480, 780, "http://127.0.0.1:4567/")) {
            bootLog << "[Boot] WebViewUiManager initialized successfully! Calling Run()..." << std::endl;
            bootLog.flush();
            std::cout << "[UI] Native WebView2 interface initialized." << std::endl;
            if (show_extension_guide) {
                waterfall::ui::WebViewUiManager::Instance().OpenDialogWindow(
                    "http://127.0.0.1:4567/extension-guide.html",
                    820, 720, false,
                    L"Waterfall — Companion Extension Guide", "guide", 0
                );
            }
            if (start_minimized) {
                waterfall::ui::WebViewUiManager::Instance().MinimizeToTray();
            }
            bootLog << "[Boot] Calling Run()..." << std::endl;
            waterfall::ui::WebViewUiManager::Instance().Run();
            bootLog << "[Boot] Run() returned! Calling Shutdown()..." << std::endl;
            waterfall::ui::WebViewUiManager::Instance().Shutdown();
            bootLog << "[Boot] Shutdown() finished." << std::endl;
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

int WINAPI wWinMain(HINSTANCE hInstance, HINSTANCE hPrevInstance, LPWSTR lpCmdLine, int nCmdShow) {
    UNREFERENCED_PARAMETER(hInstance);
    UNREFERENCED_PARAMETER(hPrevInstance);
    UNREFERENCED_PARAMETER(lpCmdLine);
    UNREFERENCED_PARAMETER(nCmdShow);

    int argc = 0;
    LPWSTR* argvW = CommandLineToArgvW(GetCommandLineW(), &argc);
    std::vector<std::string> argsUtf8;
    std::vector<char*> argvList;
    if (argvW) {
        for (int i = 0; i < argc; ++i) {
            int size = WideCharToMultiByte(CP_UTF8, 0, argvW[i], -1, nullptr, 0, nullptr, nullptr);
            if (size > 1) {
                std::string s(size - 1, 0);
                WideCharToMultiByte(CP_UTF8, 0, argvW[i], -1, &s[0], size, nullptr, nullptr);
                argsUtf8.push_back(s);
            } else {
                argsUtf8.push_back("");
            }
        }
        LocalFree(argvW);
    }
    for (auto& s : argsUtf8) {
        argvList.push_back(&s[0]);
    }
    argvList.push_back(nullptr);

    return RunWaterfall(static_cast<int>(argvList.size() - 1), argvList.data());
}

int main(int argc, char* argv[]) {
    return RunWaterfall(argc, argv);
}
