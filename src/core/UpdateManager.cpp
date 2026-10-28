#include "waterfall/core/UpdateManager.hpp"
#include <windows.h>
#include <winhttp.h>
#include <shlobj.h>
#include <nlohmann/json.hpp>
#include <iostream>
#include <fstream>
#include <filesystem>
#include <thread>
#include <regex>

using json = nlohmann::json;
namespace fs = std::filesystem;

namespace waterfall::core {

static std::wstring ToWide(const std::string& str) {
    if (str.empty()) return L"";
    int size = MultiByteToWideChar(CP_UTF8, 0, str.c_str(), -1, nullptr, 0);
    std::wstring result(size - 1, 0);
    MultiByteToWideChar(CP_UTF8, 0, str.c_str(), -1, &result[0], size);
    return result;
}

UpdateManager& UpdateManager::Instance() {
    static UpdateManager instance;
    return instance;
}

UpdateManager::UpdateManager() {
    cached_info_.current_version = current_version_;
}

UpdateInfo UpdateManager::GetCachedInfo() {
    std::lock_guard<std::mutex> lock(mutex_);
    return cached_info_;
}

bool UpdateManager::IsNewerVersion(const std::string& remote, const std::string& current) {
    auto extract_build = [](const std::string& v) -> int {
        size_t b_pos = v.find("-b");
        if (b_pos != std::string::npos) {
            try {
                return std::stoi(v.substr(b_pos + 2));
            } catch (...) {}
        }
        return 0;
    };

    auto parse_ver = [](std::string v) -> std::vector<int> {
        if (!v.empty() && (v[0] == 'v' || v[0] == 'V')) {
            v = v.substr(1);
        }
        size_t dash = v.find('-');
        if (dash != std::string::npos) {
            v = v.substr(0, dash);
        }
        std::vector<int> parts;
        std::stringstream ss(v);
        std::string item;
        while (std::getline(ss, item, '.')) {
            try {
                parts.push_back(std::stoi(item));
            } catch (...) {
                parts.push_back(0);
            }
        }
        while (parts.size() < 3) parts.push_back(0);
        return parts;
    };

    auto r_parts = parse_ver(remote);
    auto c_parts = parse_ver(current);

    for (size_t i = 0; i < 3; ++i) {
        if (r_parts[i] > c_parts[i]) return true;
        if (r_parts[i] < c_parts[i]) return false;
    }

    int r_build = extract_build(remote);
    int c_build = extract_build(current);
    if (r_build > 0 && c_build > 0) {
        return r_build > c_build;
    }

    return false;
}

std::string UpdateManager::FetchGitHubLatestRelease() {
    HINTERNET h_session = WinHttpOpen(L"Waterfall-Accelerator/2.0",
                                      WINHTTP_ACCESS_TYPE_DEFAULT_PROXY,
                                      WINHTTP_NO_PROXY_NAME,
                                      WINHTTP_NO_PROXY_BYPASS, 0);
    if (!h_session) return "";

    HINTERNET h_connect = WinHttpConnect(h_session, L"api.github.com", INTERNET_DEFAULT_HTTPS_PORT, 0);
    if (!h_connect) {
        WinHttpCloseHandle(h_session);
        return "";
    }

    std::wstring path = L"/repos/" + ToWide(repo_slug_) + L"/releases/latest";
    HINTERNET h_request = WinHttpOpenRequest(h_connect, L"GET", path.c_str(),
                                           nullptr, WINHTTP_NO_REFERER,
                                           WINHTTP_DEFAULT_ACCEPT_TYPES,
                                           WINHTTP_FLAG_SECURE);
    if (!h_request) {
        WinHttpCloseHandle(h_connect);
        WinHttpCloseHandle(h_session);
        return "";
    }

    LPCWSTR headers = L"Accept: application/vnd.github.v3+json\r\nUser-Agent: Waterfall-Accelerator/2.0\r\n";
    BOOL sent = WinHttpSendRequest(h_request, headers, static_cast<DWORD>(-1),
                                  WINHTTP_NO_REQUEST_DATA, 0, 0, 0);

    std::string response;
    if (sent && WinHttpReceiveResponse(h_request, nullptr)) {
        DWORD bytes_avail = 0;
        while (WinHttpQueryDataAvailable(h_request, &bytes_avail) && bytes_avail > 0) {
            std::vector<char> buf(bytes_avail);
            DWORD bytes_read = 0;
            if (WinHttpReadData(h_request, buf.data(), bytes_avail, &bytes_read) && bytes_read > 0) {
                response.append(buf.data(), bytes_read);
            }
        }
    }

    WinHttpCloseHandle(h_request);
    WinHttpCloseHandle(h_connect);
    WinHttpCloseHandle(h_session);
    return response;
}

UpdateInfo UpdateManager::CheckForUpdates(bool force_refresh) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (cached_info_.check_completed && !force_refresh) {
        return cached_info_;
    }

