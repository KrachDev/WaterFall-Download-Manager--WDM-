#include "waterfall/ui/WebViewUiManager.hpp"
#include <windows.h>
#include <wrl/client.h>
#include <wrl/event.h>
#include "WebView2.h"
#include <shlobj.h>
#include <dwmapi.h>
#include <iostream>
#include <algorithm>
#include "waterfall/core/ShellIntegration.hpp"
#include "waterfall/core/ConfigManager.hpp"

namespace waterfall::ui {

#define WM_WATERFALL_OPEN_DIALOG (WM_APP + 201)
#define WM_WATERFALL_SET_TOPMOST (WM_APP + 202)

struct OpenDialogParams {
    std::string url;
    int width;
    int height;
    bool is_topmost;
    std::wstring title;
    std::string type;
    int task_id;
};

struct SetTopmostParams {
    HWND hwnd = nullptr;
    int task_id = 0;
    std::string type;
    bool topmost = false;
    bool bring_to_front = true;
};

static const wchar_t* s_bridge_script = 
    L"window.waterfallDesktop = {"
    L"  openConfirmWindow: function(data) {"
    L"    fetch('/api/window/open-confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data || {}) }).catch(function(){});"
    L"  },"
    L"  openWelcomeWindow: function() {"
    L"    fetch('/api/window/open-welcome', { method: 'POST' }).catch(function(){});"
    L"  },"
    L"  completeFirstRun: function(data) {"
    L"    return fetch('/api/system/complete-first-run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data || {}) });"
    L"  },"
    L"  openProgressWindow: function(taskId) {"
    L"    var id = (typeof taskId === 'object' && taskId !== null) ? (taskId.id || 0) : (taskId || 0);"
    L"    fetch('/api/window/open-progress', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: id, topmost: false }) }).catch(function(){});"
    L"  },"
    L"  setAlwaysOnTop: function(topmost, taskId) {"
    L"    var id = (typeof taskId === 'object' && taskId !== null) ? (taskId.id || 0) : (taskId || 0);"
    L"    fetch('/api/window/set-topmost', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ topmost: !!topmost, taskId: id }) }).catch(function(){});"
    L"  },"
    L"  forceTop: function(taskId) {"
    L"    var id = (typeof taskId === 'object' && taskId !== null) ? (taskId.id || 0) : (taskId || 0);"
    L"    fetch('/api/window/set-topmost', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ topmost: true, bringToFront: true, taskId: id }) }).catch(function(){});"
    L"  },"
    L"  minimizeToTray: function() {"
    L"    fetch('/api/system/minimize-tray', { method: 'POST' }).catch(function(){});"
    L"  },"
    L"  exitApp: function() {"
    L"    fetch('/api/system/exit', { method: 'POST' }).catch(function(){});"
    L"  },"
    L"  promptQuit: function() {"
    L"    if (typeof window.showQuitOptionsModal === 'function') window.showQuitOptionsModal();"
    L"  },"
    L"  close: function(type, taskId) {\n    fetch('/api/window/close-dialog', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: type || '', taskId: taskId || 0 }) }).catch(function(){});"
    L"    window.close();"
    L"  },"
    L"  closeConfirmWindow: function() {\n    fetch('/api/window/close-dialog', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'confirm' }) }).catch(function(){});"
    L"    window.close();"
    L"  },"
    L"  openFolder: function(p) {"
    L"    fetch('/api/open-folder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: p || '' }) }).catch(function(){});"
    L"  },"
    L"  openFile: function(p) {"
    L"    fetch('/api/open-file', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: p || '' }) }).catch(function(){});"
    L"  }"
    L"};";

static std::string WideToUtf8(const std::wstring& wstr) {
    if (wstr.empty()) return "";
    int size = WideCharToMultiByte(CP_UTF8, 0, wstr.c_str(), -1, nullptr, 0, nullptr, nullptr);
    if (size <= 1) return "";
    std::string res(size - 1, 0);
    WideCharToMultiByte(CP_UTF8, 0, wstr.c_str(), -1, &res[0], size, nullptr, nullptr);
    return res;
}

static std::wstring Utf8ToWide(const std::string& str) {
    if (str.empty()) return L"";
    int size = MultiByteToWideChar(CP_UTF8, 0, str.c_str(), -1, nullptr, 0);
    if (size <= 1) return L"";
    std::wstring res(size - 1, 0);
    MultiByteToWideChar(CP_UTF8, 0, str.c_str(), -1, &res[0], size);
    return res;
}

WebViewUiManager& WebViewUiManager::Instance() {
    static WebViewUiManager instance;
    return instance;
}

LRESULT CALLBACK WebViewUiManager::WndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
    auto& mgr = WebViewUiManager::Instance();
    switch (msg) {
    case WM_SIZE: {
        if (mgr.main_controller_) {
            RECT bounds;
            GetClientRect(hwnd, &bounds);
            mgr.main_controller_->put_Bounds(bounds);
        }
        return 0;
    }
    case WM_SETFOCUS: {
        if (mgr.main_controller_) {
            mgr.main_controller_->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);
        }
        return 0;
    }
    case WM_CLOSE: {
        if (mgr.main_webview_) {
            mgr.main_webview_->ExecuteScript(
                L"if (typeof window.showQuitOptionsModal === 'function') { window.showQuitOptionsModal(); } else { fetch('/api/system/exit', { method: 'POST' }); }",
                nullptr
            );
            return 0; // Prevent immediate close; prompt user with tray/exit/cancel modal
        }
        break;
    }
    case WM_APP + 100: { // System Tray Callback Message
        if (lParam == WM_LBUTTONDBLCLK || lParam == WM_LBUTTONUP) {
            ShowWindow(hwnd, SW_RESTORE);
            SetForegroundWindow(hwnd);
            BringWindowToTop(hwnd);
        } else if (lParam == WM_RBUTTONUP) {
            POINT pt;
            GetCursorPos(&pt);
            HMENU hMenu = CreatePopupMenu();
            AppendMenuW(hMenu, MF_STRING, 2001, L"Open Waterfall");
            AppendMenuW(hMenu, MF_SEPARATOR, 0, nullptr);
            AppendMenuW(hMenu, MF_STRING, 2002, L"Exit Waterfall");
            SetForegroundWindow(hwnd);
            int cmd = TrackPopupMenu(hMenu, TPM_RETURNCMD | TPM_NONOTIFY, pt.x, pt.y, 0, hwnd, nullptr);
            DestroyMenu(hMenu);
            if (cmd == 2001) {
                ShowWindow(hwnd, SW_RESTORE);
                SetForegroundWindow(hwnd);
                BringWindowToTop(hwnd);
            } else if (cmd == 2002) {
                mgr.ExitApp();
            }
        }
        return 0;
    }
    case WM_WATERFALL_OPEN_DIALOG: {
        auto* req = reinterpret_cast<OpenDialogParams*>(wParam);
        if (req) {
            HWND res = mgr.OpenDialogWindowInternal(req->url, req->width, req->height, req->is_topmost, req->title, req->type, req->task_id);
            return reinterpret_cast<LRESULT>(res);
        }
        return 0;
    }
    case WM_WATERFALL_SET_TOPMOST: {
        auto* req = reinterpret_cast<SetTopmostParams*>(wParam);
        if (req) {
            bool ok = false;
            if (req->hwnd) {
                ok = mgr.SetWindowTopmostInternal(req->hwnd, req->topmost, req->bring_to_front);
            } else if (req->task_id > 0) {
                ok = mgr.SetWindowTopmostByTaskIdInternal(req->task_id, req->topmost, req->bring_to_front);
            } else if (!req->type.empty()) {
                ok = mgr.SetWindowTopmostByTypeInternal(req->type, req->topmost, req->bring_to_front);
            } else {
                if (!mgr.SetWindowTopmostByTypeInternal("confirm", req->topmost, req->bring_to_front)) {
                    ok = mgr.SetWindowTopmostByTypeInternal("progress", req->topmost, req->bring_to_front);
                } else {
                    ok = true;
                }
            }
            return ok ? 1 : 0;
        }
        return 0;
    }
    case WM_DESTROY: {
        if (mgr.main_controller_) {
            mgr.main_controller_->Close();
            mgr.main_controller_ = nullptr;
        }
        mgr.main_webview_ = nullptr;
        PostQuitMessage(0);
        return 0;
    }
    }
    return DefWindowProcW(hwnd, msg, wParam, lParam);
}

