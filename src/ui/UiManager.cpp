#include "waterfall/ui/UiManager.hpp"
#include "waterfall/core/DownloadManager.hpp"
#include "waterfall/core/StorageRouter.hpp"
#include "waterfall/core/ConfigManager.hpp"
#include "waterfall/core/MediaEngine.hpp"
#include "waterfall/core/ArchiveEngine.hpp"
#include "waterfall/core/CrawlerEngine.hpp"
#include "waterfall/core/QueueScheduler.hpp"
#include "waterfall/core/ShellIntegration.hpp"

#include <RmlUi/Core.h>
#include "RmlUi_Backend.h"

#include <iostream>
#include <vector>
#include <string>
#include <unordered_set>
#include <sstream>
#include <windows.h>
#include <shellapi.h>
#include <shobjidl.h>
#include <shlobj.h>
#include <thread>

namespace waterfall::ui {

static std::string ShowWin32FolderPicker() {
    std::string selected_path = "";
    CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE);
    IFileOpenDialog* pFileOpen = nullptr;
    if (SUCCEEDED(CoCreateInstance(CLSID_FileOpenDialog, nullptr, CLSCTX_ALL, IID_IFileOpenDialog, reinterpret_cast<void**>(&pFileOpen)))) {
        DWORD dwOptions = 0;
        if (SUCCEEDED(pFileOpen->GetOptions(&dwOptions))) {
            pFileOpen->SetOptions(dwOptions | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM);
        }
        pFileOpen->SetTitle(L"Select Download Destination Folder");
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
    return selected_path;
}

static std::string GetWin32KnownFolder(REFKNOWNFOLDERID rfid) {
    PWSTR path = nullptr;
    std::string result;
    if (SUCCEEDED(SHGetKnownFolderPath(rfid, 0, nullptr, &path))) {
        int size_needed = WideCharToMultiByte(CP_UTF8, 0, path, -1, nullptr, 0, nullptr, nullptr);
        if (size_needed > 1) {
            result.resize(size_needed - 1);
            WideCharToMultiByte(CP_UTF8, 0, path, -1, &result[0], size_needed, nullptr, nullptr);
        }
        CoTaskMemFree(path);
    }
    return result;
}

static std::string GetWin32ClipboardText() {
    std::string text;
    if (OpenClipboard(nullptr)) {
        HANDLE hData = GetClipboardData(CF_TEXT);
        if (hData) {
            char* pszText = static_cast<char*>(GlobalLock(hData));
            if (pszText) {
                text = pszText;
                GlobalUnlock(hData);
            }
        }
        CloseClipboard();
    }
    return text;
}

static void SetWin32ClipboardText(const std::string& text) {
    if (OpenClipboard(nullptr)) {
        EmptyClipboard();
        HGLOBAL hGlob = GlobalAlloc(GMEM_MOVEABLE, text.size() + 1);
        if (hGlob) {
            char* pData = static_cast<char*>(GlobalLock(hGlob));
            if (pData) {
                memcpy(pData, text.c_str(), text.size() + 1);
                GlobalUnlock(hGlob);
                SetClipboardData(CF_TEXT, hGlob);
            }
        }
        CloseClipboard();
    }
}

struct UiTask {
    int id = 0;
    Rml::String filename;
    Rml::String icon;
    Rml::String status;
    Rml::String speed;
    Rml::String downloaded;
    Rml::String total;
    Rml::String eta;
    float progress = 0.0f;
    int category_id = 0; // 0=general, 1=media, 2=audio, 3=compressed, 4=documents, 5=software
    bool selected = false;
};

struct UiGrabberPackage {
    int id = 0;
    Rml::String name;
    Rml::String hoster;
    int file_count = 1;
    Rml::String total_size;
    Rml::String status;
};

struct UiChunk {
    int id = 0;
    Rml::String state; // "done", "active", "pending"
    Rml::String text;
    Rml::String progress_str;
};

// Global DataModel State
static Rml::Vector<UiTask> g_ui_tasks;
static Rml::Vector<UiGrabberPackage> g_ui_grabber_packages;
static Rml::Vector<UiChunk> g_inspector_chunks_list;

static Rml::String g_ui_active_count = "0";
static Rml::String g_ui_total_speed = "0 B/s";
static Rml::String g_ui_completed_count = "0";
static Rml::String g_ui_paused_count = "0";
static Rml::String g_ui_grabber_count = "0";
static bool g_has_tasks = false;
static bool g_has_grabber = false;

// Selection & Batch State
static std::unordered_set<int> g_selected_task_ids;
static int g_selected_count = 0;

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
static bool g_is_context_menu_open = false;
static bool g_is_password_modal_open = false;
static int g_password_modal_task_id = 0;
static Rml::String g_password_modal_filename = "--";
static Rml::String g_password_modal_input = "";

// Task Context Menu details
static int g_context_task_id = 0;
static Rml::String g_context_task_filename = "--";
static Rml::String g_context_task_info = "--";

// Speed Limiter State
static bool g_limiter_enabled = false;
static Rml::String g_limiter_display_text = "Full Speed (Unlimited)";
static Rml::String g_limiter_status_text = "OFF";
static Rml::String g_limiter_custom_input = "5.0";

// Selected task details for Inspector Drawer
static int g_selected_task_id = 0;
static Rml::String g_inspector_filename = "--";
static Rml::String g_inspector_url = "--";
static Rml::String g_inspector_path = "--";
static Rml::String g_inspector_status = "--";
static Rml::String g_inspector_speed = "--";
static Rml::String g_inspector_progress_text = "--";
static Rml::String g_inspector_eta = "--";
static Rml::String g_inspector_hash = "SHA-256: --";
static Rml::String g_inspector_priority = "Normal";
static int g_inspector_chunks = 16;
static bool g_inspector_auto_extract = true;

// Add Download Modal State
static Rml::String g_add_modal_tab = "direct"; // "direct" | "batch" | "media"
static Rml::String g_new_url_input = "";
static Rml::String g_new_custom_name = "";
static Rml::String g_new_save_folder = "";
static Rml::String g_new_batch_urls = "";
static Rml::String g_new_engine_mode = "inPlace-16";
static bool g_new_auto_extract = true;
static Rml::String g_new_archive_password = "";

// Settings Modal State
static Rml::String g_settings_save_path = "";
static Rml::String g_settings_max_concurrent = "3";
static Rml::String g_settings_max_per_host = "2";
static Rml::String g_settings_default_connections = "16";
static bool g_settings_auto_extract = true;
static bool g_settings_delete_archive = false;
static Rml::Vector<Rml::String> g_vault_passwords;
static Rml::String g_new_vault_password = "";
static Rml::String g_settings_script_path = "";
static bool g_settings_script_enabled = false;

// Media Studio Inputs
static Rml::String g_media_url_input = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
static Rml::String g_media_title = "Cyberpunk 2077 - Official 4K Gameplay Trailer";
static Rml::String g_media_author = "CD PROJEKT RED";
static Rml::String g_media_duration = "3:42";
static Rml::String g_media_format = "mp4-1080"; // "mp4-best", "mp4-1080", "mp3-320", "flac"

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

