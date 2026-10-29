#define NOMINMAX
#include <windows.h>
#include <commctrl.h>
#include <shlobj.h>
#include <shobjidl.h>
#include <string>
#include <vector>
#include <filesystem>
#include <thread>
#include <atomic>
#include <dwmapi.h>

#pragma comment(lib, "comctl32.lib")
#pragma comment(lib, "dwmapi.lib")
#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "shell32.lib")
#pragma comment(lib, "user32.lib")
#pragma comment(lib, "gdi32.lib")

namespace fs = std::filesystem;

#define IDI_APP_ICON        101
#define IDR_PAYLOAD_ZIP     200

#define IDC_BTN_INSTALL     1001
#define IDC_BTN_CANCEL      1002
#define IDC_BTN_BROWSE      1003
#define IDC_EDIT_PATH       1004
#define IDC_CHK_DESKTOP     1005
#define IDC_CHK_STARTMENU   1006
#define IDC_CHK_LAUNCH      1007
#define IDC_PROGRESS        1008
#define IDC_STATUS_LABEL    1009
#define IDC_CHK_EXT_GUIDE   1010
#define IDC_BTN_OPEN_EXT    1011

static HWND g_hPathEdit = nullptr;
static HWND g_hChkDesktop = nullptr;
static HWND g_hChkStartMenu = nullptr;
static HWND g_hChkLaunch = nullptr;
static HWND g_hChkExtGuide = nullptr;
static HWND g_hProgressBar = nullptr;
static HWND g_hStatusLabel = nullptr;
static HWND g_hBtnInstall = nullptr;
static HWND g_hBtnCancel = nullptr;
static HWND g_hBtnBrowse = nullptr;
static HWND g_hBtnOpenExt = nullptr;

static std::wstring g_installDir;
static std::atomic<bool> g_isInstalling{false};
static std::atomic<bool> g_isFinished{false};

static HRESULT CreateShortcut(const std::wstring& targetPath, const std::wstring& shortcutPath, const std::wstring& description, const std::wstring& iconPath, const std::wstring& workingDir = L"") {
    IShellLinkW* psl = nullptr;
    HRESULT hr = CoCreateInstance(CLSID_ShellLink, nullptr, CLSCTX_INPROC_SERVER, IID_IShellLinkW, (LPVOID*)&psl);
    if (SUCCEEDED(hr)) {
        psl->SetPath(targetPath.c_str());
        psl->SetDescription(description.c_str());
        if (!workingDir.empty()) {
            psl->SetWorkingDirectory(workingDir.c_str());
        } else {
            std::wstring dir = fs::path(targetPath).parent_path().wstring();
            psl->SetWorkingDirectory(dir.c_str());
        }
        if (!iconPath.empty()) {
            psl->SetIconLocation(iconPath.c_str(), 0);
        }
        IPersistFile* ppf = nullptr;
        hr = psl->QueryInterface(IID_IPersistFile, (LPVOID*)&ppf);
        if (SUCCEEDED(hr)) {
            fs::path p(shortcutPath);
            std::error_code ec;
            fs::create_directories(p.parent_path(), ec);
            hr = ppf->Save(shortcutPath.c_str(), TRUE);
            ppf->Release();
        }
        psl->Release();
    }
    return hr;
}