LRESULT CALLBACK WebViewUiManager::DialogWndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
    auto& mgr = WebViewUiManager::Instance();
    switch (msg) {
    case WM_SIZE: {
        std::lock_guard<std::recursive_mutex> lock(mgr.windows_mutex_);
        for (auto& win : mgr.dialog_windows_) {
            if (win->hwnd == hwnd && win->controller) {
                RECT bounds;
                GetClientRect(hwnd, &bounds);
                win->controller->put_Bounds(bounds);
                break;
            }
        }
        return 0;
    }
    case WM_SETFOCUS: {
        std::lock_guard<std::recursive_mutex> lock(mgr.windows_mutex_);
        for (auto& win : mgr.dialog_windows_) {
            if (win->hwnd == hwnd && win->controller) {
                win->controller->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);
                break;
            }
        }
        return 0;
    }
    case WM_CLOSE: {
        bool hide_only = false;
        {
            std::lock_guard<std::recursive_mutex> lock(mgr.windows_mutex_);
            for (auto& win : mgr.dialog_windows_) {
                if (win->hwnd == hwnd && (win->type == "confirm" || win->is_preloaded)) {
                    hide_only = true;
                    win->is_visible_requested = false;
                    if (win->controller) {
                        win->controller->put_IsVisible(FALSE);
                    }
                    if (win->webview) {
                        win->webview->ExecuteScript(
                            L"if (typeof window.resetConfirmState === 'function') { window.resetConfirmState(); }",
                            nullptr
                        );
                    }
                    break;
                }
            }
        }
        if (hide_only) {
            ShowWindow(hwnd, SW_HIDE);
            return 0;
        }
        DestroyWindow(hwnd);
        return 0;
    }
    case WM_DESTROY: {
        std::shared_ptr<DialogWindowInfo> to_close = nullptr;
        {
            std::lock_guard<std::recursive_mutex> lock(mgr.windows_mutex_);
            for (auto it = mgr.dialog_windows_.begin(); it != mgr.dialog_windows_.end(); ++it) {
                if ((*it)->hwnd == hwnd) {
                    to_close = *it;
                    mgr.dialog_windows_.erase(it);
                    break;
                }
            }
        }
        if (to_close && to_close->controller) {
            to_close->controller->Close();
            to_close->controller = nullptr;
            to_close->webview = nullptr;
        }
        return 0;
    }
    }
    return DefWindowProcW(hwnd, msg, wParam, lParam);
}

