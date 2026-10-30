#pragma once

#include <windows.h>
#include <string>
#include <vector>
#include <memory>
#include <mutex>
#include <wrl/client.h>
#include "WebView2.h"

namespace waterfall::ui {

struct DialogWindowInfo {
    HWND hwnd = nullptr;
    Microsoft::WRL::ComPtr<ICoreWebView2Controller> controller;
    Microsoft::WRL::ComPtr<ICoreWebView2> webview;
    std::string url;
    std::string type; // "confirm", "progress", etc.
    int task_id = 0;
    bool is_topmost = false;
    bool is_preloaded = false;
    bool is_visible_requested = false;
};

class WebViewUiManager {
public:
    static WebViewUiManager& Instance();

    bool Initialize(int width, int height, const std::string& start_url = "http://127.0.0.1:4567/");
    void Run();
    void Shutdown();

    // Native Dialog Window Management
    HWND OpenDialogWindow(const std::string& url, int width, int height, bool is_topmost,
                          const std::wstring& title, const std::string& type = "", int task_id = 0);
    HWND OpenDialogWindowInternal(const std::string& url, int width, int height, bool is_topmost,
                                  const std::wstring& title, const std::string& type = "", int task_id = 0);
    bool SetWindowTopmost(HWND hwnd, bool topmost, bool bring_to_front = true);
    bool SetWindowTopmostInternal(HWND hwnd, bool topmost, bool bring_to_front = true);
    bool SetWindowTopmostByTaskId(int task_id, bool topmost, bool bring_to_front = true);
    bool SetWindowTopmostByTaskIdInternal(int task_id, bool topmost, bool bring_to_front = true);
    bool SetWindowTopmostByType(const std::string& type, bool topmost, bool bring_to_front = true);
    bool SetWindowTopmostByTypeInternal(const std::string& type, bool topmost, bool bring_to_front = true);
    void CloseDialogWindow(HWND hwnd);
    bool CloseDialogWindowByType(const std::string& type, int task_id = 0);

    // Warm Standby Preloading (instant snappy dialogs in RAM)
    void PreloadConfirmDialog();

    // Tray & Application Lifecycle
    void MinimizeToTray();
    void ExitApp();
    void ShowQuitOptions();

    HWND GetHwnd() const { return hwnd_; }

private:
    WebViewUiManager() = default;
    ~WebViewUiManager() = default;

    static LRESULT CALLBACK WndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam);
    static LRESULT CALLBACK DialogWndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam);

    HWND hwnd_ = nullptr;
    HICON hIconBig_ = nullptr;
    HICON hIconSmall_ = nullptr;
    bool is_running_ = false;
    DWORD main_thread_id_ = 0;

    Microsoft::WRL::ComPtr<ICoreWebView2Environment> env_;
    Microsoft::WRL::ComPtr<ICoreWebView2Controller> main_controller_;
    Microsoft::WRL::ComPtr<ICoreWebView2> main_webview_;

    std::recursive_mutex windows_mutex_;
    std::vector<std::shared_ptr<DialogWindowInfo>> dialog_windows_;
};

} // namespace waterfall::ui
