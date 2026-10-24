#pragma once

#include "waterfall/core/DownloadTask.hpp"
#include <functional>
#include <memory>
#include <thread>
#include <atomic>
#include <vector>
#include <mutex>

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

    // Compute hardware-accelerated SHA-256 checksum of a file on disk
    static std::string CalculateSha256(const std::string& file_path);

    // Start or resume downloading a task with multi-socket chunking
    void StartTask(DownloadTask& task, ProgressCallback on_progress, CompleteCallback on_complete);
    void PauseTask(int task_id);
    void CancelTask(int task_id);

    // Configuration
    void SetDefaultConnections(int connections) { default_connections_ = connections; }
    [[nodiscard]] int GetDefaultConnections() const { return default_connections_; }

private:
    struct TaskWorkerContext;
    std::mutex workers_mutex_;
    std::vector<std::shared_ptr<TaskWorkerContext>> active_workers_;
    int default_connections_ = 16;
};

} // namespace waterfall::core
