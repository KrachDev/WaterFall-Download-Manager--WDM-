#pragma once

#include <string>
#include <functional>
#include <atomic>
#include <mutex>

namespace waterfall::core {

struct UpdateInfo {
    bool check_completed = false;
    bool update_available = false;
    std::string current_version = "v2.0.1";
    std::string latest_version;
    std::string release_notes;
    std::string download_url;
    std::string asset_name;
    std::string error;
};

class UpdateManager {
public:
    using ProgressCallback = std::function<void(float percent, int64_t bytes_done, int64_t total_bytes)>;
    using CompleteCallback = std::function<void(bool success, const std::string& err)>;

    static UpdateManager& Instance();

    UpdateInfo CheckForUpdates(bool force_refresh = false);
    bool StartDownloadUpdate(ProgressCallback on_progress = nullptr, CompleteCallback on_complete = nullptr);
    bool ApplyUpdate(std::string& out_error);

    [[nodiscard]] std::string GetCurrentVersion() const { return current_version_; }
    [[nodiscard]] float GetDownloadProgress() const { return download_progress_; }
    [[nodiscard]] bool IsDownloading() const { return is_downloading_; }
    [[nodiscard]] UpdateInfo GetCachedInfo();

private:
    UpdateManager();
    ~UpdateManager() = default;

    std::string FetchGitHubLatestRelease();
    static bool IsNewerVersion(const std::string& remote, const std::string& current);

    std::string current_version_ = "v2.0.1";
    std::string repo_slug_ = "KrachDev/WaterFall-Download-Manager--WDM-";

    std::mutex mutex_;
    UpdateInfo cached_info_;

    std::atomic<bool> is_downloading_{false};
    std::atomic<float> download_progress_{0.0f};
    std::string downloaded_zip_path_;
};

} // namespace waterfall::core