bool WebViewUiManager::Initialize(int width, int height, const std::string& start_url) {
    main_thread_id_ = GetCurrentThreadId();
    CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    HINSTANCE hInstance = GetModuleHandle(nullptr);

    // Load custom application icon (embedded resource ID 101 or fallback to assets/icon.ico)
    hIconBig_ = (HICON)LoadImageW(hInstance, MAKEINTRESOURCEW(101), IMAGE_ICON, GetSystemMetrics(SM_CXICON), GetSystemMetrics(SM_CYICON), LR_DEFAULTCOLOR);
    hIconSmall_ = (HICON)LoadImageW(hInstance, MAKEINTRESOURCEW(101), IMAGE_ICON, GetSystemMetrics(SM_CXSMICON), GetSystemMetrics(SM_CYSMICON), LR_DEFAULTCOLOR);
    if (!hIconBig_ || !hIconSmall_) {
        WCHAR exePath[MAX_PATH];
        GetModuleFileNameW(nullptr, exePath, MAX_PATH);
        std::wstring exeDir = exePath;
        size_t lastSlash = exeDir.find_last_of(L"\\/");
        if (lastSlash != std::wstring::npos) exeDir = exeDir.substr(0, lastSlash);
        std::wstring iconPath = exeDir + L"\\assets\\icon.ico";

        if (!hIconBig_) {
            hIconBig_ = (HICON)LoadImageW(nullptr, iconPath.c_str(), IMAGE_ICON, GetSystemMetrics(SM_CXICON), GetSystemMetrics(SM_CYICON), LR_LOADFROMFILE);
            if (!hIconBig_) {
                hIconBig_ = (HICON)LoadImageW(nullptr, L"assets\\icon.ico", IMAGE_ICON, GetSystemMetrics(SM_CXICON), GetSystemMetrics(SM_CYICON), LR_LOADFROMFILE);
            }
        }
        if (!hIconSmall_) {
            hIconSmall_ = (HICON)LoadImageW(nullptr, iconPath.c_str(), IMAGE_ICON, GetSystemMetrics(SM_CXSMICON), GetSystemMetrics(SM_CYSMICON), LR_LOADFROMFILE);
            if (!hIconSmall_) {
                hIconSmall_ = (HICON)LoadImageW(nullptr, L"assets\\icon.ico", IMAGE_ICON, GetSystemMetrics(SM_CXSMICON), GetSystemMetrics(SM_CYSMICON), LR_LOADFROMFILE);
            }
        }
    }
    if (!hIconBig_) hIconBig_ = LoadIconW(nullptr, (LPCWSTR)IDI_APPLICATION);
    if (!hIconSmall_) hIconSmall_ = hIconBig_;

    // Register primary window class
    WNDCLASSEXW wcex = {};
    wcex.cbSize = sizeof(WNDCLASSEXW);
    wcex.style = CS_HREDRAW | CS_VREDRAW;
    wcex.lpfnWndProc = WndProc;
    wcex.hInstance = hInstance;
    wcex.hIcon = hIconBig_;
    wcex.hIconSm = hIconSmall_;
    wcex.hCursor = LoadCursorW(nullptr, (LPCWSTR)IDC_ARROW);
    wcex.hbrBackground = (HBRUSH)GetStockObject(BLACK_BRUSH);
    wcex.lpszClassName = L"Waterfall_WebView2_Class";
    RegisterClassExW(&wcex);

    // Center window on primary monitor
    int screenW = GetSystemMetrics(SM_CXSCREEN);
    int screenH = GetSystemMetrics(SM_CYSCREEN);
    int posX = std::max(0, (screenW - width) / 2);
    int posY = std::max(0, (screenH - height) / 2);

    hwnd_ = CreateWindowExW(
        0,
        L"Waterfall_WebView2_Class",
        L"🌊 Waterfall Accelerator v2.0 (Native C++20)",
        WS_OVERLAPPEDWINDOW,
        posX, posY, width, height,
        nullptr, nullptr, hInstance, nullptr
    );

    if (!hwnd_) {
        std::cerr << "[WebView2] Failed to create main application window." << std::endl;
        return false;
    }

    SendMessageW(hwnd_, WM_SETICON, ICON_BIG, (LPARAM)hIconBig_);
    SendMessageW(hwnd_, WM_SETICON, ICON_SMALL, (LPARAM)hIconSmall_);

    // Windows 10/11 Immersive Dark Titlebar
    BOOL useDarkMode = TRUE;
    DwmSetWindowAttribute(hwnd_, 20 /* DWMWA_USE_IMMERSIVE_DARK_MODE */, &useDarkMode, sizeof(useDarkMode));

    ShowWindow(hwnd_, SW_SHOW);
    UpdateWindow(hwnd_);

    // Attach Windows Taskbar Progress & Tray to this HWND
    core::ShellIntegration::Instance().Initialize(hwnd_);

    // Dedicated WebView2 user data folder in AppData\Local\Waterfall\WebView2Data
    WCHAR local_appdata[MAX_PATH];
    SHGetFolderPathW(nullptr, CSIDL_LOCAL_APPDATA, nullptr, 0, local_appdata);
    std::wstring user_data_folder = std::wstring(local_appdata) + L"\\Waterfall\\WebView2Data";
    CreateDirectoryW((std::wstring(local_appdata) + L"\\Waterfall").c_str(), nullptr);
    CreateDirectoryW(user_data_folder.c_str(), nullptr);

    HRESULT hr = CreateCoreWebView2EnvironmentWithOptions(
        nullptr, // Default Evergreen Edge runtime
        user_data_folder.c_str(),
        nullptr,
        Microsoft::WRL::Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>(
            [this, start_url](HRESULT result, ICoreWebView2Environment* env) -> HRESULT {
                if (FAILED(result) || !env) {
                    std::cerr << "[WebView2] Environment creation failed: hr=0x" << std::hex << result << std::endl;
                    return result;
                }

                env_ = env;

                env_->CreateCoreWebView2Controller(
                    hwnd_,
                    Microsoft::WRL::Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
                        [this, start_url](HRESULT result, ICoreWebView2Controller* controller) -> HRESULT {
                            if (FAILED(result) || !controller) {
                                std::cerr << "[WebView2] Controller creation failed: hr=0x" << std::hex << result << std::endl;
                                return result;
                            }

                            main_controller_ = controller;
                            main_controller_->get_CoreWebView2(&main_webview_);

                            Microsoft::WRL::ComPtr<ICoreWebView2Settings> settings;
                            if (SUCCEEDED(main_webview_->get_Settings(&settings)) && settings) {
                                settings->put_IsScriptEnabled(TRUE);
                                settings->put_AreDefaultScriptDialogsEnabled(TRUE);
                                settings->put_IsWebMessageEnabled(TRUE);
                                settings->put_AreDevToolsEnabled(TRUE);
                                settings->put_IsStatusBarEnabled(FALSE);
                            }

                            RECT bounds;
                            GetClientRect(hwnd_, &bounds);
                            main_controller_->put_Bounds(bounds);
                            main_controller_->put_IsVisible(TRUE);

                            // Inject native desktop bridge script
                            main_webview_->AddScriptToExecuteOnDocumentCreated(s_bridge_script, nullptr);

                            // Intercept window.open calls to render native dialog windows
                            main_webview_->add_NewWindowRequested(
                                Microsoft::WRL::Callback<ICoreWebView2NewWindowRequestedEventHandler>(
                                    [this](ICoreWebView2* /*sender*/, ICoreWebView2NewWindowRequestedEventArgs* args) -> HRESULT {
                                        LPWSTR uri_ws = nullptr;
                                        args->get_Uri(&uri_ws);
                                        if (uri_ws) {
                                            std::wstring ws(uri_ws);
                                            CoTaskMemFree(uri_ws);
                                            std::string uri = WideToUtf8(ws);

                                            args->put_Handled(TRUE);

                                            if (uri.find("confirm.html") != std::string::npos) {
                                                OpenDialogWindow(uri, 680, 750, true /* top window */, L"Waterfall — Download File Info", "confirm", 0);
                                            } else if (uri.find("download-progress.html") != std::string::npos) {
                                                int taskId = 0;
                                                size_t tid = uri.find("taskId=");
                                                if (tid != std::string::npos) {
                                                    taskId = std::atoi(uri.c_str() + tid + 7);
                                                }
                                                OpenDialogWindow(uri, 660, 600, false /* normal window, pin available */, L"Waterfall — Download Progress", "progress", taskId);
                                            } else if (uri.find("welcome.html") != std::string::npos) {
                                                OpenDialogWindow(uri, 760, 660, true /* top window */, L"Waterfall — Setup & Welcome Wizard", "welcome", 0);
                                            } else {
                                                ShellExecuteW(nullptr, L"open", ws.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
                                            }
                                        }
                                        return S_OK;
                                    }).Get(), nullptr);

                            std::wstring wurl = Utf8ToWide(start_url);
                            main_webview_->Navigate(wurl.c_str());

                            std::cout << "[WebView2] Connected to native C++ engine at: " << start_url << std::endl;

                            PreloadConfirmDialog();

                            // Automatically launch IDM-like Welcome Setup Wizard on first run
                            if (!core::ConfigManager::Instance().IsFirstRunCompleted()) {
                                std::cout << "[UI] First launch detected: Spawning IDM-style Welcome Setup Wizard..." << std::endl;
                                OpenDialogWindow("http://127.0.0.1:4567/welcome.html", 760, 660, true, L"Waterfall — Setup & Welcome Wizard", "welcome", 0);
                            }
                            return S_OK;
                        }).Get());
                return S_OK;
            }).Get());

    if (FAILED(hr)) {
        std::cerr << "[WebView2] CreateCoreWebView2EnvironmentWithOptions returned hr=0x" << std::hex << hr << std::endl;
        return false;
    }

    is_running_ = true;
    return true;
}


