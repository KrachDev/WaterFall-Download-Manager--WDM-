#include "waterfall/ui/UiManager.hpp"
#include "waterfall/core/DownloadManager.hpp"
#include "waterfall/core/StorageRouter.hpp"

#include <RmlUi/Core.h>
#include "RmlUi_Backend.h"

#include <iostream>
#include <vector>
#include <string>
#include <windows.h>
#include <shellapi.h>

namespace waterfall::ui {

struct UiTask {
    int id = 0;
    Rml::String filename;
    Rml::String status;
    Rml::String speed;
    Rml::String downloaded;
    Rml::String total;
    Rml::String eta;
    float progress = 0.0f;
    int category_id = 0; // 0=general, 1=compressed, 2=video, 3=audio, 4=documents, 5=software
};

struct UiGrabberPackage {
    int id = 0;
    Rml::String name;
    Rml::String hoster;
    int file_count = 1;
    Rml::String total_size;
    Rml::String status;
};

// Global DataModel State
static Rml::Vector<UiTask> g_ui_tasks;
static Rml::Vector<UiGrabberPackage> g_ui_grabber_packages;

static Rml::String g_ui_active_count = "0";
static Rml::String g_ui_total_speed = "0 B/s";
static Rml::String g_ui_completed_count = "0";
static Rml::String g_ui_paused_count = "0";
static Rml::String g_ui_grabber_count = "2";

// Views & Modals state
static Rml::String g_current_view = "downloads"; // "downloads" | "grabber" | "media"
static Rml::String g_active_filter = "all";       // "all" | "downloading" | "paused" | "completed" | "extracting" | "error"
static Rml::String g_active_category = "all";     // "all" | "compressed" | "videos" | "audio" | "documents" | "software"
static Rml::String g_settings_tab = "general";    // "general" | "engine" | "limiter" | "archive" | "automation"
static Rml::String g_power_action = "None";       // "None" | "Sleep" | "Shutdown"

static bool g_is_add_modal_open = false;
static bool g_is_settings_modal_open = false;
static bool g_is_limiter_modal_open = false;
static bool g_is_inspector_open = false;

// Selected task details for Inspector Drawer
static int g_selected_task_id = 0;
static Rml::String g_inspector_filename = "--";
static Rml::String g_inspector_url = "--";
static Rml::String g_inspector_path = "--";
static Rml::String g_inspector_status = "--";
static Rml::String g_inspector_hash = "SHA-256: 4f8b2c91a03e...";
static int g_inspector_chunks = 16;
static bool g_inspector_auto_extract = true;

// Input fields
static Rml::String g_new_url_input = "";
static Rml::String g_new_custom_name = "";
static Rml::String g_new_engine_mode = "inPlace-16";
static bool g_new_auto_extract = true;
static Rml::String g_new_archive_password = "";

// Media Studio Inputs
static Rml::String g_media_url_input = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
static Rml::String g_media_title = "Cyberpunk 2077 - Official 4K Gameplay Trailer";
static Rml::String g_media_author = "CD PROJEKT RED";
static Rml::String g_media_duration = "3:42";
static Rml::String g_media_format = "mp4_4k"; // "mp4_4k", "mp4_1080p", "mp3_320k"

static Rml::DataModelHandle g_model_handle;

static void RefreshModelData() {
    auto tasks = core::DownloadManager::Instance().GetTasks();
    g_ui_tasks.clear();

    int active_cnt = 0;
    int paused_cnt = 0;
    int done_cnt = 0;

    for (const auto& t : tasks) {
        if (t.status == core::TaskStatus::Downloading || t.status == core::TaskStatus::Probing) active_cnt++;
        if (t.status == core::TaskStatus::Paused) paused_cnt++;
        if (t.status == core::TaskStatus::Completed) done_cnt++;

        // Filter checks
        if (g_active_filter == "downloading" && t.status != core::TaskStatus::Downloading && t.status != core::TaskStatus::Probing) continue;
        if (g_active_filter == "paused" && t.status != core::TaskStatus::Paused) continue;
        if (g_active_filter == "completed" && t.status != core::TaskStatus::Completed) continue;
        if (g_active_filter == "error" && t.status != core::TaskStatus::Error) continue;

        UiTask item;
        item.id = t.id;
        item.filename = t.filename.c_str();
        item.status = t.GetStatusString().c_str();
        item.speed = t.GetSpeedFormatted().c_str();
        item.downloaded = t.GetDownloadedFormatted().c_str();
        item.total = t.GetTotalFormatted().c_str();
        item.eta = t.GetEtaFormatted().c_str();
        item.progress = t.GetProgressPercent();
        
        auto cat = core::StorageRouter::Instance().CategorizeFile(t.filename);
        item.category_id = static_cast<int>(cat);

        g_ui_tasks.push_back(item);
    }

    g_ui_active_count = std::to_string(active_cnt).c_str();
    g_ui_paused_count = std::to_string(paused_cnt).c_str();
    g_ui_completed_count = std::to_string(done_cnt).c_str();
    g_ui_total_speed = core::DownloadTask::FormatBytes(core::DownloadManager::Instance().GetTotalSpeed()).c_str() + Rml::String("/s");

    // Populate mock LinkGrabber packages for shell demonstration if empty
    if (g_ui_grabber_packages.empty()) {
        UiGrabberPackage p1;
        p1.id = 101;
        p1.name = "Cyberpunk_2077_Patch_2.12_GOG.rar";
        p1.hoster = "Pixeldrain";
        p1.file_count = 3;
        p1.total_size = "4.28 GB";
        p1.status = "Crawled & Online";
        g_ui_grabber_packages.push_back(p1);

        UiGrabberPackage p2;
        p2.id = 102;
        p2.name = "Ubuntu_24.04_LTS_Desktop_x64.iso";
        p2.hoster = "Direct Mirror";
        p2.file_count = 1;
        p2.total_size = "5.71 GB";
        p2.status = "Direct CDN Link";
        g_ui_grabber_packages.push_back(p2);
    }
    g_ui_grabber_count = std::to_string(g_ui_grabber_packages.size()).c_str();

    if (g_model_handle) {
        g_model_handle.DirtyVariable("tasks");
        g_model_handle.DirtyVariable("grabber_packages");
        g_model_handle.DirtyVariable("active_count");
        g_model_handle.DirtyVariable("paused_count");
        g_model_handle.DirtyVariable("completed_count");
        g_model_handle.DirtyVariable("grabber_count");
        g_model_handle.DirtyVariable("total_speed");
        g_model_handle.DirtyVariable("current_view");
        g_model_handle.DirtyVariable("active_filter");
        g_model_handle.DirtyVariable("active_category");
        g_model_handle.DirtyVariable("settings_tab");
        g_model_handle.DirtyVariable("power_action");
        g_model_handle.DirtyVariable("is_add_modal_open");
        g_model_handle.DirtyVariable("is_settings_modal_open");
        g_model_handle.DirtyVariable("is_limiter_modal_open");
        g_model_handle.DirtyVariable("is_inspector_open");
        g_model_handle.DirtyVariable("inspector_filename");
        g_model_handle.DirtyVariable("inspector_url");
        g_model_handle.DirtyVariable("inspector_path");
        g_model_handle.DirtyVariable("inspector_status");
        g_model_handle.DirtyVariable("inspector_hash");
    }
}

UiManager::UiManager() = default;

UiManager::~UiManager() {
    Shutdown();
}

bool UiManager::Initialize(int width, int height) {
    if (!Backend::Initialize("🌊 Waterfall Accelerator v2.0 (Native C++20)", width, height, true)) {
        std::cerr << "Failed to initialize RmlUi Win32 OpenGL backend" << std::endl;
        return false;
    }

    Rml::SetSystemInterface(Backend::GetSystemInterface());
    Rml::SetRenderInterface(Backend::GetRenderInterface());

    if (!Rml::Initialise()) {
        std::cerr << "Failed to initialise RmlUi core" << std::endl;
        return false;
    }

    Rml::LoadFontFace("C:\\Windows\\Fonts\\segoeui.ttf", true);
    Rml::LoadFontFace("C:\\Windows\\Fonts\\segoeuib.ttf", true);
    Rml::LoadFontFace("C:\\Windows\\Fonts\\consola.ttf", false);

    context_ = Rml::CreateContext("main", Rml::Vector2i(width, height));
    if (!context_) {
        std::cerr << "Failed to create RmlUi context" << std::endl;
        return false;
    }

    SetupDataModel();
    LoadDocument();

    core::DownloadManager::Instance().SetUpdateListener([this]() {
        this->RequestDataUpdate();
    });

    is_running_ = true;
    return true;
}

void UiManager::SetupDataModel() {
    Rml::DataModelConstructor constructor = context_->CreateDataModel("downloads");
    if (!constructor) return;

    // Register Structs
    if (auto task_handle = constructor.RegisterStruct<UiTask>()) {
        task_handle.RegisterMember("id", &UiTask::id);
        task_handle.RegisterMember("filename", &UiTask::filename);
        task_handle.RegisterMember("status", &UiTask::status);
        task_handle.RegisterMember("speed", &UiTask::speed);
        task_handle.RegisterMember("downloaded", &UiTask::downloaded);
        task_handle.RegisterMember("total", &UiTask::total);
        task_handle.RegisterMember("eta", &UiTask::eta);
        task_handle.RegisterMember("progress", &UiTask::progress);
        task_handle.RegisterMember("category_id", &UiTask::category_id);
    }
    constructor.RegisterArray<Rml::Vector<UiTask>>();

    if (auto pkg_handle = constructor.RegisterStruct<UiGrabberPackage>()) {
        pkg_handle.RegisterMember("id", &UiGrabberPackage::id);
        pkg_handle.RegisterMember("name", &UiGrabberPackage::name);
        pkg_handle.RegisterMember("hoster", &UiGrabberPackage::hoster);
        pkg_handle.RegisterMember("file_count", &UiGrabberPackage::file_count);
        pkg_handle.RegisterMember("total_size", &UiGrabberPackage::total_size);
        pkg_handle.RegisterMember("status", &UiGrabberPackage::status);
    }
    constructor.RegisterArray<Rml::Vector<UiGrabberPackage>>();

    // Bind Arrays & Counts
    constructor.Bind("tasks", &g_ui_tasks);
    constructor.Bind("grabber_packages", &g_ui_grabber_packages);
    constructor.Bind("active_count", &g_ui_active_count);
    constructor.Bind("paused_count", &g_ui_paused_count);
    constructor.Bind("completed_count", &g_ui_completed_count);
    constructor.Bind("grabber_count", &g_ui_grabber_count);
    constructor.Bind("total_speed", &g_ui_total_speed);

    // Bind Views & Navigation
    constructor.Bind("current_view", &g_current_view);
    constructor.Bind("active_filter", &g_active_filter);
    constructor.Bind("active_category", &g_active_category);
    constructor.Bind("settings_tab", &g_settings_tab);
    constructor.Bind("power_action", &g_power_action);

    // Bind Modals & Overlays
    constructor.Bind("is_add_modal_open", &g_is_add_modal_open);
    constructor.Bind("is_settings_modal_open", &g_is_settings_modal_open);
    constructor.Bind("is_limiter_modal_open", &g_is_limiter_modal_open);
    constructor.Bind("is_inspector_open", &g_is_inspector_open);

    // Bind Inspector Fields
    constructor.Bind("inspector_filename", &g_inspector_filename);
    constructor.Bind("inspector_url", &g_inspector_url);
    constructor.Bind("inspector_path", &g_inspector_path);
    constructor.Bind("inspector_status", &g_inspector_status);
    constructor.Bind("inspector_hash", &g_inspector_hash);
    constructor.Bind("inspector_chunks", &g_inspector_chunks);
    constructor.Bind("inspector_auto_extract", &g_inspector_auto_extract);

    // Bind Add Modal Inputs
    constructor.Bind("new_url", &g_new_url_input);
    constructor.Bind("new_custom_name", &g_new_custom_name);
    constructor.Bind("new_engine_mode", &g_new_engine_mode);
    constructor.Bind("new_auto_extract", &g_new_auto_extract);
    constructor.Bind("new_archive_password", &g_new_archive_password);

    // Bind Media Studio Fields
    constructor.Bind("media_url", &g_media_url_input);
    constructor.Bind("media_title", &g_media_title);
    constructor.Bind("media_author", &g_media_author);
    constructor.Bind("media_duration", &g_media_duration);
    constructor.Bind("media_format", &g_media_format);

    // =========================================================================
    // EVENT CALLBACKS - Every single UI button wired to C++ handlers
    // =========================================================================

    // View Navigation
    constructor.BindEventCallback("set_view", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList& args) {
        if (!args.empty()) {
            g_current_view = args[0].Get<Rml::String>();
            std::cout << "[UI] Switched view to: " << g_current_view << std::endl;
            RefreshModelData();
        }
    });

