#include "waterfall/core/ChunkEngine.hpp"
#include "waterfall/core/ConfigManager.hpp"
#include <windows.h>
#include <winhttp.h>
#include <bcrypt.h>
#include <vector>
#include <iostream>
#include <filesystem>
#include <regex>
#include <algorithm>
#include <mutex>
#include <chrono>
#include <iomanip>
#include <sstream>

#pragma comment(lib, "bcrypt.lib")

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

static std::string ComputeFileSha256(const std::string& file_path) {
    BCRYPT_ALG_HANDLE h_alg = nullptr;
    if (BCryptOpenAlgorithmProvider(&h_alg, BCRYPT_SHA256_ALGORITHM, nullptr, 0) != 0) {
        return "";
    }

    BCRYPT_HASH_HANDLE h_hash = nullptr;
    if (BCryptCreateHash(h_alg, &h_hash, nullptr, 0, nullptr, 0, 0) != 0) {
        BCryptCloseAlgorithmProvider(h_alg, 0);
        return "";
    }

    std::wstring wpath = ToWide(file_path);
    HANDLE h_file = CreateFileW(wpath.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr,
                                OPEN_EXISTING, FILE_FLAG_SEQUENTIAL_SCAN, nullptr);
    if (h_file != INVALID_HANDLE_VALUE) {
        std::vector<BYTE> buf(64 * 1024);
        DWORD bytes_read = 0;
        while (ReadFile(h_file, buf.data(), static_cast<DWORD>(buf.size()), &bytes_read, nullptr) && bytes_read > 0) {
            BCryptHashData(h_hash, buf.data(), bytes_read, 0);
        }
        CloseHandle(h_file);
    }

    BYTE hash_bytes[32];
    BCryptFinishHash(h_hash, hash_bytes, sizeof(hash_bytes), 0);
    BCryptDestroyHash(h_hash);
    BCryptCloseAlgorithmProvider(h_alg, 0);

    std::ostringstream ss;
    for (BYTE b : hash_bytes) {
        ss << std::hex << std::setw(2) << std::setfill('0') << static_cast<int>(b);
    }
    return ss.str();
}

std::string ChunkEngine::CalculateSha256(const std::string& file_path) {
    return ComputeFileSha256(file_path);
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
    
    // First try HEAD request
    HINTERNET h_request = WinHttpOpenRequest(h_connect, L"HEAD", path.c_str(),
                                             nullptr, WINHTTP_NO_REFERER,
                                             WINHTTP_DEFAULT_ACCEPT_TYPES, flags);

    bool probe_succeeded = false;
    if (h_request) {
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

            if (status_code >= 200 && status_code < 300) {
                probe_succeeded = true;

                wchar_t content_length_buf[64] = {0};
                size = sizeof(content_length_buf);
                if (WinHttpQueryHeaders(h_request, WINHTTP_QUERY_CONTENT_LENGTH,
                                        WINHTTP_HEADER_NAME_BY_INDEX, content_length_buf, &size, WINHTTP_NO_HEADER_INDEX)) {
                    info.total_size = _wtoi64(content_length_buf);
                }

                wchar_t accept_ranges_buf[64] = {0};
                size = sizeof(accept_ranges_buf);
                if (WinHttpQueryHeaders(h_request, WINHTTP_QUERY_ACCEPT_RANGES,
                                        WINHTTP_HEADER_NAME_BY_INDEX, accept_ranges_buf, &size, WINHTTP_NO_HEADER_INDEX)) {
                    if (wcsstr(accept_ranges_buf, L"bytes") != nullptr) {
                        info.supports_range = true;
                    }
                }

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
        }
        WinHttpCloseHandle(h_request);
    }

    // Fallback GET Range: bytes=0-0
    if (!probe_succeeded || info.total_size <= 0) {
        h_request = WinHttpOpenRequest(h_connect, L"GET", path.c_str(),
                                       nullptr, WINHTTP_NO_REFERER,
                                       WINHTTP_DEFAULT_ACCEPT_TYPES, flags);
        if (h_request) {
            DWORD opt = WINHTTP_OPTION_REDIRECT_POLICY_ALWAYS;
            WinHttpSetOption(h_request, WINHTTP_OPTION_REDIRECT_POLICY, &opt, sizeof(opt));
            
            LPCWSTR range_hdr = L"Range: bytes=0-0";
            if (WinHttpSendRequest(h_request, range_hdr, static_cast<DWORD>(-1),
                                   WINHTTP_NO_REQUEST_DATA, 0, 0, 0) &&
                WinHttpReceiveResponse(h_request, nullptr)) {

                DWORD status_code = 0;
                DWORD size = sizeof(status_code);
                WinHttpQueryHeaders(h_request, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
                                    WINHTTP_HEADER_NAME_BY_INDEX, &status_code, &size, WINHTTP_NO_HEADER_INDEX);
                info.status_code = status_code;

                if (status_code == 206) {
                    info.supports_range = true;
                    wchar_t range_buf[128] = {0};
                    size = sizeof(range_buf);
                    if (WinHttpQueryHeaders(h_request, WINHTTP_QUERY_CUSTOM,
                                            L"Content-Range", range_buf, &size, WINHTTP_NO_HEADER_INDEX)) {
                        std::wstring r(range_buf);
                        size_t slash = r.find(L'/');
                        if (slash != std::wstring::npos) {
                            info.total_size = _wtoi64(r.substr(slash + 1).c_str());
                        }
                    }
                }
            }
            WinHttpCloseHandle(h_request);
        }
    }

    WinHttpCloseHandle(h_connect);
    WinHttpCloseHandle(h_session);
    return info;
}

