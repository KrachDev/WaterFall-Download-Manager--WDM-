#include "waterfall/server/ExtensionServer.hpp"
#include "waterfall/core/DownloadManager.hpp"
#include "waterfall/core/ConfigManager.hpp"
#include "waterfall/core/MediaEngine.hpp"
#include "waterfall/core/CrawlerEngine.hpp"
#include "waterfall/core/ChunkEngine.hpp"
#include "waterfall/core/ArchiveEngine.hpp"
#include "waterfall/core/UpdateManager.hpp"
#include "waterfall/core/ShellIntegration.hpp"
#include "waterfall/core/StorageRouter.hpp"
#include "waterfall/ui/WebViewUiManager.hpp"
#include <httplib.h>
#include <nlohmann/json.hpp>
#include <iostream>

static std::string g_pending_confirm_json = "{}";
#include <filesystem>
#include <windows.h>
#include <shellapi.h>
#include <shobjidl.h>

using json = nlohmann::json;

namespace waterfall::server {

static std::wstring ToWide(const std::string& str) {
    if (str.empty()) return L"";
    int size = MultiByteToWideChar(CP_UTF8, 0, str.c_str(), -1, nullptr, 0);
    std::wstring result(size - 1, 0);
    MultiByteToWideChar(CP_UTF8, 0, str.c_str(), -1, &result[0], size);
    return result;
}

static json TaskToJson(const core::DownloadTask& t) {
    json segments = json::array();
    for (const auto& c : t.chunks) {
        int64_t chunk_done = std::max<int64_t>(0, c.current_byte - c.start_byte);
        int64_t chunk_total = std::max<int64_t>(0, c.end_byte - c.start_byte + 1);
        if (chunk_done > chunk_total && chunk_total > 0) chunk_done = chunk_total;

        segments.push_back({
            {"id", c.id},
            {"start", c.start_byte},
            {"startByte", c.start_byte},
            {"end", c.end_byte},
            {"endByte", c.end_byte},
            {"current", c.current_byte},
            {"currentByte", c.current_byte},
            {"downloaded", chunk_done},
            {"downloadedBytes", chunk_done},
            {"total", chunk_total},
            {"totalBytes", chunk_total},
            {"speed", c.speed_bps},
            {"is_active", c.is_active},
            {"isActive", c.is_active},
            {"is_completed", c.is_completed},
            {"isCompleted", c.is_completed},
            {"progress", c.GetProgress()}
        });
    }

    std::string priority_str = (t.priority == 3) ? "high" : ((t.priority == 1) ? "low" : "normal");

    std::string status_lower;
    switch (t.status) {
        case core::TaskStatus::Queued: status_lower = "queued"; break;
        case core::TaskStatus::Probing: status_lower = "downloading"; break;
        case core::TaskStatus::Downloading: status_lower = "downloading"; break;
        case core::TaskStatus::Paused: status_lower = "paused"; break;
        case core::TaskStatus::Extracting: status_lower = "extracting"; break;
        case core::TaskStatus::WaitingAllParts: status_lower = "queued"; break;
        case core::TaskStatus::Completed: status_lower = "completed"; break;
        case core::TaskStatus::Error: status_lower = "error"; break;
        default: status_lower = "unknown"; break;
    }

    std::string extract_status = "idle";
    if (t.status == core::TaskStatus::Extracting) {
        extract_status = "extracting";
    } else if (t.status == core::TaskStatus::Completed) {
        extract_status = (t.extract_progress >= 100.0f) ? "extracted" : "idle";
    } else if (t.status == core::TaskStatus::WaitingAllParts) {
        extract_status = "waiting_parts";
    }

    json multipart_obj = {
        {"isMultipart", t.is_multipart},
        {"groupKey", t.multipart_group},
        {"baseName", t.filename},
        {"partNumber", t.multipart_part},
        {"totalParts", t.multipart_total_parts},
        {"isRootPart", t.is_root_part}
    };

    int64_t eta_sec = t.eta_seconds;
    if (eta_sec <= 0 && t.status == core::TaskStatus::Downloading && t.total_bytes > t.downloaded_bytes) {
        int64_t spd = t.smoothed_speed_bps > 0 ? t.smoothed_speed_bps : t.speed_bps;
        if (spd > 0) {
            eta_sec = (t.total_bytes - t.downloaded_bytes) / spd;
        }
    }

    int64_t added_ms = std::chrono::duration_cast<std::chrono::milliseconds>(t.created_at.time_since_epoch()).count();
    int64_t completed_ms = 0;
    if (t.completed_at.time_since_epoch().count() > 0) {
        completed_ms = std::chrono::duration_cast<std::chrono::milliseconds>(t.completed_at.time_since_epoch()).count();
    }

    std::string save_dir = "";
    if (!t.save_path.empty()) {
        auto last_slash = t.save_path.find_last_of("\\/");
        if (last_slash != std::string::npos) {
            save_dir = t.save_path.substr(0, last_slash);
        }
    }

    int seg_count = t.chunks.empty() ? t.active_connections : static_cast<int>(t.chunks.size());

    int queue_pos = 0;
    if (t.status == core::TaskStatus::Queued) {
        queue_pos = 1;
        auto all_tasks = core::DownloadManager::Instance().GetTasks();
        for (const auto& item : all_tasks) {
            if (item.status == core::TaskStatus::Queued) {
                if (item.id == t.id) break;
                queue_pos++;
            }
        }
    }

    return json{
        {"queueOrder", t.queue_order},
        {"queuePosition", queue_pos},
        {"queuePos", queue_pos},
        {"id", t.id},
        {"name", t.filename},
        {"filename", t.filename},
        {"url", t.url},
        {"directUrl", t.direct_url},
        {"direct_url", t.direct_url},
        {"savePath", t.save_path},
        {"save_path", t.save_path},
        {"saveDir", save_dir},
        {"directory", save_dir},
        {"totalBytes", t.total_bytes},
        {"total_bytes", t.total_bytes},
        {"size", t.total_bytes},
        {"formattedSize", t.GetTotalFormatted()},
        {"downloadedBytes", t.downloaded_bytes},
        {"downloaded_bytes", t.downloaded_bytes},
        {"downloaded", t.downloaded_bytes},
        {"formattedDownloaded", t.GetDownloadedFormatted()},
        {"speed", t.speed_bps},
        {"speed_bps", t.speed_bps},
        {"speed_formatted", t.GetSpeedFormatted()},
        {"formattedSpeed", t.GetSpeedFormatted()},
        {"progress", t.GetProgressPercent()},
        {"progress_percent", t.GetProgressPercent()},
        {"eta", eta_sec},
        {"etaSeconds", eta_sec},
        {"eta_seconds", eta_sec},
        {"etaFormatted", t.GetEtaFormatted()},
        {"eta_formatted", t.GetEtaFormatted()},
        {"addedAt", added_ms},
        {"createdAt", added_ms},
        {"created_at", added_ms},
        {"completedAt", completed_ms},
        {"completed_at", completed_ms},
        {"isResumable", t.is_resumable},
        {"is_resumable", t.is_resumable},
        {"acceptRanges", t.is_resumable},
        {"connections", t.active_connections},
        {"activeConnections", t.active_connections},
        {"segmentsCount", seg_count},
        {"category", t.category},
        {"hoster", t.hoster},
        {"packageName", t.package_name},
        {"package_name", t.package_name},
        {"priority", priority_str},
        {"status", status_lower},
        {"statusText", t.GetStatusString()},
        {"error", t.error_message},
        {"errorMessage", t.error_message},
        {"isMedia", t.is_media},
        {"mediaFormat", t.media_format},
        {"sha256", t.sha256_hash},
        {"extractStatus", extract_status},
        {"extractProgress", t.extract_progress},
        {"multipart", multipart_obj},
        {"segments", segments},
        {"referrer", t.referrer},
        {"cookies", t.cookies},
        {"userAgent", t.user_agent}
    };
}

static std::string GetFileIconBase64(const std::string& filepath_or_ext) {
    std::wstring wpath = ToWide(filepath_or_ext);
    SHFILEINFOW sfi = {0};
    DWORD_PTR hr = SHGetFileInfoW(wpath.c_str(), FILE_ATTRIBUTE_NORMAL, &sfi, sizeof(sfi),
                                 SHGFI_ICON | SHGFI_SMALLICON | SHGFI_USEFILEATTRIBUTES);
    if (!hr || !sfi.hIcon) {
        return "";
    }

    ICONINFO ii = {0};
    GetIconInfo(sfi.hIcon, &ii);

    BITMAP bm = {0};
    GetObject(ii.hbmColor, sizeof(bm), &bm);

    HDC hdc = GetDC(nullptr);
    BITMAPINFO bi = {0};
    bi.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
    bi.bmiHeader.biWidth = bm.bmWidth;
    bi.bmiHeader.biHeight = bm.bmHeight;
    bi.bmiHeader.biPlanes = 1;
    bi.bmiHeader.biBitCount = 32;
    bi.bmiHeader.biCompression = BI_RGB;

    DWORD image_size = bm.bmWidth * bm.bmHeight * 4;
    std::vector<BYTE> pixels(image_size);
    GetDIBits(hdc, ii.hbmColor, 0, bm.bmHeight, pixels.data(), &bi, DIB_RGB_COLORS);
    ReleaseDC(nullptr, hdc);

    if (ii.hbmColor) DeleteObject(ii.hbmColor);
    if (ii.hbmMask) DeleteObject(ii.hbmMask);
    DestroyIcon(sfi.hIcon);

    BITMAPFILEHEADER bfh = {0};
    bfh.bfType = 0x4D42; // "BM"
    bfh.bfOffBits = sizeof(BITMAPFILEHEADER) + sizeof(BITMAPINFOHEADER);
    bfh.bfSize = bfh.bfOffBits + image_size;

    std::vector<BYTE> bmp_data(bfh.bfSize);
    memcpy(bmp_data.data(), &bfh, sizeof(bfh));
    memcpy(bmp_data.data() + sizeof(bfh), &bi.bmiHeader, sizeof(BITMAPINFOHEADER));
    memcpy(bmp_data.data() + bfh.bfOffBits, pixels.data(), image_size);

    static const char b64_chars[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    std::string b64;
    b64.reserve(((bmp_data.size() + 2) / 3) * 4);
    for (size_t i = 0; i < bmp_data.size(); i += 3) {
        uint32_t val = (bmp_data[i] << 16) | ((i + 1 < bmp_data.size() ? bmp_data[i + 1] : 0) << 8) | (i + 2 < bmp_data.size() ? bmp_data[i + 2] : 0);
        b64.push_back(b64_chars[(val >> 18) & 0x3F]);
        b64.push_back(b64_chars[(val >> 12) & 0x3F]);
        b64.push_back((i + 1 < bmp_data.size()) ? b64_chars[(val >> 6) & 0x3F] : '=');
        b64.push_back((i + 2 < bmp_data.size()) ? b64_chars[val & 0x3F] : '=');
    }

    return "data:image/bmp;base64," + b64;
}

ExtensionServer::ExtensionServer(int port)
    : port_(port), server_(std::make_unique<httplib::Server>()) {
}

ExtensionServer::~ExtensionServer() {
    Stop();
}

void ExtensionServer::SetupRoutes() {
    // Mount Frontend Static Web UI (HTML, CSS, JS, Assets)
    std::filesystem::path static_path;
    WCHAR exe_path_buf[MAX_PATH] = {0};
    GetModuleFileNameW(nullptr, exe_path_buf, MAX_PATH);
    std::filesystem::path exe_dir = std::filesystem::path(exe_path_buf).parent_path();

    if (std::filesystem::exists("src/frontend")) {
        static_path = "src/frontend";
    } else if (std::filesystem::exists("frontend")) {
        static_path = "frontend";
    } else if (std::filesystem::exists(exe_dir / "src" / "frontend")) {
        static_path = exe_dir / "src" / "frontend";
    } else if (std::filesystem::exists(exe_dir / "frontend")) {
        static_path = exe_dir / "frontend";
    }

    if (!static_path.empty()) {
        server_->set_mount_point("/", static_path.string());
        std::cout << "[ExtensionServer] Mounted Web UI from: " << static_path.string() << std::endl;
    } else {
        std::cerr << "[ExtensionServer] Warning: Web UI static directory not found!" << std::endl;
    }

    // CORS middleware
    server_->set_pre_routing_handler([](const httplib::Request& req, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        res.set_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
        res.set_header("Access-Control-Allow-Headers", "Content-Type, Authorization");
        if (req.method == "OPTIONS") {
            res.status = 204;
            return httplib::Server::HandlerResponse::Handled;
        }
        return httplib::Server::HandlerResponse::Unhandled;
    });

    // Health check & Click'n'Load detection
    server_->Get("/jdcheck.js", [](const httplib::Request&, httplib::Response& res) {
        res.set_content("jdownloader = true; var version='2.0';", "application/javascript");
    });

    // List all downloads
    server_->Get("/api/downloads", [](const httplib::Request&, httplib::Response& res) {
        auto tasks = core::DownloadManager::Instance().GetTasks();
        json j = json::array();
        for (const auto& t : tasks) {
            j.push_back(TaskToJson(t));
        }
        res.set_content(j.dump(), "application/json");
    });

    // Initial state payload
    server_->Get("/api/init", [](const httplib::Request&, httplib::Response& res) {
        auto tasks = core::DownloadManager::Instance().GetTasks();
        json tasks_json = json::array();
        int64_t global_speed = 0;
        for (const auto& t : tasks) {
            global_speed += t.speed_bps;
            tasks_json.push_back(TaskToJson(t));
        }

        auto pkgs = core::DownloadManager::Instance().GetGrabberPackages();
        json staged_json = json::array();
        for (const auto& p : pkgs) {
            json items = json::array();
            for (const auto& itm : p.items) {
                items.push_back({
                    {"url", itm.original_url},
                    {"originalUrl", itm.original_url},
                    {"direct_url", itm.direct_url},
                    {"filename", itm.filename},
                    {"size", itm.size},
                    {"hoster", itm.hoster}
                });
            }
            staged_json.push_back({
                {"id", p.name},
                {"packageName", p.name},
                {"name", p.name},
                {"hoster", p.hoster},
                {"items", items}
            });
        }

        auto cfg = core::ConfigManager::Instance().GetConfig();
        auto base_dir = core::StorageRouter::Instance().GetDefaultDownloadDir();
        auto all_cat_dirs = core::StorageRouter::Instance().GetAllCategoryDirectories(base_dir);
        json resp = {
            {"tasks", tasks_json},
            {"staged", staged_json},
            {"config", {
                {"downloadDirectory", cfg.download_directory},
                {"downloadDir", cfg.download_directory},
                {"categoryDirs", all_cat_dirs},
                {"maxConcurrentDownloads", cfg.max_concurrent_downloads},
                {"maxConcurrentPerHost", cfg.max_concurrent_per_host},
                {"speedLimitEnabled", cfg.speed_limit_enabled},
                {"speedLimitBps", cfg.speed_limit_bps},
                {"speedLimitBytesPerSec", cfg.speed_limit_bps},
                {"autoExtractArchives", cfg.auto_extract_archives},
                {"deleteArchiveAfterExtract", cfg.delete_archive_after_extract},
                {"archivePasswords", cfg.archive_passwords}
            }},
            {"globalSpeed", global_speed}
        };
        res.set_content(resp.dump(), "application/json");
    });

    // Config API
    server_->Get("/api/config", [](const httplib::Request&, httplib::Response& res) {
        auto cfg = core::ConfigManager::Instance().GetConfig();
        json j = {
            {"downloadDirectory", cfg.download_directory},
            {"maxConcurrentDownloads", cfg.max_concurrent_downloads},
            {"maxConcurrentPerHost", cfg.max_concurrent_per_host},
            {"defaultConnectionsPerTask", cfg.default_connections_per_task},
            {"speedLimitEnabled", cfg.speed_limit_enabled},
            {"speedLimitBps", cfg.speed_limit_bps},
            {"autoExtractArchives", cfg.auto_extract_archives},
            {"deleteArchiveAfterExtract", cfg.delete_archive_after_extract},
            {"archivePasswords", cfg.archive_passwords},
            {"showConsole", cfg.show_console},
            {"closeAction", cfg.close_action},
            {"firstRunCompleted", cfg.first_run_completed},
            {"startWithWindows", core::ShellIntegration::Instance().IsStartWithWindows()}
        };
        res.set_content(j.dump(), "application/json");
    });

    // Add new download
    server_->Post("/api/downloads", [](const httplib::Request& req, httplib::Response& res) {
        try {
            auto body = json::parse(req.body);
            std::string url = body.value("url", "");
            std::string filename = body.value("filename", "");
            std::string folder = body.value("target_folder", "");
            if (folder.empty()) {
                folder = body.value("saveDir", "");
            }
            std::string referrer = body.value("referrer", "");
            if (referrer.empty()) referrer = body.value("source", "");
            std::string cookies = body.value("cookies", "");
            std::string user_agent = body.value("userAgent", "");
            int64_t total_size = body.value("totalBytes", (int64_t)0);
            if (total_size == 0) total_size = body.value("size", (int64_t)0);

            if (url.empty()) {
                res.status = 400;
                res.set_content(R"({"error":"url is required"})", "application/json");
                return;
            }

            bool confirmed = body.value("confirmed", false) || body.value("force", false) || body.value("openProgress", false) || body.value("open_progress", false);

            // If not confirmed yet, DO NOT start download! Wait for user in Download File Info dialog.
            if (!confirmed) {
                json probe = body;
                probe["url"] = url;
                probe["referrer"] = referrer;
                probe["cookies"] = cookies;
                probe["userAgent"] = user_agent;

                std::string fname = core::ChunkEngine::UrlDecode(filename);
                bool accept_ranges = true;
                int probe_status = 200;

                // Probe URL headers for real filename & size
                try {
                    auto info = core::ChunkEngine::ProbeUrl(url, referrer, cookies, user_agent);
                    if (!info.filename.empty() && fname.empty()) fname = info.filename;
                    if (info.total_size > 0 && total_size == 0) total_size = info.total_size;
                    accept_ranges = info.supports_range;
                    if (info.status_code > 0) probe_status = info.status_code;
                } catch (...) {}

                if (fname.empty()) {
                    fname = url.substr(url.find_last_of("/\\") + 1);
                    size_t q = fname.find('?');
                    if (q != std::string::npos) fname = fname.substr(0, q);
                    fname = core::ChunkEngine::UrlDecode(fname);
                    if (fname.empty()) fname = "download";
                }
                probe["filename"] = fname;
                probe["totalBytes"] = total_size;
                probe["acceptRanges"] = accept_ranges;
                probe["statusCode"] = probe_status;
                probe["status_code"] = probe_status;

                // Duplicate Detection for incoming downloads
                auto existing_tasks = core::DownloadManager::Instance().GetTasks();
                for (const auto& et : existing_tasks) {
                    bool url_match = (et.url == url);
                    bool name_match = (!fname.empty() && (et.filename == fname));
                    if (url_match || name_match) {
                        json match;
                        match["id"] = et.id;
                        match["name"] = et.filename;
                        match["savePath"] = et.save_path;
                        match["isDone"] = (et.status == core::TaskStatus::Completed);
                        match["status"] = (et.status == core::TaskStatus::Completed) ? "completed"
                            : (et.status == core::TaskStatus::Downloading) ? "downloading"
                            : (et.status == core::TaskStatus::Paused) ? "paused"
                            : (et.status == core::TaskStatus::Queued) ? "queued" : "error";
                        int pct = 0;
                        if (et.total_bytes > 0) {
                            pct = static_cast<int>((static_cast<double>(et.downloaded_bytes) / static_cast<double>(et.total_bytes)) * 100.0);
                        }
                        match["percent"] = pct;
                        match["downloadedBytes"] = et.downloaded_bytes;
                        match["totalBytes"] = et.total_bytes;
                        match["isArchive"] = et.is_multipart || (et.filename.find(".zip") != std::string::npos) || (et.filename.find(".rar") != std::string::npos) || (et.filename.find(".7z") != std::string::npos);
                        probe["existingMatch"] = match;
                        break;
                    }
                }

                auto cat = core::StorageRouter::Instance().CategorizeFile(fname);
                std::string cat_str = core::StorageRouter::Instance().CategoryToString(cat);
                auto base_dir = core::StorageRouter::Instance().GetDefaultDownloadDir();
                auto target_dir = folder.empty()
                    ? core::StorageRouter::Instance().ResolveCategoryDirectory(cat, base_dir)
                    : std::filesystem::path(folder);
                auto all_cat_dirs = core::StorageRouter::Instance().GetAllCategoryDirectories(base_dir);

                probe["category"] = cat_str;
                probe["defaultSaveDir"] = target_dir.string();
                probe["rootDownloadDir"] = base_dir.string();
                probe["categoryDirs"] = all_cat_dirs;

                g_pending_confirm_json = probe.dump();

                // Open Download File Info (confirm.html) Top Window
                ui::WebViewUiManager::Instance().OpenDialogWindow(
                    "http://127.0.0.1:4567/confirm.html",
                    680, 750, true /* Top Window */,
                    L"Waterfall — Download File Info", "confirm", 0
                );

                json resp = {
                    {"success", true},
                    {"waitingForConfirmation", true},
                    {"message", "Download File Info window opened. Awaiting user confirmation."}
                };
                res.set_content(resp.dump(), "application/json");
                return;
            }

            // User has confirmed the download in confirm.html:
            int id = core::DownloadManager::Instance().AddDownload(
                url, filename, folder, 2, false, "",
                referrer, cookies, user_agent, total_size
            );
            bool auto_start = body.value("autoStart", true);
            if (body.contains("autostart")) {
                auto_start = body.value("autostart", true);
            }

            if (id > 0) {
                if (!auto_start) {
                    // User selected "Download Later"
                    core::DownloadManager::Instance().PauseDownload(id);
                } else if (body.value("openProgress", false) || body.value("open_progress", false)) {
                    std::string prog_url = "http://127.0.0.1:4567/download-progress.html?taskId=" + std::to_string(id);
                    ui::WebViewUiManager::Instance().OpenDialogWindow(
                        prog_url, 660, 600, false,
                        L"Waterfall — Download Progress", "progress", id
                    );
                }
            }
            json resp = {
                {"success", true},
                {"id", id}
            };
            res.set_content(resp.dump(), "application/json");
        } catch (const std::exception& e) {
            res.status = 400;
            res.set_content(json({{"error", e.what()}}).dump(), "application/json");
        }
    });

    // Pause download
    server_->Post(R"(/api/downloads/(\d+)/pause)", [](const httplib::Request& req, httplib::Response& res) {
        int id = std::stoi(req.matches[1]);
        bool ok = core::DownloadManager::Instance().PauseDownload(id);
        res.set_content(json({{"success", ok}}).dump(), "application/json");
    });

    // Resume download (respects queue limits)
    server_->Post(R"(/api/downloads/(\d+)/resume)", [](const httplib::Request& req, httplib::Response& res) {
        int id = std::stoi(req.matches[1]);
        bool ok = core::DownloadManager::Instance().ResumeDownload(id);
        res.set_content(json({{"success", ok}}).dump(), "application/json");
    });

    // Force start download (bypasses queue limit)
    server_->Post(R"(/api/downloads/(\d+)/force-start)", [](const httplib::Request& req, httplib::Response& res) {
        int id = std::stoi(req.matches[1]);
        bool ok = core::DownloadManager::Instance().ForceStartDownload(id);
        res.set_content(json({{"success", ok}}).dump(), "application/json");
    });

    // Delete download
    server_->Delete(R"(/api/downloads/(\d+))", [](const httplib::Request& req, httplib::Response& res) {
        int id = std::stoi(req.matches[1]);
        bool delete_file = req.has_param("delete_file") && req.get_param_value("delete_file") == "true";
        bool ok = core::DownloadManager::Instance().DeleteDownload(id, delete_file);
        res.set_content(json({{"success", ok}}).dump(), "application/json");
    });

    // Pause all
    server_->Post("/api/downloads/pause-all", [](const httplib::Request&, httplib::Response& res) {
        auto tasks = core::DownloadManager::Instance().GetTasks();
        for (const auto& t : tasks) {
            if (t.status == core::TaskStatus::Downloading) {
                core::DownloadManager::Instance().PauseDownload(t.id);
            }
        }
        res.set_content(R"({"success":true})", "application/json");
    });

    // Resume all
    server_->Post("/api/downloads/resume-all", [](const httplib::Request&, httplib::Response& res) {
        auto tasks = core::DownloadManager::Instance().GetTasks();
        for (const auto& t : tasks) {
            if (t.status == core::TaskStatus::Paused) {
                core::DownloadManager::Instance().ResumeDownload(t.id);
            }
        }
        res.set_content(R"({"success":true})", "application/json");
    });

    // Clear completed
    server_->Post("/api/downloads/clear-completed", [](const httplib::Request&, httplib::Response& res) {
        auto tasks = core::DownloadManager::Instance().GetTasks();
        for (const auto& t : tasks) {
            if (t.status == core::TaskStatus::Completed) {
                core::DownloadManager::Instance().DeleteDownload(t.id, false);
            }
        }
        res.set_content(R"({"success":true})", "application/json");
    });

    // Batch download operations
    server_->Post("/api/downloads/batch", [](const httplib::Request& req, httplib::Response& res) {
        try {
            auto body = json::parse(req.body);
            std::string action = body.value("action", "");
            const json* arr = nullptr;
            if (body.contains("taskIds") && body["taskIds"].is_array()) arr = &body["taskIds"];
            else if (body.contains("ids") && body["ids"].is_array()) arr = &body["ids"];

            if (arr) {
                for (auto& item : *arr) {
                    int id = item.is_number() ? item.get<int>() : std::stoi(item.get<std::string>());
                    if (action == "resume") core::DownloadManager::Instance().ResumeDownload(id);
                    else if (action == "pause") core::DownloadManager::Instance().PauseDownload(id);
                    else if (action == "delete") core::DownloadManager::Instance().DeleteDownload(id, false);
                }
            }
            res.set_content(R"({"success":true})", "application/json");
        } catch (const std::exception& e) {
            res.status = 400;
            res.set_content(json({{"error", e.what()}}).dump(), "application/json");
        }
    });

    // Open containing folder in Windows Explorer
    server_->Post("/api/open-folder", [](const httplib::Request& req, httplib::Response& res) {
        try {
            auto body = json::parse(req.body);
            std::string path = body.value("path", "");
            if (!path.empty()) {
                if (std::filesystem::is_directory(path)) {
                    std::string param = "\"" + path + "\"";
                    ShellExecuteA(nullptr, "open", "explorer.exe", param.c_str(), nullptr, SW_SHOW);
                } else {
                    std::string param = "/select,\"" + path + "\"";
                    ShellExecuteA(nullptr, "open", "explorer.exe", param.c_str(), nullptr, SW_SHOW);
                }
                res.set_content(R"({"success":true})", "application/json");
                return;
            }
        } catch (...) {}
        res.status = 400;
        res.set_content(R"({"error":"invalid path"})", "application/json");
    });

    // Companion Extension Info & Location
    server_->Get("/api/extension-info", [exe_dir](const httplib::Request&, httplib::Response& res) {
        std::filesystem::path ext_path;
        if (std::filesystem::exists(exe_dir / "extension")) {
            ext_path = std::filesystem::canonical(exe_dir / "extension");
        } else if (std::filesystem::exists("extension")) {
            ext_path = std::filesystem::canonical("extension");
        } else if (std::filesystem::exists(exe_dir / "src" / "extension")) {
            ext_path = std::filesystem::canonical(exe_dir / "src" / "extension");
        } else if (std::filesystem::exists("src/extension")) {
            ext_path = std::filesystem::canonical("src/extension");
        } else {
            ext_path = exe_dir / "extension";
        }
        json response = {
            {"extension_path", ext_path.string()},
            {"exists", std::filesystem::exists(ext_path)},
            {"version", "2.0.1"},
            {"port", 4567},
            {"online", true}
        };
        res.set_content(response.dump(), "application/json");
    });

    // Open Extension Folder directly in Explorer
    server_->Post("/api/open-extension-folder", [exe_dir](const httplib::Request&, httplib::Response& res) {
        std::filesystem::path ext_path;
        if (std::filesystem::exists(exe_dir / "extension")) {
            ext_path = exe_dir / "extension";
        } else if (std::filesystem::exists("extension")) {
            ext_path = std::filesystem::canonical("extension");
        } else if (std::filesystem::exists(exe_dir / "src" / "extension")) {
            ext_path = exe_dir / "src" / "extension";
        } else if (std::filesystem::exists("src/extension")) {
            ext_path = std::filesystem::canonical("src/extension");
        } else {
            ext_path = exe_dir / "extension";
        }
        std::error_code ec;
        if (!std::filesystem::exists(ext_path)) {
            std::filesystem::create_directories(ext_path, ec);
        }
        std::string param = "\"" + ext_path.string() + "\"";
        ShellExecuteA(nullptr, "open", "explorer.exe", param.c_str(), nullptr, SW_SHOW);
        json r = {{"success", true}, {"path", ext_path.string()}};
        res.set_content(r.dump(), "application/json");
    });

    // Open file with default Windows associated application
    server_->Post("/api/open-file", [](const httplib::Request& req, httplib::Response& res) {
        try {
            auto body = json::parse(req.body);
            std::string path = body.value("path", "");
            if (!path.empty()) {
                ShellExecuteA(nullptr, "open", path.c_str(), nullptr, nullptr, SW_SHOW);
                res.set_content(R"({"success":true})", "application/json");
                return;
            }
        } catch (...) {}
        res.status = 400;
        res.set_content(R"({"error":"invalid path"})", "application/json");
    });

    // Native Win32 Browse Folder Dialog
    server_->Post("/api/browse-folder", [](const httplib::Request&, httplib::Response& res) {
        std::string selected_path = "";
        CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE);
        IFileOpenDialog* pFileOpen = nullptr;
        if (SUCCEEDED(CoCreateInstance(CLSID_FileOpenDialog, nullptr, CLSCTX_ALL, IID_IFileOpenDialog, reinterpret_cast<void**>(&pFileOpen)))) {
            DWORD dwOptions = 0;
            if (SUCCEEDED(pFileOpen->GetOptions(&dwOptions))) {
                pFileOpen->SetOptions(dwOptions | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM);
            }
            if (SUCCEEDED(pFileOpen->Show(nullptr))) {
                IShellItem* pItem = nullptr;
                if (SUCCEEDED(pFileOpen->GetResult(&pItem))) {
                    PWSTR pszFilePath = nullptr;
                    if (SUCCEEDED(pItem->GetDisplayName(SIGDN_FILESYSPATH, &pszFilePath))) {
                        int size_needed = WideCharToMultiByte(CP_UTF8, 0, pszFilePath, -1, nullptr, 0, nullptr, nullptr);
                        if (size_needed > 1) {
                            selected_path.resize(size_needed - 1);
                            WideCharToMultiByte(CP_UTF8, 0, pszFilePath, -1, &selected_path[0], size_needed, nullptr, nullptr);
                        }
                        CoTaskMemFree(pszFilePath);
                    }
                    pItem->Release();
                }
            }
            pFileOpen->Release();
        }
        res.set_content(json({{"success", !selected_path.empty()}, {"folder", selected_path}}).dump(), "application/json");
    });

    // FlashGot & Click'n'Load batch ingestion
    auto handle_flashgot = [](const httplib::Request& req, httplib::Response& res) {
        std::string urls_raw;
        if (req.has_param("urls")) {
            urls_raw = req.get_param_value("urls");
        } else {
            urls_raw = req.body;
        }

        std::istringstream stream(urls_raw);
        std::string line;
        int count = 0;
        while (std::getline(stream, line)) {
            // Trim carriage return / whitespace
            while (!line.empty() && (line.back() == '\r' || line.back() == ' ')) line.pop_back();
            if (line.rfind("http", 0) == 0) {
                core::DownloadManager::Instance().AddDownload(line);
                count++;
            }
        }
        res.set_content(json({{"success", true}, {"added", count}}).dump(), "application/json");
    };

    server_->Post("/flashgot", handle_flashgot);
    server_->Post("/flashgot/", handle_flashgot);
    server_->Post("/flash/add", handle_flashgot);

    // Deep Link Crawler API
    server_->Post("/api/crawler/crawl", [](const httplib::Request& req, httplib::Response& res) {
        try {
            auto body = json::parse(req.body);
            std::string text = body.value("text", "");
            auto pkgs = core::CrawlerEngine::Instance().CrawlText(text);

            json j_pkgs = json::array();
            for (const auto& p : pkgs) {
                json j_items = json::array();
                for (const auto& itm : p.items) {
                    j_items.push_back({
                        {"original_url", itm.original_url},
                        {"direct_url", itm.direct_url},
                        {"filename", itm.filename},
                        {"size", itm.size},
                        {"hoster", itm.hoster}
                    });
                }
                j_pkgs.push_back({
                    {"name", p.name},
                    {"hoster", p.hoster},
                    {"items", j_items}
                });
            }
            res.set_content(json({{"success", true}, {"packages", j_pkgs}}).dump(), "application/json");
        } catch (const std::exception& e) {
            res.status = 400;
            res.set_content(json({{"error", e.what()}}).dump(), "application/json");
        }
    });

    // YouTube / Media Metadata Probe API
    server_->Post("/api/media/probe", [](const httplib::Request& req, httplib::Response& res) {
        try {
            auto body = json::parse(req.body);
            std::string url = body.value("url", "");
            auto meta = core::MediaEngine::Instance().ProbeMedia(url);

            json j_formats = json::array();
            for (const auto& fmt : meta.formats) {
                j_formats.push_back({
                    {"id", fmt.id},
                    {"type", fmt.type},
                    {"ext", fmt.ext},
                    {"quality", fmt.quality},
                    {"label", fmt.label}
                });
            }

            json resp = {
                {"success", meta.is_valid},
                {"id", meta.id},
                {"title", meta.title},
                {"uploader", meta.uploader},
                {"duration", meta.duration},
                {"thumbnail", meta.thumbnail},
                {"is_playlist", meta.is_playlist},
                {"formats", j_formats}
            };
            res.set_content(resp.dump(), "application/json");
        } catch (const std::exception& e) {
            res.status = 400;
            res.set_content(json({{"error", e.what()}}).dump(), "application/json");
        }
    });

    // Settings API
    server_->Get("/api/settings", [](const httplib::Request&, httplib::Response& res) {
        auto cfg = core::ConfigManager::Instance().GetConfig();
        std::string power_str = "none";
        if (cfg.post_queue_power_action == core::PowerAction::Sleep) power_str = "sleep";
        else if (cfg.post_queue_power_action == core::PowerAction::Shutdown) power_str = "shutdown";

        json j = {
            {"download_directory", cfg.download_directory},
            {"max_concurrent_downloads", cfg.max_concurrent_downloads},
            {"max_concurrent_per_host", cfg.max_concurrent_per_host},
            {"default_connections_per_task", cfg.default_connections_per_task},
            {"speed_limit_enabled", cfg.speed_limit_enabled},
            {"speed_limit_bps", cfg.speed_limit_bps},
            {"auto_extract_archives", cfg.auto_extract_archives},
            {"delete_archive_after_extract", cfg.delete_archive_after_extract},
            {"archive_passwords", cfg.archive_passwords},
            {"post_queue_power_action", power_str},
            {"show_console", cfg.show_console},
            {"close_action", cfg.close_action},
            {"first_run_completed", cfg.first_run_completed},
            {"start_with_windows", core::ShellIntegration::Instance().IsStartWithWindows()}
        };
        res.set_content(j.dump(), "application/json");
    });

    server_->Post("/api/settings", [](const httplib::Request& req, httplib::Response& res) {
        try {
            auto body = json::parse(req.body);
            auto cfg = core::ConfigManager::Instance().GetConfig();
            if (body.contains("download_directory")) cfg.download_directory = body["download_directory"];
            else if (body.contains("downloadDir")) cfg.download_directory = body["downloadDir"];

            if (body.contains("max_concurrent_downloads")) cfg.max_concurrent_downloads = body["max_concurrent_downloads"];
            else if (body.contains("maxConcurrentDownloads")) cfg.max_concurrent_downloads = body["maxConcurrentDownloads"];

            if (body.contains("max_concurrent_per_host")) cfg.max_concurrent_per_host = body["max_concurrent_per_host"];
            else if (body.contains("maxConcurrentPerHost")) cfg.max_concurrent_per_host = body["maxConcurrentPerHost"];

            if (body.contains("default_connections_per_task")) cfg.default_connections_per_task = body["default_connections_per_task"];
            else if (body.contains("segmentsPerFile")) cfg.default_connections_per_task = body["segmentsPerFile"];

            if (body.contains("speed_limit_enabled")) cfg.speed_limit_enabled = body["speed_limit_enabled"];
            else if (body.contains("speedLimitEnabled")) cfg.speed_limit_enabled = body["speedLimitEnabled"];

            if (body.contains("speed_limit_bps")) cfg.speed_limit_bps = body["speed_limit_bps"];
            else if (body.contains("speedLimitBytesPerSec")) cfg.speed_limit_bps = body["speedLimitBytesPerSec"];

            if (body.contains("auto_extract_archives")) cfg.auto_extract_archives = body["auto_extract_archives"];
            else if (body.contains("autoExtractArchives")) cfg.auto_extract_archives = body["autoExtractArchives"];

            if (body.contains("delete_archive_after_extract")) cfg.delete_archive_after_extract = body["delete_archive_after_extract"];
            else if (body.contains("deleteArchiveAfterExtract")) cfg.delete_archive_after_extract = body["deleteArchiveAfterExtract"];

            if (body.contains("archive_passwords") && body["archive_passwords"].is_array()) {
                cfg.archive_passwords = body["archive_passwords"].get<std::vector<std::string>>();
            }
            if (body.contains("show_console")) {
                cfg.show_console = body["show_console"];
                HWND consoleHwnd = GetConsoleWindow();
                if (consoleHwnd) {
                    ShowWindow(consoleHwnd, cfg.show_console ? SW_SHOW : SW_HIDE);
                    if (cfg.show_console) SetForegroundWindow(consoleHwnd);
                }
            }
            if (body.contains("close_action")) {
                cfg.close_action = body["close_action"];
            }
            if (body.contains("first_run_completed")) {
                cfg.first_run_completed = body["first_run_completed"].get<bool>();
            }
            if (body.contains("start_with_windows")) {
                bool start_win = body["start_with_windows"].get<bool>();
                cfg.start_with_windows = start_win;
                core::ShellIntegration::Instance().SetStartWithWindows(start_win);
            }
            core::ConfigManager::Instance().UpdateConfig(cfg);

            // Re-schedule queue immediately in case slots opened up
            auto all_tasks = core::DownloadManager::Instance().GetTasks();
            core::QueueScheduler::Instance().Schedule(all_tasks, [](int id) {
                core::DownloadManager::Instance().StartTaskInternal(id);
            });
            core::DownloadManager::Instance().NotifyUpdate();

            res.set_content(R"({"success":true})", "application/json");
        } catch (const std::exception& e) {
            res.status = 400;
            res.set_content(json({{"error", e.what()}}).dump(), "application/json");
        }
    });

    server_->Post("/api/queue/max-concurrent", [](const httplib::Request& req, httplib::Response& res) {
        try {
            auto body = json::parse(req.body);
            int max_dl = body.value("maxConcurrent", body.value("max_concurrent", 3));
            if (max_dl < 1) max_dl = 1;
            auto cfg = core::ConfigManager::Instance().GetConfig();
            cfg.max_concurrent_downloads = max_dl;
            core::ConfigManager::Instance().UpdateConfig(cfg);
            auto all_tasks = core::DownloadManager::Instance().GetTasks();
            core::QueueScheduler::Instance().Schedule(all_tasks, [](int id) {
                core::DownloadManager::Instance().StartTaskInternal(id);
            });
            core::DownloadManager::Instance().NotifyUpdate();
            res.set_content(json({{"success", true}, {"maxConcurrent", max_dl}}).dump(), "application/json");
        } catch (...) {
            res.status = 400;
            res.set_content(R"({"error":"Invalid request"})", "application/json");
        }
    });

    // Console Toggle API
    server_->Get("/api/system/console", [](const httplib::Request&, httplib::Response& res) {
        auto cfg = core::ConfigManager::Instance().GetConfig();
        HWND consoleHwnd = GetConsoleWindow();
        bool visible = consoleHwnd && IsWindowVisible(consoleHwnd);
        res.set_content(json({{"show", cfg.show_console}, {"visible", visible}}).dump(), "application/json");
    });

    server_->Post("/api/system/console", [](const httplib::Request& req, httplib::Response& res) {
        try {
            auto body = json::parse(req.body);
            bool show = body.value("show", false);
            auto cfg = core::ConfigManager::Instance().GetConfig();
            cfg.show_console = show;
            core::ConfigManager::Instance().UpdateConfig(cfg);

            HWND consoleHwnd = GetConsoleWindow();
            if (consoleHwnd) {
                ShowWindow(consoleHwnd, show ? SW_SHOW : SW_HIDE);
                if (show) SetForegroundWindow(consoleHwnd);
            }
            res.set_content(json({{"success", true}, {"show", show}}).dump(), "application/json");
        } catch (const std::exception& e) {
            res.status = 400;
            res.set_content(json({{"error", e.what()}}).dump(), "application/json");
        }
    });

    // System Tray & Exit Lifecycle API
    server_->Post("/api/system/minimize-tray", [](const httplib::Request&, httplib::Response& res) {
        ui::WebViewUiManager::Instance().MinimizeToTray();
        res.set_content(R"({"success":true,"action":"tray"})", "application/json");
    });

    server_->Post("/api/system/restore-tray", [](const httplib::Request&, httplib::Response& res) {
        core::ShellIntegration::Instance().RestoreFromTray();
        res.set_content(R"({"success":true,"action":"restore"})", "application/json");
    });

    server_->Post("/api/system/exit", [](const httplib::Request&, httplib::Response& res) {
        res.set_content(R"({"success":true,"action":"exit"})", "application/json");
        std::thread([]() {
            std::this_thread::sleep_for(std::chrono::milliseconds(200));
            ui::WebViewUiManager::Instance().ExitApp();
        }).detach();
    });

    // First-Run Lifecycle API
    server_->Get("/api/system/first-run", [](const httplib::Request&, httplib::Response& res) {
        bool completed = core::ConfigManager::Instance().IsFirstRunCompleted();
        res.set_content(json({{"completed", completed}}).dump(), "application/json");
    });

    server_->Post("/api/system/complete-first-run", [](const httplib::Request& req, httplib::Response& res) {
        try {
            auto cfg = core::ConfigManager::Instance().GetConfig();
            if (!req.body.empty()) {
                auto body = json::parse(req.body);
                if (body.contains("download_directory")) cfg.download_directory = body["download_directory"];
                if (body.contains("max_concurrent_downloads")) cfg.max_concurrent_downloads = body["max_concurrent_downloads"];
                if (body.contains("default_connections_per_task")) cfg.default_connections_per_task = body["default_connections_per_task"];
                if (body.contains("auto_extract_archives")) cfg.auto_extract_archives = body["auto_extract_archives"];
                if (body.contains("close_action")) cfg.close_action = body["close_action"];
                if (body.contains("start_with_windows")) {
                    bool start_win = body["start_with_windows"].get<bool>();
                    cfg.start_with_windows = start_win;
                    core::ShellIntegration::Instance().SetStartWithWindows(start_win);
                }
            }
            cfg.first_run_completed = true;
            core::ConfigManager::Instance().UpdateConfig(cfg);
            res.set_content(R"({"success":true,"firstRunCompleted":true})", "application/json");
        } catch (const std::exception& e) {
            res.status = 400;
            res.set_content(json({{"error", e.what()}}).dump(), "application/json");
        }
    });

    server_->Post("/api/system/reset-first-run", [](const httplib::Request&, httplib::Response& res) {
        auto cfg = core::ConfigManager::Instance().GetConfig();
        cfg.first_run_completed = false;
        core::ConfigManager::Instance().UpdateConfig(cfg);
        res.set_content(R"({"success":true,"firstRunCompleted":false})", "application/json");
    });

    server_->Get("/api/system/start-with-windows", [](const httplib::Request&, httplib::Response& res) {
        bool enabled = core::ShellIntegration::Instance().IsStartWithWindows();
        res.set_content(json({{"enabled", enabled}}).dump(), "application/json");
    });

    server_->Post("/api/system/start-with-windows", [](const httplib::Request& req, httplib::Response& res) {
        try {
            auto body = json::parse(req.body);
            bool enable = body.value("enable", true);
            bool ok = core::ShellIntegration::Instance().SetStartWithWindows(enable);
            auto cfg = core::ConfigManager::Instance().GetConfig();
            cfg.start_with_windows = enable;
            core::ConfigManager::Instance().UpdateConfig(cfg);
            res.set_content(json({{"success", ok}, {"enabled", enable}}).dump(), "application/json");
        } catch (const std::exception& e) {
            res.status = 400;
            res.set_content(json({{"error", e.what()}}).dump(), "application/json");
        }
    });

    // 1. Verify Checksum
    auto handle_verify = [](const httplib::Request& req, httplib::Response& res) {
        int id = std::stoi(req.matches[1]);
        std::string hash;
        bool ok = core::DownloadManager::Instance().VerifyChecksum(id, hash);
        res.set_content(json({{"success", ok}, {"hash", hash}, {"verified", ok}}).dump(), "application/json");
    };
    server_->Get(R"(/api/downloads/(\d+)/verify)", handle_verify);
    server_->Post(R"(/api/downloads/(\d+)/verify)", handle_verify);

    // 2. Extract Archive
    server_->Post(R"(/api/downloads/(\d+)/extract)", [](const httplib::Request& req, httplib::Response& res) {
        int id = std::stoi(req.matches[1]);
        std::string pwd;
        if (!req.body.empty()) {
            try {
                auto body = json::parse(req.body);
                pwd = body.value("password", "");
            } catch (...) {}
        }
        bool ok = core::DownloadManager::Instance().ExtractTask(id, pwd);
        res.set_content(json({{"success", ok}}).dump(), "application/json");
    });

    // 3. Set Archive Password & Trigger Extract
    server_->Post(R"(/api/downloads/(\d+)/set-password)", [](const httplib::Request& req, httplib::Response& res) {
        int id = std::stoi(req.matches[1]);
        std::string pwd;
        try {
            auto body = json::parse(req.body);
            pwd = body.value("password", "");
            if (!pwd.empty()) {
                auto cfg = core::ConfigManager::Instance().GetConfig();
                cfg.archive_passwords.push_back(pwd);
                core::ConfigManager::Instance().UpdateConfig(cfg);
            }
        } catch (...) {}
        bool ok = core::DownloadManager::Instance().ExtractTask(id, pwd);
        res.set_content(json({{"success", ok}}).dump(), "application/json");
    });

    // 4. Update Expired URL & Resume
    server_->Post(R"(/api/downloads/(\d+)/update-url)", [](const httplib::Request& req, httplib::Response& res) {
        try {
            int id = std::stoi(req.matches[1]);
            auto body = json::parse(req.body);
            std::string new_url = body.value("url", "");
            if (new_url.empty()) {
                res.status = 400;
                res.set_content(R"({"error":"url is required"})", "application/json");
                return;
            }
            bool ok = core::DownloadManager::Instance().UpdateDownloadUrl(id, new_url);
            res.set_content(json({{"success", ok}}).dump(), "application/json");
        } catch (const std::exception& e) {
            res.status = 400;
            res.set_content(json({{"error", e.what()}}).dump(), "application/json");
        }
    });

    // 5. Live Media Stream ("Watch As You Download") with HTTP Range Support
    server_->Get(R"(/api/downloads/(\d+)/stream)", [](const httplib::Request& req, httplib::Response& res) {
        int id = std::stoi(req.matches[1]);
        auto* task = core::DownloadManager::Instance().GetTaskPtr(id);
        if (!task || task->save_path.empty()) {
            res.status = 404;
            res.set_content("Download task not found", "text/plain");
            return;
        }

        std::wstring wpath = ToWide(task->save_path);
        HANDLE h_file = CreateFileW(wpath.c_str(), GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr,
                                    OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
        if (h_file == INVALID_HANDLE_VALUE) {
            res.status = 404;
            res.set_content("Target file not accessible on disk yet", "text/plain");
            return;
        }

        LARGE_INTEGER size_li;
        GetFileSizeEx(h_file, &size_li);
        int64_t file_size = size_li.QuadPart;
        if (file_size <= 0 && task->total_bytes > 0) {
            file_size = task->total_bytes;
        }
        if (file_size <= 0) {
            CloseHandle(h_file);
            res.status = 404;
            res.set_content("File is empty", "text/plain");
            return;
        }

        std::string content_type = "video/mp4";
        std::string fn = task->filename;
        std::transform(fn.begin(), fn.end(), fn.begin(), ::tolower);
        if (fn.ends_with(".mp3")) content_type = "audio/mpeg";
        else if (fn.ends_with(".m4a")) content_type = "audio/mp4";
        else if (fn.ends_with(".flac")) content_type = "audio/flac";
        else if (fn.ends_with(".wav")) content_type = "audio/wav";
        else if (fn.ends_with(".webm")) content_type = "video/webm";
        else if (fn.ends_with(".mkv")) content_type = "video/x-matroska";

        int64_t start_byte = 0;
        int64_t end_byte = file_size - 1;
        bool is_range = false;

        if (req.has_header("Range")) {
            std::string range_hdr = req.get_header_value("Range");
            if (range_hdr.rfind("bytes=", 0) == 0) {
                std::string spec = range_hdr.substr(6);
                size_t dash = spec.find('-');
                if (dash != std::string::npos) {
                    is_range = true;
                    std::string s_str = spec.substr(0, dash);
                    std::string e_str = spec.substr(dash + 1);
                    if (!s_str.empty()) start_byte = std::stoll(s_str);
                    if (!e_str.empty()) end_byte = std::stoll(e_str);
                }
            }
        }

        if (start_byte >= file_size) {
            CloseHandle(h_file);
            res.status = 416; // Range Not Satisfiable
            res.set_header("Content-Range", "bytes */" + std::to_string(file_size));
            return;
        }

        if (end_byte >= file_size) {
            end_byte = file_size - 1;
        }

        // Chunk streaming window (max 2MB per slice)
        if (end_byte - start_byte + 1 > (2 * 1024 * 1024)) {
            end_byte = start_byte + (2 * 1024 * 1024) - 1;
        }

        int64_t content_length = end_byte - start_byte + 1;
        res.set_header("Accept-Ranges", "bytes");
        res.set_header("Content-Type", content_type);

        if (is_range) {
            res.status = 206;
            res.set_header("Content-Range", "bytes " + std::to_string(start_byte) + "-" + std::to_string(end_byte) + "/" + std::to_string(file_size));
        } else {
            res.status = 200;
        }
        res.set_header("Content-Length", std::to_string(content_length));

        LARGE_INTEGER seek_li;
        seek_li.QuadPart = start_byte;
        SetFilePointerEx(h_file, seek_li, nullptr, FILE_BEGIN);

        std::string buffer;
        buffer.resize(static_cast<size_t>(content_length));
        DWORD read_bytes = 0;
        ReadFile(h_file, &buffer[0], static_cast<DWORD>(content_length), &read_bytes, nullptr);
        CloseHandle(h_file);

        buffer.resize(read_bytes);
        res.set_content(buffer, content_type);
    });

    // 6. Pre-Download Probe API
    server_->Post("/api/downloads/probe", [](const httplib::Request& req, httplib::Response& res) {
        try {
            auto body = json::parse(req.body);
            std::string url = body.value("url", "");
            if (url.empty()) {
                res.status = 400;
                res.set_content(R"({"error":"url is required"})", "application/json");
                return;
            }
            auto info = core::ChunkEngine::ProbeUrl(url);
            auto cat = core::StorageRouter::Instance().CategorizeFile(info.filename);
            std::string cat_str = core::StorageRouter::Instance().CategoryToString(cat);
            auto base_dir = core::StorageRouter::Instance().GetDefaultDownloadDir();
            auto target_dir = core::StorageRouter::Instance().ResolveCategoryDirectory(cat, base_dir);
            auto all_cat_dirs = core::StorageRouter::Instance().GetAllCategoryDirectories(base_dir);

            json j = {
                {"success", true},
                {"filename", info.filename},
                {"total_bytes", info.total_size},
                {"totalBytes", info.total_size},
                {"resumable", info.supports_range},
                {"supports_range", info.supports_range},
                {"status_code", info.status_code},
                {"category", cat_str},
                {"defaultSaveDir", target_dir.string()},
                {"rootDownloadDir", base_dir.string()},
                {"categoryDirs", all_cat_dirs}
            };
            res.set_content(j.dump(), "application/json");
        } catch (const std::exception& e) {
            res.status = 400;
            res.set_content(json({{"error", e.what()}}).dump(), "application/json");
        }
    });

    // 7. Per-Task Queue Priority
    server_->Post("/api/queue/priority", [](const httplib::Request& req, httplib::Response& res) {
        try {
            auto body = json::parse(req.body);
            int id = body.value("id", 0);
            std::string prio_str = body.value("priority", "normal");
            int priority = (prio_str == "high" || prio_str == "3") ? 3 : ((prio_str == "low" || prio_str == "1") ? 1 : 2);
            core::DownloadManager::Instance().SetTaskPriority(id, priority);
            res.set_content(R"({"success":true})", "application/json");
        } catch (const std::exception& e) {
            res.status = 400;
            res.set_content(json({{"error", e.what()}}).dump(), "application/json");
        }
    });

    // 8. Media Studio Batch Add
    server_->Post("/api/media/batch-add", [](const httplib::Request& req, httplib::Response& res) {
        try {
            auto body = json::parse(req.body);
            int added_count = 0;
            if (body.contains("items") && body["items"].is_array()) {
                for (const auto& itm : body["items"]) {
                    std::string u = itm.value("url", "");
                    std::string title = itm.value("title", "");
                    std::string fmt = itm.value("format", "best");
                    if (!u.empty()) {
                        core::DownloadManager::Instance().AddDownload(u, title, "", 2, true, fmt);
                        added_count++;
                    }
                }
            }
            res.set_content(json({{"success", true}, {"added", added_count}}).dump(), "application/json");
        } catch (const std::exception& e) {
            res.status = 400;
            res.set_content(json({{"error", e.what()}}).dump(), "application/json");
        }
    });

    // 9. Force Download Group (Multipart or Playlist)
    server_->Post(R"(/api/downloads/group/(.+)/force-download)", [](const httplib::Request& req, httplib::Response& res) {
        std::string group_key = req.matches[1];
        core::DownloadManager::Instance().ForceDownloadGroup(group_key);
        res.set_content(R"({"success":true})", "application/json");
    });

    // 10. Pending Browser Intercepted Downloads
    server_->Get("/api/downloads/pending-confirm", [](const httplib::Request&, httplib::Response& res) {
        res.set_content(g_pending_confirm_json.empty() ? "{}" : g_pending_confirm_json, "application/json");
    });

    server_->Post("/api/downloads/pending-confirm", [](const httplib::Request& req, httplib::Response& res) {
        g_pending_confirm_json = req.body;
        res.set_content(R"({"success":true})", "application/json");
    });

    // 11. Native Windows App Icon Resolver
    server_->Get("/api/app-icon", [](const httplib::Request& req, httplib::Response& res) {
        std::string ext = req.get_param_value("ext");
        std::string name = req.get_param_value("name");
        std::string target = !name.empty() ? name : (!ext.empty() ? ext : ".bin");
        std::string icon_uri = GetFileIconBase64(target);
        json j = {
            {"appName", "Application"},
            {"icon", icon_uri}
        };
        res.set_content(j.dump(), "application/json");
    });

    // 12. Crawler Engine Info & Update
    server_->Get("/api/crawler/info", [](const httplib::Request&, httplib::Response& res) {
        std::string bin = core::MediaEngine::Instance().GetYtDlpPath();
        res.set_content(json({
            {"success", true},
            {"available", !bin.empty()},
            {"version", "2026.10"}
        }).dump(), "application/json");
    });

    server_->Post("/api/crawler/update", [](const httplib::Request&, httplib::Response& res) {
        res.set_content(R"({"success":true,"message":"yt-dlp is up to date"})", "application/json");
    });

    // 13. LinkGrabber Crawl Alias & Single-Item Delete
    server_->Post("/api/linkgrabber/crawl", [](const httplib::Request& req, httplib::Response& res) {
        try {
            auto body = json::parse(req.body);
            std::string text = body.value("text", "");
            auto pkgs = core::CrawlerEngine::Instance().CrawlText(text);
            json j_pkgs = json::array();
            for (const auto& p : pkgs) {
                json j_items = json::array();
                for (const auto& itm : p.items) {
                    j_items.push_back({
                        {"original_url", itm.original_url},
                        {"direct_url", itm.direct_url},
                        {"filename", itm.filename},
                        {"size", itm.size},
                        {"hoster", itm.hoster}
                    });
                }
                j_pkgs.push_back({
                    {"name", p.name},
                    {"hoster", p.hoster},
                    {"items", j_items}
                });
            }
            res.set_content(json({{"success", true}, {"packages", j_pkgs}}).dump(), "application/json");
        } catch (const std::exception& e) {
            res.status = 400;
            res.set_content(json({{"error", e.what()}}).dump(), "application/json");
        }
    });

    server_->Delete(R"(/api/linkgrabber/(.+))", [](const httplib::Request& req, httplib::Response& res) {
        std::string id = req.matches[1];
        try {
            int idx = std::stoi(id);
            core::DownloadManager::Instance().RemoveGrabberPackage(idx);
        } catch (...) {
            core::DownloadManager::Instance().ClearGrabber();
        }
        res.set_content(R"({"success":true})", "application/json");
    });

    // 14. Test Post-Download Script in Settings Modal
    server_->Post("/api/settings/test-script", [](const httplib::Request& req, httplib::Response& res) {
        try {
            auto body = json::parse(req.body);
            std::string script_path = body.value("postDownloadScriptPath", "");
            std::string custom_compiler = body.value("postDownloadCustomCompiler", "");
            std::string script_args = body.value("postDownloadArguments", "\"%FILE%\"");

            auto rep_all = [](std::string str) {
                auto rep = [&str](const std::string& f, const std::string& t) {
                    size_t s = 0;
                    while ((s = str.find(f, s)) != std::string::npos) {
                        str.replace(s, f.length(), t);
                        s += t.length();
                    }
                };
                rep("%FILE%", "C:\\Downloads\\test_download.zip");
                rep("%DIR%", "C:\\Downloads");
                rep("%NAME%", "test_download.zip");
                rep("%URL%", "https://example.com/test_download.zip");
                rep("%SIZE%", "104857600");
                rep("%CATEGORY%", "Compressed");
                rep("%STATUS%", "Completed");
                return str;
            };

            std::string resolved_args = rep_all(script_args);
            std::wstring cmd;
            if (!custom_compiler.empty()) {
                cmd = ToWide("\"" + custom_compiler + "\" \"" + script_path + "\" " + resolved_args);
            } else {
                std::filesystem::path p(script_path);
                std::string ext = p.extension().string();
                if (ext == ".py") cmd = L"python.exe \"" + ToWide(script_path) + L"\" " + ToWide(resolved_args);
                else if (ext == ".ps1") cmd = L"powershell.exe -ExecutionPolicy Bypass -File \"" + ToWide(script_path) + L"\" " + ToWide(resolved_args);
                else if (ext == ".bat" || ext == ".cmd") cmd = L"cmd.exe /c \"" + ToWide(script_path) + L"\" " + ToWide(resolved_args);
                else cmd = L"\"" + ToWide(script_path) + L"\" " + ToWide(resolved_args);
            }

            HANDLE h_read = nullptr, h_write = nullptr;
            SECURITY_ATTRIBUTES sa = { sizeof(sa), nullptr, TRUE };
            CreatePipe(&h_read, &h_write, &sa, 0);
            SetHandleInformation(h_read, HANDLE_FLAG_INHERIT, 0);

            STARTUPINFOW si = { sizeof(si) };
            si.dwFlags = STARTF_USESTDHANDLES | STARTF_USESHOWWINDOW;
            si.hStdOutput = h_write;
            si.hStdError = h_write;
            si.wShowWindow = SW_HIDE;

            PROCESS_INFORMATION pi = {0};
            std::vector<wchar_t> cmd_buf(cmd.begin(), cmd.end());
            cmd_buf.push_back(L'\0');

            DWORD exit_code = 0;
            std::string stdout_str;
            if (CreateProcessW(nullptr, cmd_buf.data(), nullptr, nullptr, TRUE, CREATE_NO_WINDOW, nullptr, nullptr, &si, &pi)) {
                CloseHandle(h_write);
                h_write = nullptr;

                char buf[1024];
                DWORD bytes_read = 0;
                while (ReadFile(h_read, buf, sizeof(buf) - 1, &bytes_read, nullptr) && bytes_read > 0) {
                    buf[bytes_read] = '\0';
                    stdout_str += buf;
                }

                WaitForSingleObject(pi.hProcess, 5000);
                GetExitCodeProcess(pi.hProcess, &exit_code);
                CloseHandle(pi.hProcess);
                CloseHandle(pi.hThread);
            } else {
                exit_code = GetLastError();
                stdout_str = "CreateProcess failed with Win32 Error: " + std::to_string(exit_code);
            }
            if (h_read) CloseHandle(h_read);
            if (h_write) CloseHandle(h_write);

            res.set_content(json({
                {"success", exit_code == 0},
                {"code", exit_code},
                {"stdout", stdout_str},
                {"stderr", ""}
            }).dump(), "application/json");
        } catch (const std::exception& e) {
            res.status = 400;
            res.set_content(json({{"error", e.what()}}).dump(), "application/json");
        }
    });

    // Queue reordering
    server_->Post("/api/queue/move-top", [](const httplib::Request& req, httplib::Response& res) {
        auto body = json::parse(req.body);
        int id = body.value("id", 0);
        core::DownloadManager::Instance().MoveTaskTop(id);
        res.set_content(R"({"success":true})", "application/json");
    });

    server_->Post("/api/queue/move-up", [](const httplib::Request& req, httplib::Response& res) {
        auto body = json::parse(req.body);
        int id = body.value("id", 0);
        core::DownloadManager::Instance().MoveTaskUp(id);
        res.set_content(R"({"success":true})", "application/json");
    });

    server_->Post("/api/queue/move-down", [](const httplib::Request& req, httplib::Response& res) {
        auto body = json::parse(req.body);
        int id = body.value("id", 0);
        core::DownloadManager::Instance().MoveTaskDown(id);
        res.set_content(R"({"success":true})", "application/json");
    });

    server_->Post("/api/queue/move-bottom", [](const httplib::Request& req, httplib::Response& res) {
        auto body = json::parse(req.body);
        int id = body.value("id", 0);
        core::DownloadManager::Instance().MoveTaskBottom(id);
        res.set_content(R"({"success":true})", "application/json");
    });

    // LinkGrabber
    server_->Get("/api/linkgrabber", [](const httplib::Request&, httplib::Response& res) {
        auto pkgs = core::DownloadManager::Instance().GetGrabberPackages();
        json j_pkgs = json::array();
        for (const auto& p : pkgs) {
            json j_items = json::array();
            for (const auto& itm : p.items) {
                j_items.push_back({
                    {"original_url", itm.original_url},
                    {"direct_url", itm.direct_url},
                    {"filename", itm.filename},
                    {"size", itm.size},
                    {"hoster", itm.hoster}
                });
            }
            j_pkgs.push_back({
                {"name", p.name},
                {"hoster", p.hoster},
                {"items", j_items}
            });
        }
        res.set_content(json({{"packages", j_pkgs}}).dump(), "application/json");
    });

    server_->Post("/api/linkgrabber/transfer", [](const httplib::Request& req, httplib::Response& res) {
        try {
            if (!req.body.empty()) {
                auto body = json::parse(req.body);
                if (body.contains("package_index")) {
                    int idx = body["package_index"];
                    core::DownloadManager::Instance().TransferGrabberPackage(idx);
                    res.set_content(R"({"success":true})", "application/json");
                    return;
                }
            }
            core::DownloadManager::Instance().TransferAllGrabberPackages();
            res.set_content(R"({"success":true})", "application/json");
        } catch (const std::exception& e) {
            res.status = 400;
            res.set_content(json({{"error", e.what()}}).dump(), "application/json");
        }
    });

    server_->Post("/api/linkgrabber/clear", [](const httplib::Request&, httplib::Response& res) {
        core::DownloadManager::Instance().ClearGrabber();
        res.set_content(R"({"success":true})", "application/json");
    });

    // Power Actions
    server_->Get("/api/power", [](const httplib::Request&, httplib::Response& res) {
        auto act = core::ConfigManager::Instance().GetPowerAction();
        std::string act_str = "none";
        if (act == core::PowerAction::Sleep) act_str = "sleep";
        else if (act == core::PowerAction::Shutdown) act_str = "shutdown";
        res.set_content(json({{"power_action", act_str}}).dump(), "application/json");
    });

    server_->Post("/api/power", [](const httplib::Request& req, httplib::Response& res) {
        try {
            auto body = json::parse(req.body);
            std::string action = body.value("action", "none");
            if (action == "sleep") core::ConfigManager::Instance().SetPowerAction(core::PowerAction::Sleep);
            else if (action == "shutdown") core::ConfigManager::Instance().SetPowerAction(core::PowerAction::Shutdown);
            else core::ConfigManager::Instance().SetPowerAction(core::PowerAction::None);
            res.set_content(R"({"success":true})", "application/json");
        } catch (const std::exception& e) {
            res.status = 400;
            res.set_content(json({{"error", e.what()}}).dump(), "application/json");
        }
    });

    // Auto-Updater Endpoints
    server_->Get("/api/update/check", [](const httplib::Request& req, httplib::Response& res) {
        bool force = req.has_param("force") && (req.get_param_value("force") == "true" || req.get_param_value("force") == "1");
        auto info = core::UpdateManager::Instance().CheckForUpdates(force);
        json out = {
            {"success", true},
            {"check_completed", info.check_completed},
            {"update_available", info.update_available},
            {"current_version", info.current_version},
            {"latest_version", info.latest_version},
            {"release_notes", info.release_notes},
            {"download_url", info.download_url},
            {"asset_name", info.asset_name},
            {"error", info.error}
        };
        res.set_content(out.dump(), "application/json");
    });

    server_->Post("/api/update/download", [](const httplib::Request&, httplib::Response& res) {
        bool started = core::UpdateManager::Instance().StartDownloadUpdate();
        if (started) {
            res.set_content(R"({"success":true,"message":"Update download initiated"})", "application/json");
        } else {
            res.status = 400;
            res.set_content(R"({"success":false,"error":"Download already in progress or no update available"})", "application/json");
        }
    });

    server_->Get("/api/update/progress", [](const httplib::Request&, httplib::Response& res) {
        json out = {
            {"is_downloading", core::UpdateManager::Instance().IsDownloading()},
            {"progress", core::UpdateManager::Instance().GetDownloadProgress()}
        };
        res.set_content(out.dump(), "application/json");
    });

    server_->Post("/api/update/apply", [](const httplib::Request&, httplib::Response& res) {
        std::string err;
        if (core::UpdateManager::Instance().ApplyUpdate(err)) {
            res.set_content(R"({"success":true,"message":"Restarting Waterfall to apply update..."})", "application/json");
        } else {
            res.status = 500;
            json out = {
                {"success", false},
                {"error", err.empty() ? "Failed to apply update." : err}
            };
            res.set_content(out.dump(), "application/json");
        }
    });

    // Native Desktop Dialog Window Management API
    server_->Post("/api/window/open-confirm", [](const httplib::Request& req, httplib::Response& res) {
        if (!req.body.empty()) {
            g_pending_confirm_json = req.body;
        }
        ui::WebViewUiManager::Instance().OpenDialogWindow(
            "http://127.0.0.1:4567/confirm.html",
            680, 750, true /* Top Window */,
            L"Waterfall — Download File Info", "confirm", 0
        );
        res.set_content(R"({"success":true})", "application/json");
    });

    server_->Post("/api/window/open-welcome", [](const httplib::Request&, httplib::Response& res) {
        ui::WebViewUiManager::Instance().OpenDialogWindow(
            "http://127.0.0.1:4567/welcome.html",
            760, 660, true /* Top Window */,
            L"Waterfall — Setup & Welcome Wizard", "welcome", 0
        );
        res.set_content(R"({"success":true})", "application/json");
    });

    server_->Post("/api/window/open-extension-guide", [](const httplib::Request&, httplib::Response& res) {
        ui::WebViewUiManager::Instance().OpenDialogWindow(
            "http://127.0.0.1:4567/extension-guide.html",
            820, 720, false /* Not Top Window */,
            L"Waterfall — Browser Extension Setup Guide", "guide", 0
        );
        res.set_content(R"({"success":true})", "application/json");
    });

    server_->Post("/api/window/open-progress", [](const httplib::Request& req, httplib::Response& res) {
        int taskId = 0;
        bool topmost = false;
        if (!req.body.empty()) {
            try {
                auto body = json::parse(req.body);
                if (body.contains("taskId")) {
                    if (body["taskId"].is_number()) {
                        taskId = body["taskId"].get<int>();
                    } else if (body["taskId"].is_string()) {
                        taskId = std::stoi(body["taskId"].get<std::string>());
                    } else if (body["taskId"].is_object()) {
                        taskId = body["taskId"].value("id", 0);
                    }
                }
                if (taskId == 0 && body.contains("id")) {
                    if (body["id"].is_number()) {
                        taskId = body["id"].get<int>();
                    } else if (body["id"].is_string()) {
                        taskId = std::stoi(body["id"].get<std::string>());
                    }
                }
                if (body.contains("topmost")) {
                    topmost = body["topmost"].get<bool>();
                }
            } catch (...) {}
        }
        if (taskId == 0 && req.has_param("taskId")) {
            try { taskId = std::stoi(req.get_param_value("taskId")); } catch (...) {}
        }
        if (taskId == 0 && req.has_param("id")) {
            try { taskId = std::stoi(req.get_param_value("id")); } catch (...) {}
        }
        std::string url = "http://127.0.0.1:4567/download-progress.html?taskId=" + std::to_string(taskId);
        ui::WebViewUiManager::Instance().OpenDialogWindow(
            url, 660, 600, topmost,
            L"Waterfall — Download Progress", "progress", taskId
        );
        res.set_content(R"({"success":true})", "application/json");
    });

    server_->Post("/api/window/set-topmost", [](const httplib::Request& req, httplib::Response& res) {
        try {
            auto body = json::parse(req.body);
            bool topmost = body.value("topmost", true);
            bool bringToFront = body.value("bringToFront", true);
            int taskId = 0;
            if (body.contains("taskId")) {
                if (body["taskId"].is_number()) {
                    taskId = body["taskId"].get<int>();
                } else if (body["taskId"].is_string()) {
                    try { taskId = std::stoi(body["taskId"].get<std::string>()); } catch (...) {}
                } else if (body["taskId"].is_object()) {
                    taskId = body["taskId"].value("id", 0);
                }
            }
            std::string type = body.value("type", "");

            if (taskId > 0) {
                ui::WebViewUiManager::Instance().SetWindowTopmostByTaskId(taskId, topmost, bringToFront);
            } else if (!type.empty()) {
                ui::WebViewUiManager::Instance().SetWindowTopmostByType(type, topmost, bringToFront);
            } else {
                if (!ui::WebViewUiManager::Instance().SetWindowTopmostByType("confirm", topmost, bringToFront)) {
                    ui::WebViewUiManager::Instance().SetWindowTopmostByType("progress", topmost, bringToFront);
                }
            }
            res.set_content(R"({"success":true})", "application/json");
        } catch (const std::exception& e) {
            res.status = 400;
            res.set_content(json({{"error", e.what()}}).dump(), "application/json");
        }
    });

    server_->Post("/api/window/close-dialog", [](const httplib::Request& req, httplib::Response& res) {
        try {
            std::string type;
            int taskId = 0;
            if (!req.body.empty()) {
                auto body = json::parse(req.body);
                if (body.contains("type")) type = body["type"].get<std::string>();
                if (body.contains("taskId")) {
                    if (body["taskId"].is_number()) taskId = body["taskId"].get<int>();
                    else if (body["taskId"].is_string()) {
                        try { taskId = std::stoi(body["taskId"].get<std::string>()); } catch (...) {}
                    }
                }
            }
            ui::WebViewUiManager::Instance().CloseDialogWindowByType(type, taskId);
            res.set_content(R"({"success":true})", "application/json");
        } catch (const std::exception& e) {
            res.status = 400;
            res.set_content(json({{"error", e.what()}}).dump(), "application/json");
        }
    });

    // Crossdomain XML for web integrations
    server_->Get("/crossdomain.xml", [](const httplib::Request&, httplib::Response& res) {
        res.set_content(
            "<?xml version=\"1.0\"?>\n"
            "<!DOCTYPE cross-domain-policy SYSTEM \"http://www.adobe.com/xml/dtds/cross-domain-policy.dtd\">\n"
            "<cross-domain-policy>\n"
            "<allow-access-from domain=\"*\" />\n"
            "</cross-domain-policy>",
            "text/xml"
        );
    });
}

bool ExtensionServer::Start() {
    if (is_running_) return true;

    SetupRoutes();
    is_running_ = true;

    server_thread_ = std::thread([this]() {
        std::cout << "[ExtensionServer] Listening on http://127.0.0.1:" << port_ << std::endl;
        server_->listen("127.0.0.1", port_);
        is_running_ = false;
    });

    return true;
}

void ExtensionServer::Stop() {
    if (is_running_) {
        server_->stop();
        if (server_thread_.joinable()) {
            server_thread_.join();
        }
        is_running_ = false;
    }
}

} // namespace waterfall::server
