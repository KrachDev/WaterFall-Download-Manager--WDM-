#pragma once

#include <string>
#include <vector>
#include <mutex>
#include <cstdint>

struct sqlite3;

namespace waterfall::core {

enum class PowerAction {
    None,
    Sleep,
    Shutdown
};

struct AppConfig {
    std::string download_directory;
    int max_concurrent_downloads = 3;
    int max_concurrent_per_host = 2;
    int default_connections_per_task = 16;
    
    bool speed_limit_enabled = false;
    int64_t speed_limit_bps = 5 * 1024 * 1024; // Default 5 MB/s
    
    bool auto_extract_archives = true;
    bool delete_archive_after_extract = false;
    std::vector<std::string> archive_passwords;
    
    PowerAction post_queue_power_action = PowerAction::None;
    bool system_tray_notifications = true;
};

class ConfigManager {
public:
    static ConfigManager& Instance();
    ~ConfigManager();

    void Initialize(sqlite3* db);
    
    AppConfig GetConfig();
    void UpdateConfig(const AppConfig& config);

    // Specific quick accessors
    int GetMaxConcurrentDownloads();
    void SetMaxConcurrentDownloads(int count);
    int GetMaxConcurrentPerHost();
    void SetMaxConcurrentPerHost(int count);
    bool IsSpeedLimitEnabled();
    void SetSpeedLimitEnabled(bool enabled);
    int64_t GetSpeedLimitBps();
    void SetSpeedLimitBps(int64_t bps);
    bool ShouldAutoExtract();
    void SetAutoExtract(bool val);
    bool ShouldDeleteArchiveAfterExtract();
    void SetDeleteArchiveAfterExtract(bool val);
    int GetDefaultConnectionsPerTask();
    void SetDefaultConnectionsPerTask(int count);
    std::vector<std::string> GetArchivePasswords();
    void AddArchivePassword(const std::string& pwd);
    void RemoveArchivePassword(const std::string& pwd);
    PowerAction GetPowerAction();
    void SetPowerAction(PowerAction action);
    std::string GetDownloadDirectory();
    void SetDownloadDirectory(const std::string& dir);

private:
    ConfigManager();
    void LoadFromDb();
    void SaveToDb();

    sqlite3* db_ = nullptr;
    std::mutex mutex_;
    AppConfig config_;
};

} // namespace waterfall::core
