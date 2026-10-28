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
    if (taskbar_) {
        taskbar_->Release();
        taskbar_ = nullptr;
    }
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
    nid_.uFlags = NIF_ICON | NIF_TIP | NIF_INFO | NIF_MESSAGE;
    nid_.uCallbackMessage = WM_APP + 100;
    HICON hTrayIcon = (HICON)LoadImageW(GetModuleHandle(nullptr), MAKEINTRESOURCEW(101), IMAGE_ICON, GetSystemMetrics(SM_CXSMICON), GetSystemMetrics(SM_CYSMICON), LR_DEFAULTCOLOR);
    if (!hTrayIcon) {
        WCHAR exePath[MAX_PATH];
        GetModuleFileNameW(nullptr, exePath, MAX_PATH);
        std::wstring exeDir = exePath;
        size_t lastSlash = exeDir.find_last_of(L"\\/");
        if (lastSlash != std::wstring::npos) exeDir = exeDir.substr(0, lastSlash);
        std::wstring iconPath = exeDir + L"\\assets\\icon.ico";
        hTrayIcon = (HICON)LoadImageW(nullptr, iconPath.c_str(), IMAGE_ICON, GetSystemMetrics(SM_CXSMICON), GetSystemMetrics(SM_CYSMICON), LR_LOADFROMFILE);
        if (!hTrayIcon) {
            hTrayIcon = (HICON)LoadImageW(nullptr, L"assets\\icon.ico", IMAGE_ICON, GetSystemMetrics(SM_CXSMICON), GetSystemMetrics(SM_CYSMICON), LR_LOADFROMFILE);
        }
    }
    if (!hTrayIcon) {
        hTrayIcon = LoadIconW(nullptr, (LPCWSTR)IDI_APPLICATION);
    }
    nid_.hIcon = hTrayIcon;
    wcscpy_s(nid_.szTip, L"Waterfall Download Accelerator");

    if (Shell_NotifyIconW(NIM_ADD, &nid_)) {
        nid_.uVersion = NOTIFYICON_VERSION_4;
        Shell_NotifyIconW(NIM_SETVERSION, &nid_);
        tray_initialized_ = true;
    }

    if (!taskbar_) {
        CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE);
        if (SUCCEEDED(CoCreateInstance(CLSID_TaskbarList, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&taskbar_)))) {
            taskbar_->HrInit();
        }
    }
}

void ShellIntegration::SetTaskbarProgress(uint64_t completed, uint64_t total, TaskbarProgressState state) {
    if (!taskbar_ || !hwnd_) return;

    TBPFLAG flag = TBPF_NOPROGRESS;
    switch (state) {
        case TaskbarProgressState::Normal: flag = TBPF_NORMAL; break;
        case TaskbarProgressState::Paused: flag = TBPF_PAUSED; break;
        case TaskbarProgressState::Error: flag = TBPF_ERROR; break;
        case TaskbarProgressState::Indeterminate: flag = TBPF_INDETERMINATE; break;
        default: flag = TBPF_NOPROGRESS; break;
    }

    taskbar_->SetProgressState(hwnd_, flag);
    if (flag == TBPF_NORMAL || flag == TBPF_PAUSED) {
        taskbar_->SetProgressValue(hwnd_, completed, total > 0 ? total : 1);
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

void ShellIntegration::MinimizeToTray() {
    if (hwnd_ && IsWindow(hwnd_)) {
        ShowWindow(hwnd_, SW_HIDE);
        ShowNotification(
            "Waterfall Download Accelerator",
            "Waterfall is running in your system tray. Double-click the tray icon to restore."
        );
    }
}

void ShellIntegration::RestoreFromTray() {
    if (hwnd_ && IsWindow(hwnd_)) {
        ShowWindow(hwnd_, SW_RESTORE);
        SetForegroundWindow(hwnd_);
        BringWindowToTop(hwnd_);
    }
}

bool ShellIntegration::IsStartWithWindows() {
    HKEY hKey;
    if (RegOpenKeyExW(HKEY_CURRENT_USER, L"Software\\Microsoft\\Windows\\CurrentVersion\\Run", 0, KEY_READ, &hKey) == ERROR_SUCCESS) {
        WCHAR path[MAX_PATH];
        DWORD path_len = sizeof(path);
        DWORD type = 0;
        LONG res = RegQueryValueExW(hKey, L"WaterfallAccelerator", nullptr, &type, reinterpret_cast<LPBYTE>(path), &path_len);
        RegCloseKey(hKey);
        return res == ERROR_SUCCESS;
    }
    return false;
}

bool ShellIntegration::SetStartWithWindows(bool enable) {
    HKEY hKey;
    if (RegOpenKeyExW(HKEY_CURRENT_USER, L"Software\\Microsoft\\Windows\\CurrentVersion\\Run", 0, KEY_SET_VALUE, &hKey) == ERROR_SUCCESS) {
        if (enable) {
            WCHAR exePath[MAX_PATH];
            GetModuleFileNameW(nullptr, exePath, MAX_PATH);
            std::wstring cmd = L"\"" + std::wstring(exePath) + L"\" --minimized";
            RegSetValueExW(hKey, L"WaterfallAccelerator", 0, REG_SZ, reinterpret_cast<const BYTE*>(cmd.c_str()), static_cast<DWORD>((cmd.length() + 1) * sizeof(wchar_t)));
        } else {
            RegDeleteValueW(hKey, L"WaterfallAccelerator");
        }
        RegCloseKey(hKey);
        return true;
    }
    return false;
}

} // namespace waterfall::core