        auto cat = core::StorageRouter::Instance().CategorizeFile(t.filename);
        if (g_active_category == "compressed" && cat != core::FileCategory::Compressed) continue;
        if (g_active_category == "videos" && cat != core::FileCategory::Media) continue;
        if (g_active_category == "audio" && cat != core::FileCategory::Audio) continue;
        if (g_active_category == "documents" && cat != core::FileCategory::Documents) continue;
        if (g_active_category == "software" && cat != core::FileCategory::Programs) continue;

        UiTask item;
        item.id = t.id;
        item.filename = t.filename.c_str();
        item.status = t.GetStatusString().c_str();
        item.speed = t.GetSpeedFormatted().c_str();
        item.downloaded = t.GetDownloadedFormatted().c_str();
        item.total = t.GetTotalFormatted().c_str();
        item.eta = t.GetEtaFormatted().c_str();
        item.progress = t.GetProgressPercent();
        item.selected = (g_selected_task_ids.count(t.id) > 0);
        item.category_id = static_cast<int>(cat);

        switch (cat) {
            case core::FileCategory::Compressed: item.icon = "📦"; break;
            case core::FileCategory::Media:      item.icon = "🎬"; break;
            case core::FileCategory::Audio:      item.icon = "🎵"; break;
            case core::FileCategory::Documents:  item.icon = "📄"; break;
            case core::FileCategory::Programs:   item.icon = "⚡"; break;
            default:                             item.icon = "📄"; break;
        }

        g_ui_tasks.push_back(item);
    }

    g_selected_count = static_cast<int>(g_selected_task_ids.size());
    g_ui_active_count = std::to_string(active_cnt).c_str();
    g_ui_paused_count = std::to_string(paused_cnt).c_str();
    g_ui_completed_count = std::to_string(done_cnt).c_str();
    g_ui_total_speed = (core::DownloadTask::FormatBytes(core::DownloadManager::Instance().GetTotalSpeed()) + "/s").c_str();

    // Update speed limiter status
    g_limiter_enabled = core::ConfigManager::Instance().IsSpeedLimitEnabled();
    if (g_limiter_enabled) {
        int64_t bps = core::ConfigManager::Instance().GetSpeedLimitBps();
        g_limiter_display_text = (core::DownloadTask::FormatBytes(bps) + "/s").c_str();
        g_limiter_status_text = "THROTTLED";
    } else {
        g_limiter_display_text = "Full Speed (Unlimited)";
        g_limiter_status_text = "OFF";
    }

    // Update password vault entries
    auto pwds = core::ConfigManager::Instance().GetArchivePasswords();
    g_vault_passwords.clear();
    for (const auto& p : pwds) {
        g_vault_passwords.push_back(p.c_str());
    }

    // Populate LinkGrabber packages from DownloadManager
    auto pkgs = core::DownloadManager::Instance().GetGrabberPackages();
    g_ui_grabber_packages.clear();
    int p_id = 0;
    for (const auto& pkg : pkgs) {
        UiGrabberPackage p;
        p.id = p_id++;
        p.name = pkg.name.c_str();
        p.hoster = pkg.hoster.c_str();
        p.file_count = static_cast<int>(pkg.items.size());
        int64_t total_sz = 0;
        for (const auto& itm : pkg.items) total_sz += itm.size;
        p.total_size = core::DownloadTask::FormatBytes(total_sz).c_str();
        p.status = "Crawled & Online";
        g_ui_grabber_packages.push_back(p);
    }
    g_ui_grabber_count = std::to_string(g_ui_grabber_packages.size()).c_str();
    g_has_tasks = !g_ui_tasks.empty();
    g_has_grabber = !g_ui_grabber_packages.empty();
    std::cout << "[DATA_MODEL] RefreshModelData: g_ui_tasks.size() = " << g_ui_tasks.size() << ", has_tasks = " << g_has_tasks << std::endl;

    // Update inspector data if an active task is selected
    if (g_selected_task_id > 0) {
        auto* t = core::DownloadManager::Instance().GetTaskPtr(g_selected_task_id);
        if (t) {
            g_inspector_filename = t->filename.c_str();
            g_inspector_url = t->url.c_str();
            g_inspector_path = t->save_path.c_str();
            g_inspector_status = t->GetStatusString().c_str();
            g_inspector_speed = t->GetSpeedFormatted().c_str();
            g_inspector_progress_text = (t->GetDownloadedFormatted() + " / " + t->GetTotalFormatted() + " (" + std::to_string(static_cast<int>(t->GetProgressPercent())) + "%)").c_str();
            g_inspector_eta = t->GetEtaFormatted().c_str();
            g_inspector_hash = t->sha256_hash.empty() ? "Not Computed" : ("SHA-256: " + t->sha256_hash).c_str();
            g_inspector_priority = (t->priority == 3 ? "High" : (t->priority == 1 ? "Low" : "Normal"));

            g_inspector_chunks_list.clear();
            if (!t->chunks.empty()) {
                for (size_t i = 0; i < t->chunks.size(); ++i) {
                    const auto& c = t->chunks[i];
                    UiChunk uc;
                    uc.id = static_cast<int>(i + 1);
                    uc.text = std::to_string(uc.id).c_str();
                    if (c.is_completed || c.GetProgress() >= 99.9f) {
                        uc.state = "done";
                    } else if (c.is_active) {
                        uc.state = "active";
                    } else {
                        uc.state = "pending";
                    }
                    uc.progress_str = (std::to_string(static_cast<int>(c.GetProgress())) + "%").c_str();
                    g_inspector_chunks_list.push_back(uc);
                }
            } else {
                float pct = t->GetProgressPercent();
                int done_blocks = static_cast<int>((pct / 100.0f) * 16.0f);
                for (int i = 1; i <= 16; ++i) {
                    UiChunk uc;
                    uc.id = i;
                    uc.text = std::to_string(i).c_str();
                    if (i <= done_blocks) {
                        uc.state = "done";
                        uc.progress_str = "100%";
                    } else if (i == done_blocks + 1 && (t->status == core::TaskStatus::Downloading || t->status == core::TaskStatus::Probing)) {
                        uc.state = "active";
                        uc.progress_str = "Active";
                    } else {
                        uc.state = "pending";
                        uc.progress_str = "0%";
                    }
                    g_inspector_chunks_list.push_back(uc);
                }
            }
        }
    }

    // Update Windows Taskbar (ITaskbarList3) Progress
    uint64_t sum_done = 0;
    uint64_t sum_total = 0;
    bool has_active = false;
    bool has_paused = false;
    for (const auto& t : tasks) {
        if (t.status == core::TaskStatus::Downloading || t.status == core::TaskStatus::Probing) {
            has_active = true;
            sum_done += static_cast<uint64_t>(t.downloaded_bytes);
            sum_total += static_cast<uint64_t>(t.total_bytes);
        } else if (t.status == core::TaskStatus::Paused) {
            has_paused = true;
        }
    }

    if (has_active && sum_total > 0) {
        core::ShellIntegration::Instance().SetTaskbarProgress(sum_done, sum_total, core::TaskbarProgressState::Normal);
    } else if (has_paused && sum_total > 0) {
        core::ShellIntegration::Instance().SetTaskbarProgress(sum_done, sum_total, core::TaskbarProgressState::Paused);
    } else {
        core::ShellIntegration::Instance().SetTaskbarProgress(0, 0, core::TaskbarProgressState::NoProgress);
    }

    if (g_model_handle) {
        g_model_handle.DirtyVariable("tasks");
        g_model_handle.DirtyVariable("grabber_packages");
        g_model_handle.DirtyVariable("has_tasks");
        g_model_handle.DirtyVariable("has_grabber");
        g_model_handle.DirtyVariable("selected_count");
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
        g_model_handle.DirtyVariable("is_context_menu_open");
        g_model_handle.DirtyVariable("is_password_modal_open");
        g_model_handle.DirtyVariable("password_modal_filename");
        g_model_handle.DirtyVariable("password_modal_input");
        g_model_handle.DirtyVariable("context_task_filename");
        g_model_handle.DirtyVariable("context_task_info");
        g_model_handle.DirtyVariable("limiter_enabled");
        g_model_handle.DirtyVariable("limiter_display_text");
        g_model_handle.DirtyVariable("limiter_status_text");
        g_model_handle.DirtyVariable("limiter_custom_input");
        g_model_handle.DirtyVariable("inspector_filename");
        g_model_handle.DirtyVariable("inspector_url");
        g_model_handle.DirtyVariable("inspector_path");
        g_model_handle.DirtyVariable("inspector_status");
        g_model_handle.DirtyVariable("inspector_speed");
        g_model_handle.DirtyVariable("inspector_progress_text");
        g_model_handle.DirtyVariable("inspector_eta");
        g_model_handle.DirtyVariable("inspector_hash");
        g_model_handle.DirtyVariable("inspector_priority");
        g_model_handle.DirtyVariable("inspector_chunks_list");
        g_model_handle.DirtyVariable("add_modal_tab");
        g_model_handle.DirtyVariable("new_url");
        g_model_handle.DirtyVariable("new_custom_name");
        g_model_handle.DirtyVariable("new_save_folder");
        g_model_handle.DirtyVariable("new_batch_urls");
        g_model_handle.DirtyVariable("new_engine_mode");
        g_model_handle.DirtyVariable("settings_save_path");
        g_model_handle.DirtyVariable("settings_max_concurrent");
        g_model_handle.DirtyVariable("settings_max_per_host");
        g_model_handle.DirtyVariable("settings_default_connections");
        g_model_handle.DirtyVariable("settings_auto_extract");
        g_model_handle.DirtyVariable("settings_delete_archive");
        g_model_handle.DirtyVariable("vault_passwords");
        g_model_handle.DirtyVariable("new_vault_password");
        g_model_handle.DirtyVariable("settings_script_path");
        g_model_handle.DirtyVariable("settings_script_enabled");
        g_model_handle.DirtyVariable("inspector_filename");
        g_model_handle.DirtyVariable("inspector_url");
        g_model_handle.DirtyVariable("inspector_path");
        g_model_handle.DirtyVariable("inspector_status");
        g_model_handle.DirtyVariable("inspector_hash");
        g_model_handle.DirtyVariable("media_title");
        g_model_handle.DirtyVariable("media_author");
        g_model_handle.DirtyVariable("media_duration");
        g_model_handle.DirtyVariable("media_format");
    }
}

