#include "waterfall/server/ExtensionServer.hpp"
#include "waterfall/core/DownloadManager.hpp"
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
