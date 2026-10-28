#include "waterfall/core/QueueScheduler.hpp"
#include "waterfall/core/ConfigManager.hpp"
#include <algorithm>
#include <map>
#include <regex>
#include <iostream>

namespace waterfall::core {

QueueScheduler& QueueScheduler::Instance() {
    static QueueScheduler instance;
    return instance;
}

std::string QueueScheduler::GetHostKey(const std::string& url) {
    if (url.empty()) return "generic";
    std::smatch m;
    std::regex host_regex(R"(https?://([^/:\?#]+))", std::regex::icase);
    if (std::regex_search(url, m, host_regex)) {
        std::string host = m[1].str();
        std::transform(host.begin(), host.end(), host.begin(), ::tolower);
        return host;
    }
    return "generic";
}

void QueueScheduler::Schedule(std::vector<DownloadTask>& tasks, StartTaskCallback start_cb) {
    std::unique_lock<std::mutex> lock(mutex_);

    int max_active = std::max(1, ConfigManager::Instance().GetMaxConcurrentDownloads());
    int max_per_host = std::max(1, ConfigManager::Instance().GetMaxConcurrentPerHost());

    int active_count = 0;
    std::map<std::string, int> active_hosts;

    // 1. Count currently active downloads
    for (const auto& t : tasks) {
        if (t.status == TaskStatus::Downloading || t.status == TaskStatus::Probing) {
            active_count++;
            std::string host = GetHostKey(t.url);
            active_hosts[host]++;
        }
    }

    if (active_count >= max_active) return;
    int available_slots = max_active - active_count;

    // 2. Collect queued tasks
    std::vector<DownloadTask*> queued_ptrs;
    for (auto& t : tasks) {
        if (t.status == TaskStatus::Queued) {
            queued_ptrs.push_back(&t);
        }
    }

    if (queued_ptrs.empty()) return;

    // 3. Sort queued tasks: Priority desc, multipart sequencing, added time
    std::stable_sort(queued_ptrs.begin(), queued_ptrs.end(), [](const DownloadTask* a, const DownloadTask* b) {
        if (a->priority != b->priority) {
            return a->priority > b->priority;
        }
        if (a->is_multipart && b->is_multipart && !a->multipart_group.empty() && a->multipart_group == b->multipart_group) {
            return a->multipart_part < b->multipart_part;
        }
        return a->queue_order < b->queue_order;
    });

    // 4. Select tasks to launch respecting domain caps
    std::vector<int> tasks_to_start;
    for (auto* task : queued_ptrs) {
        if (static_cast<int>(tasks_to_start.size()) >= available_slots) break;

        std::string host = GetHostKey(task->url);
        int current_on_host = active_hosts[host];
        int effective_cap = task->is_media ? std::max(max_per_host, 4) : max_per_host;

        if (current_on_host >= effective_cap) {
            continue; // Skip, slot taken by other downloads on same host
        }

        tasks_to_start.push_back(task->id);
        active_hosts[host]++;
    }

    lock.unlock();

    // 5. Trigger starts outside of mutex lock
    for (int id : tasks_to_start) {
        if (start_cb) {
            start_cb(id);
        }
    }
}

void QueueScheduler::MoveTaskTop(std::vector<DownloadTask>& tasks, int task_id) {
    std::lock_guard<std::mutex> lock(mutex_);
    for (auto it = tasks.begin(); it != tasks.end(); ++it) {
        if (it->id == task_id) {
            DownloadTask item = *it;
            tasks.erase(it);
            tasks.insert(tasks.begin(), item);
            break;
        }
    }
}

void QueueScheduler::MoveTaskUp(std::vector<DownloadTask>& tasks, int task_id) {
    std::lock_guard<std::mutex> lock(mutex_);
    for (size_t i = 1; i < tasks.size(); ++i) {
        if (tasks[i].id == task_id) {
            std::swap(tasks[i], tasks[i - 1]);
            break;
        }
    }
}

void QueueScheduler::MoveTaskDown(std::vector<DownloadTask>& tasks, int task_id) {
    std::lock_guard<std::mutex> lock(mutex_);
    for (size_t i = 0; i + 1 < tasks.size(); ++i) {
        if (tasks[i].id == task_id) {
            std::swap(tasks[i], tasks[i + 1]);
            break;
        }
    }
}

void QueueScheduler::MoveTaskBottom(std::vector<DownloadTask>& tasks, int task_id) {
    std::lock_guard<std::mutex> lock(mutex_);
    for (auto it = tasks.begin(); it != tasks.end(); ++it) {
        if (it->id == task_id) {
            DownloadTask item = *it;
            tasks.erase(it);
            tasks.push_back(item);
            break;
        }
    }
}

void QueueScheduler::SortTasks(std::vector<DownloadTask>& tasks, SortMode mode) {
    std::lock_guard<std::mutex> lock(mutex_);
    switch (mode) {
        case SortMode::DateDesc:
            std::stable_sort(tasks.begin(), tasks.end(), [](const DownloadTask& a, const DownloadTask& b) {
                return a.id > b.id;
            });
            break;
        case SortMode::DateAsc:
            std::stable_sort(tasks.begin(), tasks.end(), [](const DownloadTask& a, const DownloadTask& b) {
                return a.id < b.id;
            });
            break;
        case SortMode::NameAsc:
            std::stable_sort(tasks.begin(), tasks.end(), [](const DownloadTask& a, const DownloadTask& b) {
                return a.filename < b.filename;
            });
            break;
        case SortMode::NameDesc:
            std::stable_sort(tasks.begin(), tasks.end(), [](const DownloadTask& a, const DownloadTask& b) {
                return a.filename > b.filename;
            });
            break;
        case SortMode::SizeDesc:
            std::stable_sort(tasks.begin(), tasks.end(), [](const DownloadTask& a, const DownloadTask& b) {
                return a.total_bytes > b.total_bytes;
            });
            break;
        case SortMode::SizeAsc:
            std::stable_sort(tasks.begin(), tasks.end(), [](const DownloadTask& a, const DownloadTask& b) {
                return a.total_bytes < b.total_bytes;
            });
            break;
        case SortMode::Status:
            std::stable_sort(tasks.begin(), tasks.end(), [](const DownloadTask& a, const DownloadTask& b) {
                return static_cast<int>(a.status) < static_cast<int>(b.status);
            });
            break;
    }
}

} // namespace waterfall::core
