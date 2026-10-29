import sys

def patch_chunk_engine():
    with open('src/core/ChunkEngine.cpp', 'r', encoding='utf-8') as f:
        content = f.read()

    norm = content.replace('\r\n', '\n')

    # 1. Update ProbeUrl flags to avoid double-escaping %20 and add full GET fallback
    old_probe_flags = """    DWORD flags = (url_comp.nScheme == INTERNET_SCHEME_HTTPS) ? WINHTTP_FLAG_SECURE : 0;

    std::wstring custom_headers;"""

    new_probe_flags = """    DWORD flags = (url_comp.nScheme == INTERNET_SCHEME_HTTPS) ? WINHTTP_FLAG_SECURE : 0;
    flags |= WINHTTP_FLAG_ESCAPE_DISABLE | WINHTTP_FLAG_ESCAPE_DISABLE_QUERY;

    std::wstring custom_headers;"""

    if old_probe_flags in norm:
        norm = norm.replace(old_probe_flags, new_probe_flags)
        print("Updated ProbeUrl flags!")
    else:
        print("Warning: old_probe_flags not found")

    old_probe_fallbacks = """    // 1. Try HEAD first
    bool success = probe_request(L"HEAD", L"");

    // 2. If HEAD returned 403, 405, or size <= 0, fallback to GET Range: bytes=0-0
    if (!success || info.total_size <= 0) {
        probe_request(L"GET", L"Range: bytes=0-0\\r\\n");
    }"""

    new_probe_fallbacks = """    // 1. Try HEAD first
    bool success = probe_request(L"HEAD", L"");

    // 2. If HEAD returned 403, 405, or size <= 0, fallback to GET Range: bytes=0-0
    if (!success || info.total_size <= 0) {
        bool range_ok = probe_request(L"GET", L"Range: bytes=0-0\\r\\n");
        // 3. If Range request failed (some CDNs/servers reject Range on probe), try standard GET headers
        if (!range_ok && info.status_code >= 400) {
            probe_request(L"GET", L"");
        }
    }"""

    if old_probe_fallbacks in norm:
        norm = norm.replace(old_probe_fallbacks, new_probe_fallbacks)
        print("Updated probe fallbacks!")
    else:
        print("Warning: old_probe_fallbacks not found")

    # 2. Update StartTask coordinator & worker failure handling
    old_worker_setup = """        std::atomic<int64_t> total_bytes_downloaded{task.downloaded_bytes};
        std::atomic<int> completed_chunks{0};

        // 4. Concurrent chunk worker with auto-retry and stall watchdog
        auto run_chunk_download = [worker, h_file, host, path, url_comp, flags, &total_bytes_downloaded, &completed_chunks](int chunk_idx) {"""

    new_worker_setup = """        std::atomic<int64_t> total_bytes_downloaded{task.downloaded_bytes};
        std::atomic<int> completed_chunks{0};
        std::atomic<bool> any_worker_failed{false};
        std::atomic<int> active_workers{static_cast<int>(task.chunks.size())};
        std::string failure_error_msg;
        std::mutex failure_mutex;

        // 4. Concurrent chunk worker with auto-retry and stall watchdog
        auto run_chunk_download = [worker, h_file, host, path, url_comp, flags, &total_bytes_downloaded, &completed_chunks, &any_worker_failed, &active_workers, &failure_error_msg, &failure_mutex](int chunk_idx) {"""

    if old_worker_setup in norm:
        norm = norm.replace(old_worker_setup, new_worker_setup)
        print("Updated worker setup!")
    else:
        print("Warning: old_worker_setup not found")

    # Update flags in StartTask
    old_task_flags = """        DWORD flags = (url_comp.nScheme == INTERNET_SCHEME_HTTPS) ? WINHTTP_FLAG_SECURE : 0;

        std::atomic<int64_t> total_bytes_downloaded"""

    new_task_flags = """        DWORD flags = (url_comp.nScheme == INTERNET_SCHEME_HTTPS) ? WINHTTP_FLAG_SECURE : 0;
        flags |= WINHTTP_FLAG_ESCAPE_DISABLE | WINHTTP_FLAG_ESCAPE_DISABLE_QUERY;

        std::atomic<int64_t> total_bytes_downloaded"""

    if old_task_flags in norm:
        norm = norm.replace(old_task_flags, new_task_flags)
        print("Updated task flags with escape disable!")
    else:
        print("Warning: old_task_flags not found")

    # Update chunk worker loop retry failure recording
    old_worker_loop_end = """                WinHttpCloseHandle(h_request);
                WinHttpCloseHandle(h_connect);
                WinHttpCloseHandle(h_session);
            }
        };"""

    new_worker_loop_end = """                WinHttpCloseHandle(h_request);
                WinHttpCloseHandle(h_connect);
                WinHttpCloseHandle(h_session);
            }

            if (!my_chunk.is_completed && !worker->cancel_requested) {
                std::lock_guard<std::mutex> lk(failure_mutex);
                any_worker_failed = true;
                if (failure_error_msg.empty()) {
                    failure_error_msg = "Download stream failed after retries (check host login/session)";
                }
            }
            active_workers--;
        };"""

    if old_worker_loop_end in norm:
        norm = norm.replace(old_worker_loop_end, new_worker_loop_end)
        print("Updated worker loop retry failure recording!")
    else:
        print("Warning: old_worker_loop_end not found")

    # Update coordinator while loop and completion
    old_coord = """        while (!worker->cancel_requested &&
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

        // Ensure file EOF matches downloaded bytes
        if (task.total_bytes <= 0 || task.total_bytes != total_bytes_downloaded.load()) {
            task.total_bytes = total_bytes_downloaded.load();
            LARGE_INTEGER li;
            li.QuadPart = task.total_bytes;
            SetFilePointerEx(h_file, li, nullptr, FILE_BEGIN);
            SetEndOfFile(h_file);
        }

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
        }"""

    new_coord = """        while (!worker->cancel_requested &&
               !any_worker_failed.load() &&
               (task.total_bytes <= 0 || total_bytes_downloaded.load() < task.total_bytes) &&
               completed_chunks.load() < static_cast<int>(task.chunks.size()) &&
               active_workers.load() > 0) {
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

        // Ensure file EOF matches downloaded bytes
        if (task.total_bytes <= 0 || task.total_bytes != total_bytes_downloaded.load()) {
            task.total_bytes = total_bytes_downloaded.load();
            LARGE_INTEGER li;
            li.QuadPart = task.total_bytes;
            SetFilePointerEx(h_file, li, nullptr, FILE_BEGIN);
            SetEndOfFile(h_file);
        }

        CloseHandle(h_file);

        if (worker->cancel_requested) {
            task.status = TaskStatus::Paused;
            task.speed_bps = 0;
            if (on_complete) on_complete(task.id, false, "Download paused");
        } else if (any_worker_failed.load()) {
            task.status = TaskStatus::Error;
            task.speed_bps = 0;
            task.error_message = failure_error_msg.empty() ? "Download failed: connection interrupted or rejected by server" : failure_error_msg;
            if (on_complete) on_complete(task.id, false, task.error_message);
        } else {
            task.status = TaskStatus::Completed;
            task.speed_bps = 0;
            task.downloaded_bytes = task.total_bytes;
            task.completed_at = std::chrono::system_clock::now();

            // Compute SHA-256 for file verification
            task.sha256_hash = ComputeFileSha256(task.save_path);

            if (on_complete) on_complete(task.id, true, "");
        }"""

    if old_coord in norm:
        norm = norm.replace(old_coord, new_coord)
        print("Updated coordinator while loop & error handling!")
    else:
        print("Warning: old_coord not found")

    with open('src/core/ChunkEngine.cpp', 'w', encoding='utf-8', newline='\r\n') as f:
        f.write(norm)
    print("ChunkEngine.cpp patch complete!")

if __name__ == '__main__':
    patch_chunk_engine()

