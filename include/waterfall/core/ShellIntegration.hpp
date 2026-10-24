#pragma once

#include <string>
#include <windows.h>
#include <shellapi.h>

namespace waterfall::core {

class ShellIntegration {
public:
    static ShellIntegration& Instance();

    void Initialize(HWND hwnd = nullptr);
    void ShowNotification(const std::string& title, const std::string& message);
    void TriggerPowerAction(const std::string& action); // "sleep", "shutdown"
    void OpenFolderAndSelect(const std::string& file_path);

private:
    ShellIntegration();
    ~ShellIntegration();

    HWND hwnd_ = nullptr;
    NOTIFYICONDATAW nid_ = { sizeof(nid_) };
    bool tray_initialized_ = false;
};

} // namespace waterfall::core