void WebViewUiManager::PreloadConfirmDialog() {
    if (!env_) return;

    {
        std::lock_guard<std::recursive_mutex> lock(windows_mutex_);
        for (auto& win : dialog_windows_) {
            if (win->type == "confirm" && win->hwnd && IsWindow(win->hwnd)) {
                return;
            }
        }
    }

    HINSTANCE hInstance = GetModuleHandle(nullptr);
    static bool s_class_registered = false;
    if (!s_class_registered) {
        WNDCLASSEXW dwcex = {};
        dwcex.cbSize = sizeof(WNDCLASSEXW);
        dwcex.style = CS_HREDRAW | CS_VREDRAW;
        dwcex.lpfnWndProc = DialogWndProc;
        dwcex.hInstance = hInstance;
        dwcex.hIcon = hIconBig_ ? hIconBig_ : LoadIconW(nullptr, (LPCWSTR)IDI_APPLICATION);
        dwcex.hIconSm = hIconSmall_ ? hIconSmall_ : dwcex.hIcon;
        dwcex.hCursor = LoadCursorW(nullptr, (LPCWSTR)IDC_ARROW);
        dwcex.hbrBackground = (HBRUSH)GetStockObject(BLACK_BRUSH);
        dwcex.lpszClassName = L"Waterfall_Dialog_Class";
        RegisterClassExW(&dwcex);
        s_class_registered = true;
    }

    int width = 680;
    int height = 750;
    int screenW = GetSystemMetrics(SM_CXSCREEN);
    int screenH = GetSystemMetrics(SM_CYSCREEN);
    int posX = std::max(0, (screenW - width) / 2);
    int posY = std::max(0, (screenH - height) / 2);

    DWORD exStyle = WS_EX_APPWINDOW | WS_EX_TOPMOST;
    HWND dlgHwnd = CreateWindowExW(
        exStyle,
        L"Waterfall_Dialog_Class",
        L"Waterfall — Download File Info",
        WS_OVERLAPPEDWINDOW,
        posX, posY, width, height,
        nullptr,
        nullptr, hInstance, nullptr
    );

    if (!dlgHwnd) {
        std::cerr << "[WebView2] Failed to create preloaded confirm dialog window" << std::endl;
        return;
    }

    if (hIconBig_) SendMessageW(dlgHwnd, WM_SETICON, ICON_BIG, (LPARAM)hIconBig_);
    if (hIconSmall_) SendMessageW(dlgHwnd, WM_SETICON, ICON_SMALL, (LPARAM)hIconSmall_);

    BOOL useDarkMode = TRUE;
    DwmSetWindowAttribute(dlgHwnd, 20 /* DWMWA_USE_IMMERSIVE_DARK_MODE */, &useDarkMode, sizeof(useDarkMode));

    // Keep hidden initially in RAM
    ShowWindow(dlgHwnd, SW_HIDE);

    auto info = std::make_shared<DialogWindowInfo>();
    info->hwnd = dlgHwnd;
    info->url = "http://127.0.0.1:4567/confirm.html";
    info->type = "confirm";
    info->task_id = 0;
    info->is_topmost = true;
    info->is_preloaded = true;
    info->is_visible_requested = false;
    {
        std::lock_guard<std::recursive_mutex> lock(windows_mutex_);
        dialog_windows_.push_back(info);
    }

    env_->CreateCoreWebView2Controller(
        dlgHwnd,
        Microsoft::WRL::Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
            [this, dlgHwnd, width, height](HRESULT result, ICoreWebView2Controller* controller) -> HRESULT {
                if (FAILED(result) || !controller) {
                    std::cerr << "[WebView2] Failed to create preloaded confirm controller: hr=0x" << std::hex << result << std::endl;
                    return result;
                }

                std::shared_ptr<DialogWindowInfo> win_info = nullptr;
                {
                    std::lock_guard<std::recursive_mutex> lk(windows_mutex_);
                    for (auto& w : dialog_windows_) {
                        if (w->hwnd == dlgHwnd) {
                            win_info = w;
                            break;
                        }
                    }
                }

                if (!win_info) {
                    controller->Close();
                    return S_OK;
                }

                win_info->controller = controller;
                controller->get_CoreWebView2(&win_info->webview);

                Microsoft::WRL::ComPtr<ICoreWebView2Settings> settings;
                if (SUCCEEDED(win_info->webview->get_Settings(&settings)) && settings) {
                    settings->put_IsScriptEnabled(TRUE);
                    settings->put_AreDefaultScriptDialogsEnabled(TRUE);
                    settings->put_IsWebMessageEnabled(TRUE);
                    settings->put_AreDevToolsEnabled(TRUE);
                    settings->put_IsStatusBarEnabled(FALSE);
                }

                RECT bounds = {0, 0, width, height};
                GetClientRect(dlgHwnd, &bounds);
                if (bounds.right <= 0 || bounds.bottom <= 0) {
                    bounds = {0, 0, width, height};
                }
                controller->put_Bounds(bounds);
                controller->put_IsVisible(win_info->is_visible_requested ? TRUE : FALSE);

                // Inject bridge script
                win_info->webview->AddScriptToExecuteOnDocumentCreated(s_bridge_script, nullptr);

                // Handle window.close() from JS
                win_info->webview->add_WindowCloseRequested(
                    Microsoft::WRL::Callback<ICoreWebView2WindowCloseRequestedEventHandler>(
                        [dlgHwnd](ICoreWebView2* /*sender*/, IUnknown* /*args*/) -> HRESULT {
                            PostMessageW(dlgHwnd, WM_CLOSE, 0, 0);
                            return S_OK;
                        }).Get(), nullptr);

                // Handle window.open inside dialogs
                win_info->webview->add_NewWindowRequested(
                    Microsoft::WRL::Callback<ICoreWebView2NewWindowRequestedEventHandler>(
                        [this](ICoreWebView2* /*sender*/, ICoreWebView2NewWindowRequestedEventArgs* args) -> HRESULT {
                            LPWSTR uri_ws = nullptr;
                            args->get_Uri(&uri_ws);
                            if (uri_ws) {
                                std::wstring ws(uri_ws);
                                CoTaskMemFree(uri_ws);
                                std::string uri = WideToUtf8(ws);
                                args->put_Handled(TRUE);

                                if (uri.find("confirm.html") != std::string::npos) {
                                    OpenDialogWindow(uri, 680, 750, true, L"Waterfall — Download File Info", "confirm", 0);
                                } else if (uri.find("download-progress.html") != std::string::npos) {
                                    int taskId = 0;
                                    size_t tid = uri.find("taskId=");
                                    if (tid != std::string::npos) {
                                        taskId = std::atoi(uri.c_str() + tid + 7);
                                    }
                                    OpenDialogWindow(uri, 660, 600, false, L"Waterfall — Download Progress", "progress", taskId);
                                } else {
                                    ShellExecuteW(nullptr, L"open", ws.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
                                }
                            }
                            return S_OK;
                        }).Get(), nullptr);

                std::wstring wurl = Utf8ToWide(win_info->url);
                win_info->webview->Navigate(wurl.c_str());

                if (win_info->is_visible_requested) {
                    ShowWindow(dlgHwnd, SW_SHOW);
                    SetWindowPos(dlgHwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
                    SetForegroundWindow(dlgHwnd);
                    BringWindowToTop(dlgHwnd);
                    win_info->webview->ExecuteScript(
                        L"if (typeof window.refreshConfirmData === 'function') { window.refreshConfirmData(); }",
                        nullptr
                    );
                }

                std::cout << "[WebView2] Warm standby dialog preloaded in RAM: " << win_info->url << std::endl;
                return S_OK;
            }).Get());
}

HWND WebViewUiManager::OpenDialogWindow(const std::string& url, int width, int height, bool is_topmost,
                                      const std::wstring& title, const std::string& type, int task_id) {
    if (main_thread_id_ != 0 && GetCurrentThreadId() != main_thread_id_ && hwnd_ && IsWindow(hwnd_)) {
        OpenDialogParams p{ url, width, height, is_topmost, title, type, task_id };
        return reinterpret_cast<HWND>(SendMessageW(hwnd_, WM_WATERFALL_OPEN_DIALOG, reinterpret_cast<WPARAM>(&p), 0));
    }
    return OpenDialogWindowInternal(url, width, height, is_topmost, title, type, task_id);
}

HWND WebViewUiManager::OpenDialogWindowInternal(const std::string& url, int width, int height, bool is_topmost,
                                              const std::wstring& title, const std::string& type, int task_id) {
    std::string full_url = url;
    if (full_url.rfind("http://", 0) != 0 && full_url.rfind("https://", 0) != 0 && full_url.rfind("file://", 0) != 0) {
        if (!full_url.empty() && full_url[0] == '/') {
            full_url = "http://127.0.0.1:4567" + full_url;
        } else {
            full_url = "http://127.0.0.1:4567/" + full_url;
        }
    }

    HWND existing_hwnd = nullptr;
    std::shared_ptr<DialogWindowInfo> existing_win = nullptr;
    {
        std::lock_guard<std::recursive_mutex> lock(windows_mutex_);
        for (auto& win : dialog_windows_) {
            bool match = false;
            if (task_id > 0 && win->task_id == task_id) match = true;
            else if (!type.empty() && type == "confirm" && win->type == "confirm") match = true;
            else if (!type.empty() && type == "welcome" && win->type == "welcome") match = true;

            if (match && win->hwnd && IsWindow(win->hwnd)) {
                existing_hwnd = win->hwnd;
                existing_win = win;
                if (is_topmost) win->is_topmost = true;
                break;
            }
        }
    }

    HWND prevFg = GetForegroundWindow();
    bool mainWasForeground = (prevFg != nullptr && (prevFg == hwnd_ || IsChild(hwnd_, prevFg)));

    if (existing_hwnd && existing_win) {
        existing_win->is_visible_requested = true;

        // Recenter dialog on screen
        int screenW = GetSystemMetrics(SM_CXSCREEN);
        int screenH = GetSystemMetrics(SM_CYSCREEN);
        int posX = std::max(0, (screenW - width) / 2);
        int posY = std::max(0, (screenH - height) / 2);
        SetWindowPos(existing_hwnd, nullptr, posX, posY, width, height, SWP_NOZORDER | SWP_NOACTIVATE);

        if (existing_win->controller) {
            RECT bounds = {0, 0, width, height};
            GetClientRect(existing_hwnd, &bounds);
            if (bounds.right <= 0 || bounds.bottom <= 0) {
                bounds = {0, 0, width, height};
            }
            existing_win->controller->put_Bounds(bounds);
            existing_win->controller->put_IsVisible(TRUE);
        }

        ShowWindow(existing_hwnd, SW_SHOW);
        if (is_topmost) {
            SetWindowPos(existing_hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
        } else {
            SetWindowPos(existing_hwnd, HWND_TOP, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
        }
        SetForegroundWindow(existing_hwnd);
        BringWindowToTop(existing_hwnd);

        if (existing_win->webview) {
            existing_win->webview->ExecuteScript(
                L"if (typeof window.refreshConfirmData === 'function') { window.refreshConfirmData(); } else { window.location.reload(); }",
                nullptr
            );
        }

        if (type == "confirm" && !mainWasForeground && hwnd_ && IsWindow(hwnd_) && !IsIconic(hwnd_)) {
            if (prevFg && IsWindow(prevFg)) {
                SetWindowPos(hwnd_, prevFg, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
            } else {
                SetWindowPos(hwnd_, HWND_BOTTOM, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
            }
        }
        return existing_hwnd;
    }

    HINSTANCE hInstance = GetModuleHandle(nullptr);

    // Register dialog window class once
    static bool s_class_registered = false;
    if (!s_class_registered) {
        WNDCLASSEXW dwcex = {};
        dwcex.cbSize = sizeof(WNDCLASSEXW);
        dwcex.style = CS_HREDRAW | CS_VREDRAW;
        dwcex.lpfnWndProc = DialogWndProc;
        dwcex.hInstance = hInstance;
        dwcex.hIcon = hIconBig_ ? hIconBig_ : LoadIconW(nullptr, (LPCWSTR)IDI_APPLICATION);
        dwcex.hIconSm = hIconSmall_ ? hIconSmall_ : dwcex.hIcon;
        dwcex.hCursor = LoadCursorW(nullptr, (LPCWSTR)IDC_ARROW);
        dwcex.hbrBackground = (HBRUSH)GetStockObject(BLACK_BRUSH);
        dwcex.lpszClassName = L"Waterfall_Dialog_Class";
        RegisterClassExW(&dwcex);
        s_class_registered = true;
    }

    // Center dialog window on screen
    int screenW = GetSystemMetrics(SM_CXSCREEN);
    int screenH = GetSystemMetrics(SM_CYSCREEN);
    int posX = std::max(0, (screenW - width) / 2);
    int posY = std::max(0, (screenH - height) / 2);

    DWORD exStyle = WS_EX_APPWINDOW;
    if (is_topmost) {
        exStyle |= WS_EX_TOPMOST;
    }

    HWND dlgHwnd = CreateWindowExW(
        exStyle,
        L"Waterfall_Dialog_Class",
        title.c_str(),
        WS_OVERLAPPEDWINDOW,
        posX, posY, width, height,
        nullptr, // Standalone top-level window (do not drag main application window forward)
        nullptr, hInstance, nullptr
    );

    if (!dlgHwnd) {
        std::cerr << "[WebView2] Failed to create dialog window (" << type << ")" << std::endl;
        return nullptr;
    }

    if (hIconBig_) SendMessageW(dlgHwnd, WM_SETICON, ICON_BIG, (LPARAM)hIconBig_);
    if (hIconSmall_) SendMessageW(dlgHwnd, WM_SETICON, ICON_SMALL, (LPARAM)hIconSmall_);

    BOOL useDarkMode = TRUE;
    DwmSetWindowAttribute(dlgHwnd, 20 /* DWMWA_USE_IMMERSIVE_DARK_MODE */, &useDarkMode, sizeof(useDarkMode));

    ShowWindow(dlgHwnd, SW_SHOW);
    UpdateWindow(dlgHwnd);

    if (is_topmost) {
        SetWindowPos(dlgHwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
        SetForegroundWindow(dlgHwnd);
        BringWindowToTop(dlgHwnd);
    } else {
        SetForegroundWindow(dlgHwnd);
    }

    // Keep main application window from jumping over the user's active browser window (Chrome, Edge, etc.)
    if (type == "confirm" && !mainWasForeground && hwnd_ && IsWindow(hwnd_) && !IsIconic(hwnd_)) {
        if (prevFg && IsWindow(prevFg)) {
            SetWindowPos(hwnd_, prevFg, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
        } else {
            SetWindowPos(hwnd_, HWND_BOTTOM, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
        }
    }

    auto info = std::make_shared<DialogWindowInfo>();
    info->hwnd = dlgHwnd;
    info->url = full_url;
    info->type = type;
    info->task_id = task_id;
    info->is_topmost = is_topmost;
    info->is_preloaded = (type == "confirm");
    info->is_visible_requested = true;
    {
        std::lock_guard<std::recursive_mutex> lock(windows_mutex_);
        dialog_windows_.push_back(info);
    }

    if (!env_) {
        std::cerr << "[WebView2] Cannot create dialog webview: env_ is null" << std::endl;
        return dlgHwnd;
    }

    env_->CreateCoreWebView2Controller(
        dlgHwnd,
        Microsoft::WRL::Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
            [this, dlgHwnd, full_url, width, height, prevFg, mainWasForeground, is_topmost, type](HRESULT result, ICoreWebView2Controller* controller) -> HRESULT {
                if (FAILED(result) || !controller) {
                    std::cerr << "[WebView2] Failed to create dialog controller: hr=0x" << std::hex << result << std::endl;
                    return result;
                }

                std::shared_ptr<DialogWindowInfo> win_info = nullptr;
                {
                    std::lock_guard<std::recursive_mutex> lk(windows_mutex_);
                    for (auto& w : dialog_windows_) {
                        if (w->hwnd == dlgHwnd) {
                            win_info = w;
                            break;
                        }
                    }
                }

                if (!win_info) {
                    controller->Close();
                    return S_OK;
                }

                win_info->controller = controller;
                controller->get_CoreWebView2(&win_info->webview);

                Microsoft::WRL::ComPtr<ICoreWebView2Settings> settings;
                if (SUCCEEDED(win_info->webview->get_Settings(&settings)) && settings) {
                    settings->put_IsScriptEnabled(TRUE);
                    settings->put_AreDefaultScriptDialogsEnabled(TRUE);
                    settings->put_IsWebMessageEnabled(TRUE);
                    settings->put_AreDevToolsEnabled(TRUE);
                    settings->put_IsStatusBarEnabled(FALSE);
                }

                RECT bounds = {0, 0, width, height};
                GetClientRect(dlgHwnd, &bounds);
                if (bounds.right <= 0 || bounds.bottom <= 0) {
                    bounds.left = 0;
                    bounds.top = 0;
                    bounds.right = width;
                    bounds.bottom = height;
                }
                controller->put_Bounds(bounds);
                controller->put_IsVisible(TRUE);

                if (is_topmost) {
                    SetWindowPos(dlgHwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
                } else {
                    SetWindowPos(dlgHwnd, HWND_TOP, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
                }
                SetForegroundWindow(dlgHwnd);
                BringWindowToTop(dlgHwnd);

                if (type == "confirm" && !mainWasForeground && hwnd_ && IsWindow(hwnd_) && !IsIconic(hwnd_)) {
                    if (prevFg && IsWindow(prevFg)) {
                        SetWindowPos(hwnd_, prevFg, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
                    } else {
                        SetWindowPos(hwnd_, HWND_BOTTOM, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
                    }
                }

                // Inject bridge script
                win_info->webview->AddScriptToExecuteOnDocumentCreated(s_bridge_script, nullptr);

                // Handle window.close() from JS
                win_info->webview->add_WindowCloseRequested(
                    Microsoft::WRL::Callback<ICoreWebView2WindowCloseRequestedEventHandler>(
                        [dlgHwnd](ICoreWebView2* /*sender*/, IUnknown* /*args*/) -> HRESULT {
                            PostMessageW(dlgHwnd, WM_CLOSE, 0, 0);
                            return S_OK;
                        }).Get(), nullptr);

                // Handle window.open inside dialogs
                win_info->webview->add_NewWindowRequested(
                    Microsoft::WRL::Callback<ICoreWebView2NewWindowRequestedEventHandler>(
                        [this](ICoreWebView2* /*sender*/, ICoreWebView2NewWindowRequestedEventArgs* args) -> HRESULT {
                            LPWSTR uri_ws = nullptr;
                            args->get_Uri(&uri_ws);
                            if (uri_ws) {
                                std::wstring ws(uri_ws);
                                CoTaskMemFree(uri_ws);
                                std::string uri = WideToUtf8(ws);
                                args->put_Handled(TRUE);

                                if (uri.find("confirm.html") != std::string::npos) {
                                    OpenDialogWindow(uri, 680, 750, true, L"Waterfall — Download File Info", "confirm", 0);
                                } else if (uri.find("download-progress.html") != std::string::npos) {
                                    int taskId = 0;
                                    size_t tid = uri.find("taskId=");
                                    if (tid != std::string::npos) {
                                        taskId = std::atoi(uri.c_str() + tid + 7);
                                    }
                                    OpenDialogWindow(uri, 660, 600, false, L"Waterfall — Download Progress", "progress", taskId);
                                } else if (uri.find("welcome.html") != std::string::npos) {
                                    OpenDialogWindow(uri, 760, 660, true, L"Waterfall — Setup & Welcome Wizard", "welcome", 0);
                                } else {
                                    ShellExecuteW(nullptr, L"open", ws.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
                                }
                            }
                            return S_OK;
                        }).Get(), nullptr);

                std::wstring wurl = Utf8ToWide(full_url);
                win_info->webview->Navigate(wurl.c_str());

                std::cout << "[WebView2] Dialog window loaded: " << full_url << std::endl;
                return S_OK;
            }).Get());

    return dlgHwnd;
}

bool WebViewUiManager::SetWindowTopmost(HWND hwnd, bool topmost, bool bring_to_front) {
    if (main_thread_id_ != 0 && GetCurrentThreadId() != main_thread_id_ && hwnd_ && IsWindow(hwnd_)) {
        SetTopmostParams p{ hwnd, 0, "", topmost, bring_to_front };
        return SendMessageW(hwnd_, WM_WATERFALL_SET_TOPMOST, reinterpret_cast<WPARAM>(&p), 0) != 0;
    }
    return SetWindowTopmostInternal(hwnd, topmost, bring_to_front);
}

bool WebViewUiManager::SetWindowTopmostInternal(HWND hwnd, bool topmost, bool bring_to_front) {
    if (!hwnd || !IsWindow(hwnd)) return false;
    UINT flags = SWP_NOMOVE | SWP_NOSIZE | (bring_to_front ? SWP_SHOWWINDOW : 0);
    SetWindowPos(hwnd, topmost ? HWND_TOPMOST : HWND_NOTOPMOST, 0, 0, 0, 0, flags);
    if (bring_to_front) {
        SetForegroundWindow(hwnd);
        BringWindowToTop(hwnd);
    }

    std::lock_guard<std::recursive_mutex> lock(windows_mutex_);
    for (auto& win : dialog_windows_) {
        if (win->hwnd == hwnd) {
            win->is_topmost = topmost;
            break;
        }
    }
    return true;
}

bool WebViewUiManager::SetWindowTopmostByTaskId(int task_id, bool topmost, bool bring_to_front) {
    if (main_thread_id_ != 0 && GetCurrentThreadId() != main_thread_id_ && hwnd_ && IsWindow(hwnd_)) {
        SetTopmostParams p{ nullptr, task_id, "", topmost, bring_to_front };
        return SendMessageW(hwnd_, WM_WATERFALL_SET_TOPMOST, reinterpret_cast<WPARAM>(&p), 0) != 0;
    }
    return SetWindowTopmostByTaskIdInternal(task_id, topmost, bring_to_front);
}

bool WebViewUiManager::SetWindowTopmostByTaskIdInternal(int task_id, bool topmost, bool bring_to_front) {
    std::lock_guard<std::recursive_mutex> lock(windows_mutex_);
    for (auto& win : dialog_windows_) {
        if (win->task_id == task_id && win->hwnd && IsWindow(win->hwnd)) {
            UINT flags = SWP_NOMOVE | SWP_NOSIZE | (bring_to_front ? SWP_SHOWWINDOW : 0);
            SetWindowPos(win->hwnd, topmost ? HWND_TOPMOST : HWND_NOTOPMOST, 0, 0, 0, 0, flags);
            if (bring_to_front) {
                SetForegroundWindow(win->hwnd);
                BringWindowToTop(win->hwnd);
            }
            win->is_topmost = topmost;
            return true;
        }
    }
    return false;
}

bool WebViewUiManager::SetWindowTopmostByType(const std::string& type, bool topmost, bool bring_to_front) {
    if (main_thread_id_ != 0 && GetCurrentThreadId() != main_thread_id_ && hwnd_ && IsWindow(hwnd_)) {
        SetTopmostParams p{ nullptr, 0, type, topmost, bring_to_front };
        return SendMessageW(hwnd_, WM_WATERFALL_SET_TOPMOST, reinterpret_cast<WPARAM>(&p), 0) != 0;
    }
    return SetWindowTopmostByTypeInternal(type, topmost, bring_to_front);
}

bool WebViewUiManager::SetWindowTopmostByTypeInternal(const std::string& type, bool topmost, bool bring_to_front) {
    std::lock_guard<std::recursive_mutex> lock(windows_mutex_);
    for (auto& win : dialog_windows_) {
        if (win->type == type && win->hwnd && IsWindow(win->hwnd)) {
            UINT flags = SWP_NOMOVE | SWP_NOSIZE | (bring_to_front ? SWP_SHOWWINDOW : 0);
            SetWindowPos(win->hwnd, topmost ? HWND_TOPMOST : HWND_NOTOPMOST, 0, 0, 0, 0, flags);
            if (bring_to_front) {
                SetForegroundWindow(win->hwnd);
                BringWindowToTop(win->hwnd);
            }
            win->is_topmost = topmost;
            return true;
        }
    }
    return false;
}

void WebViewUiManager::CloseDialogWindow(HWND hwnd) {
    if (hwnd && IsWindow(hwnd)) {
        PostMessageW(hwnd, WM_CLOSE, 0, 0);
    }
}

bool WebViewUiManager::CloseDialogWindowByType(const std::string& type, int task_id) {
    std::lock_guard<std::recursive_mutex> lock(windows_mutex_);
    bool closed = false;
    for (auto& win : dialog_windows_) {
        if (!win || !win->hwnd || !IsWindow(win->hwnd)) continue;
        if (task_id > 0 && win->task_id == task_id) {
            PostMessageW(win->hwnd, WM_CLOSE, 0, 0);
            closed = true;
        } else if (!type.empty() && win->type == type) {
            PostMessageW(win->hwnd, WM_CLOSE, 0, 0);
            closed = true;
        } else if (type.empty() && task_id == 0) {
            PostMessageW(win->hwnd, WM_CLOSE, 0, 0);
            closed = true;
        }
    }
    return closed;
}

void WebViewUiManager::Run() {
    MSG msg;
    while (GetMessageW(&msg, nullptr, 0, 0)) {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }
}

void WebViewUiManager::MinimizeToTray() {
    core::ShellIntegration::Instance().MinimizeToTray();
}

void WebViewUiManager::ExitApp() {
    if (hwnd_ && IsWindow(hwnd_)) {
        DestroyWindow(hwnd_);
    } else {
        PostQuitMessage(0);
    }
}

void WebViewUiManager::ShowQuitOptions() {
    if (main_webview_) {
        main_webview_->ExecuteScript(L"if (typeof window.showQuitOptionsModal === 'function') window.showQuitOptionsModal();", nullptr);
    }
}

void WebViewUiManager::Shutdown() {
    if (is_running_) {
        is_running_ = false;

        // Close all dialog windows
        {
            std::lock_guard<std::recursive_mutex> lock(windows_mutex_);
            for (auto& win : dialog_windows_) {
                if (win->controller) {
                    win->controller->Close();
                    win->controller = nullptr;
                }
                if (win->hwnd && IsWindow(win->hwnd)) {
                    DestroyWindow(win->hwnd);
                }
            }
            dialog_windows_.clear();
        }

        if (main_controller_) {
            main_controller_->Close();
            main_controller_ = nullptr;
        }
        main_webview_ = nullptr;
        env_ = nullptr;

        if (hwnd_) {
            DestroyWindow(hwnd_);
            hwnd_ = nullptr;
        }
        CoUninitialize();
    }
}

} // namespace waterfall::ui
