#pragma once

#include "waterfall/core/DownloadTask.hpp"
#include "waterfall/core/ChunkEngine.hpp"
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

    int AddDownload(const std::string& url, const std::string& custom_name = "", const std::string& target_folder = "");
    bool PauseDownload(int task_id);
    bool ResumeDownload(int task_id);
    bool DeleteDownload(int task_id, bool delete_file_from_disk = false);

    std::vector<DownloadTask> GetTasks();
    DownloadTask* GetTaskPtr(int task_id);

    int GetActiveCount();
    int64_t GetTotalSpeed();

    void SetUpdateListener(UpdateListener listener);

private:
    DownloadManager();
    void SaveTaskToDb(const DownloadTask& task);
    void LoadTasksFromDb();
    void NotifyUpdate();

    std::mutex tasks_mutex_;
    std::vector<DownloadTask> tasks_;
    int next_id_ = 1;

    ChunkEngine chunk_engine_;
    sqlite3* db_ = nullptr;
    UpdateListener update_listener_;
};

} // namespace waterfall::core