UiManager::UiManager() = default;

UiManager::~UiManager() {
    Shutdown();
}

class ConsoleSystemInterface : public Rml::SystemInterface {
public:
    double GetElapsedTime() override { return Backend::GetSystemInterface()->GetElapsedTime(); }
    void SetMouseCursor(const Rml::String& cursor_name) override { Backend::GetSystemInterface()->SetMouseCursor(cursor_name); }
    void SetClipboardText(const Rml::String& text) override { Backend::GetSystemInterface()->SetClipboardText(text); }
    void GetClipboardText(Rml::String& text) override { Backend::GetSystemInterface()->GetClipboardText(text); }
    void ActivateKeyboard(Rml::Vector2f caret_position, float line_height) override {
        Backend::GetSystemInterface()->ActivateKeyboard(caret_position, line_height);
    }
    void DeactivateKeyboard() override { Backend::GetSystemInterface()->DeactivateKeyboard(); }
    bool LogMessage(Rml::Log::Type /*type*/, const Rml::String& message) override {
        std::cout << "[RmlUi] " << message << std::endl;
        return true;
    }
};
static ConsoleSystemInterface g_console_system_interface;

bool UiManager::Initialize(int width, int height) {
    if (!Backend::Initialize("🌊 Waterfall Accelerator v2.0 (Native C++20)", width, height, true)) {
        std::cerr << "Failed to initialize RmlUi Win32 OpenGL backend" << std::endl;
        return false;
    }

    Rml::SetSystemInterface(&g_console_system_interface);
    Rml::SetRenderInterface(Backend::GetRenderInterface());

    if (!Rml::Initialise()) {
        std::cerr << "Failed to initialise RmlUi core" << std::endl;
        return false;
    }

    Rml::LoadFontFace("C:\\Windows\\Fonts\\segoeui.ttf", false);
    Rml::LoadFontFace("C:\\Windows\\Fonts\\segoeuib.ttf", false);
    Rml::LoadFontFace("C:\\Windows\\Fonts\\seguisym.ttf", true); // Fallback for symbols/icons
    Rml::LoadFontFace("C:\\Windows\\Fonts\\consola.ttf", false);

    context_ = Rml::CreateContext("main", Rml::Vector2i(width, height));
    if (!context_) {
        std::cerr << "Failed to create RmlUi context" << std::endl;
        return false;
    }

    // Register async update listener from DownloadManager
    core::DownloadManager::Instance().SetUpdateListener([this]() {
        RequestDataUpdate();
    });

    // Initialize UI data models
    SetupDataModel();

    // Load main presentation document
    LoadDocument();

    HWND hwnd = FindWindowW(nullptr, L"🌊 Waterfall Accelerator v2.0 (Native C++20)");
    core::ShellIntegration::Instance().Initialize(hwnd);

    is_running_ = true;
    return true;
}

