#include "waterfall/core/DownloadManager.hpp"
#include "waterfall/core/StorageRouter.hpp"
#include <sqlite3.h>
#include <iostream>
#include <filesystem>

namespace waterfall::core {

DownloadManager& DownloadManager::Instance() {
    static DownloadManager manager;
    return manager;
}

DownloadManager::DownloadManager() = default;

DownloadManager::~DownloadManager() {
    if (db_) {
        sqlite3_close(db_);
        db_ = nullptr;
    }
}

bool DownloadManager::Initialize(const std::string& db_path) {
    int rc = sqlite3_open(db_path.c_str(), &db_);
    if (rc != SQLITE_OK) {
        std::cerr << "Failed to open SQLite database: " << sqlite3_errmsg(db_) << std::endl;
        return false;
    }

    // Enable Write-Ahead Logging (WAL) mode for maximum concurrency and zero lock stalls
    sqlite3_exec(db_, "PRAGMA journal_mode=WAL;", nullptr, nullptr, nullptr);
    sqlite3_exec(db_, "PRAGMA synchronous=NORMAL;", nullptr, nullptr, nullptr);

    const char* schema = 
        "CREATE TABLE IF NOT EXISTS downloads ("
        "  id INTEGER PRIMARY KEY,"
        "  url TEXT NOT NULL,"
        "  filename TEXT NOT NULL,"
        "  save_path TEXT NOT NULL,"
        "  total_bytes INTEGER DEFAULT 0,"
        "  downloaded_bytes INTEGER DEFAULT 0,"
        "  status INTEGER DEFAULT 0,"
        "  created_at INTEGER,"
        "  completed_at INTEGER"
        ");";

    char* err = nullptr;
    if (sqlite3_exec(db_, schema, nullptr, nullptr, &err) != SQLITE_OK) {
        std::cerr << "Database schema creation failed: " << err << std::endl;
        sqlite3_free(err);
        return false;
    }

    LoadTasksFromDb();
    return true;
}

void DownloadManager::LoadTasksFromDb() {
    std::lock_guard<std::mutex> lock(tasks_mutex_);
    tasks_.clear();

    const char* query = "SELECT id, url, filename, save_path, total_bytes, downloaded_bytes, status FROM downloads ORDER BY id DESC;";
    sqlite3_stmt* stmt = nullptr;

    if (sqlite3_prepare_v2(db_, query, -1, &stmt, nullptr) == SQLITE_OK) {
        while (sqlite3_step(stmt) == SQLITE_ROW) {
            DownloadTask task;
            task.id = sqlite3_column_int(stmt, 0);
            task.url = reinterpret_cast<const char*>(sqlite3_column_text(stmt, 1));
            task.filename = reinterpret_cast<const char*>(sqlite3_column_text(stmt, 2));
            task.save_path = reinterpret_cast<const char*>(sqlite3_column_text(stmt, 3));
            task.total_bytes = sqlite3_column_int64(stmt, 4);
            task.downloaded_bytes = sqlite3_column_int64(stmt, 5);
            int st = sqlite3_column_int(stmt, 6);
            task.status = (st == 4) ? TaskStatus::Completed : TaskStatus::Paused;

            if (task.id >= next_id_) {
                next_id_ = task.id + 1;
            }
            tasks_.push_back(task);
        }
        sqlite3_finalize(stmt);
    }
}

void DownloadManager::SaveTaskToDb(const DownloadTask& task) {
    if (!db_) return;

    const char* sql = "INSERT OR REPLACE INTO downloads (id, url, filename, save_path, total_bytes, downloaded_bytes, status) "
                      "VALUES (?, ?, ?, ?, ?, ?, ?);";
    sqlite3_stmt* stmt = nullptr;
    if (sqlite3_prepare_v2(db_, sql, -1, &stmt, nullptr) == SQLITE_OK) {
        sqlite3_bind_int(stmt, 1, task.id);
        sqlite3_bind_text(stmt, 2, task.url.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(stmt, 3, task.filename.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(stmt, 4, task.save_path.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_int64(stmt, 5, task.total_bytes);
        sqlite3_bind_int64(stmt, 6, task.downloaded_bytes);
        sqlite3_bind_int(stmt, 7, static_cast<int>(task.status));
        sqlite3_step(stmt);
        sqlite3_finalize(stmt);
    }
}

int DownloadManager::AddDownload(const std::string& url, const std::string& custom_name, const std::string& target_folder) {
    std::lock_guard<std::mutex> lock(tasks_mutex_);

    DownloadTask task;
    task.id = next_id_++;
    task.url = url;

    // Use custom name or extract from URL
    std::string base_name = custom_name.empty() ? StorageRouter::Instance().SanitizeFilename("download") : custom_name;
    task.filename = base_name;

    // Resolve storage location
    std::filesystem::path folder = target_folder.empty() ? StorageRouter::Instance().ResolveTargetDirectory(task.filename) : std::filesystem::path(target_folder);
    task.save_path = (folder / task.filename).string();
    task.status = TaskStatus::Queued;

    tasks_.insert(tasks_.begin(), task);
    SaveTaskToDb(task);

    // Launch download through ChunkEngine
    DownloadTask* task_ref = &tasks_.front();
    chunk_engine_.StartTask(*task_ref,
        [this](const DownloadTask& updated) {
            SaveTaskToDb(updated);
            NotifyUpdate();
        },
        [this](int id, bool success, const std::string& err) {
            std::lock_guard<std::mutex> lk(tasks_mutex_);
            for (auto& t : tasks_) {
                if (t.id == id) {
                    t.status = success ? TaskStatus::Completed : TaskStatus::Error;
                    if (!success) t.error_message = err;
                    SaveTaskToDb(t);
                    break;
                }
            }
            NotifyUpdate();
        });

    NotifyUpdate();
    return task.id;
}

bool DownloadManager::PauseDownload(int task_id) {
    std::lock_guard<std::mutex> lock(tasks_mutex_);
    for (auto& t : tasks_) {
        if (t.id == task_id) {
            chunk_engine_.PauseTask(task_id);
            t.status = TaskStatus::Paused;
            t.speed_bps = 0;
            SaveTaskToDb(t);
            NotifyUpdate();
            return true;
        }
    }
    return false;
}

bool DownloadManager::ResumeDownload(int task_id) {
    std::lock_guard<std::mutex> lock(tasks_mutex_);
    for (auto& t : tasks_) {
        if (t.id == task_id) {
            t.status = TaskStatus::Downloading;
            chunk_engine_.StartTask(t,
                [this](const DownloadTask& updated) {
                    SaveTaskToDb(updated);
                    NotifyUpdate();
                },
                [this](int id, bool success, const std::string& err) {
                    std::lock_guard<std::mutex> lk(tasks_mutex_);
                    for (auto& item : tasks_) {
                        if (item.id == id) {
                            item.status = success ? TaskStatus::Completed : TaskStatus::Error;
                            if (!success) item.error_message = err;
                            SaveTaskToDb(item);
                            break;
                        }
                    }
                    NotifyUpdate();
                });
            NotifyUpdate();
            return true;
        }
    }
    return false;
}

bool DownloadManager::DeleteDownload(int task_id, bool delete_file_from_disk) {
    std::lock_guard<std::mutex> lock(tasks_mutex_);
    for (auto it = tasks_.begin(); it != tasks_.end(); ++it) {
        if (it->id == task_id) {
            chunk_engine_.CancelTask(task_id);
            if (delete_file_from_disk) {
                std::error_code ec;
                std::filesystem::remove(it->save_path, ec);
            }
            if (db_) {
                std::string sql = "DELETE FROM downloads WHERE id = " + std::to_string(task_id) + ";";
                sqlite3_exec(db_, sql.c_str(), nullptr, nullptr, nullptr);
            }
            tasks_.erase(it);
            NotifyUpdate();
            return true;
        }
    }
    return false;
}

std::vector<DownloadTask> DownloadManager::GetTasks() {
    std::lock_guard<std::mutex> lock(tasks_mutex_);
    return tasks_;
}

DownloadTask* DownloadManager::GetTaskPtr(int task_id) {
    for (auto& t : tasks_) {
        if (t.id == task_id) return &t;
    }
    return nullptr;
}

int DownloadManager::GetActiveCount() {
    std::lock_guard<std::mutex> lock(tasks_mutex_);
    int count = 0;
    for (const auto& t : tasks_) {
        if (t.status == TaskStatus::Downloading || t.status == TaskStatus::Probing) {
            count++;
        }
    }
    return count;
}

int64_t DownloadManager::GetTotalSpeed() {
    std::lock_guard<std::mutex> lock(tasks_mutex_);
    int64_t total = 0;
    for (const auto& t : tasks_) {
        if (t.status == TaskStatus::Downloading) {
            total += t.speed_bps;
        }
    }
    return total;
}

void DownloadManager::SetUpdateListener(UpdateListener listener) {
    update_listener_ = std::move(listener);
}

void DownloadManager::NotifyUpdate() {
    if (update_listener_) {
        update_listener_();
    }
}

} // namespace waterfall::core
