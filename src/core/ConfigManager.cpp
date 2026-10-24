#include "waterfall/core/ConfigManager.hpp"
#include "waterfall/core/StorageRouter.hpp"
#include <sqlite3.h>
#include <sstream>
#include <iostream>

namespace waterfall::core {

ConfigManager& ConfigManager::Instance() {
    static ConfigManager instance;
    return instance;
}

ConfigManager::ConfigManager() {
    // Default download directory to Windows Downloads folder
    config_.download_directory = StorageRouter::Instance().GetDefaultDownloadDir().string();
}

ConfigManager::~ConfigManager() = default;

void ConfigManager::Initialize(sqlite3* db) {
    std::lock_guard<std::mutex> lock(mutex_);
    db_ = db;
    if (!db_) return;

    const char* schema = 
        "CREATE TABLE IF NOT EXISTS settings ("
        "  key TEXT PRIMARY KEY,"
        "  value TEXT"
        ");";
    sqlite3_exec(db_, schema, nullptr, nullptr, nullptr);

    LoadFromDb();
}

void ConfigManager::LoadFromDb() {
    if (!db_) return;

    auto get_str = [this](const std::string& key, const std::string& default_val) -> std::string {
        sqlite3_stmt* stmt = nullptr;
        std::string result = default_val;
        const char* q = "SELECT value FROM settings WHERE key = ?;";
        if (sqlite3_prepare_v2(db_, q, -1, &stmt, nullptr) == SQLITE_OK) {
            sqlite3_bind_text(stmt, 1, key.c_str(), -1, SQLITE_STATIC);
            if (sqlite3_step(stmt) == SQLITE_ROW) {
                const char* val = reinterpret_cast<const char*>(sqlite3_column_text(stmt, 0));
                if (val) result = val;
            }
            sqlite3_finalize(stmt);
        }
        return result;
    };

    std::string dl_dir = get_str("download_directory", config_.download_directory);
    if (!dl_dir.empty()) config_.download_directory = dl_dir;

    std::string max_dl = get_str("max_concurrent_downloads", "3");
    config_.max_concurrent_downloads = std::max(1, std::stoi(max_dl));

    std::string max_host = get_str("max_concurrent_per_host", "2");
    config_.max_concurrent_per_host = std::max(1, std::stoi(max_host));

    std::string def_conn = get_str("default_connections_per_task", "16");
    config_.default_connections_per_task = std::stoi(def_conn);

    std::string speed_lim_on = get_str("speed_limit_enabled", "0");
    config_.speed_limit_enabled = (speed_lim_on == "1");

    std::string speed_lim_bps = get_str("speed_limit_bps", "5242880");
    config_.speed_limit_bps = std::stoll(speed_lim_bps);

    std::string auto_ext = get_str("auto_extract_archives", "1");
    config_.auto_extract_archives = (auto_ext == "1");

    std::string del_after = get_str("delete_archive_after_extract", "0");
    config_.delete_archive_after_extract = (del_after == "1");

    std::string power = get_str("post_queue_power_action", "none");
    if (power == "sleep") config_.post_queue_power_action = PowerAction::Sleep;
    else if (power == "shutdown") config_.post_queue_power_action = PowerAction::Shutdown;
    else config_.post_queue_power_action = PowerAction::None;

    std::string passwords_raw = get_str("archive_passwords", "");
    config_.archive_passwords.clear();
    if (!passwords_raw.empty()) {
        std::istringstream iss(passwords_raw);
        std::string pwd;
        while (std::getline(iss, pwd, '\n')) {
            if (!pwd.empty()) config_.archive_passwords.push_back(pwd);
        }
    }
}

void ConfigManager::SaveToDb() {
    if (!db_) return;

    auto set_str = [this](const std::string& key, const std::string& val) {
        sqlite3_stmt* stmt = nullptr;
        const char* q = "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?);";
        if (sqlite3_prepare_v2(db_, q, -1, &stmt, nullptr) == SQLITE_OK) {
            sqlite3_bind_text(stmt, 1, key.c_str(), -1, SQLITE_STATIC);
            sqlite3_bind_text(stmt, 2, val.c_str(), -1, SQLITE_STATIC);
            sqlite3_step(stmt);
            sqlite3_finalize(stmt);
        }
    };

    set_str("download_directory", config_.download_directory);
    set_str("max_concurrent_downloads", std::to_string(config_.max_concurrent_downloads));
    set_str("max_concurrent_per_host", std::to_string(config_.max_concurrent_per_host));
    set_str("default_connections_per_task", std::to_string(config_.default_connections_per_task));
    set_str("speed_limit_enabled", config_.speed_limit_enabled ? "1" : "0");
    set_str("speed_limit_bps", std::to_string(config_.speed_limit_bps));
    set_str("auto_extract_archives", config_.auto_extract_archives ? "1" : "0");
    set_str("delete_archive_after_extract", config_.delete_archive_after_extract ? "1" : "0");

    std::string power_str = "none";
    if (config_.post_queue_power_action == PowerAction::Sleep) power_str = "sleep";
    else if (config_.post_queue_power_action == PowerAction::Shutdown) power_str = "shutdown";
    set_str("post_queue_power_action", power_str);

    std::string passwords_raw;
    for (const auto& p : config_.archive_passwords) {
        passwords_raw += p + "\n";
    }
    set_str("archive_passwords", passwords_raw);
}

AppConfig ConfigManager::GetConfig() {
    std::lock_guard<std::mutex> lock(mutex_);
    return config_;
}

void ConfigManager::UpdateConfig(const AppConfig& config) {
    std::lock_guard<std::mutex> lock(mutex_);
    config_ = config;
    SaveToDb();
}

int ConfigManager::GetMaxConcurrentDownloads() {
    std::lock_guard<std::mutex> lock(mutex_);
    return config_.max_concurrent_downloads;
}

void ConfigManager::SetMaxConcurrentDownloads(int count) {
    std::lock_guard<std::mutex> lock(mutex_);
    config_.max_concurrent_downloads = std::max(1, count);
    SaveToDb();
}

int ConfigManager::GetMaxConcurrentPerHost() {
    std::lock_guard<std::mutex> lock(mutex_);
    return config_.max_concurrent_per_host;
}

void ConfigManager::SetMaxConcurrentPerHost(int count) {
    std::lock_guard<std::mutex> lock(mutex_);
    config_.max_concurrent_per_host = std::max(1, count);
    SaveToDb();
}

bool ConfigManager::IsSpeedLimitEnabled() {
    std::lock_guard<std::mutex> lock(mutex_);
    return config_.speed_limit_enabled;
}

void ConfigManager::SetSpeedLimitEnabled(bool enabled) {
    std::lock_guard<std::mutex> lock(mutex_);
    config_.speed_limit_enabled = enabled;
    SaveToDb();
}

int64_t ConfigManager::GetSpeedLimitBps() {
    std::lock_guard<std::mutex> lock(mutex_);
    return config_.speed_limit_bps;
}

void ConfigManager::SetSpeedLimitBps(int64_t bps) {
    std::lock_guard<std::mutex> lock(mutex_);
    config_.speed_limit_bps = std::max<int64_t>(0, bps);
    SaveToDb();
}

bool ConfigManager::ShouldAutoExtract() {
    std::lock_guard<std::mutex> lock(mutex_);
    return config_.auto_extract_archives;
}

void ConfigManager::SetAutoExtract(bool val) {
    std::lock_guard<std::mutex> lock(mutex_);
    config_.auto_extract_archives = val;
    SaveToDb();
}

bool ConfigManager::ShouldDeleteArchiveAfterExtract() {
    std::lock_guard<std::mutex> lock(mutex_);
    return config_.delete_archive_after_extract;
}

void ConfigManager::SetDeleteArchiveAfterExtract(bool val) {
    std::lock_guard<std::mutex> lock(mutex_);
    config_.delete_archive_after_extract = val;
    SaveToDb();
}

int ConfigManager::GetDefaultConnectionsPerTask() {
    std::lock_guard<std::mutex> lock(mutex_);
    return config_.default_connections_per_task;
}

void ConfigManager::SetDefaultConnectionsPerTask(int count) {
    std::lock_guard<std::mutex> lock(mutex_);
    config_.default_connections_per_task = count;
    SaveToDb();
}

std::vector<std::string> ConfigManager::GetArchivePasswords() {
    std::lock_guard<std::mutex> lock(mutex_);
    return config_.archive_passwords;
}

void ConfigManager::AddArchivePassword(const std::string& pwd) {
    std::lock_guard<std::mutex> lock(mutex_);
    for (const auto& p : config_.archive_passwords) {
        if (p == pwd) return;
    }
    config_.archive_passwords.push_back(pwd);
    SaveToDb();
}

void ConfigManager::RemoveArchivePassword(const std::string& pwd) {
    std::lock_guard<std::mutex> lock(mutex_);
    auto it = std::remove(config_.archive_passwords.begin(), config_.archive_passwords.end(), pwd);
    if (it != config_.archive_passwords.end()) {
        config_.archive_passwords.erase(it, config_.archive_passwords.end());
        SaveToDb();
    }
}

PowerAction ConfigManager::GetPowerAction() {
    std::lock_guard<std::mutex> lock(mutex_);
    return config_.post_queue_power_action;
}

void ConfigManager::SetPowerAction(PowerAction action) {
    std::lock_guard<std::mutex> lock(mutex_);
    config_.post_queue_power_action = action;
    SaveToDb();
}

std::string ConfigManager::GetDownloadDirectory() {
    std::lock_guard<std::mutex> lock(mutex_);
    return config_.download_directory;
}

void ConfigManager::SetDownloadDirectory(const std::string& dir) {
    std::lock_guard<std::mutex> lock(mutex_);
    config_.download_directory = dir;
    SaveToDb();
}

} // namespace waterfall::core