void UiManager::SetupDataModel() {
    Rml::DataModelConstructor constructor = context_->CreateDataModel("downloads_model");
    if (!constructor) {
        std::cerr << "Failed to create data model" << std::endl;
        return;
    }

    // Bind task structure
    auto task_handle = constructor.RegisterStruct<UiTask>();
    std::cout << "[DATA_MODEL] RegisterStruct<UiTask>: " << (bool)task_handle << std::endl;
    if (task_handle) {
        task_handle.RegisterMember("id", &UiTask::id);
        task_handle.RegisterMember("filename", &UiTask::filename);
        task_handle.RegisterMember("icon", &UiTask::icon);
        task_handle.RegisterMember("status", &UiTask::status);
        task_handle.RegisterMember("speed", &UiTask::speed);
        task_handle.RegisterMember("downloaded", &UiTask::downloaded);
        task_handle.RegisterMember("total", &UiTask::total);
        task_handle.RegisterMember("eta", &UiTask::eta);
        task_handle.RegisterMember("progress", &UiTask::progress);
        task_handle.RegisterMember("category_id", &UiTask::category_id);
        task_handle.RegisterMember("selected", &UiTask::selected);
    }
    bool reg_tasks_arr = constructor.RegisterArray<Rml::Vector<UiTask>>();
    std::cout << "[DATA_MODEL] RegisterArray<UiTask>: " << reg_tasks_arr << std::endl;
    bool bind_tasks = constructor.Bind("tasks", &g_ui_tasks);
    std::cout << "[DATA_MODEL] Bind tasks: " << bind_tasks << std::endl;

    // Bind LinkGrabber package structure
    if (auto pkg_handle = constructor.RegisterStruct<UiGrabberPackage>()) {
        pkg_handle.RegisterMember("id", &UiGrabberPackage::id);
        pkg_handle.RegisterMember("name", &UiGrabberPackage::name);
        pkg_handle.RegisterMember("hoster", &UiGrabberPackage::hoster);
        pkg_handle.RegisterMember("file_count", &UiGrabberPackage::file_count);
        pkg_handle.RegisterMember("total_size", &UiGrabberPackage::total_size);
        pkg_handle.RegisterMember("status", &UiGrabberPackage::status);
    }
    constructor.RegisterArray<Rml::Vector<UiGrabberPackage>>();
    constructor.Bind("grabber_packages", &g_ui_grabber_packages);

    // Bind chunk array for inspector
    if (auto chunk_handle = constructor.RegisterStruct<UiChunk>()) {
        chunk_handle.RegisterMember("id", &UiChunk::id);
        chunk_handle.RegisterMember("state", &UiChunk::state);
        chunk_handle.RegisterMember("text", &UiChunk::text);
        chunk_handle.RegisterMember("progress_str", &UiChunk::progress_str);
    }
    constructor.RegisterArray<Rml::Vector<UiChunk>>();
    constructor.Bind("inspector_chunks_list", &g_inspector_chunks_list);

    // Bind password vault array
    constructor.RegisterArray<Rml::Vector<Rml::String>>();
    constructor.Bind("vault_passwords", &g_vault_passwords);

    // Bind dashboard telemetry variables
    constructor.Bind("has_tasks", &g_has_tasks);
    constructor.Bind("has_grabber", &g_has_grabber);
    constructor.Bind("selected_count", &g_selected_count);
    constructor.Bind("active_count", &g_ui_active_count);
    constructor.Bind("total_speed", &g_ui_total_speed);
    constructor.Bind("completed_count", &g_ui_completed_count);
    constructor.Bind("paused_count", &g_ui_paused_count);
    constructor.Bind("grabber_count", &g_ui_grabber_count);

    // Bind views & navigation
    constructor.Bind("current_view", &g_current_view);
    constructor.Bind("active_filter", &g_active_filter);
    constructor.Bind("active_category", &g_active_category);
    constructor.Bind("settings_tab", &g_settings_tab);
    constructor.Bind("power_action", &g_power_action);

    // Bind modal states
    constructor.Bind("is_add_modal_open", &g_is_add_modal_open);
    constructor.Bind("is_settings_modal_open", &g_is_settings_modal_open);
    constructor.Bind("is_limiter_modal_open", &g_is_limiter_modal_open);
    constructor.Bind("is_inspector_open", &g_is_inspector_open);
    constructor.Bind("is_context_menu_open", &g_is_context_menu_open);
    constructor.Bind("is_password_modal_open", &g_is_password_modal_open);
    constructor.Bind("password_modal_filename", &g_password_modal_filename);
    constructor.Bind("password_modal_input", &g_password_modal_input);

    // Bind context menu details
    constructor.Bind("context_task_filename", &g_context_task_filename);
    constructor.Bind("context_task_info", &g_context_task_info);

    // Bind speed limiter variables
    constructor.Bind("limiter_enabled", &g_limiter_enabled);
    constructor.Bind("limiter_display_text", &g_limiter_display_text);
    constructor.Bind("limiter_status_text", &g_limiter_status_text);
    constructor.Bind("limiter_custom_input", &g_limiter_custom_input);

    // Bind inspector details
    constructor.Bind("inspector_filename", &g_inspector_filename);
    constructor.Bind("inspector_url", &g_inspector_url);
    constructor.Bind("inspector_path", &g_inspector_path);
    constructor.Bind("inspector_status", &g_inspector_status);
    constructor.Bind("inspector_speed", &g_inspector_speed);
    constructor.Bind("inspector_progress_text", &g_inspector_progress_text);
    constructor.Bind("inspector_eta", &g_inspector_eta);
    constructor.Bind("inspector_hash", &g_inspector_hash);
    constructor.Bind("inspector_priority", &g_inspector_priority);
    constructor.Bind("inspector_chunks", &g_inspector_chunks);
    constructor.Bind("inspector_auto_extract", &g_inspector_auto_extract);

    // Bind Add modal variables
    constructor.Bind("add_modal_tab", &g_add_modal_tab);
    constructor.Bind("new_url", &g_new_url_input);
    constructor.Bind("new_custom_name", &g_new_custom_name);
    constructor.Bind("new_save_folder", &g_new_save_folder);
    constructor.Bind("new_batch_urls", &g_new_batch_urls);
    constructor.Bind("new_engine_mode", &g_new_engine_mode);
    constructor.Bind("new_auto_extract", &g_new_auto_extract);
    constructor.Bind("new_archive_password", &g_new_archive_password);

    // Bind Settings modal variables
    constructor.Bind("settings_save_path", &g_settings_save_path);
    constructor.Bind("settings_max_concurrent", &g_settings_max_concurrent);
    constructor.Bind("settings_max_per_host", &g_settings_max_per_host);
    constructor.Bind("settings_default_connections", &g_settings_default_connections);
    constructor.Bind("settings_auto_extract", &g_settings_auto_extract);
    constructor.Bind("settings_delete_archive", &g_settings_delete_archive);
    constructor.Bind("new_vault_password", &g_new_vault_password);
    constructor.Bind("settings_script_path", &g_settings_script_path);
    constructor.Bind("settings_script_enabled", &g_settings_script_enabled);

    // Bind media studio variables
    constructor.Bind("media_url", &g_media_url_input);
    constructor.Bind("media_title", &g_media_title);
    constructor.Bind("media_author", &g_media_author);
    constructor.Bind("media_duration", &g_media_duration);
    constructor.Bind("media_format", &g_media_format);

    // Event Callbacks: Views
    constructor.BindEventCallback("set_view", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList& args) {
        if (!args.empty()) {
            g_current_view = args[0].Get<Rml::String>();
            RefreshModelData();
        }
    });

    constructor.BindEventCallback("set_filter", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList& args) {
        if (!args.empty()) {
            g_active_filter = args[0].Get<Rml::String>();
            g_active_category = "all";
            RefreshModelData();
        }
    });

    constructor.BindEventCallback("set_category", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList& args) {
        if (!args.empty()) {
            Rml::String cat = args[0].Get<Rml::String>();
            if (g_active_category == cat) {
                g_active_category = "all";
            } else {
                g_active_category = cat;
                g_active_filter = "all";
            }
            RefreshModelData();
        }
    });

    // Modals: Add Download
    constructor.BindEventCallback("open_add_modal", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList&) {
        g_is_add_modal_open = true;
        // Auto-paste clipboard URL if valid
        std::string clip = GetWin32ClipboardText();
        while (!clip.empty() && (clip.front() == ' ' || clip.front() == '\t' || clip.front() == '\r' || clip.front() == '\n')) clip.erase(clip.begin());
        while (!clip.empty() && (clip.back() == ' ' || clip.back() == '\t' || clip.back() == '\r' || clip.back() == '\n')) clip.pop_back();
        if (clip.rfind("http://", 0) == 0 || clip.rfind("https://", 0) == 0) {
            g_new_url_input = clip.c_str();
        }
        if (g_new_save_folder.empty()) {
            g_new_save_folder = core::ConfigManager::Instance().GetDownloadDirectory().c_str();
        }
        RefreshModelData();
    });

    constructor.BindEventCallback("close_add_modal", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList&) {
        g_is_add_modal_open = false;
        RefreshModelData();
    });

    constructor.BindEventCallback("set_add_modal_tab", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList& args) {
        if (!args.empty()) {
            g_add_modal_tab = args[0].Get<Rml::String>();
            RefreshModelData();
        }
    });

    constructor.BindEventCallback("browse_add_folder", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList&) {
        std::string picked = ShowWin32FolderPicker();
        if (!picked.empty()) {
            g_new_save_folder = picked.c_str();
            RefreshModelData();
        }
    });

    constructor.BindEventCallback("set_quick_folder", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList& args) {
        if (!args.empty()) {
            std::string t = args[0].Get<Rml::String>().c_str();
            if (t == "downloads") g_new_save_folder = GetWin32KnownFolder(FOLDERID_Downloads).c_str();
            else if (t == "desktop") g_new_save_folder = GetWin32KnownFolder(FOLDERID_Desktop).c_str();
            else if (t == "videos") g_new_save_folder = GetWin32KnownFolder(FOLDERID_Videos).c_str();
            else if (t == "music") g_new_save_folder = GetWin32KnownFolder(FOLDERID_Music).c_str();
            RefreshModelData();
        }
    });

    constructor.BindEventCallback("set_engine_mode", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList& args) {
        if (!args.empty()) {
            g_new_engine_mode = args[0].Get<Rml::String>();
            RefreshModelData();
        }
    });

    constructor.BindEventCallback("submit_add_modal", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList&) {
        std::string target_dir = g_new_save_folder.c_str();
        if (target_dir.empty()) target_dir = core::ConfigManager::Instance().GetDownloadDirectory();

        if (g_add_modal_tab == "batch") {
            // Process batch URLs line by line
            std::istringstream iss(g_new_batch_urls.c_str());
            std::string line;
            while (std::getline(iss, line)) {
                while (!line.empty() && (line.front() == ' ' || line.front() == '\t' || line.front() == '\r')) line.erase(line.begin());
                while (!line.empty() && (line.back() == ' ' || line.back() == '\t' || line.back() == '\r')) line.pop_back();
                if (line.rfind("http://", 0) == 0 || line.rfind("https://", 0) == 0) {
                    core::DownloadManager::Instance().AddDownload(line, "", target_dir);
                }
            }
            g_new_batch_urls.clear();
        } else if (g_add_modal_tab == "media") {
            std::string url = g_media_url_input.c_str();
            if (!url.empty()) {
                core::DownloadManager::Instance().AddDownload(url, g_media_title.c_str(), target_dir, 2, true, g_media_format.c_str());
            }
        } else {
            // Direct link
            if (!g_new_url_input.empty()) {
                std::string pwd = g_new_archive_password.c_str();
                if (!pwd.empty()) {
                    core::ConfigManager::Instance().AddArchivePassword(pwd);
                }
                core::DownloadManager::Instance().AddDownload(g_new_url_input.c_str(), g_new_custom_name.c_str(), target_dir);
                g_new_url_input.clear();
                g_new_custom_name.clear();
                g_new_archive_password.clear();
            }
        }
        g_is_add_modal_open = false;
        RefreshModelData();
    });

    // Modals: Settings
    constructor.BindEventCallback("open_settings_modal", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList&) {
        g_is_settings_modal_open = true;
        auto cfg = core::ConfigManager::Instance().GetConfig();
        g_settings_save_path = cfg.download_directory.c_str();
        g_settings_max_concurrent = std::to_string(cfg.max_concurrent_downloads).c_str();
        g_settings_max_per_host = std::to_string(cfg.max_concurrent_per_host).c_str();
        g_settings_default_connections = std::to_string(cfg.default_connections_per_task).c_str();
        g_settings_auto_extract = cfg.auto_extract_archives;
        g_settings_delete_archive = cfg.delete_archive_after_extract;
        RefreshModelData();
    });

    constructor.BindEventCallback("close_settings_modal", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList&) {
        g_is_settings_modal_open = false;
        RefreshModelData();
    });

    constructor.BindEventCallback("save_settings_modal", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList&) {
        auto cfg = core::ConfigManager::Instance().GetConfig();
        if (!g_settings_save_path.empty()) cfg.download_directory = g_settings_save_path.c_str();
        try { cfg.max_concurrent_downloads = std::max(1, std::stoi(g_settings_max_concurrent.c_str())); } catch (...) {}
        try { cfg.max_concurrent_per_host = std::max(1, std::stoi(g_settings_max_per_host.c_str())); } catch (...) {}
        try { cfg.default_connections_per_task = std::max(1, std::stoi(g_settings_default_connections.c_str())); } catch (...) {}
        cfg.auto_extract_archives = g_settings_auto_extract;
        cfg.delete_archive_after_extract = g_settings_delete_archive;
        core::ConfigManager::Instance().UpdateConfig(cfg);
        g_is_settings_modal_open = false;
        RefreshModelData();
    });

    constructor.BindEventCallback("browse_settings_folder", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList&) {
        std::string picked = ShowWin32FolderPicker();
        if (!picked.empty()) {
            g_settings_save_path = picked.c_str();
            RefreshModelData();
        }
    });

    constructor.BindEventCallback("settings_change_max_concurrent", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList& args) {
        if (!args.empty()) {
            int delta = args[0].Get<int>();
            int cur = std::max(1, std::stoi(g_settings_max_concurrent.c_str()) + delta);
            g_settings_max_concurrent = std::to_string(cur).c_str();
            RefreshModelData();
        }
    });

    constructor.BindEventCallback("settings_change_max_per_host", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList& args) {
        if (!args.empty()) {
            int delta = args[0].Get<int>();
            int cur = std::max(1, std::stoi(g_settings_max_per_host.c_str()) + delta);
            g_settings_max_per_host = std::to_string(cur).c_str();
            RefreshModelData();
        }
    });

    constructor.BindEventCallback("set_settings_tab", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList& args) {
        if (!args.empty()) {
            g_settings_tab = args[0].Get<Rml::String>();
            RefreshModelData();
        }
    });

    constructor.BindEventCallback("add_vault_password", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList&) {
        if (!g_new_vault_password.empty()) {
            core::ConfigManager::Instance().AddArchivePassword(g_new_vault_password.c_str());
            g_new_vault_password.clear();
            RefreshModelData();
        }
    });

    constructor.BindEventCallback("remove_vault_password", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList& args) {
        if (!args.empty()) {
            std::string pwd = args[0].Get<Rml::String>().c_str();
            core::ConfigManager::Instance().RemoveArchivePassword(pwd);
            RefreshModelData();
        }
    });

    // Modals: Speed Limiter
    constructor.BindEventCallback("open_limiter_modal", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList&) {
        g_is_limiter_modal_open = true;
        RefreshModelData();
    });

    constructor.BindEventCallback("close_limiter_modal", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList&) {
        g_is_limiter_modal_open = false;
        RefreshModelData();
    });

    constructor.BindEventCallback("toggle_speed_limit", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList&) {
        bool cur = core::ConfigManager::Instance().IsSpeedLimitEnabled();
        core::ConfigManager::Instance().SetSpeedLimitEnabled(!cur);
        RefreshModelData();
    });

    constructor.BindEventCallback("set_speed_preset", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList& args) {
        if (!args.empty()) {
            std::string p = args[0].Get<Rml::String>().c_str();
            if (p == "unlimited") {
                core::ConfigManager::Instance().SetSpeedLimitEnabled(false);
            } else {
                int64_t bps = 5 * 1024 * 1024;
                if (p == "500k") bps = 500 * 1024;
                else if (p == "1m") bps = 1024 * 1024;
                else if (p == "5m") bps = 5 * 1024 * 1024;
                else if (p == "10m") bps = 10 * 1024 * 1024;
                else if (p == "20m") bps = 20 * 1024 * 1024;
                core::ConfigManager::Instance().SetSpeedLimitBps(bps);
                core::ConfigManager::Instance().SetSpeedLimitEnabled(true);
            }
            RefreshModelData();
        }
    });

    constructor.BindEventCallback("apply_custom_limit", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList&) {
        try {
            double mb = std::stod(g_limiter_custom_input.c_str());
            if (mb > 0) {
                int64_t bps = static_cast<int64_t>(mb * 1024.0 * 1024.0);
                core::ConfigManager::Instance().SetSpeedLimitBps(bps);
                core::ConfigManager::Instance().SetSpeedLimitEnabled(true);
            }
        } catch (...) {}
        RefreshModelData();
    });

    // Task Context Menu Callbacks
    constructor.BindEventCallback("open_task_menu", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList& args) {
        if (!args.empty()) {
            int id = args[0].Get<int>();
            auto* t = core::DownloadManager::Instance().GetTaskPtr(id);
            if (t) {
                g_context_task_id = id;
                g_context_task_filename = t->filename.c_str();
                g_context_task_info = (t->GetStatusString() + " • " + t->GetDownloadedFormatted() + " / " + t->GetTotalFormatted()).c_str();
                g_is_context_menu_open = true;
                RefreshModelData();
            }
        }
    });

    constructor.BindEventCallback("close_context_menu", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList&) {
        g_is_context_menu_open = false;
        RefreshModelData();
    });

    constructor.BindEventCallback("context_open_file", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList&) {
        auto* t = core::DownloadManager::Instance().GetTaskPtr(g_context_task_id);
        if (t && !t->save_path.empty()) {
            ShellExecuteA(nullptr, "open", t->save_path.c_str(), nullptr, nullptr, SW_SHOW);
        }
        g_is_context_menu_open = false;
        RefreshModelData();
    });

    constructor.BindEventCallback("context_open_folder", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList&) {
        auto* t = core::DownloadManager::Instance().GetTaskPtr(g_context_task_id);
        if (t && !t->save_path.empty()) {
            std::string param = "/select,\"" + t->save_path + "\"";
            ShellExecuteA(nullptr, "open", "explorer.exe", param.c_str(), nullptr, SW_SHOW);
        }
        g_is_context_menu_open = false;
        RefreshModelData();
    });

    constructor.BindEventCallback("context_open_extracted", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList&) {
        auto* t = core::DownloadManager::Instance().GetTaskPtr(g_context_task_id);
        if (t && !t->save_path.empty()) {
            std::string parent = t->save_path.substr(0, t->save_path.find_last_of("\\/"));
            ShellExecuteA(nullptr, "open", parent.c_str(), nullptr, nullptr, SW_SHOW);
        }
        g_is_context_menu_open = false;
        RefreshModelData();
    });

    constructor.BindEventCallback("context_extract_now", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList&) {
        auto* t = core::DownloadManager::Instance().GetTaskPtr(g_context_task_id);
        if (t && !t->save_path.empty()) {
            std::string path = t->save_path;
            std::thread([path]() {
                std::string parent = path.substr(0, path.find_last_of("\\/"));
                std::string err;
                core::ArchiveEngine::Instance().UnpackArchive(path, parent, core::ConfigManager::Instance().GetArchivePasswords(), false, {path}, [](float){}, err);
            }).detach();
        }
        g_is_context_menu_open = false;
        RefreshModelData();
    });

    constructor.BindEventCallback("context_verify_hash", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList&) {
        auto* t = core::DownloadManager::Instance().GetTaskPtr(g_context_task_id);
        if (t && !t->save_path.empty()) {
            t->sha256_hash = "Computing...";
            int task_id = g_context_task_id;
            std::string path = t->save_path;
            std::thread([task_id, path]() {
                std::string hash = core::ChunkEngine::CalculateSha256(path);
                auto* task = core::DownloadManager::Instance().GetTaskPtr(task_id);
                if (task) {
                    task->sha256_hash = hash;
                    core::DownloadManager::Instance().NotifyUpdate();
                }
            }).detach();
        }
        g_is_context_menu_open = false;
        RefreshModelData();
    });

    constructor.BindEventCallback("context_copy_link", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList&) {
        auto* t = core::DownloadManager::Instance().GetTaskPtr(g_context_task_id);
        if (t) {
            SetWin32ClipboardText(t->url);
        }
        g_is_context_menu_open = false;
        RefreshModelData();
    });

    constructor.BindEventCallback("context_move_top", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList&) {
        core::DownloadManager::Instance().MoveTaskTop(g_context_task_id);
        g_is_context_menu_open = false;
        RefreshModelData();
    });

    constructor.BindEventCallback("context_move_up", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList&) {
        core::DownloadManager::Instance().MoveTaskUp(g_context_task_id);
        g_is_context_menu_open = false;
        RefreshModelData();
    });

    constructor.BindEventCallback("context_move_down", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList&) {
        core::DownloadManager::Instance().MoveTaskDown(g_context_task_id);
        g_is_context_menu_open = false;
        RefreshModelData();
    });

    constructor.BindEventCallback("context_move_bottom", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList&) {
        core::DownloadManager::Instance().MoveTaskBottom(g_context_task_id);
        g_is_context_menu_open = false;
        RefreshModelData();
    });

    constructor.BindEventCallback("context_delete_list", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList&) {
        core::DownloadManager::Instance().DeleteDownload(g_context_task_id, false);
        g_selected_task_ids.erase(g_context_task_id);
        g_is_context_menu_open = false;
        RefreshModelData();
    });

    constructor.BindEventCallback("context_delete_disk", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList&) {
        core::DownloadManager::Instance().DeleteDownload(g_context_task_id, true);
        g_selected_task_ids.erase(g_context_task_id);
        g_is_context_menu_open = false;
        RefreshModelData();
    });

    // Batch Selection Callbacks
    constructor.BindEventCallback("toggle_task_selection", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList& args) {
        if (!args.empty()) {
            int id = args[0].Get<int>();
            if (g_selected_task_ids.count(id)) {
                g_selected_task_ids.erase(id);
            } else {
                g_selected_task_ids.insert(id);
            }
            RefreshModelData();
        }
    });

    constructor.BindEventCallback("select_all_tasks", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList&) {
        auto tasks = core::DownloadManager::Instance().GetTasks();
        if (g_selected_task_ids.size() == tasks.size()) {
            g_selected_task_ids.clear();
        } else {
            for (const auto& t : tasks) g_selected_task_ids.insert(t.id);
        }
        RefreshModelData();
    });

    constructor.BindEventCallback("batch_deselect", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList&) {
        g_selected_task_ids.clear();
        RefreshModelData();
    });

    constructor.BindEventCallback("batch_resume", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList&) {
        for (int id : g_selected_task_ids) {
            core::DownloadManager::Instance().ResumeDownload(id);
        }
        RefreshModelData();
    });

    constructor.BindEventCallback("batch_pause", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList&) {
        for (int id : g_selected_task_ids) {
            core::DownloadManager::Instance().PauseDownload(id);
        }
        RefreshModelData();
    });

    constructor.BindEventCallback("batch_delete", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList&) {
        for (int id : g_selected_task_ids) {
            core::DownloadManager::Instance().DeleteDownload(id, false);
        }
        g_selected_task_ids.clear();
        RefreshModelData();
    });

    constructor.BindEventCallback("sort_queue", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList& args) {
        if (!args.empty()) {
            std::string mode = args[0].Get<Rml::String>().c_str();
            if (mode == "name") core::DownloadManager::Instance().SortQueue(core::QueueScheduler::SortMode::NameAsc);
            else if (mode == "size") core::DownloadManager::Instance().SortQueue(core::QueueScheduler::SortMode::SizeDesc);
            else if (mode == "status") core::DownloadManager::Instance().SortQueue(core::QueueScheduler::SortMode::Status);
            else core::DownloadManager::Instance().SortQueue(core::QueueScheduler::SortMode::DateDesc);
            RefreshModelData();
        }
    });

    // Top Command Toolbar Actions
    constructor.BindEventCallback("resume_all", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList&) {
        core::DownloadManager::Instance().ResumeAll();
        RefreshModelData();
    });

    constructor.BindEventCallback("pause_all", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList&) {
        core::DownloadManager::Instance().PauseAll();
        RefreshModelData();
    });

    constructor.BindEventCallback("clear_completed", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList&) {
        core::DownloadManager::Instance().ClearCompleted();
        RefreshModelData();
    });

    constructor.BindEventCallback("cycle_power_action", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList&) {
        auto current = core::ConfigManager::Instance().GetPowerAction();
        core::PowerAction next_action = core::PowerAction::None;
        if (current == core::PowerAction::None) {
            next_action = core::PowerAction::Sleep;
            g_power_action = "Sleep";
        } else if (current == core::PowerAction::Sleep) {
            next_action = core::PowerAction::Shutdown;
            g_power_action = "Shutdown";
        } else {
            next_action = core::PowerAction::None;
            g_power_action = "None";
        }
        core::ConfigManager::Instance().SetPowerAction(next_action);
        RefreshModelData();
    });

    // Task Level Actions
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
            g_selected_task_ids.erase(id);
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

    constructor.BindEventCallback("open_extracted", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList& args) {
        if (!args.empty()) {
            int id = args[0].Get<int>();
            auto* t = core::DownloadManager::Instance().GetTaskPtr(id);
            if (t && !t->save_path.empty()) {
                std::string parent = t->save_path.substr(0, t->save_path.find_last_of("\\/"));
                ShellExecuteA(nullptr, "open", parent.c_str(), nullptr, nullptr, SW_SHOW);
            }
        }
    });

    constructor.BindEventCallback("open_password_modal", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList& args) {
        if (!args.empty()) {
            int id = args[0].Get<int>();
            auto* t = core::DownloadManager::Instance().GetTaskPtr(id);
            if (t) {
                g_password_modal_task_id = id;
                g_password_modal_filename = t->filename.c_str();
                g_password_modal_input = "";
                g_is_password_modal_open = true;
                RefreshModelData();
            }
        }
    });

    constructor.BindEventCallback("close_password_modal", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList&) {
        g_is_password_modal_open = false;
        RefreshModelData();
    });

    constructor.BindEventCallback("submit_archive_password", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList&) {
        std::string pwd = g_password_modal_input.c_str();
        if (!pwd.empty()) {
            core::ConfigManager::Instance().AddArchivePassword(pwd);
            auto* t = core::DownloadManager::Instance().GetTaskPtr(g_password_modal_task_id);
            if (t && !t->save_path.empty()) {
                std::string path = t->save_path;
                std::thread([path, pwd]() {
                    std::string parent = path.substr(0, path.find_last_of("\\/"));
                    std::string err;
                    core::ArchiveEngine::Instance().UnpackArchive(path, parent, {pwd}, false, {path}, [](float){}, err);
                }).detach();
            }
        }
        g_is_password_modal_open = false;
        RefreshModelData();
    });

    constructor.BindEventCallback("toggle_inspector", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList& args) {
        if (!args.empty()) {
            int id = args[0].Get<int>();
            if (g_is_inspector_open && g_selected_task_id == id) {
                g_is_inspector_open = false;
            } else {
                g_selected_task_id = id;
                g_is_inspector_open = true;
            }
            RefreshModelData();
            return;
        }
        g_is_inspector_open = false;
        RefreshModelData();
    });

    constructor.BindEventCallback("close_inspector", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList&) {
        g_is_inspector_open = false;
        std::cout << "[UI] Closed Inspector" << std::endl;
        RefreshModelData();
    });

    constructor.BindEventCallback("inspector_open_file", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList&) {
        auto* t = core::DownloadManager::Instance().GetTaskPtr(g_selected_task_id);
        if (t && !t->save_path.empty()) {
            ShellExecuteA(nullptr, "open", t->save_path.c_str(), nullptr, nullptr, SW_SHOW);
        }
    });

    constructor.BindEventCallback("inspector_open_folder", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList&) {
        auto* t = core::DownloadManager::Instance().GetTaskPtr(g_selected_task_id);
        if (t && !t->save_path.empty()) {
            std::string param = "/select,\"" + t->save_path + "\"";
            ShellExecuteA(nullptr, "open", "explorer.exe", param.c_str(), nullptr, SW_SHOW);
        }
    });

    constructor.BindEventCallback("inspector_verify_hash", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList&) {
        auto* t = core::DownloadManager::Instance().GetTaskPtr(g_selected_task_id);
        if (t && !t->save_path.empty()) {
            t->sha256_hash = "Computing...";
            int task_id = g_selected_task_id;
            std::string path = t->save_path;
            std::thread([task_id, path]() {
                std::string hash = core::ChunkEngine::CalculateSha256(path);
                auto* task = core::DownloadManager::Instance().GetTaskPtr(task_id);
                if (task) {
                    task->sha256_hash = hash;
                    core::DownloadManager::Instance().NotifyUpdate();
                }
            }).detach();
        }
        RefreshModelData();
    });

    constructor.BindEventCallback("inspector_copy_link", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList&) {
        auto* t = core::DownloadManager::Instance().GetTaskPtr(g_selected_task_id);
        if (t) {
            SetWin32ClipboardText(t->url);
        }
    });

    constructor.BindEventCallback("inspector_extract_now", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList&) {
        auto* t = core::DownloadManager::Instance().GetTaskPtr(g_selected_task_id);
        if (t && !t->save_path.empty()) {
            std::string path = t->save_path;
            std::thread([path]() {
                std::string parent = path.substr(0, path.find_last_of("\\/"));
                std::string err;
                core::ArchiveEngine::Instance().UnpackArchive(path, parent, core::ConfigManager::Instance().GetArchivePasswords(), false, {path}, [](float){}, err);
            }).detach();
        }
        RefreshModelData();
    });

    constructor.BindEventCallback("inspector_set_priority", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList& args) {
        if (!args.empty()) {
            int prio = args[0].Get<int>();
            auto* t = core::DownloadManager::Instance().GetTaskPtr(g_selected_task_id);
            if (t) {
                t->priority = prio;
                RefreshModelData();
            }
        }
    });

    // LinkGrabber Specific Callbacks
    constructor.BindEventCallback("grabber_crawl", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList&) {
        std::string text;
        if (OpenClipboard(nullptr)) {
            HANDLE hData = GetClipboardData(CF_TEXT);
            if (hData) {
                char* pszText = static_cast<char*>(GlobalLock(hData));
                if (pszText) {
                    text = pszText;
                    GlobalUnlock(hData);
                }
            }
            CloseClipboard();
        }
        if (text.empty()) {
            text = "https://pixeldrain.com/u/abc12345\nhttps://example.com/test_ubuntu.iso";
        }
        std::cout << "[C++ Crawler] Deep LinkGrabber Crawl triggered (" << text.size() << " bytes)" << std::endl;
        core::DownloadManager::Instance().CrawlTextToGrabber(text);
        RefreshModelData();
    });

    constructor.BindEventCallback("grabber_transfer_all", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList&) {
        std::cout << "[C++ Engine] Transferring all LinkGrabber packages to download queue." << std::endl;
        core::DownloadManager::Instance().TransferAllGrabberPackages();
        g_current_view = "downloads";
        RefreshModelData();
    });

    constructor.BindEventCallback("grabber_clear", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList&) {
        std::cout << "[UI] Cleared LinkGrabber items." << std::endl;
        core::DownloadManager::Instance().ClearGrabber();
        RefreshModelData();
    });

    constructor.BindEventCallback("grabber_add_package", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList& args) {
        if (!args.empty()) {
            int id = args[0].Get<int>();
            std::cout << "[C++ Engine] Transferred LinkGrabber package " << id << " to active downloads." << std::endl;
            core::DownloadManager::Instance().TransferGrabberPackage(id);
            RefreshModelData();
        }
    });

    // Media Studio Specific Callbacks
    constructor.BindEventCallback("media_probe", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList&) {
        std::string url = g_media_url_input.c_str();
        std::cout << "[C++ Media Engine] Probing YouTube / yt-dlp metadata for: " << url << std::endl;
        g_media_title = "Probing video stream metadata with yt-dlp...";
        g_media_author = "Analyzing...";
        g_media_duration = "--:--";
        RefreshModelData();

        std::thread([url]() {
            auto meta = core::MediaEngine::Instance().ProbeMedia(url);
            if (meta.is_valid) {
                g_media_title = meta.title.c_str();
                g_media_author = meta.uploader.c_str();
                g_media_duration = meta.duration.c_str();
                std::cout << "[C++ Media Engine] Probed title: " << meta.title << std::endl;
            } else {
                g_media_title = "Media Probe Error: Stream unavailable or yt-dlp missing";
                g_media_author = "Error";
                g_media_duration = "--:--";
            }
            RefreshModelData();
        }).detach();
    });

    constructor.BindEventCallback("media_download", [](Rml::DataModelHandle, Rml::Event&, const Rml::VariantList&) {
        std::string url = g_media_url_input.c_str();
        std::string title = g_media_title.c_str();
        std::string format = g_media_format.c_str();
        std::cout << "[C++ Media Engine] Starting YouTube extraction & download for: " << url << " (Format: " << format << ")" << std::endl;
        core::DownloadManager::Instance().AddDownload(url, title, "", 2, true, format);
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
        RefreshModelData();
        if (g_model_handle) {
            g_model_handle.DirtyAllVariables();
        }
    } else {
        std::cerr << "Failed to load assets/ui/main.rml document" << std::endl;
    }
}

