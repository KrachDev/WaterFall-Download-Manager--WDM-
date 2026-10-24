#include "waterfall/core/ChunkEngine.hpp"
#include <windows.h>
#include <winhttp.h>
#include <vector>
#include <iostream>
#include <filesystem>
#include <regex>

namespace waterfall::core {

static std::wstring ToWide(const std::string& str) {
    if (str.empty()) return L"";
    int size = MultiByteToWideChar(CP_UTF8, 0, str.c_str(), -1, nullptr, 0);
    std::wstring result(size - 1, 0);
    MultiByteToWideChar(CP_UTF8, 0, str.c_str(), -1, &result[0], size);
    return result;
}

static std::string ToUtf8(const std::wstring& str) {
    if (str.empty()) return "";
    int size = WideCharToMultiByte(CP_UTF8, 0, str.c_str(), -1, nullptr, 0, nullptr, nullptr);
    std::string result(size - 1, 0);
    WideCharToMultiByte(CP_UTF8, 0, str.c_str(), -1, &result[0], size, nullptr, nullptr);
    return result;
}

RemoteFileInfo ChunkEngine::ProbeUrl(const std::string& url) {
    RemoteFileInfo info;
    info.redirected_url = url;

    std::wstring wide_url = ToWide(url);
    URL_COMPONENTS url_comp = {0};
    url_comp.dwStructSize = sizeof(url_comp);
    url_comp.dwSchemeLength = static_cast<DWORD>(-1);
    url_comp.dwHostNameLength = static_cast<DWORD>(-1);
    url_comp.dwUrlPathLength = static_cast<DWORD>(-1);
    url_comp.dwExtraInfoLength = static_cast<DWORD>(-1);

    if (!WinHttpCrackUrl(wide_url.c_str(), 0, 0, &url_comp)) {
        return info;
    }

    std::wstring host(url_comp.lpszHostName, url_comp.dwHostNameLength);
    std::wstring path(url_comp.lpszUrlPath, url_comp.dwUrlPathLength);
    if (url_comp.dwExtraInfoLength > 0) {
        path.append(url_comp.lpszExtraInfo, url_comp.dwExtraInfoLength);
    }

    // Default filename from URL path if not overridden by Content-Disposition
    std::filesystem::path url_file_path(path);
    info.filename = ToUtf8(url_file_path.filename().wstring());
    if (info.filename.empty() || info.filename == "/") {
        info.filename = "download.bin";
    }

    HINTERNET h_session = WinHttpOpen(L"Waterfall Native Engine/2.0",
                                      WINHTTP_ACCESS_TYPE_DEFAULT_PROXY,
                                      WINHTTP_NO_PROXY_NAME,
                                      WINHTTP_NO_PROXY_BYPASS, 0);
    if (!h_session) return info;

    HINTERNET h_connect = WinHttpConnect(h_session, host.c_str(), url_comp.nPort, 0);
    if (!h_connect) {
        WinHttpCloseHandle(h_session);
        return info;
    }

    DWORD flags = (url_comp.nScheme == INTERNET_SCHEME_HTTPS) ? WINHTTP_FLAG_SECURE : 0;
    HINTERNET h_request = WinHttpOpenRequest(h_connect, L"HEAD", path.c_str(),
                                             nullptr, WINHTTP_NO_REFERER,
                                             WINHTTP_DEFAULT_ACCEPT_TYPES, flags);

    if (h_request) {
        // Allow automatic redirect
        DWORD option = WINHTTP_OPTION_REDIRECT_POLICY_ALWAYS;
        WinHttpSetOption(h_request, WINHTTP_OPTION_REDIRECT_POLICY, &option, sizeof(option));

        if (WinHttpSendRequest(h_request, WINHTTP_NO_ADDITIONAL_HEADERS, 0,
                               WINHTTP_NO_REQUEST_DATA, 0, 0, 0) &&
            WinHttpReceiveResponse(h_request, nullptr)) {

            DWORD status_code = 0;
            DWORD size = sizeof(status_code);
            WinHttpQueryHeaders(h_request, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
                                WINHTTP_HEADER_NAME_BY_INDEX, &status_code, &size, WINHTTP_NO_HEADER_INDEX);
            info.status_code = status_code;

            // Content-Length
            wchar_t content_length_buf[64] = {0};
            size = sizeof(content_length_buf);
            if (WinHttpQueryHeaders(h_request, WINHTTP_QUERY_CONTENT_LENGTH,
                                    WINHTTP_HEADER_NAME_BY_INDEX, content_length_buf, &size, WINHTTP_NO_HEADER_INDEX)) {
                info.total_size = _wtoi64(content_length_buf);
            }

            // Accept-Ranges
            wchar_t accept_ranges_buf[64] = {0};
            size = sizeof(accept_ranges_buf);
            if (WinHttpQueryHeaders(h_request, WINHTTP_QUERY_ACCEPT_RANGES,
                                    WINHTTP_HEADER_NAME_BY_INDEX, accept_ranges_buf, &size, WINHTTP_NO_HEADER_INDEX)) {
                if (wcsstr(accept_ranges_buf, L"bytes") != nullptr) {
                    info.supports_range = true;
                }
            }

            // Content-Disposition (filename)
            wchar_t disp_buf[512] = {0};
            size = sizeof(disp_buf);
            if (WinHttpQueryHeaders(h_request, WINHTTP_QUERY_CONTENT_DISPOSITION,
                                    WINHTTP_HEADER_NAME_BY_INDEX, disp_buf, &size, WINHTTP_NO_HEADER_INDEX)) {
                std::wstring disp(disp_buf);
                std::wregex regex_fn(L"filename\\*?=['\"]?(?:UTF-8'')?([^;'\"]+)['\"]?");
                std::wsmatch match;
                if (std::regex_search(disp, match, regex_fn) && match.size() > 1) {
                    info.filename = ToUtf8(match[1].str());
                }
            }
        }
        WinHttpCloseHandle(h_request);
    }

    WinHttpCloseHandle(h_connect);
    WinHttpCloseHandle(h_session);
    return info;
}

struct ChunkEngine::WorkerContext {
    int task_id;
    std::atomic<bool> cancel_requested{false};
    std::thread worker_thread;
};

ChunkEngine::ChunkEngine() = default;

ChunkEngine::~ChunkEngine() {
    for (auto& w : active_workers_) {
        w->cancel_requested = true;
        if (w->worker_thread.joinable()) {
            w->worker_thread.join();
        }
    }
}

void ChunkEngine::StartTask(DownloadTask& task, ProgressCallback on_progress, CompleteCallback on_complete) {
    auto worker = std::make_unique<WorkerContext>();
    worker->task_id = task.id;
    WorkerContext* ctx = worker.get();

    task.status = TaskStatus::Downloading;

    worker->worker_thread = std::thread([ctx, &task, on_progress, on_complete]() {
        // Probe first to discover size and ranges
        RemoteFileInfo info = ChunkEngine::ProbeUrl(task.url);
        if (info.total_size > 0) {
            task.total_bytes = info.total_size;
            task.is_resumable = info.supports_range;
        }

        std::filesystem::path target_path = task.save_path;
        std::filesystem::create_directories(target_path.parent_path());

        // Preallocate target file for zero fragmentation
        std::wstring wtarget = target_path.wstring();
        HANDLE h_file = CreateFileW(wtarget.c_str(), GENERIC_WRITE | GENERIC_READ,
                                    FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr,
                                    OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);

        if (h_file == INVALID_HANDLE_VALUE) {
            task.status = TaskStatus::Error;
            task.error_message = "Cannot create target file on disk";
            if (on_complete) on_complete(task.id, false, task.error_message);
            return;
        }

        if (task.total_bytes > 0) {
            LARGE_INTEGER li;
            li.QuadPart = task.total_bytes;
            SetFilePointerEx(h_file, li, nullptr, FILE_BEGIN);
            SetEndOfFile(h_file);
            li.QuadPart = 0;
            SetFilePointerEx(h_file, li, nullptr, FILE_BEGIN);
        }

        // Connect and stream download
        std::wstring wide_url = ToWide(task.url);
        URL_COMPONENTS url_comp = {0};
        url_comp.dwStructSize = sizeof(url_comp);
        url_comp.dwSchemeLength = static_cast<DWORD>(-1);
        url_comp.dwHostNameLength = static_cast<DWORD>(-1);
        url_comp.dwUrlPathLength = static_cast<DWORD>(-1);
        url_comp.dwExtraInfoLength = static_cast<DWORD>(-1);
        WinHttpCrackUrl(wide_url.c_str(), 0, 0, &url_comp);

        HINTERNET h_session = WinHttpOpen(L"Waterfall/2.0", WINHTTP_ACCESS_TYPE_DEFAULT_PROXY,
                                          WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0);
        std::wstring host(url_comp.lpszHostName, url_comp.dwHostNameLength);
        std::wstring path(url_comp.lpszUrlPath, url_comp.dwUrlPathLength);
        if (url_comp.dwExtraInfoLength > 0) {
            path.append(url_comp.lpszExtraInfo, url_comp.dwExtraInfoLength);
        }

        HINTERNET h_connect = WinHttpConnect(h_session, host.c_str(), url_comp.nPort, 0);
        DWORD flags = (url_comp.nScheme == INTERNET_SCHEME_HTTPS) ? WINHTTP_FLAG_SECURE : 0;
        HINTERNET h_request = WinHttpOpenRequest(h_connect, L"GET", path.c_str(),
                                                 nullptr, WINHTTP_NO_REFERER,
                                                 WINHTTP_DEFAULT_ACCEPT_TYPES, flags);

        DWORD opt = WINHTTP_OPTION_REDIRECT_POLICY_ALWAYS;
        WinHttpSetOption(h_request, WINHTTP_OPTION_REDIRECT_POLICY, &opt, sizeof(opt));

        if (WinHttpSendRequest(h_request, WINHTTP_NO_ADDITIONAL_HEADERS, 0,
                               WINHTTP_NO_REQUEST_DATA, 0, 0, 0) &&
            WinHttpReceiveResponse(h_request, nullptr)) {

            const DWORD BUFFER_SIZE = 64 * 1024; // 64 KB streaming buffer
            std::vector<char> buffer(BUFFER_SIZE);
            DWORD bytes_read = 0;
            auto last_time = std::chrono::steady_clock::now();
            int64_t bytes_since_last_tick = 0;

            while (!ctx->cancel_requested && WinHttpReadData(h_request, buffer.data(), BUFFER_SIZE, &bytes_read) && bytes_read > 0) {
                DWORD written = 0;
                WriteFile(h_file, buffer.data(), bytes_read, &written, nullptr);

                task.downloaded_bytes += bytes_read;
                bytes_since_last_tick += bytes_read;

                auto now = std::chrono::steady_clock::now();
                auto elapsed_ms = std::chrono::duration_cast<std::chrono::milliseconds>(now - last_time).count();
                if (elapsed_ms >= 500) {
                    task.speed_bps = (bytes_since_last_tick * 1000) / elapsed_ms;
                    bytes_since_last_tick = 0;
                    last_time = now;
                    if (on_progress) on_progress(task);
                }
            }

            CloseHandle(h_file);
            WinHttpCloseHandle(h_request);
            WinHttpCloseHandle(h_connect);
            WinHttpCloseHandle(h_session);

            if (ctx->cancel_requested) {
                task.status = TaskStatus::Paused;
                if (on_complete) on_complete(task.id, false, "Download paused by user");
            } else {
                task.status = TaskStatus::Completed;
                task.speed_bps = 0;
                task.completed_at = std::chrono::system_clock::now();
                if (on_complete) on_complete(task.id, true, "");
            }
        } else {
            CloseHandle(h_file);
            task.status = TaskStatus::Error;
            task.error_message = "HTTP connection failed";
            if (on_complete) on_complete(task.id, false, task.error_message);
        }
    });

    active_workers_.push_back(std::move(worker));
}

void ChunkEngine::PauseTask(int task_id) {
    for (auto& w : active_workers_) {
        if (w->task_id == task_id) {
            w->cancel_requested = true;
            break;
        }
    }
}

void ChunkEngine::CancelTask(int task_id) {
    PauseTask(task_id);
}

} // namespace waterfall::core
