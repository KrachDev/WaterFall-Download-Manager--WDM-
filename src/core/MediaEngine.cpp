#include "waterfall/core/MediaEngine.hpp"
#include <windows.h>
#include <nlohmann/json.hpp>
#include <filesystem>
#include <iostream>
#include <regex>
#include <thread>

namespace waterfall::core {

namespace fs = std::filesystem;
using json = nlohmann::json;

static std::wstring ToWide(const std::string& str) {
    if (str.empty()) return L"";
    int size = MultiByteToWideChar(CP_UTF8, 0, str.c_str(), -1, nullptr, 0);
    std::wstring result(size - 1, 0);
    MultiByteToWideChar(CP_UTF8, 0, str.c_str(), -1, &result[0], size);
    return result;
}

MediaEngine& MediaEngine::Instance() {
    static MediaEngine instance;
    return instance;
}

MediaEngine::MediaEngine() {
    LocateBinaries();
}

void MediaEngine::LocateBinaries() {
    wchar_t exe_buf[MAX_PATH] = {0};
    GetModuleFileNameW(nullptr, exe_buf, MAX_PATH);
    fs::path exe_dir = fs::path(exe_buf).parent_path();

    std::vector<fs::path> candidates = {
        fs::current_path() / "bin",
        exe_dir / "bin",
        exe_dir / "../bin",
        fs::current_path()
    };

    yt_dlp_path_ = "yt-dlp.exe";
    for (const auto& c : candidates) {
        std::error_code ec;
        if (fs::exists(c / "yt-dlp.exe", ec) && !ec) {
            yt_dlp_path_ = (c / "yt-dlp.exe").string();
            break;
        }
    }

    ffmpeg_path_ = "ffmpeg.exe";
    for (const auto& c : candidates) {
        std::error_code ec;
        if (fs::exists(c / "ffmpeg.exe", ec) && !ec) {
            ffmpeg_path_ = (c / "ffmpeg.exe").string();
            break;
        }
    }
}

bool MediaEngine::IsMediaUrl(const std::string& url) {
    if (url.empty()) return false;
    std::regex media_regex(R"((?:youtube\.com|youtu\.be|soundcloud\.com|vimeo\.com|tiktok\.com|twitch\.tv|twitter\.com|x\.com))", std::regex::icase);
    return std::regex_search(url, media_regex);
}

MediaMetadata MediaEngine::ProbeMedia(const std::string& url) {
    MediaMetadata meta;
    if (url.empty()) return meta;

    std::wstring cmd = L"\"" + ToWide(yt_dlp_path_) + L"\" --dump-single-json --no-warnings \"" + ToWide(url) + L"\"";

    HANDLE h_read = nullptr;
    HANDLE h_write = nullptr;
    SECURITY_ATTRIBUTES sa = { sizeof(sa), nullptr, TRUE };
    if (!CreatePipe(&h_read, &h_write, &sa, 0)) return meta;
    SetHandleInformation(h_read, HANDLE_FLAG_INHERIT, 0);

    STARTUPINFOW si = { sizeof(si) };
    si.dwFlags = STARTF_USESTDHANDLES | STARTF_USESHOWWINDOW;
    si.hStdOutput = h_write;
    si.hStdError = h_write;
    si.wShowWindow = SW_HIDE;

    PROCESS_INFORMATION pi = {0};
    std::vector<wchar_t> cmd_buf(cmd.begin(), cmd.end());
    cmd_buf.push_back(L'\0');

    if (!CreateProcessW(nullptr, cmd_buf.data(), nullptr, nullptr, TRUE,
                        CREATE_NO_WINDOW, nullptr, nullptr, &si, &pi)) {
        CloseHandle(h_read);
        CloseHandle(h_write);
        return meta;
    }
    CloseHandle(h_write);

    std::string json_str;
    char buffer[4096];
    DWORD read_bytes = 0;
    while (ReadFile(h_read, buffer, sizeof(buffer) - 1, &read_bytes, nullptr) && read_bytes > 0) {
        buffer[read_bytes] = '\0';
        json_str.append(buffer, read_bytes);
    }
    CloseHandle(h_read);
    WaitForSingleObject(pi.hProcess, 15000); // 15 second probe timeout
    CloseHandle(pi.hProcess);
    CloseHandle(pi.hThread);

    try {
        auto j = json::parse(json_str);
        meta.is_valid = true;
        meta.id = j.value("id", "");
        meta.title = j.value("title", "Media Title");
        meta.uploader = j.value("uploader", j.value("channel", "Unknown Artist"));
        meta.webpage_url = j.value("webpage_url", url);

        if (j.contains("thumbnail") && j["thumbnail"].is_string()) {
            meta.thumbnail = j["thumbnail"].get<std::string>();
        }

        int duration_sec = j.value("duration", 0);
        meta.duration_seconds = duration_sec;
        if (duration_sec > 0) {
            int mins = duration_sec / 60;
            int secs = duration_sec % 60;
            meta.duration = std::to_string(mins) + ":" + (secs < 10 ? "0" : "") + std::to_string(secs);
        } else {
            meta.duration = "--:--";
        }

        // Standard format choices
        meta.formats = {
            { "mp3-320", "audio", "mp3", "320k", "MP3 High Quality (320 kbps)" },
            { "mp3-192", "audio", "mp3", "192k", "MP3 Standard (192 kbps)" },
            { "m4a-best", "audio", "m4a", "best", "M4A / AAC (Apple Quality)" },
            { "flac-lossless", "audio", "flac", "0", "FLAC Lossless" },
            { "wav-lossless", "audio", "wav", "0", "WAV Uncompressed" },
            { "mp4-1080", "video", "mp4", "1080p", "MP4 Full HD (1080p)" },
            { "mp4-720", "video", "mp4", "720p", "MP4 HD (720p)" },
            { "mp4-best", "video", "mp4", "best", "MP4 Best Available" }
        };

        // Check if playlist
        if (j.value("_type", "") == "playlist" && j.contains("entries") && j["entries"].is_array()) {
            meta.is_playlist = true;
            for (const auto& entry : j["entries"]) {
                MediaEntry me;
                me.id = entry.value("id", "");
                me.title = entry.value("title", "Untitled Track");
                me.url = entry.value("url", "https://www.youtube.com/watch?v=" + me.id);
                int sec = entry.value("duration", 0);
                me.duration_seconds = sec;
                if (sec > 0) {
                    me.duration = std::to_string(sec / 60) + ":" + (sec % 60 < 10 ? "0" : "") + std::to_string(sec % 60);
                }
                meta.playlist_entries.push_back(me);
            }
        }
    } catch (const std::exception& e) {
        std::cerr << "[MediaEngine] JSON parse error: " << e.what() << std::endl;
    }

    return meta;
}

bool MediaEngine::StartDownload(const std::string& url,
                                const std::string& format_id,
                                const std::string& output_folder,
                                const std::string& output_filename,
                                ProgressCallback on_progress,
                                CompleteCallback on_complete) {
    std::thread([this, url, format_id, output_folder, output_filename, on_progress, on_complete]() {
        fs::create_directories(output_folder);

        std::wstring cmd = L"\"" + ToWide(yt_dlp_path_) + L"\" --newline --no-playlist ";

        if (!ffmpeg_path_.empty()) {
            fs::path ffmpeg_dir = fs::path(ffmpeg_path_).parent_path();
            cmd += L"--ffmpeg-location \"" + ffmpeg_dir.wstring() + L"\" ";
        }

        // Configure audio or video format
        if (format_id.find("mp3") != std::string::npos) {
            std::string qual = (format_id == "mp3-320") ? "320k" : "192k";
            cmd += L"-x --audio-format mp3 --audio-quality " + ToWide(qual) + L" --embed-thumbnail --embed-metadata ";
        } else if (format_id.find("flac") != std::string::npos) {
            cmd += L"-x --audio-format flac --embed-thumbnail --embed-metadata ";
        } else if (format_id.find("m4a") != std::string::npos) {
            cmd += L"-x --audio-format m4a --embed-thumbnail --embed-metadata ";
        } else if (format_id.find("wav") != std::string::npos) {
            cmd += L"-x --audio-format wav ";
        } else if (format_id == "mp4-1080") {
            cmd += L"-f \"bestvideo[height<=1080]+bestaudio/best[height<=1080]/best\" --merge-output-format mp4 --embed-thumbnail --embed-metadata ";
        } else if (format_id == "mp4-720") {
            cmd += L"-f \"bestvideo[height<=720]+bestaudio/best[height<=720]/best\" --merge-output-format mp4 --embed-thumbnail --embed-metadata ";
        } else {
            // Default best video
            cmd += L"-f \"bestvideo+bestaudio/best\" --merge-output-format mp4 --embed-thumbnail --embed-metadata ";
        }

        // Output template
        fs::path out_path = fs::path(output_folder) / (output_filename.empty() ? "%(title)s.%(ext)s" : (output_filename + ".%(ext)s"));
        cmd += L"-o \"" + out_path.wstring() + L"\" \"" + ToWide(url) + L"\"";

        HANDLE h_read = nullptr;
        HANDLE h_write = nullptr;
        SECURITY_ATTRIBUTES sa = { sizeof(sa), nullptr, TRUE };
        if (!CreatePipe(&h_read, &h_write, &sa, 0)) {
            if (on_complete) on_complete(false, "Failed to create pipe");
            return;
        }
        SetHandleInformation(h_read, HANDLE_FLAG_INHERIT, 0);

        STARTUPINFOW si = { sizeof(si) };
        si.dwFlags = STARTF_USESTDHANDLES | STARTF_USESHOWWINDOW;
        si.hStdOutput = h_write;
        si.hStdError = h_write;
        si.wShowWindow = SW_HIDE;

        PROCESS_INFORMATION pi = {0};
        std::vector<wchar_t> cmd_buf(cmd.begin(), cmd.end());
        cmd_buf.push_back(L'\0');

        if (!CreateProcessW(nullptr, cmd_buf.data(), nullptr, nullptr, TRUE,
                            CREATE_NO_WINDOW, nullptr, nullptr, &si, &pi)) {
            CloseHandle(h_read);
            CloseHandle(h_write);
            if (on_complete) on_complete(false, "Failed to launch yt-dlp");
            return;
        }
        CloseHandle(h_write);

        char buffer[1024];
        DWORD bytes_read = 0;
        std::string line;
        std::regex progress_regex(R"(\[download\]\s+(\d+\.?\d*)%\s+of\s+~?(\S+)\s+at\s+(\S+)\s+ETA\s+(\S+))");

        while (ReadFile(h_read, buffer, sizeof(buffer) - 1, &bytes_read, nullptr) && bytes_read > 0) {
            buffer[bytes_read] = '\0';
            line.append(buffer, bytes_read);

            size_t pos = 0;
            while ((pos = line.find('\n')) != std::string::npos) {
                std::string current_line = line.substr(0, pos);
                line.erase(0, pos + 1);

                std::smatch m;
                if (std::regex_search(current_line, m, progress_regex)) {
                    float pct = std::stof(m[1].str());
                    std::string spd_str = m[3].str();
                    std::string eta = m[4].str();

                    // Convert speed string (e.g. 1.25MiB/s) to bps
                    int64_t bps = 0;
                    if (spd_str.find("MiB") != std::string::npos) {
                        bps = static_cast<int64_t>(std::stof(spd_str) * 1024 * 1024);
                    } else if (spd_str.find("KiB") != std::string::npos) {
                        bps = static_cast<int64_t>(std::stof(spd_str) * 1024);
                    }

                    if (on_progress) on_progress(pct, bps, eta);
                }
            }
        }

        CloseHandle(h_read);
        WaitForSingleObject(pi.hProcess, INFINITE);

        DWORD exit_code = 0;
        GetExitCodeProcess(pi.hProcess, &exit_code);
        CloseHandle(pi.hProcess);
        CloseHandle(pi.hThread);

        if (exit_code == 0) {
            if (on_progress) on_progress(100.0f, 0, "0s");
            if (on_complete) on_complete(true, "");
        } else {
            if (on_complete) on_complete(false, "yt-dlp exited with code " + std::to_string(exit_code));
        }
    }).detach();

    return true;
}

} // namespace waterfall::core
