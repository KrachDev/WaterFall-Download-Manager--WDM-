#pragma once

#include "waterfall/core/DownloadTask.hpp"
#include "waterfall/core/ChunkEngine.hpp"
#include "waterfall/core/QueueScheduler.hpp"
#include "waterfall/core/CrawlerEngine.hpp"
#include <vector>
#include <mutex>
#include <memory>
#include <functional>

struct sqlite3;

namespace waterfall::core {

class DownloadManager {
public:
    using UpdateListener = std::function<void()>;

    static DownloadManager& Instance();
    ~DownloadManager();

    bool Initialize(const std::string& db_path = "waterfall.db");

    int AddDownload(const std::string& url,
                    const std::string& custom_name = "",
                    const std::string& target_folder = "",
                    int priority = 2,
                    bool is_media = false,
                    const std::string& media_format = "");

    bool PauseDownload(int task_id);
    bool ResumeDownload(int task_id);
    bool DeleteDownload(int task_id, bool delete_file_from_disk = false);
    void PauseAll();
    void ResumeAll();
    void ClearCompleted();

    // Queue ordering
    void MoveTaskTop(int task_id);
    void MoveTaskUp(int task_id);
    void MoveTaskDown(int task_id);
    void MoveTaskBottom(int task_id);
    void SortQueue(QueueScheduler::SortMode mode);

    // LinkGrabber
    std::vector<CrawlerPackage> GetGrabberPackages();
    void CrawlTextToGrabber(const std::string& text);
    void TransferGrabberPackage(int package_index);
    void TransferAllGrabberPackages();
    void ClearGrabber();
    void RemoveGrabberPackage(int package_index);

    // Advanced task operations
    bool UpdateDownloadUrl(int task_id, const std::string& new_url);
    bool VerifyChecksum(int task_id, std::string& out_hash);
    bool ExtractTask(int task_id, const std::string& password = "");
    void SetTaskPriority(int task_id, int priority);
    void ForceDownloadGroup(const std::string& group_key);
    void UpdateTaskbar();

    std::vector<DownloadTask> GetTasks();
    DownloadTask* GetTaskPtr(int task_id);

    int GetActiveCount();
    int64_t GetTotalSpeed();

    void SetUpdateListener(UpdateListener listener);
    void NotifyUpdate();

private:
    DownloadManager();
    void SaveTaskToDb(const DownloadTask& task);
    void LoadTasksFromDb();
    void OnTaskFinished(int task_id, bool success, const std::string& err);
    void CheckMultipartExtraction(const DownloadTask& completed_task);

    std::recursive_mutex tasks_mutex_;
    std::vector<DownloadTask> tasks_;
    std::vector<CrawlerPackage> grabber_packages_;
    int next_id_ = 1;

    ChunkEngine chunk_engine_;
    sqlite3* db_ = nullptr;
    UpdateListener update_listener_;
};

} // namespace waterfall::core