struct ChunkEngine::TaskWorkerContext {
    int task_id = 0;
    DownloadTask task_state;
    std::atomic<bool> cancel_requested{false};
    std::thread coordinator_thread;
    std::vector<std::thread> chunk_threads;
    std::mutex chunk_lock;
};

ChunkEngine::ChunkEngine() = default;

ChunkEngine::~ChunkEngine() {
    std::lock_guard<std::mutex> lk(workers_mutex_);
    for (auto& w : active_workers_) {
        w->cancel_requested = true;
    }
    for (auto& w : active_workers_) {
        if (w->coordinator_thread.joinable()) {
            w->coordinator_thread.join();
        }
        for (auto& ct : w->chunk_threads) {
            if (ct.joinable()) ct.join();
        }
    }
}

void ChunkEngine::StartTask(DownloadTask& task, ProgressCallback on_progress, CompleteCallback on_complete) {
    auto worker = std::make_shared<TaskWorkerContext>();
    worker->task_id = task.id;
    worker->task_state = task;

    {
        std::lock_guard<std::mutex> lk(workers_mutex_);
        active_workers_.push_back(worker);
    }

    task.status = TaskStatus::Downloading;

    worker->coordinator_thread = std::thread([this, worker, on_progress, on_complete]() {
        DownloadTask& task = worker->task_state;
        // 1. Probe remote server
        if (task.total_bytes <= 0) {
            RemoteFileInfo info = ProbeUrl(task.url);
            if (info.total_size > 0) {
                task.total_bytes = info.total_size;
                task.is_resumable = info.supports_range;
            }
            if ((task.filename.empty() || task.filename == "download" || task.filename == "download.bin") && !info.filename.empty()) {
                task.filename = info.filename;
                task.save_path = (std::filesystem::path(task.save_path).parent_path() / info.filename).string();
            }
        }

        // 2. Pre-allocate target file on disk using sparse zero-fragmentation
        std::filesystem::path target_path = task.save_path;
        std::filesystem::create_directories(target_path.parent_path());

        std::wstring wtarget = target_path.wstring();
        HANDLE h_file = CreateFileW(wtarget.c_str(),
                                    GENERIC_READ | GENERIC_WRITE,
                                    FILE_SHARE_READ | FILE_SHARE_WRITE,
                                    nullptr,
                                    OPEN_ALWAYS,
                                    FILE_ATTRIBUTE_NORMAL,
                                    nullptr);

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

        // 3. Initialize multi-segment chunk boundaries
        int num_chunks = 1;
        if (task.is_resumable && task.total_bytes > (1024 * 1024)) {
            if (task.total_bytes > 1024LL * 1024 * 1024) {
                num_chunks = 32;
            } else if (task.total_bytes > 100LL * 1024 * 1024) {
                num_chunks = 16;
            } else {
                num_chunks = 8;
            }
        }
        task.active_connections = num_chunks;

        if (task.chunks.empty()) {
            int64_t slice_size = task.total_bytes / num_chunks;
            for (int i = 0; i < num_chunks; ++i) {
                ChunkInfo chunk;
                chunk.id = i;
                chunk.start_byte = i * slice_size;
                chunk.end_byte = (i == num_chunks - 1) ? (task.total_bytes - 1) : ((i + 1) * slice_size - 1);
                chunk.current_byte = chunk.start_byte;
                chunk.is_active = true;
                chunk.is_completed = false;
                task.chunks.push_back(chunk);
            }
        }

        std::wstring wide_url = ToWide(task.url);
        URL_COMPONENTS url_comp = {0};
        url_comp.dwStructSize = sizeof(url_comp);
        url_comp.dwSchemeLength = static_cast<DWORD>(-1);
        url_comp.dwHostNameLength = static_cast<DWORD>(-1);
        url_comp.dwUrlPathLength = static_cast<DWORD>(-1);
        url_comp.dwExtraInfoLength = static_cast<DWORD>(-1);
        WinHttpCrackUrl(wide_url.c_str(), 0, 0, &url_comp);

        std::wstring host(url_comp.lpszHostName, url_comp.dwHostNameLength);
        std::wstring path(url_comp.lpszUrlPath, url_comp.dwUrlPathLength);
        if (url_comp.dwExtraInfoLength > 0) {
            path.append(url_comp.lpszExtraInfo, url_comp.dwExtraInfoLength);
        }
        DWORD flags = (url_comp.nScheme == INTERNET_SCHEME_HTTPS) ? WINHTTP_FLAG_SECURE : 0;

        std::atomic<int64_t> total_bytes_downloaded{task.downloaded_bytes};
        std::atomic<int> completed_chunks{0};

        // 4. Concurrent chunk worker with auto-retry and stall watchdog
        auto run_chunk_download = [worker, h_file, host, path, url_comp, flags, &total_bytes_downloaded, &completed_chunks](int chunk_idx) {
            DownloadTask& task = worker->task_state;
            if (chunk_idx < 0 || chunk_idx >= static_cast<int>(task.chunks.size())) return;
            ChunkInfo& my_chunk = task.chunks[chunk_idx];

            int retries = 0;
            while (!worker->cancel_requested && my_chunk.current_byte <= my_chunk.end_byte && retries < 5) {
                HINTERNET h_session = WinHttpOpen(L"Waterfall/2.0", WINHTTP_ACCESS_TYPE_DEFAULT_PROXY,
                                                  WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0);
                if (!h_session) {
                    retries++;
                    std::this_thread::sleep_for(std::chrono::milliseconds(500));
                    continue;
                }

                // 25-second socket stall watchdog
                DWORD timeout_ms = 25000;
                WinHttpSetTimeouts(h_session, timeout_ms, timeout_ms, timeout_ms, timeout_ms);

                HINTERNET h_connect = WinHttpConnect(h_session, host.c_str(), url_comp.nPort, 0);
                if (!h_connect) {
                    WinHttpCloseHandle(h_session);
                    retries++;
                    std::this_thread::sleep_for(std::chrono::milliseconds(500));
                    continue;
                }

                HINTERNET h_request = WinHttpOpenRequest(h_connect, L"GET", path.c_str(),
                                                         nullptr, WINHTTP_NO_REFERER,
                                                         WINHTTP_DEFAULT_ACCEPT_TYPES, flags);
                if (!h_request) {
                    WinHttpCloseHandle(h_connect);
                    WinHttpCloseHandle(h_session);
                    retries++;
                    std::this_thread::sleep_for(std::chrono::milliseconds(500));
                    continue;
                }

                DWORD opt = WINHTTP_OPTION_REDIRECT_POLICY_ALWAYS;
                WinHttpSetOption(h_request, WINHTTP_OPTION_REDIRECT_POLICY, &opt, sizeof(opt));

                std::wstring range_hdr = L"Range: bytes=" + std::to_wstring(my_chunk.current_byte) + L"-" + std::to_wstring(my_chunk.end_byte);
                
                if (WinHttpSendRequest(h_request, range_hdr.c_str(), static_cast<DWORD>(-1),
                                       WINHTTP_NO_REQUEST_DATA, 0, 0, 0) &&
                    WinHttpReceiveResponse(h_request, nullptr)) {

                    const DWORD BUFFER_SIZE = 64 * 1024; // 64 KB buffer
                    std::vector<char> buffer(BUFFER_SIZE);
                    DWORD bytes_read = 0;

                    while (!worker->cancel_requested &&
                           my_chunk.current_byte <= my_chunk.end_byte &&
                           WinHttpReadData(h_request, buffer.data(), BUFFER_SIZE, &bytes_read) && bytes_read > 0) {

                        int64_t bytes_to_write = (std::min)(static_cast<int64_t>(bytes_read), (my_chunk.end_byte - my_chunk.current_byte + 1));

                        OVERLAPPED ov = {0};
                        LARGE_INTEGER offset;
                        offset.QuadPart = my_chunk.current_byte;
                        ov.Offset = offset.LowPart;
                        ov.OffsetHigh = offset.HighPart;

                        DWORD written = 0;
                        WriteFile(h_file, buffer.data(), static_cast<DWORD>(bytes_to_write), &written, &ov);

                        my_chunk.current_byte += written;
                        total_bytes_downloaded += written;

                        // Token-bucket Speed Limiter throttle check
                        if (ConfigManager::Instance().IsSpeedLimitEnabled()) {
                            int64_t limit_bps = ConfigManager::Instance().GetSpeedLimitBps();
                            int active_threads = (std::max)(1, static_cast<int>(task.chunks.size()));
                            int64_t thread_cap = (std::max)(8192LL, limit_bps / active_threads);
                            double target_ms = (static_cast<double>(written) / thread_cap) * 1000.0;
                            if (target_ms > 4.0) {
                                std::this_thread::sleep_for(std::chrono::milliseconds(static_cast<int>(target_ms)));
                            }
                        }
                    }

                    if (my_chunk.current_byte > my_chunk.end_byte) {
                        my_chunk.is_completed = true;
                        my_chunk.is_active = false;
                        completed_chunks++;
                    }
                } else {
                    retries++;
                    std::this_thread::sleep_for(std::chrono::milliseconds(500));
                }

                WinHttpCloseHandle(h_request);
                WinHttpCloseHandle(h_connect);
                WinHttpCloseHandle(h_session);
            }
        };

        // 5. Launch chunk threads
        for (size_t chunk_idx = 0; chunk_idx < task.chunks.size(); ++chunk_idx) {
            worker->chunk_threads.emplace_back(run_chunk_download, static_cast<int>(chunk_idx));
        }

        // 6. Coordinator loop
        auto last_tick = std::chrono::steady_clock::now();
        int64_t last_bytes = total_bytes_downloaded.load();

        while (!worker->cancel_requested &&
               (task.total_bytes <= 0 || total_bytes_downloaded.load() < task.total_bytes) &&
               completed_chunks.load() < static_cast<int>(task.chunks.size())) {
            std::this_thread::sleep_for(std::chrono::milliseconds(250));

            auto now = std::chrono::steady_clock::now();
            auto elapsed_ms = std::chrono::duration_cast<std::chrono::milliseconds>(now - last_tick).count();

            if (elapsed_ms >= 250) {
                int64_t current_bytes = total_bytes_downloaded.load();
                int64_t delta = current_bytes - last_bytes;
                if (delta > 0 && elapsed_ms > 0) {
                    task.speed_bps = (delta * 1000) / elapsed_ms;
                }
                task.downloaded_bytes = current_bytes;
                last_bytes = current_bytes;
                last_tick = now;

                if (on_progress) on_progress(task);
            }
        }

        // 7. Join worker threads and flush file
        for (auto& ct : worker->chunk_threads) {
            if (ct.joinable()) ct.join();
        }

        FlushFileBuffers(h_file);
        CloseHandle(h_file);

        if (worker->cancel_requested) {
            task.status = TaskStatus::Paused;
            task.speed_bps = 0;
            if (on_complete) on_complete(task.id, false, "Download paused");
        } else {
            task.status = TaskStatus::Completed;
            task.speed_bps = 0;
            task.downloaded_bytes = task.total_bytes;
            task.completed_at = std::chrono::system_clock::now();

            // Compute SHA-256 for file verification
            task.sha256_hash = ComputeFileSha256(task.save_path);

            if (on_complete) on_complete(task.id, true, "");
        }
    });
}

void ChunkEngine::PauseTask(int task_id) {
    std::lock_guard<std::mutex> lk(workers_mutex_);
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