    cached_info_.check_completed = true;
    cached_info_.current_version = current_version_;
    cached_info_.update_available = false;
    cached_info_.error.clear();

    std::string raw_json = FetchGitHubLatestRelease();
    if (raw_json.empty()) {
        cached_info_.error = "Could not reach GitHub Releases API";
        return cached_info_;
    }

    try {
        auto j = json::parse(raw_json);
        if (j.contains("tag_name")) {
            cached_info_.latest_version = j.value("tag_name", "");
            cached_info_.release_notes = j.value("body", "");

            if (IsNewerVersion(cached_info_.latest_version, current_version_)) {
                cached_info_.update_available = true;
            }

            // Find Windows x64 zip asset
            if (j.contains("assets") && j["assets"].is_array()) {
                for (const auto& a : j["assets"]) {
                    std::string name = a.value("name", "");
                    if (name.ends_with(".zip") && name.find("windows") != std::string::npos) {
                        cached_info_.asset_name = name;
                        cached_info_.download_url = a.value("browser_download_url", "");
                        break;
                    }
                }
                // Fallback to any .zip asset
                if (cached_info_.download_url.empty()) {
                    for (const auto& a : j["assets"]) {
                        std::string name = a.value("name", "");
                        if (name.ends_with(".zip")) {
                            cached_info_.asset_name = name;
                            cached_info_.download_url = a.value("browser_download_url", "");
                            break;
                        }
                    }
                }
            }
        } else if (j.contains("message")) {
            cached_info_.error = j.value("message", "API rate limit or error");
        }
    } catch (const std::exception& e) {
        cached_info_.error = std::string("JSON parsing error: ") + e.what();
    }

    return cached_info_;
}

