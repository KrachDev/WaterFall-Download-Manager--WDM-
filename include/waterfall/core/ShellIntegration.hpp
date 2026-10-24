#pragma once

#include <string>
#include <windows.h>
#include <shellapi.h>
#include <shobjidl.h>
#include <cstdint>

namespace waterfall::core {

enum class TaskbarProgressState {
    NoProgress = 0,
    Indeterminate = 1,
    Normal = 2,
    Error = 3,
    Paused = 4
};

class ShellIntegration {
public:
    static ShellIntegration& Instance();

    void Initialize(HWND hwnd = nullptr);
    void ShowNotification(const std::string& title, const std::string& message);
    void TriggerPowerAction(const std::string& action); // "sleep", "shutdown"
    void OpenFolderAndSelect(const std::string& file_path);

    void SetTaskbarProgress(uint64_t completed, uint64_t total, TaskbarProgressState state = TaskbarProgressState::Normal);

private:
    ShellIntegration();
    ~ShellIntegration();

    HWND hwnd_ = nullptr;
    NOTIFYICONDATAW nid_ = { sizeof(nid_) };
    bool tray_initialized_ = false;
    ITaskbarList3* taskbar_ = nullptr;
};

} // namespace waterfall::core
