#include "waterfall/server/ExtensionServer.hpp"
#include "waterfall/core/DownloadManager.hpp"
#include "waterfall/core/ConfigManager.hpp"
#include "waterfall/core/MediaEngine.hpp"
#include "waterfall/core/CrawlerEngine.hpp"
#include <httplib.h>
#include <nlohmann/json.hpp>
#include <iostream>

using json = nlohmann::json;

namespace waterfall::server {

ExtensionServer::ExtensionServer(int port)
    : port_(port), server_(std::make_unique<httplib::Server>()) {
}

ExtensionServer::~ExtensionServer() {
    Stop();
}

void ExtensionServer::SetupRoutes() {
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
            j.push_back({
                {"id", t.id},
                {"url", t.url},
                {"filename", t.filename},
                {"save_path", t.save_path},
                {"total_bytes", t.total_bytes},
                {"downloaded_bytes", t.downloaded_bytes},
                {"speed_bps", t.speed_bps},
                {"speed_formatted", t.GetSpeedFormatted()},
                {"progress_percent", t.GetProgressPercent()},
                {"status", t.GetStatusString()}
            });
        }
        res.set_content(j.dump(), "application/json");
    });

    // Add new download
    server_->Post("/api/downloads", [](const httplib::Request& req, httplib::Response& res) {
        try {
            auto body = json::parse(req.body);
            std::string url = body.value("url", "");
            std::string filename = body.value("filename", "");
            std::string folder = body.value("target_folder", "");

            if (url.empty()) {
                res.status = 400;
                res.set_content(R"({"error":"url is required"})", "application/json");
                return;
            }

            int id = core::DownloadManager::Instance().AddDownload(url, filename, folder);
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

    // Resume download
    server_->Post(R"(/api/downloads/(\d+)/resume)", [](const httplib::Request& req, httplib::Response& res) {
        int id = std::stoi(req.matches[1]);
        bool ok = core::DownloadManager::Instance().ResumeDownload(id);
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
        json j = {
            {"download_directory", cfg.download_directory},
            {"max_concurrent_downloads", cfg.max_concurrent_downloads},
            {"max_concurrent_per_host", cfg.max_concurrent_per_host},
            {"speed_limit_enabled", cfg.speed_limit_enabled},
            {"speed_limit_bps", cfg.speed_limit_bps},
            {"auto_extract_archives", cfg.auto_extract_archives},
            {"delete_archive_after_extract", cfg.delete_archive_after_extract},
            {"archive_passwords", cfg.archive_passwords}
        };
        res.set_content(j.dump(), "application/json");
    });

    server_->Post("/api/settings", [](const httplib::Request& req, httplib::Response& res) {
        try {
            auto body = json::parse(req.body);
            auto cfg = core::ConfigManager::Instance().GetConfig();
            if (body.contains("download_directory")) cfg.download_directory = body["download_directory"];
            if (body.contains("max_concurrent_downloads")) cfg.max_concurrent_downloads = body["max_concurrent_downloads"];
            if (body.contains("max_concurrent_per_host")) cfg.max_concurrent_per_host = body["max_concurrent_per_host"];
            if (body.contains("speed_limit_enabled")) cfg.speed_limit_enabled = body["speed_limit_enabled"];
            if (body.contains("speed_limit_bps")) cfg.speed_limit_bps = body["speed_limit_bps"];
            if (body.contains("auto_extract_archives")) cfg.auto_extract_archives = body["auto_extract_archives"];
            if (body.contains("delete_archive_after_extract")) cfg.delete_archive_after_extract = body["delete_archive_after_extract"];
            if (body.contains("archive_passwords") && body["archive_passwords"].is_array()) {
                cfg.archive_passwords = body["archive_passwords"].get<std::vector<std::string>>();
            }
            core::ConfigManager::Instance().UpdateConfig(cfg);
            res.set_content(R"({"success":true})", "application/json");
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
