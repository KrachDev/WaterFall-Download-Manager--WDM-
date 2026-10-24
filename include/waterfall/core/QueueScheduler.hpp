#pragma once

#include "waterfall/core/DownloadTask.hpp"
#include <vector>
#include <string>
#include <functional>
#include <mutex>

namespace waterfall::core {

class QueueScheduler {
public:
    using StartTaskCallback = std::function<void(int task_id)>;

    static QueueScheduler& Instance();

    void Schedule(std::vector<DownloadTask>& tasks, StartTaskCallback start_cb);
    std::string GetHostKey(const std::string& url);

    void MoveTaskTop(std::vector<DownloadTask>& tasks, int task_id);
    void MoveTaskUp(std::vector<DownloadTask>& tasks, int task_id);
    void MoveTaskDown(std::vector<DownloadTask>& tasks, int task_id);
    void MoveTaskBottom(std::vector<DownloadTask>& tasks, int task_id);

    enum class SortMode {
        DateDesc,
        DateAsc,
        NameAsc,
        NameDesc,
        SizeDesc,
        SizeAsc,
        Status
    };
    void SortTasks(std::vector<DownloadTask>& tasks, SortMode mode);

private:
    QueueScheduler() = default;
    std::mutex mutex_;
};

} // namespace waterfall::core