bool UpdateManager::StartDownloadUpdate(ProgressCallback on_progress, CompleteCallback on_complete) {
    if (is_downloading_) return false;

    UpdateInfo info;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        info = cached_info_;
    }

    if (info.download_url.empty()) {
        if (on_complete) on_complete(false, "No download URL available for update.");
        return false;
    }

    is_downloading_ = true;
    download_progress_ = 0.0f;

    std::thread([this, info, on_progress, on_complete]() {
        // Resolve temp update path
        WCHAR temp_dir[MAX_PATH];
        GetTempPathW(MAX_PATH, temp_dir);
        fs::path update_dir = fs::path(temp_dir) / "Waterfall";
        std::error_code ec;
        fs::create_directories(update_dir, ec);
        fs::path target_zip = update_dir / "update.zip";
        downloaded_zip_path_ = target_zip.string();

        if (fs::exists(target_zip)) {
            fs::remove(target_zip, ec);
        }

        // WinHTTP download following redirects
        std::wstring wide_url = ToWide(info.download_url);
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

        HINTERNET h_session = WinHttpOpen(L"Waterfall-Accelerator/2.0",
                                          WINHTTP_ACCESS_TYPE_DEFAULT_PROXY,
                                          WINHTTP_NO_PROXY_NAME,
                                          WINHTTP_NO_PROXY_BYPASS, 0);
        if (!h_session) {
            is_downloading_ = false;
            if (on_complete) on_complete(false, "WinHttpOpen failed");
            return;
        }

        HINTERNET h_connect = WinHttpConnect(h_session, host.c_str(),
                                           (url_comp.nScheme == INTERNET_SCHEME_HTTPS) ? INTERNET_DEFAULT_HTTPS_PORT : INTERNET_DEFAULT_HTTP_PORT, 0);
        if (!h_connect) {
            WinHttpCloseHandle(h_session);
            is_downloading_ = false;
            if (on_complete) on_complete(false, "WinHttpConnect failed");
            return;
        }

        DWORD flags = (url_comp.nScheme == INTERNET_SCHEME_HTTPS) ? WINHTTP_FLAG_SECURE : 0;
        HINTERNET h_request = WinHttpOpenRequest(h_connect, L"GET", path.c_str(),
                                               nullptr, WINHTTP_NO_REFERER,
                                               WINHTTP_DEFAULT_ACCEPT_TYPES, flags);
        if (!h_request) {
            WinHttpCloseHandle(h_connect);
            WinHttpCloseHandle(h_session);
            is_downloading_ = false;
            if (on_complete) on_complete(false, "WinHttpOpenRequest failed");
            return;
        }

        // Enable automatic redirect following for GitHub Releases -> AWS S3 CDN
        DWORD opt = WINHTTP_OPTION_REDIRECT_POLICY_ALWAYS;
        WinHttpSetOption(h_request, WINHTTP_OPTION_REDIRECT_POLICY, &opt, sizeof(opt));

        BOOL sent = WinHttpSendRequest(h_request, WINHTTP_NO_ADDITIONAL_HEADERS, 0,
                                      WINHTTP_NO_REQUEST_DATA, 0, 0, 0);
        if (!sent || !WinHttpReceiveResponse(h_request, nullptr)) {
            WinHttpCloseHandle(h_request);
            WinHttpCloseHandle(h_connect);
            WinHttpCloseHandle(h_session);
            is_downloading_ = false;
            if (on_complete) on_complete(false, "Failed to receive response from update server");
            return;
        }

        // Query Content-Length
        int64_t total_size = 0;
        wchar_t cl_buf[64] = {0};
        DWORD cl_size = sizeof(cl_buf);
        if (WinHttpQueryHeaders(h_request, WINHTTP_QUERY_CONTENT_LENGTH, WINHTTP_HEADER_NAME_BY_INDEX, cl_buf, &cl_size, WINHTTP_NO_HEADER_INDEX)) {
            total_size = _wtoi64(cl_buf);
        }

        std::ofstream out_file(target_zip, std::ios::binary);
        if (!out_file.is_open()) {
            WinHttpCloseHandle(h_request);
            WinHttpCloseHandle(h_connect);
            WinHttpCloseHandle(h_session);
            is_downloading_ = false;
            if (on_complete) on_complete(false, "Cannot create temporary update file on disk");
            return;
        }

        int64_t downloaded_bytes = 0;
        DWORD bytes_avail = 0;
        std::vector<char> buf(64 * 1024);

        while (WinHttpQueryDataAvailable(h_request, &bytes_avail) && bytes_avail > 0) {
            DWORD to_read = std::min<DWORD>(bytes_avail, static_cast<DWORD>(buf.size()));
            DWORD bytes_read = 0;
            if (WinHttpReadData(h_request, buf.data(), to_read, &bytes_read) && bytes_read > 0) {
                out_file.write(buf.data(), bytes_read);
                downloaded_bytes += bytes_read;

                if (total_size > 0) {
                    float pct = static_cast<float>((static_cast<double>(downloaded_bytes) / static_cast<double>(total_size)) * 100.0);
                    download_progress_ = pct;
                    if (on_progress) on_progress(pct, downloaded_bytes, total_size);
                }
            }
        }

        out_file.close();
        WinHttpCloseHandle(h_request);
        WinHttpCloseHandle(h_connect);
        WinHttpCloseHandle(h_session);

        download_progress_ = 100.0f;
        is_downloading_ = false;

        std::cout << "[Updater] Successfully downloaded release update: " << target_zip.string() << std::endl;
        if (on_complete) on_complete(true, "");
    }).detach();

    return true;
}

