#include <windows.h>
#include <shlobj.h>
#include <string>
#include <vector>
#include <filesystem>
#include <iostream>
#include <dwmapi.h>

namespace fs = std::filesystem;

static void KillWaterfallProcesses() {
    system("taskkill /f /im waterfall.exe 2>nul");
    system("taskkill /f /im Waterfall.exe 2>nul");
}

static void DeleteShortcut(int csidl, const std::wstring& filename) {
    WCHAR path[MAX_PATH];
    if (SUCCEEDED(SHGetFolderPathW(nullptr, csidl, nullptr, 0, path))) {
        fs::path p = fs::path(path) / filename;
        std::error_code ec;
        if (fs::exists(p)) {
            fs::remove(p, ec);
        }
    }
}

int WINAPI wWinMain(HINSTANCE hInstance, HINSTANCE hPrevInstance, LPWSTR lpCmdLine, int nCmdShow) {
    UNREFERENCED_PARAMETER(hInstance);
    UNREFERENCED_PARAMETER(hPrevInstance);
    UNREFERENCED_PARAMETER(lpCmdLine);
    UNREFERENCED_PARAMETER(nCmdShow);

    // 1. Confirm Uninstall
    int confirm = MessageBoxW(
        nullptr,
        L"Are you sure you want to completely remove Waterfall Download Accelerator and all of its components?",
        L"Waterfall Uninstall",
        MB_YESNO | MB_ICONQUESTION | MB_DEFBUTTON2
    );

    if (confirm != IDYES) {
        return 0;
    }

    // 2. Kill running instances
    KillWaterfallProcesses();

    // 3. Remove Desktop & Start Menu Shortcuts
    DeleteShortcut(CSIDL_DESKTOPDIRECTORY, L"Waterfall Accelerator.lnk");
    DeleteShortcut(CSIDL_PROGRAMS, L"Waterfall Accelerator.lnk");

    // Remove Start Menu Program Group Folder
    WCHAR progPath[MAX_PATH];
    if (SUCCEEDED(SHGetFolderPathW(nullptr, CSIDL_PROGRAMS, nullptr, 0, progPath))) {
        fs::path groupFolder = fs::path(progPath) / "Waterfall";
        std::error_code ec;
        fs::remove_all(groupFolder, ec);
    }
    SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, NULL, NULL);

    // 4. Remove Windows Registry Uninstall Entry
    HKEY hKeyUninstall;
    if (RegOpenKeyExW(HKEY_CURRENT_USER, L"Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall", 0, KEY_WRITE, &hKeyUninstall) == ERROR_SUCCESS) {
        RegDeleteKeyW(hKeyUninstall, L"WaterfallAccelerator");
        RegCloseKey(hKeyUninstall);
    }

    // Remove autostart entry if present
    HKEY hKeyRun;
    if (RegOpenKeyExW(HKEY_CURRENT_USER, L"Software\\Microsoft\\Windows\\CurrentVersion\\Run", 0, KEY_SET_VALUE, &hKeyRun) == ERROR_SUCCESS) {
        RegDeleteValueW(hKeyRun, L"WaterfallAccelerator");
        RegCloseKey(hKeyRun);
    }

    // 5. Get current installation folder
    WCHAR exePath[MAX_PATH];
    GetModuleFileNameW(nullptr, exePath, MAX_PATH);
    fs::path installDir = fs::path(exePath).parent_path();

    // Safety guard: Never delete source repo, dist folder, or drive root
    if (installDir.filename() == "dist" || 
        fs::exists(installDir / ".git") || 
        fs::exists(installDir / "CMakeLists.txt") ||
        fs::exists(installDir / "src" / "main.cpp") ||
        installDir == installDir.root_path()) {
        MessageBoxW(nullptr, L"Uninstaller cannot be executed inside the build or repository directory.", L"Waterfall Uninstall", MB_OK | MB_ICONERROR);
        return 1;
    }

    // 6. Delete directory via detached self-deleting script
    WCHAR tempPath[MAX_PATH];
    GetTempPathW(MAX_PATH, tempPath);
    fs::path batPath = fs::path(tempPath) / "waterfall_uninstall.bat";

    std::wstring batCmd = 
        L"@echo off\r\n"
        L"timeout /t 1 /nobreak >nul\r\n"
        L"rd /s /q \"" + installDir.wstring() + L"\"\r\n"
        L"del \"%~f0\"\r\n";

    HANDLE hFile = CreateFileW(batPath.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (hFile != INVALID_HANDLE_VALUE) {
        DWORD written = 0;
        int len = WideCharToMultiByte(CP_UTF8, 0, batCmd.c_str(), -1, nullptr, 0, nullptr, nullptr);
        if (len > 0) {
            std::vector<char> utf8(len);
            WideCharToMultiByte(CP_UTF8, 0, batCmd.c_str(), -1, utf8.data(), len, nullptr, nullptr);
            WriteFile(hFile, utf8.data(), static_cast<DWORD>(len - 1), &written, nullptr);
        }
        CloseHandle(hFile);

        // Spawn detached cleaner
        STARTUPINFOW si = { sizeof(si) };
        si.dwFlags = STARTF_USESHOWWINDOW;
        si.wShowWindow = SW_HIDE;
        PROCESS_INFORMATION pi = {0};

        std::wstring cmdLine = L"cmd.exe /c \"" + batPath.wstring() + L"\"";
        std::vector<wchar_t> cmdBuf(cmdLine.begin(), cmdLine.end());
        cmdBuf.push_back(L'\0');

        CreateProcessW(nullptr, cmdBuf.data(), nullptr, nullptr, FALSE, CREATE_NEW_CONSOLE, nullptr, nullptr, &si, &pi);
        if (pi.hProcess) CloseHandle(pi.hProcess);
        if (pi.hThread) CloseHandle(pi.hThread);
    }

    MessageBoxW(
        nullptr,
        L"Waterfall Download Accelerator was successfully removed from your computer.",
        L"Waterfall Uninstall",
        MB_OK | MB_ICONINFORMATION
    );

    return 0;
}
