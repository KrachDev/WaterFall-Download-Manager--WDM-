#include "waterfall/core/ShellIntegration.hpp"
#include <shellapi.h>
#include <shlobj.h>
#include <iostream>

#pragma comment(lib, "powrprof.lib")

extern "C" {
    typedef BOOLEAN (WINAPI *SetSuspendStateFunc)(BOOLEAN, BOOLEAN, BOOLEAN);
}

namespace waterfall::core {

static std::wstring ToWide(const std::string& str) {
    if (str.empty()) return L"";
    int size = MultiByteToWideChar(CP_UTF8, 0, str.c_str(), -1, nullptr, 0);
    std::wstring result(size - 1, 0);
    MultiByteToWideChar(CP_UTF8, 0, str.c_str(), -1, &result[0], size);
    return result;
}

ShellIntegration& ShellIntegration::Instance() {
    static ShellIntegration instance;
    return instance;
}

ShellIntegration::ShellIntegration() = default;

ShellIntegration::~ShellIntegration() {
    if (tray_initialized_) {
        Shell_NotifyIconW(NIM_DELETE, &nid_);
        tray_initialized_ = false;
    }
}

void ShellIntegration::Initialize(HWND hwnd) {
    hwnd_ = hwnd;
    ZeroMemory(&nid_, sizeof(nid_));
    nid_.cbSize = sizeof(NOTIFYICONDATAW);
    nid_.hWnd = hwnd_;
    nid_.uID = 1001;
    nid_.uFlags = NIF_ICON | NIF_TIP | NIF_INFO;
    nid_.hIcon = LoadIcon(nullptr, IDI_APPLICATION);
    wcscpy_s(nid_.szTip, L"Waterfall Download Accelerator");

    if (Shell_NotifyIconW(NIM_ADD, &nid_)) {
        nid_.uVersion = NOTIFYICON_VERSION_4;
        Shell_NotifyIconW(NIM_SETVERSION, &nid_);
        tray_initialized_ = true;
    }
}

void ShellIntegration::ShowNotification(const std::string& title, const std::string& message) {
    if (!tray_initialized_) {
        Initialize(nullptr);
    }

    std::wstring wtitle = ToWide(title);
    std::wstring wmsg = ToWide(message);

    wcsncpy_s(nid_.szInfoTitle, wtitle.c_str(), _TRUNCATE);
    wcsncpy_s(nid_.szInfo, wmsg.c_str(), _TRUNCATE);
    nid_.dwInfoFlags = NIIF_INFO;

    Shell_NotifyIconW(NIM_MODIFY, &nid_);
}

void ShellIntegration::TriggerPowerAction(const std::string& action) {
    if (action == "sleep") {
        std::cout << "[Shell] Putting system to sleep..." << std::endl;
        HMODULE hPowrprof = LoadLibraryA("powrprof.dll");
        if (hPowrprof) {
            auto set_suspend = reinterpret_cast<SetSuspendStateFunc>(GetProcAddress(hPowrprof, "SetSuspendState"));
            if (set_suspend) {
                set_suspend(FALSE, FALSE, FALSE);
            }
            FreeLibrary(hPowrprof);
        }
    } else if (action == "shutdown") {
        std::cout << "[Shell] Initiating system shutdown..." << std::endl;
        HANDLE hToken;
        TOKEN_PRIVILEGES tkp;
        if (OpenProcessToken(GetCurrentProcess(), TOKEN_ADJUST_PRIVILEGES | TOKEN_QUERY, &hToken)) {
            LookupPrivilegeValue(nullptr, SE_SHUTDOWN_NAME, &tkp.Privileges[0].Luid);
            tkp.PrivilegeCount = 1;
            tkp.Privileges[0].Attributes = SE_PRIVILEGE_ENABLED;
            AdjustTokenPrivileges(hToken, FALSE, &tkp, 0, nullptr, 0);
            CloseHandle(hToken);
        }

        wchar_t shutdown_msg[] = L"Waterfall has completed the download queue.";
        InitiateSystemShutdownExW(nullptr, shutdown_msg, 60, FALSE, FALSE,
                                  SHTDN_REASON_MAJOR_APPLICATION | SHTDN_REASON_MINOR_MAINTENANCE);
    }
}

void ShellIntegration::OpenFolderAndSelect(const std::string& file_path) {
    std::string param = "/select,\"" + file_path + "\"";
    ShellExecuteA(nullptr, "open", "explorer.exe", param.c_str(), nullptr, SW_SHOW);
}

} // namespace waterfall::core