bool UpdateManager::ApplyUpdate(std::string& out_error) {
    if (downloaded_zip_path_.empty() || !fs::exists(downloaded_zip_path_)) {
        out_error = "Downloaded update archive not found on disk.";
        return false;
    }

    WCHAR exe_buf[MAX_PATH] = {0};
    GetModuleFileNameW(nullptr, exe_buf, MAX_PATH);
    fs::path exe_path(exe_buf);
    fs::path install_dir = exe_path.parent_path();

    WCHAR temp_dir[MAX_PATH] = {0};
    GetTempPathW(MAX_PATH, temp_dir);
    fs::path updater_bat = fs::path(temp_dir) / "Waterfall" / "apply_update.bat";

    // Write detached updater script
    std::ofstream bat(updater_bat);
    if (!bat.is_open()) {
        out_error = "Cannot create update staging script.";
        return false;
    }

    DWORD current_pid = GetCurrentProcessId();

    bat << "@echo off\n";
    bat << "set PID=" << current_pid << "\n";
    bat << "set \"TARGET_DIR=" << install_dir.string() << "\"\n";
    bat << "set \"ZIP_PATH=" << downloaded_zip_path_ << "\"\n";
    bat << "set \"EXE_PATH=" << exe_path.string() << "\"\n";
    bat << "\n";
    bat << ":: 1. Wait for Waterfall process to exit\n";
    bat << ":WAIT_LOOP\n";
    bat << "tasklist /fi \"PID eq %PID%\" 2>nul | find \"%PID%\" >nul\n";
    bat << "if %ERRORLEVEL% equ 0 (\n";
    bat << "    timeout /t 1 /nobreak >nul\n";
    bat << "    goto WAIT_LOOP\n";
    bat << ")\n";
    bat << "\n";
    bat << ":: 2. Extract update zip over installation folder\n";
    bat << "powershell -NoProfile -ExecutionPolicy Bypass -Command \"Expand-Archive -Path '%ZIP_PATH%' -DestinationPath '%TARGET_DIR%' -Force\"\n";
    bat << "\n";
    bat << ":: 3. Clean up update zip\n";
    bat << "del \"%ZIP_PATH%\" >nul 2>&1\n";
    bat << "\n";
    bat << ":: 4. Restart Waterfall and exit updater\n";
    bat << "start \"\" \"%EXE_PATH%\"\n";
    bat << "exit\n";
    bat.close();

    // Launch updater script detached
    std::wstring cmd = L"cmd.exe /c \"" + updater_bat.wstring() + L"\"";
    std::vector<wchar_t> cmd_buf(cmd.begin(), cmd.end());
    cmd_buf.push_back(L'\0');

    STARTUPINFOW si = { sizeof(si) };
    si.dwFlags = STARTF_USESHOWWINDOW;
    si.wShowWindow = SW_HIDE;

    PROCESS_INFORMATION pi = {0};
    BOOL launched = CreateProcessW(nullptr, cmd_buf.data(), nullptr, nullptr, FALSE,
                                   CREATE_NEW_CONSOLE, nullptr, nullptr, &si, &pi);
    if (!launched) {
        out_error = "Failed to spawn update process.";
        return false;
    }

    CloseHandle(pi.hProcess);
    CloseHandle(pi.hThread);

    std::cout << "[Updater] Update script spawned. Closing Waterfall to apply update in 600ms..." << std::endl;
    std::thread([]() {
        std::this_thread::sleep_for(std::chrono::milliseconds(600));
        ExitProcess(0);
    }).detach();
    return true;
}

} // namespace waterfall::core
