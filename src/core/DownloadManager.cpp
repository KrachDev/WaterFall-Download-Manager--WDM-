#include "waterfall/core/DownloadManager.hpp"
#include "waterfall/core/StorageRouter.hpp"
#include "waterfall/core/ConfigManager.hpp"
#include "waterfall/core/ArchiveEngine.hpp"
#include "waterfall/core/MediaEngine.hpp"
#include "waterfall/core/ScriptEngine.hpp"
#include "waterfall/core/ShellIntegration.hpp"
#include <sqlite3.h>
#include <iostream>
#include <filesystem>
#include <thread>
#include <algorithm>

namespace waterfall::core {

namespace fs = std::filesystem;

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
        "  priority INTEGER DEFAULT 2,"
        "  category TEXT,"
        "  hoster TEXT,"
        "  is_media INTEGER DEFAULT 0,"
        "  media_format TEXT,"
        "  is_multipart INTEGER DEFAULT 0,"
        "  multipart_group TEXT,"
        "  multipart_part INTEGER DEFAULT 1,"
        "  sha256 TEXT,"
        "  created_at INTEGER,"
        "  completed_at INTEGER"
        ");"
        "CREATE TABLE IF NOT EXISTS task_chunks ("
        "  task_id INTEGER,"
        "  chunk_id INTEGER,"
        "  start_byte INTEGER,"
        "  end_byte INTEGER,"
        "  current_byte INTEGER,"
        "  is_completed INTEGER,"
        "  PRIMARY KEY (task_id, chunk_id)"
        ");";

    char* err = nullptr;
    if (sqlite3_exec(db_, schema, nullptr, nullptr, &err) != SQLITE_OK) {
        std::cerr << "Database schema creation failed: " << err << std::endl;
        sqlite3_free(err);
        return false;
    }

    // Initialize Subsystems
    ConfigManager::Instance().Initialize(db_);
    ShellIntegration::Instance().Initialize();

    LoadTasksFromDb();

    // Trigger scheduler to start any pending queued tasks
    QueueScheduler::Instance().Schedule(tasks_, [this](int id) {
        ResumeDownload(id);
    });

    return true;
}