static void RegisterUninstall(const std::wstring& installDir, const std::wstring& version) {
    HKEY hKey;
    std::wstring subkey = L"Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\WaterfallAccelerator";
    if (RegCreateKeyExW(HKEY_CURRENT_USER, subkey.c_str(), 0, nullptr, REG_OPTION_NON_VOLATILE, KEY_WRITE, nullptr, &hKey, nullptr) == ERROR_SUCCESS) {
        std::wstring displayName = L"Waterfall Download Accelerator";
        std::wstring publisher = L"KrachDev";
        std::wstring exePath = installDir + L"\\Waterfall.exe";
        std::wstring uninstallPath = installDir + L"\\Uninstall.exe";
        std::wstring iconPath = exePath + L",0";
        std::wstring url = L"https://github.com/KrachDev/WaterFall-Download-Manager--WDM-";

        auto set_val = [&](const wchar_t* name, const std::wstring& val) {
            RegSetValueExW(hKey, name, 0, REG_SZ, reinterpret_cast<const BYTE*>(val.c_str()), static_cast<DWORD>((val.length() + 1) * sizeof(wchar_t)));
        };

        set_val(L"DisplayName", displayName);
        set_val(L"DisplayVersion", version);
        set_val(L"Publisher", publisher);
        set_val(L"DisplayIcon", iconPath);
        set_val(L"InstallLocation", installDir);
        set_val(L"UninstallString", L"\"" + uninstallPath + L"\"");
        set_val(L"URLInfoAbout", url);
        set_val(L"HelpLink", url);

        DWORD noModify = 1;
        DWORD noRepair = 1;
        DWORD estSize = 250000; // ~250 MB
        RegSetValueExW(hKey, L"NoModify", 0, REG_DWORD, reinterpret_cast<const BYTE*>(&noModify), sizeof(DWORD));
        RegSetValueExW(hKey, L"NoRepair", 0, REG_DWORD, reinterpret_cast<const BYTE*>(&noRepair), sizeof(DWORD));
        RegSetValueExW(hKey, L"EstimatedSize", 0, REG_DWORD, reinterpret_cast<const BYTE*>(&estSize), sizeof(DWORD));

        RegCloseKey(hKey);
    }
}