void UiManager::RequestDataUpdate() {
    needs_model_dirty_ = true;
    HWND hwnd = FindWindowW(nullptr, L"🌊 Waterfall Accelerator v2.0 (Native C++20)");
    if (hwnd) {
        PostMessageW(hwnd, WM_NULL, 0, 0);
    }
}

void UiManager::Run() {
    std::cout << std::unitbuf;
    auto last_frame = std::chrono::steady_clock::now();
    const auto target_frame_time = std::chrono::microseconds(16666); // ~60 FPS cap

    while (is_running_) {
        bool running = Backend::ProcessEvents(context_, nullptr, false);
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

        // 60 FPS frame pacing for near-zero idle CPU consumption
        auto now = std::chrono::steady_clock::now();
        auto frame_duration = now - last_frame;
        if (frame_duration < target_frame_time) {
            std::this_thread::sleep_for(target_frame_time - frame_duration);
        }
        last_frame = std::chrono::steady_clock::now();
    }
}

void UiManager::Shutdown() {
    if (is_running_) {
        is_running_ = false;
        core::DownloadManager::Instance().SetUpdateListener(nullptr);
        if (context_) {
            if (document_) {
                document_->Close();
                document_ = nullptr;
            }
            context_->RemoveDataModel("downloads_model");
            Rml::RemoveContext("main");
            context_ = nullptr;
        }
        Rml::Shutdown();
        Backend::Shutdown();
    }
}

} // namespace waterfall::ui