void DownloadManager::LoadTasksFromDb() {
    std::lock_guard lock(tasks_mutex_);
    tasks_.clear();

    const char* query = "SELECT id, url, filename, save_path, total_bytes, downloaded_bytes, status, priority, category, hoster, is_media, media_format, is_multipart, multipart_group, multipart_part, sha256 FROM downloads ORDER BY id DESC;";
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
            if (st == static_cast<int>(TaskStatus::Completed)) {
                task.status = TaskStatus::Completed;
            } else {
                task.status = TaskStatus::Paused; // Incomplete tasks start as paused on reboot
            }

            task.priority = sqlite3_column_int(stmt, 7);
            const char* cat = reinterpret_cast<const char*>(sqlite3_column_text(stmt, 8));
            if (cat) task.category = cat;

            const char* hst = reinterpret_cast<const char*>(sqlite3_column_text(stmt, 9));
            if (hst) task.hoster = hst;

            task.is_media = (sqlite3_column_int(stmt, 10) != 0);
            const char* fmt = reinterpret_cast<const char*>(sqlite3_column_text(stmt, 11));
            if (fmt) task.media_format = fmt;

            task.is_multipart = (sqlite3_column_int(stmt, 12) != 0);
            const char* mpg = reinterpret_cast<const char*>(sqlite3_column_text(stmt, 13));
            if (mpg) task.multipart_group = mpg;
            task.multipart_part = sqlite3_column_int(stmt, 14);

            const char* sha = reinterpret_cast<const char*>(sqlite3_column_text(stmt, 15));
            if (sha) task.sha256_hash = sha;

            // Load stored chunks for byte-accurate resuming
            const char* chunk_query = "SELECT chunk_id, start_byte, end_byte, current_byte, is_completed FROM task_chunks WHERE task_id = ? ORDER BY chunk_id ASC;";
            sqlite3_stmt* c_stmt = nullptr;
            if (sqlite3_prepare_v2(db_, chunk_query, -1, &c_stmt, nullptr) == SQLITE_OK) {
                sqlite3_bind_int(c_stmt, 1, task.id);
                while (sqlite3_step(c_stmt) == SQLITE_ROW) {
                    ChunkInfo c;
                    c.id = sqlite3_column_int(c_stmt, 0);
                    c.start_byte = sqlite3_column_int64(c_stmt, 1);
                    c.end_byte = sqlite3_column_int64(c_stmt, 2);
                    c.current_byte = sqlite3_column_int64(c_stmt, 3);
                    c.is_completed = (sqlite3_column_int(c_stmt, 4) != 0);
                    task.chunks.push_back(c);
                }
                sqlite3_finalize(c_stmt);
            }

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

    const char* sql = "INSERT OR REPLACE INTO downloads (id, url, filename, save_path, total_bytes, downloaded_bytes, status, priority, category, hoster, is_media, media_format, is_multipart, multipart_group, multipart_part, sha256) "
                      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);";
    sqlite3_stmt* stmt = nullptr;
    if (sqlite3_prepare_v2(db_, sql, -1, &stmt, nullptr) == SQLITE_OK) {
        sqlite3_bind_int(stmt, 1, task.id);
        sqlite3_bind_text(stmt, 2, task.url.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(stmt, 3, task.filename.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(stmt, 4, task.save_path.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_int64(stmt, 5, task.total_bytes);
        sqlite3_bind_int64(stmt, 6, task.downloaded_bytes);
        sqlite3_bind_int(stmt, 7, static_cast<int>(task.status));
        sqlite3_bind_int(stmt, 8, task.priority);
        sqlite3_bind_text(stmt, 9, task.category.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(stmt, 10, task.hoster.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_int(stmt, 11, task.is_media ? 1 : 0);
        sqlite3_bind_text(stmt, 12, task.media_format.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_int(stmt, 13, task.is_multipart ? 1 : 0);
        sqlite3_bind_text(stmt, 14, task.multipart_group.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_int(stmt, 15, task.multipart_part);
        sqlite3_bind_text(stmt, 16, task.sha256_hash.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_step(stmt);
        sqlite3_finalize(stmt);
    }

    // Persist active chunk slices
    for (const auto& c : task.chunks) {
        const char* c_sql = "INSERT OR REPLACE INTO task_chunks (task_id, chunk_id, start_byte, end_byte, current_byte, is_completed) "
                            "VALUES (?, ?, ?, ?, ?, ?);";
        sqlite3_stmt* c_stmt = nullptr;
        if (sqlite3_prepare_v2(db_, c_sql, -1, &c_stmt, nullptr) == SQLITE_OK) {
            sqlite3_bind_int(c_stmt, 1, task.id);
            sqlite3_bind_int(c_stmt, 2, c.id);
            sqlite3_bind_int64(c_stmt, 3, c.start_byte);
            sqlite3_bind_int64(c_stmt, 4, c.end_byte);
            sqlite3_bind_int64(c_stmt, 5, c.current_byte);
            sqlite3_bind_int(c_stmt, 6, c.is_completed ? 1 : 0);
            sqlite3_step(c_stmt);
            sqlite3_finalize(c_stmt);
        }
    }
}

int DownloadManager::AddDownload(const std::string& url,
                                const std::string& custom_name,
                                const std::string& target_folder,
                                int priority,
                                bool is_media,
                                const std::string& media_format) {
    std::lock_guard lock(tasks_mutex_);

    DownloadTask task;
    task.id = next_id_++;
    task.url = url;
    task.priority = priority;
    task.is_media = is_media || MediaEngine::Instance().IsMediaUrl(url);
    task.media_format = media_format;

    // Use custom name or extract from URL
    std::string base_name = custom_name;
    if (base_name.empty()) {
        size_t q = url.find('?');
        std::string clean = (q != std::string::npos) ? url.substr(0, q) : url;
        size_t slash = clean.find_last_of("/\\");
        if (slash != std::string::npos && slash + 1 < clean.size()) {
            base_name = clean.substr(slash + 1);
        }
        if (base_name.empty() || base_name == "/") {
            base_name = "download.bin";
        }
        base_name = StorageRouter::Instance().SanitizeFilename(base_name);
    }
    task.filename = base_name;

    // Check multipart archive status
    auto mp_info = ArchiveEngine::Instance().ParseMultipartInfo(task.filename);
    if (mp_info.is_multipart) {
        task.is_multipart = true;
        task.multipart_group = mp_info.group_key;
        task.multipart_part = mp_info.part_number;
        task.is_root_part = mp_info.is_root_part;
    }

    // Resolve storage location
    std::string folder = target_folder.empty() ? ConfigManager::Instance().GetDownloadDirectory() : target_folder;
    std::filesystem::path folder_path = folder.empty() ? StorageRouter::Instance().ResolveTargetDirectory(task.filename) : std::filesystem::path(folder);
    task.save_path = (folder_path / task.filename).string();
    task.status = TaskStatus::Queued;

    // Determine category
    auto cat = StorageRouter::Instance().CategorizeFile(task.filename);
    switch (cat) {
        case FileCategory::Audio: task.category = "Audio"; break;
        case FileCategory::Media: task.category = "Video"; break;
        case FileCategory::Compressed: task.category = "Compressed"; break;
        case FileCategory::Programs: task.category = "Programs"; break;
        case FileCategory::Documents: task.category = "Documents"; break;
        default: task.category = "Other"; break;
    }

    tasks_.insert(tasks_.begin(), task);
    SaveTaskToDb(task);

    // Schedule next downloads
    QueueScheduler::Instance().Schedule(tasks_, [this](int id) {
        ResumeDownload(id);
    });

    NotifyUpdate();
    return task.id;
}

bool DownloadManager::PauseDownload(int task_id) {
    std::lock_guard lock(tasks_mutex_);
    for (auto& t : tasks_) {
        if (t.id == task_id) {
            chunk_engine_.PauseTask(task_id);
            t.status = TaskStatus::Paused;
            t.speed_bps = 0;
            SaveTaskToDb(t);
            NotifyUpdate();

            // Slot freed up: schedule next
            QueueScheduler::Instance().Schedule(tasks_, [this](int id) {
                ResumeDownload(id);
            });
            return true;
        }
    }
    return false;
}

bool DownloadManager::ResumeDownload(int task_id) {
    std::lock_guard lock(tasks_mutex_);
    for (auto& t : tasks_) {
        if (t.id == task_id) {
            t.status = TaskStatus::Downloading;

            if (t.is_media) {
                // Route to MediaEngine
                MediaEngine::Instance().StartDownload(t.url, t.media_format,
                    fs::path(t.save_path).parent_path().string(),
                    fs::path(t.filename).stem().string(),
                    [this, task_id](float pct, int64_t spd, const std::string& /*eta*/) {
                        std::lock_guard lk(tasks_mutex_);
                        for (auto& item : tasks_) {
                            if (item.id == task_id) {
                                item.downloaded_bytes = static_cast<int64_t>(item.total_bytes * (pct / 100.0f));
                                item.speed_bps = spd;
                                break;
                            }
                        }
                        NotifyUpdate();
                    },
                    [this, task_id](bool success, const std::string& err) {
                        OnTaskFinished(task_id, success, err);
                    });
            } else {
                // Route to ChunkEngine
                chunk_engine_.StartTask(t,
                    [this](const DownloadTask& updated) {
                        {
                            std::lock_guard lk(tasks_mutex_);
                            for (auto& item : tasks_) {
                                if (item.id == updated.id) {
                                    item.downloaded_bytes = updated.downloaded_bytes;
                                    item.total_bytes = updated.total_bytes;
                                    item.speed_bps = updated.speed_bps;
                                    item.chunks = updated.chunks;
                                    item.sha256_hash = updated.sha256_hash;
                                    break;
                                }
                            }
                        }
                        SaveTaskToDb(updated);
                        NotifyUpdate();
                    },
                    [this](int id, bool success, const std::string& err) {
                        OnTaskFinished(id, success, err);
                    });
            }

            NotifyUpdate();
            return true;
        }
    }
    return false;
}

void DownloadManager::OnTaskFinished(int task_id, bool success, const std::string& err) {
    DownloadTask finished_task;
    bool found = false;

    {
        std::lock_guard lk(tasks_mutex_);
        for (auto& item : tasks_) {
            if (item.id == task_id) {
                item.status = success ? TaskStatus::Completed : TaskStatus::Error;
                if (!success) item.error_message = err;
                item.speed_bps = 0;
                SaveTaskToDb(item);
                finished_task = item;
                found = true;
                break;
            }
        }
    }

    if (!found) return;

    if (success) {
        // 1. Show native OS balloon notification
        ShellIntegration::Instance().ShowNotification("Download Complete", finished_task.filename + " has finished downloading.");

        // 2. Check Multipart Archive Extraction
        if (finished_task.is_multipart) {
            CheckMultipartExtraction(finished_task);
        } else if (ConfigManager::Instance().ShouldAutoExtract() && ArchiveEngine::Instance().IsArchiveFile(finished_task.save_path)) {
            // Single archive extraction
            std::thread([this, finished_task]() {
                std::string out_dir = (fs::path(finished_task.save_path).parent_path() / fs::path(finished_task.filename).stem()).string();
                std::string ext_err;
                ArchiveEngine::Instance().UnpackArchive(finished_task.save_path, out_dir,
                    ConfigManager::Instance().GetArchivePasswords(),
                    ConfigManager::Instance().ShouldDeleteArchiveAfterExtract(),
                    {},
                    [this, finished_task](float pct) {
                        std::lock_guard lk(tasks_mutex_);
                        for (auto& item : tasks_) {
                            if (item.id == finished_task.id) {
                                item.status = TaskStatus::Extracting;
                                item.extract_progress = pct;
                                break;
                            }
                        }
                        NotifyUpdate();
                    },
                    ext_err);

                std::lock_guard lk(tasks_mutex_);
                for (auto& item : tasks_) {
                    if (item.id == finished_task.id) {
                        item.status = TaskStatus::Completed;
                        break;
                    }
                }
                NotifyUpdate();
            }).detach();
        }
    }

    NotifyUpdate();

    // 3. Queue Scheduler: Kick off next available download!
    QueueScheduler::Instance().Schedule(tasks_, [this](int id) {
        ResumeDownload(id);
    });

    // 4. Power action check if entire queue has completed
    int active = GetActiveCount();
    if (active == 0) {
        auto power = ConfigManager::Instance().GetPowerAction();
        if (power == PowerAction::Sleep) {
            ShellIntegration::Instance().TriggerPowerAction("sleep");
        } else if (power == PowerAction::Shutdown) {
            ShellIntegration::Instance().TriggerPowerAction("shutdown");
        }
    }
}

void DownloadManager::CheckMultipartExtraction(const DownloadTask& completed_task) {
    if (!completed_task.is_multipart || completed_task.multipart_group.empty()) return;

    std::vector<DownloadTask> group_tasks;
    bool all_finished = true;

    {
        std::lock_guard lk(tasks_mutex_);
        for (const auto& t : tasks_) {
            if (t.is_multipart && t.multipart_group == completed_task.multipart_group) {
                group_tasks.push_back(t);
                if (t.status != TaskStatus::Completed) {
                    all_finished = false;
                }
            }
        }
    }

    if (!all_finished) {
        // Mark as waiting on sibling parts
        std::lock_guard lk(tasks_mutex_);
        for (auto& t : tasks_) {
            if (t.id == completed_task.id) {
                t.status = TaskStatus::WaitingAllParts;
                break;
            }
        }
        return;
    }

    // All parts completed! Find root part and extract
    std::vector<std::string> paths;
    for (const auto& t : group_tasks) {
        paths.push_back(t.save_path);
    }

    std::string root_part = ArchiveEngine::Instance().FindRootArchivePart(paths);
    if (root_part.empty()) return;

    std::thread([this, completed_task, root_part, paths]() {
        std::string out_dir = (fs::path(root_part).parent_path() / completed_task.multipart_group).string();
        std::string ext_err;

        ArchiveEngine::Instance().UnpackArchive(root_part, out_dir,
            ConfigManager::Instance().GetArchivePasswords(),
            ConfigManager::Instance().ShouldDeleteArchiveAfterExtract(),
            paths,
            [this, completed_task](float pct) {
                std::lock_guard lk(tasks_mutex_);
                for (auto& item : tasks_) {
                    if (item.multipart_group == completed_task.multipart_group) {
                        item.status = TaskStatus::Extracting;
                        item.extract_progress = pct;
                    }
                }
                NotifyUpdate();
            },
            ext_err);

        std::lock_guard lk(tasks_mutex_);
        for (auto& item : tasks_) {
            if (item.multipart_group == completed_task.multipart_group) {
                item.status = TaskStatus::Completed;
            }
        }
        NotifyUpdate();
    }).detach();
}

bool DownloadManager::DeleteDownload(int task_id, bool delete_file_from_disk) {
    std::lock_guard lock(tasks_mutex_);
    for (auto it = tasks_.begin(); it != tasks_.end(); ++it) {
        if (it->id == task_id) {
            chunk_engine_.CancelTask(task_id);
            if (delete_file_from_disk) {
                std::error_code ec;
                std::filesystem::remove(it->save_path, ec);
            }
            if (db_) {
                std::string sql = "DELETE FROM downloads WHERE id = " + std::to_string(task_id) + ";"
                                  "DELETE FROM task_chunks WHERE task_id = " + std::to_string(task_id) + ";";
                sqlite3_exec(db_, sql.c_str(), nullptr, nullptr, nullptr);
            }
            tasks_.erase(it);
            NotifyUpdate();

            // Schedule next if slot opened
            QueueScheduler::Instance().Schedule(tasks_, [this](int id) {
                ResumeDownload(id);
            });
            return true;
        }
    }
    return false;
}

void DownloadManager::PauseAll() {
    std::lock_guard lock(tasks_mutex_);
    for (auto& t : tasks_) {
        if (t.status == TaskStatus::Downloading || t.status == TaskStatus::Probing) {
            chunk_engine_.PauseTask(t.id);
            t.status = TaskStatus::Paused;
            t.speed_bps = 0;
            SaveTaskToDb(t);
        }
    }
    NotifyUpdate();
}

void DownloadManager::ResumeAll() {
    std::lock_guard lock(tasks_mutex_);
    for (auto& t : tasks_) {
        if (t.status == TaskStatus::Paused) {
            t.status = TaskStatus::Queued;
            SaveTaskToDb(t);
        }
    }
    QueueScheduler::Instance().Schedule(tasks_, [this](int id) {
        ResumeDownload(id);
    });
    NotifyUpdate();
}

void DownloadManager::ClearCompleted() {
    std::lock_guard lock(tasks_mutex_);
    for (auto it = tasks_.begin(); it != tasks_.end();) {
        if (it->status == TaskStatus::Completed) {
            if (db_) {
                std::string sql = "DELETE FROM downloads WHERE id = " + std::to_string(it->id) + ";"
                                  "DELETE FROM task_chunks WHERE task_id = " + std::to_string(it->id) + ";";
                sqlite3_exec(db_, sql.c_str(), nullptr, nullptr, nullptr);
            }
            it = tasks_.erase(it);
        } else {
            ++it;
        }
    }
    NotifyUpdate();
}

void DownloadManager::MoveTaskTop(int task_id) {
    QueueScheduler::Instance().MoveTaskTop(tasks_, task_id);
    NotifyUpdate();
}

void DownloadManager::MoveTaskUp(int task_id) {
    QueueScheduler::Instance().MoveTaskUp(tasks_, task_id);
    NotifyUpdate();
}

void DownloadManager::MoveTaskDown(int task_id) {
    QueueScheduler::Instance().MoveTaskDown(tasks_, task_id);
    NotifyUpdate();
}

void DownloadManager::MoveTaskBottom(int task_id) {
    QueueScheduler::Instance().MoveTaskBottom(tasks_, task_id);
    NotifyUpdate();
}

void DownloadManager::SortQueue(QueueScheduler::SortMode mode) {
    QueueScheduler::Instance().SortTasks(tasks_, mode);
    NotifyUpdate();
}

std::vector<CrawlerPackage> DownloadManager::GetGrabberPackages() {
    std::lock_guard lock(tasks_mutex_);
    return grabber_packages_;
}

void DownloadManager::CrawlTextToGrabber(const std::string& text) {
    std::thread([this, text]() {
        auto pkgs = CrawlerEngine::Instance().CrawlText(text);
        {
            std::lock_guard lock(tasks_mutex_);
            for (auto& p : pkgs) {
                grabber_packages_.push_back(p);
            }
        }
        NotifyUpdate();
    }).detach();
}

void DownloadManager::TransferGrabberPackage(int package_index) {
    std::lock_guard lock(tasks_mutex_);
    if (package_index >= 0 && package_index < static_cast<int>(grabber_packages_.size())) {
        const auto& pkg = grabber_packages_[package_index];
        for (const auto& item : pkg.items) {
            AddDownload(item.direct_url.empty() ? item.original_url : item.direct_url,
                        item.filename, "", 2, item.is_media, item.media_format);
        }
        grabber_packages_.erase(grabber_packages_.begin() + package_index);
        NotifyUpdate();
    }
}

void DownloadManager::TransferAllGrabberPackages() {
    std::lock_guard lock(tasks_mutex_);
    for (const auto& pkg : grabber_packages_) {
        for (const auto& item : pkg.items) {
            AddDownload(item.direct_url.empty() ? item.original_url : item.direct_url,
                        item.filename, "", 2, item.is_media, item.media_format);
        }
    }
    grabber_packages_.clear();
    NotifyUpdate();
}

void DownloadManager::ClearGrabber() {
    std::lock_guard lock(tasks_mutex_);
    grabber_packages_.clear();
    NotifyUpdate();
}

std::vector<DownloadTask> DownloadManager::GetTasks() {
    std::lock_guard lock(tasks_mutex_);
    return tasks_;
}

DownloadTask* DownloadManager::GetTaskPtr(int task_id) {
    for (auto& t : tasks_) {
        if (t.id == task_id) return &t;
    }
    return nullptr;
}

int DownloadManager::GetActiveCount() {
    std::lock_guard lock(tasks_mutex_);
    int count = 0;
    for (const auto& t : tasks_) {
        if (t.status == TaskStatus::Downloading || t.status == TaskStatus::Probing) {
            count++;
        }
    }
    return count;
}

int64_t DownloadManager::GetTotalSpeed() {
    std::lock_guard lock(tasks_mutex_);
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
