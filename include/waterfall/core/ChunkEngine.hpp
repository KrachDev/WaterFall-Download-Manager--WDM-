#pragma once

#include "waterfall/core/DownloadTask.hpp"
#include <functional>
#include <memory>
#include <thread>
#include <atomic>

namespace waterfall::core {

struct RemoteFileInfo {
    int64_t total_size = 0;
    bool supports_range = false;
    std::string filename;
    std::string redirected_url;
    int status_code = 0;
};

class ChunkEngine {
public:
    using ProgressCallback = std::function<void(const DownloadTask&)>;
    using CompleteCallback = std::function<void(int task_id, bool success, const std::string& err)>;

    ChunkEngine();
    ~ChunkEngine();

    // Probe URL to inspect Content-Length, filename, and 206 Partial Content support
    static RemoteFileInfo ProbeUrl(const std::string& url);

    // Start or resume downloading a task
    void StartTask(DownloadTask& task, ProgressCallback on_progress, CompleteCallback on_complete);
    void PauseTask(int task_id);
    void CancelTask(int task_id);

private:
    struct WorkerContext;
    std::vector<std::unique_ptr<WorkerContext>> active_workers_;
};

} // namespace waterfall::core