static bool ExtractPayloadTo(const std::wstring& targetDir, HWND hwnd) {
    // 1. Locate Payload: either embedded RCDATA resource or adjacent zip file
    std::wstring zipPath;
    bool isTempZip = false;

    SetWindowTextW(g_hStatusLabel, L"Preparing setup payload...");
    SendMessageW(g_hProgressBar, PBM_SETPOS, 10, 0);

    HRSRC hRes = FindResourceW(nullptr, MAKEINTRESOURCEW(IDR_PAYLOAD_ZIP), MAKEINTRESOURCEW(10) /* RT_RCDATA */);
    if (hRes) {
        HGLOBAL hData = LoadResource(nullptr, hRes);
        DWORD size = SizeofResource(nullptr, hRes);
        void* pData = LockResource(hData);

        if (pData && size > 0) {
            WCHAR tempPath[MAX_PATH];
            GetTempPathW(MAX_PATH, tempPath);
            fs::path tempZip = fs::path(tempPath) / "waterfall_setup_payload.zip";
            HANDLE hFile = CreateFileW(tempZip.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
            if (hFile != INVALID_HANDLE_VALUE) {
                // Write payload in 4MB chunks
                const BYTE* pByte = reinterpret_cast<const BYTE*>(pData);
                DWORD remaining = size;
                const DWORD chunkSize = 4 * 1024 * 1024;
                while (remaining > 0) {
                    DWORD toWrite = std::min(remaining, chunkSize);
                    DWORD written = 0;
                    WriteFile(hFile, pByte, toWrite, &written, nullptr);
                    pByte += toWrite;
                    remaining -= toWrite;
                }
                CloseHandle(hFile);
                zipPath = tempZip.wstring();
                isTempZip = true;
            }
        }
    }

    if (zipPath.empty()) {
        // Fallback: search adjacent directory for Waterfall-*.zip
        WCHAR exeBuf[MAX_PATH];
        GetModuleFileNameW(nullptr, exeBuf, MAX_PATH);
        fs::path exeDir = fs::path(exeBuf).parent_path();
        for (const auto& entry : fs::directory_iterator(exeDir)) {
            if (entry.is_regular_file() && entry.path().extension() == ".zip" && entry.path().filename().string().find("Waterfall") == 0) {
                zipPath = entry.path().wstring();
                break;
            }
        }
    }

    if (zipPath.empty()) {
        SetWindowTextW(g_hStatusLabel, L"Error: Installation payload archive not found.");
        return false;
    }

    // 2. Ensure target directory exists
    std::error_code ec;
    fs::create_directories(targetDir, ec);

    // 3. Extract Archive: Use fast native tar.exe if available (Windows 10/11), otherwise Expand-Archive
    SetWindowTextW(g_hStatusLabel, L"Extracting Waterfall application files...");
    SendMessageW(g_hProgressBar, PBM_SETPOS, 35, 0);

    bool extractionOk = false;
    fs::path systemTar = L"C:\\Windows\\System32\\tar.exe";
    if (fs::exists(systemTar)) {
        // Fast extraction via tar.exe (~1-2 seconds)
        std::wstring tarCmd = L"\"" + systemTar.wstring() + L"\" -xf \"" + zipPath + L"\" -C \"" + targetDir + L"\"";
        STARTUPINFOW si = { sizeof(si) };
        si.dwFlags = STARTF_USESHOWWINDOW;
        si.wShowWindow = SW_HIDE;
        PROCESS_INFORMATION pi = {0};

        std::vector<wchar_t> cmdBuf(tarCmd.begin(), tarCmd.end());
        cmdBuf.push_back(L'\0');

        if (CreateProcessW(nullptr, cmdBuf.data(), nullptr, nullptr, FALSE, CREATE_NO_WINDOW, nullptr, nullptr, &si, &pi)) {
            WaitForSingleObject(pi.hProcess, 60000);
            DWORD exitCode = 0;
            GetExitCodeProcess(pi.hProcess, &exitCode);
            CloseHandle(pi.hProcess);
            CloseHandle(pi.hThread);
            if (exitCode == 0) {
                extractionOk = true;
            }
        }
    }

    if (!extractionOk) {
        // Fallback via PowerShell Expand-Archive
        std::wstring psCmd = L"powershell.exe -NoProfile -ExecutionPolicy Bypass -Command \"Expand-Archive -Path '" + 
                             zipPath + L"' -DestinationPath '" + targetDir + L"' -Force\"";

        STARTUPINFOW si = { sizeof(si) };
        si.dwFlags = STARTF_USESHOWWINDOW;
        si.wShowWindow = SW_HIDE;
        PROCESS_INFORMATION pi = {0};

        std::vector<wchar_t> cmdBuf(psCmd.begin(), psCmd.end());
        cmdBuf.push_back(L'\0');

        if (CreateProcessW(nullptr, cmdBuf.data(), nullptr, nullptr, FALSE, CREATE_NO_WINDOW, nullptr, nullptr, &si, &pi)) {
            WaitForSingleObject(pi.hProcess, 180000);
            CloseHandle(pi.hProcess);
            CloseHandle(pi.hThread);
            extractionOk = true;
        }
    }

    if (isTempZip) {
        fs::remove(zipPath, ec);
    }

    SendMessageW(g_hProgressBar, PBM_SETPOS, 75, 0);
    SetWindowTextW(g_hStatusLabel, L"Configuring shortcuts and shell integration...");

    // 4. Ensure Waterfall.exe is in target root directory (flatten subfolder if zipped with a top-level dir)
    fs::path mainExe = fs::path(targetDir) / "Waterfall.exe";
    if (!fs::exists(mainExe)) {
        for (const auto& entry : fs::directory_iterator(targetDir)) {
            if (entry.is_directory()) {
                fs::path candidate = entry.path() / "Waterfall.exe";
                if (fs::exists(candidate)) {
                    for (const auto& sub : fs::directory_iterator(entry.path())) {
                        fs::copy(sub.path(), fs::path(targetDir) / sub.path().filename(), fs::copy_options::recursive | fs::copy_options::overwrite_existing, ec);
                    }
                    fs::remove_all(entry.path(), ec);
                    break;
                }
            }
        }
    }

    // Copy Uninstall.exe adjacent if installer has it
    WCHAR exeBuf[MAX_PATH];
    GetModuleFileNameW(nullptr, exeBuf, MAX_PATH);
    fs::path uninstallerSource = fs::path(exeBuf).parent_path() / "Uninstall.exe";
    if (fs::exists(uninstallerSource) && !fs::exists(fs::path(targetDir) / "Uninstall.exe")) {
        fs::copy_file(uninstallerSource, fs::path(targetDir) / "Uninstall.exe", fs::copy_options::overwrite_existing, ec);
    }

    // 5. Create Desktop & Start Menu Shortcuts with Working Directory & Icons
    std::wstring exeFullPath = (fs::path(targetDir) / "Waterfall.exe").wstring();
    std::wstring guideHtmlPath = (fs::path(targetDir) / "frontend" / "extension-guide.html").wstring();
    std::wstring uninstallerFullPath = (fs::path(targetDir) / "Uninstall.exe").wstring();

    if (SendMessageW(g_hChkDesktop, BM_GETCHECK, 0, 0) == BST_CHECKED) {
        WCHAR desktopPath[MAX_PATH];
        if (SUCCEEDED(SHGetFolderPathW(nullptr, CSIDL_DESKTOPDIRECTORY, nullptr, 0, desktopPath))) {
            fs::path lnk = fs::path(desktopPath) / "Waterfall Accelerator.lnk";
            CreateShortcut(exeFullPath, lnk.wstring(), L"Waterfall High-Speed Download Accelerator", exeFullPath, targetDir);
        }
    }

    if (SendMessageW(g_hChkStartMenu, BM_GETCHECK, 0, 0) == BST_CHECKED) {
        WCHAR startMenuPath[MAX_PATH];
        if (SUCCEEDED(SHGetFolderPathW(nullptr, CSIDL_PROGRAMS, nullptr, 0, startMenuPath))) {
            // Main shortcut directly in Programs
            fs::path lnkRoot = fs::path(startMenuPath) / "Waterfall Accelerator.lnk";
            CreateShortcut(exeFullPath, lnkRoot.wstring(), L"Waterfall High-Speed Download Accelerator", exeFullPath, targetDir);

            // Program Group Folder: Start Menu\Programs\Waterfall
            fs::path groupFolder = fs::path(startMenuPath) / "Waterfall";
            fs::create_directories(groupFolder, ec);

            fs::path lnkApp = groupFolder / "Waterfall Accelerator.lnk";
            CreateShortcut(exeFullPath, lnkApp.wstring(), L"Waterfall High-Speed Download Accelerator", exeFullPath, targetDir);

            if (fs::exists(guideHtmlPath)) {
                fs::path lnkGuide = groupFolder / "Companion Extension Guide.lnk";
                CreateShortcut(guideHtmlPath, lnkGuide.wstring(), L"Waterfall Browser Companion Extension Guide", exeFullPath, targetDir);
            }

            if (fs::exists(uninstallerFullPath)) {
                fs::path lnkUninst = groupFolder / "Uninstall Waterfall.lnk";
                CreateShortcut(uninstallerFullPath, lnkUninst.wstring(), L"Uninstall Waterfall Download Accelerator", uninstallerFullPath, targetDir);
            }
        }
    }

    // Refresh Windows Shell Icons
    SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, NULL, NULL);

    // 6. Register Windows Uninstall entry
    RegisterUninstall(targetDir, L"2.0.1");

    SendMessageW(g_hProgressBar, PBM_SETPOS, 100, 0);

    fs::path extDir = fs::path(targetDir) / "extension";
    std::wstring finishMsg = L"Installation complete! Extension ready in: " + extDir.wstring();
    SetWindowTextW(g_hStatusLabel, finishMsg.c_str());

    return true;
}