    constructor.BindEventCallback("set_filter", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList& args) {
        if (!args.empty()) {
            g_active_filter = args[0].Get<Rml::String>();
            std::cout << "[UI] Filter set to: " << g_active_filter << std::endl;
            RefreshModelData();
        }
    });

    constructor.BindEventCallback("set_category", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList& args) {
        if (!args.empty()) {
            g_active_category = args[0].Get<Rml::String>();
            std::cout << "[UI] Category set to: " << g_active_category << std::endl;
            RefreshModelData();
        }
    });

    // Modals
    constructor.BindEventCallback("open_add_modal", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList&) {
        g_is_add_modal_open = true;
        std::cout << "[UI] Opened Add Download Modal" << std::endl;
        RefreshModelData();
    });

    constructor.BindEventCallback("close_add_modal", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList&) {
        g_is_add_modal_open = false;
        std::cout << "[UI] Closed Add Download Modal" << std::endl;
        RefreshModelData();
    });

    constructor.BindEventCallback("submit_add_modal", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList&) {
        if (!g_new_url_input.empty()) {
            std::cout << "[C++ Engine] Creating download task: " << g_new_url_input << " (Engine: " << g_new_engine_mode << ")" << std::endl;
            core::DownloadManager::Instance().AddDownload(g_new_url_input, g_new_custom_name);
            g_new_url_input.clear();
            g_new_custom_name.clear();
        }
        g_is_add_modal_open = false;
        RefreshModelData();
    });

    constructor.BindEventCallback("open_settings_modal", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList&) {
        g_is_settings_modal_open = true;
        std::cout << "[UI] Opened Settings Modal" << std::endl;
        RefreshModelData();
    });

    constructor.BindEventCallback("close_settings_modal", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList&) {
        g_is_settings_modal_open = false;
        std::cout << "[UI] Closed Settings Modal" << std::endl;
        RefreshModelData();
    });

    constructor.BindEventCallback("set_settings_tab", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList& args) {
        if (!args.empty()) {
            g_settings_tab = args[0].Get<Rml::String>();
            std::cout << "[UI] Settings Tab: " << g_settings_tab << std::endl;
            RefreshModelData();
        }
    });

    constructor.BindEventCallback("open_limiter_modal", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList&) {
        g_is_limiter_modal_open = !g_is_limiter_modal_open;
        std::cout << "[UI] Toggled Speed Limiter Modal: " << g_is_limiter_modal_open << std::endl;
        RefreshModelData();
    });

    // Top Command Toolbar Actions
    constructor.BindEventCallback("resume_all", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList&) {
        std::cout << "[C++ Engine] Resume All invoked." << std::endl;
        auto tasks = core::DownloadManager::Instance().GetTasks();
        for (const auto& t : tasks) {
            if (t.status == core::TaskStatus::Paused) {
                core::DownloadManager::Instance().ResumeDownload(t.id);
            }
        }
        RefreshModelData();
    });

    constructor.BindEventCallback("pause_all", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList&) {
        std::cout << "[C++ Engine] Pause All invoked." << std::endl;
        auto tasks = core::DownloadManager::Instance().GetTasks();
        for (const auto& t : tasks) {
            if (t.status == core::TaskStatus::Downloading) {
                core::DownloadManager::Instance().PauseDownload(t.id);
            }
        }
        RefreshModelData();
    });

    constructor.BindEventCallback("clear_completed", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList&) {
        std::cout << "[C++ Engine] Clear Completed invoked." << std::endl;
        auto tasks = core::DownloadManager::Instance().GetTasks();
        for (const auto& t : tasks) {
            if (t.status == core::TaskStatus::Completed) {
                core::DownloadManager::Instance().DeleteDownload(t.id, false);
            }
        }
        RefreshModelData();
    });

    constructor.BindEventCallback("cycle_power_action", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList&) {
        if (g_power_action == "None") g_power_action = "Sleep";
        else if (g_power_action == "Sleep") g_power_action = "Shutdown";
        else g_power_action = "None";
        std::cout << "[UI] Power Action cycled to: " << g_power_action << std::endl;
        RefreshModelData();
    });

    // Task Level Actions
    constructor.BindEventCallback("pause_download", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList& args) {
        if (!args.empty()) {
            int id = args[0].Get<int>();
            std::cout << "[C++ Engine] Pause task: " << id << std::endl;
            core::DownloadManager::Instance().PauseDownload(id);
            RefreshModelData();
        }
    });

    constructor.BindEventCallback("resume_download", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList& args) {
        if (!args.empty()) {
            int id = args[0].Get<int>();
            std::cout << "[C++ Engine] Resume task: " << id << std::endl;
            core::DownloadManager::Instance().ResumeDownload(id);
            RefreshModelData();
        }
    });

    constructor.BindEventCallback("delete_download", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList& args) {
        if (!args.empty()) {
            int id = args[0].Get<int>();
            std::cout << "[C++ Engine] Delete task: " << id << std::endl;
            core::DownloadManager::Instance().DeleteDownload(id, false);
            RefreshModelData();
        }
    });

    constructor.BindEventCallback("open_folder", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList& args) {
        if (!args.empty()) {
            int id = args[0].Get<int>();
            auto tasks = core::DownloadManager::Instance().GetTasks();
            for (const auto& t : tasks) {
                if (t.id == id) {
                    std::cout << "[OS] Opening Explorer for: " << t.save_path << std::endl;
                    std::string param = "/select,\"" + t.save_path + "\"";
                    ShellExecuteA(nullptr, "open", "explorer.exe", param.c_str(), nullptr, SW_SHOW);
                    break;
                }
            }
        }
    });

    constructor.BindEventCallback("toggle_inspector", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList& args) {
        if (!args.empty()) {
            int id = args[0].Get<int>();
            auto tasks = core::DownloadManager::Instance().GetTasks();
            for (const auto& t : tasks) {
                if (t.id == id) {
                    g_selected_task_id = id;
                    g_inspector_filename = t.filename.c_str();
                    g_inspector_url = t.url.c_str();
                    g_inspector_path = t.save_path.c_str();
                    g_inspector_status = t.GetStatusString().c_str();
                    g_is_inspector_open = true;
                    std::cout << "[UI] Opened Inspector for task: " << t.filename << std::endl;
                    RefreshModelData();
                    return;
                }
            }
        }
        g_is_inspector_open = false;
        RefreshModelData();
    });

    constructor.BindEventCallback("close_inspector", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList&) {
        g_is_inspector_open = false;
        std::cout << "[UI] Closed Inspector" << std::endl;
        RefreshModelData();
    });

    // LinkGrabber Specific Callbacks
    constructor.BindEventCallback("grabber_crawl", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList&) {
        std::cout << "[C++ Crawler] Deep LinkGrabber Crawl triggered on clipboard & queue." << std::endl;
    });

    constructor.BindEventCallback("grabber_transfer_all", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList&) {
        std::cout << "[C++ Engine] Transferring all LinkGrabber packages to download queue." << std::endl;
        for (const auto& pkg : g_ui_grabber_packages) {
            core::DownloadManager::Instance().AddDownload("https://example.com/" + std::string(pkg.name.c_str()), pkg.name.c_str());
        }
        g_ui_grabber_packages.clear();
        RefreshModelData();
    });

    constructor.BindEventCallback("grabber_clear", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList&) {
        std::cout << "[UI] Cleared LinkGrabber items." << std::endl;
        g_ui_grabber_packages.clear();
        RefreshModelData();
    });

    constructor.BindEventCallback("grabber_add_package", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList& args) {
        if (!args.empty()) {
            int id = args[0].Get<int>();
            std::cout << "[C++ Engine] Transferred LinkGrabber package " << id << " to active downloads." << std::endl;
            for (auto it = g_ui_grabber_packages.begin(); it != g_ui_grabber_packages.end(); ++it) {
                if (it->id == id) {
                    core::DownloadManager::Instance().AddDownload("https://example.com/" + std::string(it->name.c_str()), it->name.c_str());
                    g_ui_grabber_packages.erase(it);
                    break;
                }
            }
            RefreshModelData();
        }
    });

    // Media Studio Specific Callbacks
    constructor.BindEventCallback("media_probe", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList&) {
        std::cout << "[C++ Media Engine] Probing YouTube / yt-dlp metadata for: " << g_media_url_input << std::endl;
    });

    constructor.BindEventCallback("media_download", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList&) {
        std::cout << "[C++ Media Engine] Starting YouTube extraction & download for: " << g_media_url_input << " (Format: " << g_media_format << ")" << std::endl;
        core::DownloadManager::Instance().AddDownload(g_media_url_input, std::string(g_media_title.c_str()) + ".mp4");
        g_current_view = "downloads";
        RefreshModelData();
    });

    constructor.BindEventCallback("set_media_format", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList& args) {
        if (!args.empty()) {
            g_media_format = args[0].Get<Rml::String>();
            std::cout << "[UI] Selected Media Format: " << g_media_format << std::endl;
            RefreshModelData();
        }
    });

    g_model_handle = constructor.GetModelHandle();
    RefreshModelData();
}

void UiManager::LoadDocument() {
    document_ = context_->LoadDocument("assets/ui/main.rml");
    if (document_) {
        document_->Show();
    } else {
        std::cerr << "Failed to load assets/ui/main.rml document" << std::endl;
    }
}

void UiManager::RequestDataUpdate() {
    needs_model_dirty_ = true;
}

void UiManager::Run() {
    while (is_running_) {
        bool running = Backend::ProcessEvents(context_, nullptr);
        if (!running) {
            break;
        }

        if (needs_model_dirty_) {
            needs_model_dirty_ = false;
            RefreshModelData();
        }

        context_->Update();

        Backend::BeginFrame();
        context_->Render();
        Backend::PresentFrame();
    }
}

void UiManager::Shutdown() {
    if (is_running_) {
        if (context_) {
            Rml::Shutdown();
            context_ = nullptr;
        }
        Backend::Shutdown();
        is_running_ = false;
    }
}

} // namespace waterfall::ui
