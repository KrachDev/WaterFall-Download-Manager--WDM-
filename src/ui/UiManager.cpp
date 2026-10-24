#include "waterfall/ui/UiManager.hpp"
#include "waterfall/core/DownloadManager.hpp"
#include "waterfall/core/StorageRouter.hpp"

#include <RmlUi/Core.h>
#include "RmlUi_Backend.h"

#include <iostream>
#include <vector>

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
};

static Rml::Vector<UiTask> g_ui_tasks;
static Rml::String g_ui_active_count = "0";
static Rml::String g_ui_total_speed = "0 B/s";
static Rml::String g_new_url_input = "";
static Rml::DataModelHandle g_model_handle;

static void RefreshModelData() {
    auto tasks = core::DownloadManager::Instance().GetTasks();
    g_ui_tasks.clear();
    for (const auto& t : tasks) {
        UiTask item;
        item.id = t.id;
        item.filename = t.filename.c_str();
        item.status = t.GetStatusString().c_str();
        item.speed = t.GetSpeedFormatted().c_str();
        item.downloaded = t.GetDownloadedFormatted().c_str();
        item.total = t.GetTotalFormatted().c_str();
        item.eta = t.GetEtaFormatted().c_str();
        item.progress = t.GetProgressPercent();
        g_ui_tasks.push_back(item);
    }

    g_ui_active_count = std::to_string(core::DownloadManager::Instance().GetActiveCount()).c_str();
    g_ui_total_speed = core::DownloadTask::FormatBytes(core::DownloadManager::Instance().GetTotalSpeed()).c_str() + Rml::String("/s");

    if (g_model_handle) {
        g_model_handle.DirtyVariable("tasks");
        g_model_handle.DirtyVariable("active_count");
        g_model_handle.DirtyVariable("total_speed");
    }
}

UiManager::UiManager() = default;

UiManager::~UiManager() {
    Shutdown();
}

bool UiManager::Initialize(int width, int height) {
    if (!Backend::Initialize("🌊 Waterfall Accelerator v2.0 (Native C++)", width, height, true)) {
        std::cerr << "Failed to initialize RmlUi Win32 OpenGL backend" << std::endl;
        return false;
    }

    Rml::SetSystemInterface(Backend::GetSystemInterface());
    Rml::SetRenderInterface(Backend::GetRenderInterface());

    if (!Rml::Initialise()) {
        std::cerr << "Failed to initialise RmlUi core" << std::endl;
        return false;
    }

    // Load Segoe UI from Windows Fonts directory for crisp native typography
    Rml::LoadFontFace("C:\\Windows\\Fonts\\segoeui.ttf", true);
    Rml::LoadFontFace("C:\\Windows\\Fonts\\segoeuib.ttf", true); // Bold
    Rml::LoadFontFace("C:\\Windows\\Fonts\\consola.ttf", false); // Monospace

    context_ = Rml::CreateContext("main", Rml::Vector2i(width, height));
    if (!context_) {
        std::cerr << "Failed to create RmlUi context" << std::endl;
        return false;
    }

    SetupDataModel();
    LoadDocument();

    // Hook DownloadManager updates to UI dirty refresh
    core::DownloadManager::Instance().SetUpdateListener([this]() {
        this->RequestDataUpdate();
    });

    is_running_ = true;
    return true;
}

void UiManager::SetupDataModel() {
    Rml::DataModelConstructor constructor = context_->CreateDataModel("downloads");
    if (!constructor) return;

    if (auto task_handle = constructor.RegisterStruct<UiTask>()) {
        task_handle.RegisterMember("id", &UiTask::id);
        task_handle.RegisterMember("filename", &UiTask::filename);
        task_handle.RegisterMember("status", &UiTask::status);
        task_handle.RegisterMember("speed", &UiTask::speed);
        task_handle.RegisterMember("downloaded", &UiTask::downloaded);
        task_handle.RegisterMember("total", &UiTask::total);
        task_handle.RegisterMember("eta", &UiTask::eta);
        task_handle.RegisterMember("progress", &UiTask::progress);
    }

    constructor.RegisterArray<Rml::Vector<UiTask>>();
    constructor.Bind("tasks", &g_ui_tasks);
    constructor.Bind("active_count", &g_ui_active_count);
    constructor.Bind("total_speed", &g_ui_total_speed);
    constructor.Bind("new_url", &g_new_url_input);

    // Event callbacks
    constructor.BindEventCallback("add_download", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList&) {
        if (!g_new_url_input.empty()) {
            core::DownloadManager::Instance().AddDownload(g_new_url_input);
            g_new_url_input.clear();
            g_model_handle.DirtyVariable("new_url");
            RefreshModelData();
        }
    });

    constructor.BindEventCallback("pause_download", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList& args) {
        if (!args.empty()) {
            int id = args[0].Get<int>();
            core::DownloadManager::Instance().PauseDownload(id);
            RefreshModelData();
        }
    });

    constructor.BindEventCallback("resume_download", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList& args) {
        if (!args.empty()) {
            int id = args[0].Get<int>();
            core::DownloadManager::Instance().ResumeDownload(id);
            RefreshModelData();
        }
    });

    constructor.BindEventCallback("delete_download", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList& args) {
        if (!args.empty()) {
            int id = args[0].Get<int>();
            core::DownloadManager::Instance().DeleteDownload(id, false);
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