LRESULT CALLBACK WndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
    switch (msg) {
    case WM_CREATE: {
        // Resolve default path: %LOCALAPPDATA%\Programs\Waterfall
        WCHAR localAppData[MAX_PATH];
        if (SUCCEEDED(SHGetFolderPathW(nullptr, CSIDL_LOCAL_APPDATA, nullptr, 0, localAppData))) {
            g_installDir = (fs::path(localAppData) / "Programs" / "Waterfall").wstring();
        } else {
            g_installDir = L"C:\\Waterfall";
        }

        HFONT hFontDefault = (HFONT)GetStockObject(DEFAULT_GUI_FONT);

        // Header Labels
        HWND hTitle = CreateWindowExW(0, L"STATIC", L"Waterfall Download Accelerator", WS_CHILD | WS_VISIBLE | SS_LEFT, 24, 18, 490, 26, hwnd, nullptr, nullptr, nullptr);
        HWND hSubtitle = CreateWindowExW(0, L"STATIC", L"Setup Wizard — High-Speed Native C++20 Multi-Stream Engine (v2.0.1)", WS_CHILD | WS_VISIBLE | SS_LEFT, 24, 44, 490, 20, hwnd, nullptr, nullptr, nullptr);

        // Path Label & Edit
        HWND hPathLabel = CreateWindowExW(0, L"STATIC", L"Installation Destination Directory:", WS_CHILD | WS_VISIBLE | SS_LEFT, 24, 76, 260, 18, hwnd, nullptr, nullptr, nullptr);
        g_hPathEdit = CreateWindowExW(WS_EX_CLIENTEDGE, L"EDIT", g_installDir.c_str(), WS_CHILD | WS_VISIBLE | ES_AUTOHSCROLL, 24, 96, 400, 24, hwnd, (HMENU)IDC_EDIT_PATH, nullptr, nullptr);
        g_hBtnBrowse = CreateWindowExW(0, L"BUTTON", L"Browse...", WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON, 432, 95, 90, 26, hwnd, (HMENU)IDC_BTN_BROWSE, nullptr, nullptr);

        // Options Checkboxes
        g_hChkDesktop = CreateWindowExW(0, L"BUTTON", L"Create Desktop shortcut", WS_CHILD | WS_VISIBLE | BS_AUTOCHECKBOX, 24, 134, 280, 22, hwnd, (HMENU)IDC_CHK_DESKTOP, nullptr, nullptr);
        g_hChkStartMenu = CreateWindowExW(0, L"BUTTON", L"Create Start Menu shortcuts (Programs & Group)", WS_CHILD | WS_VISIBLE | BS_AUTOCHECKBOX, 24, 158, 380, 22, hwnd, (HMENU)IDC_CHK_STARTMENU, nullptr, nullptr);
        g_hChkLaunch = CreateWindowExW(0, L"BUTTON", L"Launch Waterfall Accelerator on finish", WS_CHILD | WS_VISIBLE | BS_AUTOCHECKBOX, 24, 182, 340, 22, hwnd, (HMENU)IDC_CHK_LAUNCH, nullptr, nullptr);
        g_hChkExtGuide = CreateWindowExW(0, L"BUTTON", L"Open Browser Companion Extension Guide on finish", WS_CHILD | WS_VISIBLE | BS_AUTOCHECKBOX, 24, 206, 420, 22, hwnd, (HMENU)IDC_CHK_EXT_GUIDE, nullptr, nullptr);

        SendMessageW(g_hChkDesktop, BM_SETCHECK, BST_CHECKED, 0);
        SendMessageW(g_hChkStartMenu, BM_SETCHECK, BST_CHECKED, 0);
        SendMessageW(g_hChkLaunch, BM_SETCHECK, BST_CHECKED, 0);
        SendMessageW(g_hChkExtGuide, BM_SETCHECK, BST_CHECKED, 0);

        // Status Label & Progress Bar
        g_hStatusLabel = CreateWindowExW(0, L"STATIC", L"Click Install to begin setup.", WS_CHILD | WS_VISIBLE | SS_LEFT, 24, 242, 498, 20, hwnd, (HMENU)IDC_STATUS_LABEL, nullptr, nullptr);
        g_hProgressBar = CreateWindowExW(0, PROGRESS_CLASSW, nullptr, WS_CHILD | WS_VISIBLE | PBS_SMOOTH, 24, 266, 498, 18, hwnd, (HMENU)IDC_PROGRESS, nullptr, nullptr);
        SendMessageW(g_hProgressBar, PBM_SETRANGE32, 0, 100);
        SendMessageW(g_hProgressBar, PBM_SETPOS, 0, 0);

        // Open Extension Folder Action Button (Initially hidden/disabled until setup succeeds)
        g_hBtnOpenExt = CreateWindowExW(0, L"BUTTON", L"Open Extension Folder", WS_CHILD | WS_VISIBLE | WS_DISABLED | BS_PUSHBUTTON, 24, 320, 180, 32, hwnd, (HMENU)IDC_BTN_OPEN_EXT, nullptr, nullptr);

        // Action Buttons
        g_hBtnInstall = CreateWindowExW(0, L"BUTTON", L"Install", WS_CHILD | WS_VISIBLE | BS_DEFPUSHBUTTON, 326, 320, 96, 32, hwnd, (HMENU)IDC_BTN_INSTALL, nullptr, nullptr);
        g_hBtnCancel = CreateWindowExW(0, L"BUTTON", L"Cancel", WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON, 428, 320, 94, 32, hwnd, (HMENU)IDC_BTN_CANCEL, nullptr, nullptr);

        // Apply GUI font
        for (HWND h : {hTitle, hSubtitle, hPathLabel, g_hPathEdit, g_hBtnBrowse, g_hChkDesktop, g_hChkStartMenu, g_hChkLaunch, g_hChkExtGuide, g_hStatusLabel, g_hBtnOpenExt, g_hBtnInstall, g_hBtnCancel}) {
            if (h) SendMessageW(h, WM_SETFONT, (WPARAM)hFontDefault, TRUE);
        }

        return 0;
    }
    case WM_COMMAND: {
        int id = LOWORD(wParam);
        if (id == IDC_BTN_BROWSE) {
            WCHAR chosenPath[MAX_PATH] = {0};
            BROWSEINFOW bi = {0};
            bi.hwndOwner = hwnd;
            bi.lpszTitle = L"Select Waterfall Installation Folder:";
            bi.ulFlags = BIF_RETURNONLYFSDIRS | BIF_NEWDIALOGSTYLE;
            PIDLIST_ABSOLUTE pidl = SHBrowseForFolderW(&bi);
            if (pidl) {
                if (SHGetPathFromIDListW(pidl, chosenPath)) {
                    g_installDir = chosenPath;
                    SetWindowTextW(g_hPathEdit, g_installDir.c_str());
                }
                CoTaskMemFree(pidl);
            }
        } else if (id == IDC_BTN_OPEN_EXT) {
            fs::path extDir = fs::path(g_installDir) / "extension";
            std::error_code ec;
            if (!fs::exists(extDir)) {
                fs::create_directories(extDir, ec);
            }
            ShellExecuteW(nullptr, L"open", extDir.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
        } else if (id == IDC_BTN_CANCEL) {
            DestroyWindow(hwnd);
        } else if (id == IDC_BTN_INSTALL) {
            if (g_isFinished) {
                // 1. Open Companion Extension Guide & Folder if checked
                if (SendMessageW(g_hChkExtGuide, BM_GETCHECK, 0, 0) == BST_CHECKED) {
                    fs::path extDir = fs::path(g_installDir) / "extension";
                    ShellExecuteW(nullptr, L"open", extDir.c_str(), nullptr, nullptr, SW_SHOWNORMAL);

                    fs::path guidePath = fs::path(g_installDir) / "frontend" / "extension-guide.html";
                    if (fs::exists(guidePath)) {
                        ShellExecuteW(nullptr, L"open", guidePath.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
                    }
                }

                // 2. Launch Waterfall Accelerator if checked
                if (SendMessageW(g_hChkLaunch, BM_GETCHECK, 0, 0) == BST_CHECKED) {
                    fs::path exe = fs::path(g_installDir) / "Waterfall.exe";
                    ShellExecuteW(nullptr, L"open", exe.c_str(), nullptr, g_installDir.c_str(), SW_SHOWNORMAL);
                }

                DestroyWindow(hwnd);
                return 0;
            }

            if (g_isInstalling) return 0;

            // Retrieve destination folder from edit control
            WCHAR buf[MAX_PATH];
            GetWindowTextW(g_hPathEdit, buf, MAX_PATH);
            g_installDir = buf;

            if (g_installDir.empty()) {
                MessageBoxW(hwnd, L"Please select a valid installation directory.", L"Error", MB_ICONWARNING);
                return 0;
            }

            // Disable controls during installation
            g_isInstalling = true;
            EnableWindow(g_hBtnInstall, FALSE);
            EnableWindow(g_hBtnBrowse, FALSE);
            EnableWindow(g_hBtnCancel, FALSE);
            EnableWindow(g_hPathEdit, FALSE);
            EnableWindow(g_hChkDesktop, FALSE);
            EnableWindow(g_hChkStartMenu, FALSE);
            EnableWindow(g_hChkLaunch, FALSE);
            EnableWindow(g_hChkExtGuide, FALSE);

            // Execute installation in background thread
            std::thread([hwnd]() {
                bool ok = ExtractPayloadTo(g_installDir, hwnd);
                g_isInstalling = false;
                g_isFinished = ok;

                PostMessageW(hwnd, WM_APP + 301, ok ? 1 : 0, 0);
            }).detach();
        }
        return 0;
    }
    case WM_APP + 301: {
        bool ok = (wParam == 1);
        EnableWindow(g_hBtnInstall, TRUE);
        EnableWindow(g_hBtnCancel, TRUE);
        EnableWindow(g_hChkLaunch, TRUE);
        EnableWindow(g_hChkExtGuide, TRUE);

        if (ok) {
            EnableWindow(g_hBtnOpenExt, TRUE);
            SetWindowTextW(g_hBtnInstall, L"Finish");
            SetWindowTextW(g_hBtnCancel, L"Close");
        } else {
            SetWindowTextW(g_hBtnInstall, L"Retry");
        }
        return 0;
    }
    case WM_DESTROY: {
        PostQuitMessage(0);
        return 0;
    }
    }
    return DefWindowProcW(hwnd, msg, wParam, lParam);
}

int WINAPI wWinMain(HINSTANCE hInstance, HINSTANCE hPrevInstance, LPWSTR lpCmdLine, int nCmdShow) {
    UNREFERENCED_PARAMETER(hPrevInstance);
    UNREFERENCED_PARAMETER(lpCmdLine);

    CoInitialize(nullptr);
    INITCOMMONCONTROLSEX icex;
    icex.dwSize = sizeof(icex);
    icex.dwICC = ICC_PROGRESS_CLASS | ICC_STANDARD_CLASSES;
    InitCommonControlsEx(&icex);

    HICON hIconBig = (HICON)LoadImageW(hInstance, MAKEINTRESOURCEW(IDI_APP_ICON), IMAGE_ICON, GetSystemMetrics(SM_CXICON), GetSystemMetrics(SM_CYICON), LR_DEFAULTCOLOR);
    HICON hIconSmall = (HICON)LoadImageW(hInstance, MAKEINTRESOURCEW(IDI_APP_ICON), IMAGE_ICON, GetSystemMetrics(SM_CXSMICON), GetSystemMetrics(SM_CYSMICON), LR_DEFAULTCOLOR);
    if (!hIconBig) hIconBig = LoadIconW(nullptr, (LPCWSTR)IDI_APPLICATION);
    if (!hIconSmall) hIconSmall = hIconBig;

    WNDCLASSEXW wcex = {};
    wcex.cbSize = sizeof(wcex);
    wcex.style = CS_HREDRAW | CS_VREDRAW;
    wcex.lpfnWndProc = WndProc;
    wcex.hInstance = hInstance;
    wcex.hIcon = hIconBig;
    wcex.hIconSm = hIconSmall;
    wcex.hCursor = LoadCursorW(nullptr, (LPCWSTR)IDC_ARROW);
    wcex.hbrBackground = (HBRUSH)(COLOR_BTNFACE + 1);
    wcex.lpszClassName = L"Waterfall_Setup_Class";
    RegisterClassExW(&wcex);

    int width = 560;
    int height = 410;
    int screenW = GetSystemMetrics(SM_CXSCREEN);
    int screenH = GetSystemMetrics(SM_CYSCREEN);
    int posX = std::max(0, (screenW - width) / 2);
    int posY = std::max(0, (screenH - height) / 2);

    HWND hwnd = CreateWindowExW(
        0,
        L"Waterfall_Setup_Class",
        L"Waterfall Download Accelerator — Setup Wizard",
        WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX,
        posX, posY, width, height,
        nullptr, nullptr, hInstance, nullptr
    );

    if (!hwnd) return 1;

    SendMessageW(hwnd, WM_SETICON, ICON_BIG, (LPARAM)hIconBig);
    SendMessageW(hwnd, WM_SETICON, ICON_SMALL, (LPARAM)hIconSmall);

    BOOL useDarkMode = TRUE;
    DwmSetWindowAttribute(hwnd, 20 /* DWMWA_USE_IMMERSIVE_DARK_MODE */, &useDarkMode, sizeof(useDarkMode));

    ShowWindow(hwnd, nCmdShow);
    UpdateWindow(hwnd);

    MSG msg;
    while (GetMessageW(&msg, nullptr, 0, 0)) {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }

    CoUninitialize();
    return (int)msg.wParam;
}
