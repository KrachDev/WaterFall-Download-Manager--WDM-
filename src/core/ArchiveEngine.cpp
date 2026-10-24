#include "waterfall/core/ArchiveEngine.hpp"
#include <windows.h>
#include <filesystem>
#include <regex>
#include <iostream>
#include <algorithm>

namespace waterfall::core {

namespace fs = std::filesystem;

static std::wstring ToWide(const std::string& str) {
    if (str.empty()) return L"";
    int size = MultiByteToWideChar(CP_UTF8, 0, str.c_str(), -1, nullptr, 0);
    std::wstring result(size - 1, 0);
    MultiByteToWideChar(CP_UTF8, 0, str.c_str(), -1, &result[0], size);
    return result;
}

ArchiveEngine& ArchiveEngine::Instance() {
    static ArchiveEngine instance;
    return instance;
}

ArchiveEngine::ArchiveEngine() {
    extractor_bin_ = LocateExtractorBinary();
}

std::string ArchiveEngine::LocateExtractorBinary() {
    // 1. If 7z.exe is resolvable in PATH (e.g., NanaZip or standard 7-Zip), prefer it
    wchar_t found[MAX_PATH];
    if (SearchPathW(nullptr, L"7z.exe", nullptr, MAX_PATH, found, nullptr) > 0) {
        return "7z.exe";
    }

    const std::vector<std::string> candidates = {
        "C:\\Program Files\\7-Zip\\7z.exe",
        "C:\\Program Files (x86)\\7-Zip\\7z.exe",
        "bin\\7z.exe",
        "C:\\Windows\\System32\\tar.exe"
    };

    for (const auto& path : candidates) {
        std::error_code ec;
        if (fs::exists(path, ec) && !ec) {
            return path;
        }
    }
    return "7z.exe"; // Fallback to PATH resolution
}

bool ArchiveEngine::IsArchiveFile(const std::string& path_str) {
    std::string lower = path_str;
    std::transform(lower.begin(), lower.end(), lower.begin(), ::tolower);

    // Guard: Videos are never archives
    if (lower.ends_with(".mp4") || lower.ends_with(".mkv") || lower.ends_with(".avi") ||
        lower.ends_with(".webm") || lower.ends_with(".mov") || lower.ends_with(".flv")) {
        return false;
    }

    if (lower.ends_with(".zip") || lower.ends_with(".rar") || lower.ends_with(".7z") ||
        lower.ends_with(".tar") || lower.ends_with(".gz") || lower.ends_with(".bz2") ||
        lower.ends_with(".xz") || lower.ends_with(".iso") || lower.ends_with(".z01") ||
        lower.ends_with(".r00") || lower.ends_with(".001")) {
        return true;
    }

    // Check regex for .part1.rar, .7z.001, etc.
    std::regex part_regex(R"(\.part\d+(\.rar)?$|\.7z\.\d+$|\.zip\.\d+$|\.r\d+$|\.z\d+$)", std::regex::icase);
    return std::regex_search(lower, part_regex);
}

MultipartInfo ArchiveEngine::ParseMultipartInfo(const std::string& filename, const std::string& package_name) {
    MultipartInfo info;
    info.base_name = filename;

    // Check if video
    std::string lower = filename;
    std::transform(lower.begin(), lower.end(), lower.begin(), ::tolower);
    if (lower.ends_with(".mp4") || lower.ends_with(".mkv") || lower.ends_with(".avi") ||
        lower.ends_with(".webm") || lower.ends_with(".mov")) {
        return info;
    }

    auto generate_key = [](const std::string& s) {
        std::string res;
        for (char c : s) {
            if (isalnum(static_cast<unsigned char>(c)) || c == '_') {
                res += static_cast<char>(tolower(static_cast<unsigned char>(c)));
            } else if (c == ' ' || c == '.' || c == '-') {
                res += '_';
            }
        }
        return res.empty() ? "archive_group" : res;
    };

    // 1. .part(\d+).rar or .part(\d+)
    std::smatch m;
    std::regex part_rar(R"(^(.*?)(?:[._\-\s]+part|part)(\d+)(\.rar|\.zip|\.7z|\.tar)?$)", std::regex::icase);
    if (std::regex_match(filename, m, part_rar)) {
        info.is_multipart = true;
        std::string base = m[1].str();
        info.part_number = std::stoi(m[2].str());
        info.is_root_part = (info.part_number == 1);
        info.format = m[3].matched ? m[3].str() : "rar";
        info.base_name = base.empty() ? (package_name.empty() ? filename : package_name) : base;
        info.group_key = generate_key(info.base_name);
        return info;
    }

    // 2. .7z.001, .zip.001, .rar.001
    std::regex num_ext(R"(^(.*?)\.(7z|zip|rar|tar)\.(\d{3,})$)", std::regex::icase);
    if (std::regex_match(filename, m, num_ext)) {
        info.is_multipart = true;
        info.base_name = m[1].str();
        info.format = m[2].str();
        info.part_number = std::stoi(m[3].str());
        info.is_root_part = (info.part_number == 1);
        info.group_key = generate_key(info.base_name);
        return info;
    }

    // 3. .z01, .z02
    std::regex z_ext(R"(^(.*?)\.z(\d{2,})$)", std::regex::icase);
    if (std::regex_match(filename, m, z_ext)) {
        info.is_multipart = true;
        info.base_name = m[1].str();
        info.part_number = std::stoi(m[2].str());
        info.is_root_part = false;
        info.format = "zip";
        info.group_key = generate_key(info.base_name);
        return info;
    }

    // 4. .r00, .r01
    std::regex r_ext(R"(^(.*?)\.r(\d{2,})$)", std::regex::icase);
    if (std::regex_match(filename, m, r_ext)) {
        info.is_multipart = true;
        info.base_name = m[1].str();
        info.part_number = std::stoi(m[2].str()) + 1;
        info.is_root_part = false;
        info.format = "rar";
        info.group_key = generate_key(info.base_name);
        return info;
    }

    return info;
}

std::string ArchiveEngine::FindRootArchivePart(const std::vector<std::string>& file_paths) {
    if (file_paths.empty()) return "";
    if (file_paths.size() == 1) return file_paths[0];

    // Look for part1 or part01
    std::regex p1(R"(\.part0*1(\.rar)?$)", std::regex::icase);
    for (const auto& p : file_paths) {
        if (std::regex_search(p, p1)) return p;
    }

    // Look for .001
    std::regex dot001(R"(\.(001|\d+\.001)$)", std::regex::icase);
    for (const auto& p : file_paths) {
        if (std::regex_search(p, dot001)) return p;
    }

    // Look for .rar (old-style)
    for (const auto& p : file_paths) {
        if (p.ends_with(".rar") && !std::regex_search(p, std::regex(R"(\.part\d+\.rar$)", std::regex::icase))) {
            return p;
        }
    }

    // Look for .zip
    for (const auto& p : file_paths) {
        if (p.ends_with(".zip")) return p;
    }

    // Fallback: pick the first path
    return file_paths[0];
}

bool ArchiveEngine::UnpackArchive(const std::string& archive_path,
                                  const std::string& output_dir,
                                  const std::vector<std::string>& passwords,
                                  bool delete_after,
                                  const std::vector<std::string>& all_part_paths,
                                  ProgressCallback on_progress,
                                  std::string& out_error) {
    std::error_code ec;
    if (!fs::exists(archive_path, ec) || ec) {
        out_error = "Archive file does not exist on disk: " + archive_path;
        return false;
    }

    fs::create_directories(output_dir, ec);

    std::vector<std::string> pw_list = passwords;
    // Always try empty password first
    pw_list.insert(pw_list.begin(), "");

    std::string bin_path = LocateExtractorBinary();

    for (size_t attempt = 0; attempt < pw_list.size(); ++attempt) {
        const std::string& pwd = pw_list[attempt];

        std::wstring cmd_line;
        if (bin_path.find("tar.exe") != std::string::npos) {
            cmd_line = L"\"" + ToWide(bin_path) + L"\" -xf \"" + ToWide(archive_path) + L"\" -C \"" + ToWide(output_dir) + L"\"";
        } else {
            // 7z / NanaZip
            cmd_line = L"\"" + ToWide(bin_path) + L"\" x -y -bsp1 ";
            if (!pwd.empty()) {
                cmd_line += L"-p\"" + ToWide(pwd) + L"\" ";
            } else {
                cmd_line += L"-p- "; // Non-interactive, do not wait on stdin
            }
            cmd_line += L"-o\"" + ToWide(output_dir) + L"\" \"" + ToWide(archive_path) + L"\"";
        }

        // Setup pipes for stdout capture
        HANDLE h_read_pipe = nullptr;
        HANDLE h_write_pipe = nullptr;
        SECURITY_ATTRIBUTES sa = { sizeof(sa), nullptr, TRUE };
        if (!CreatePipe(&h_read_pipe, &h_write_pipe, &sa, 0)) {
            out_error = "Failed to create extraction pipe";
            return false;
        }
        SetHandleInformation(h_read_pipe, HANDLE_FLAG_INHERIT, 0);

        STARTUPINFOW si = { sizeof(si) };
        si.dwFlags = STARTF_USESTDHANDLES | STARTF_USESHOWWINDOW;
        si.hStdOutput = h_write_pipe;
        si.hStdError = h_write_pipe;
        si.wShowWindow = SW_HIDE;

        PROCESS_INFORMATION pi = {0};
        std::vector<wchar_t> cmd_buf(cmd_line.begin(), cmd_line.end());
        cmd_buf.push_back(L'\0');

        BOOL success = CreateProcessW(nullptr, cmd_buf.data(), nullptr, nullptr, TRUE,
                                      CREATE_NO_WINDOW, nullptr, nullptr, &si, &pi);
        CloseHandle(h_write_pipe);

        if (!success) {
            CloseHandle(h_read_pipe);
            out_error = "Failed to launch extraction binary: " + bin_path;
            return false;
        }

        std::string output;
        char buffer[1024];
        DWORD bytes_read = 0;
        std::regex pct_regex(R"((\d+)\s*%)");

        while (ReadFile(h_read_pipe, buffer, sizeof(buffer) - 1, &bytes_read, nullptr) && bytes_read > 0) {
            buffer[bytes_read] = '\0';
            output.append(buffer, bytes_read);

            // Parse progress
            std::string s(buffer, bytes_read);
            std::smatch match;
            if (std::regex_search(s, match, pct_regex)) {
                float pct = std::stof(match[1].str());
                if (on_progress) on_progress(pct);
            }
        }

        CloseHandle(h_read_pipe);
        WaitForSingleObject(pi.hProcess, INFINITE);

        DWORD exit_code = 0;
        GetExitCodeProcess(pi.hProcess, &exit_code);
        CloseHandle(pi.hProcess);
        CloseHandle(pi.hThread);

        if (exit_code == 0) {
            if (on_progress) on_progress(100.0f);

            // If requested, clean up all parts
            if (delete_after) {
                ec.clear();
                if (!all_part_paths.empty()) {
                    for (const auto& part : all_part_paths) {
                        fs::remove(part, ec);
                    }
                } else {
                    fs::remove(archive_path, ec);
                }
            }
            return true;
        }

        // Check if password error occurred
        bool is_password_err = (output.find("Wrong password") != std::string::npos ||
                                output.find("encrypted") != std::string::npos ||
                                output.find("CRC Failed") != std::string::npos);

        if (!is_password_err && attempt == 0 && pw_list.size() > 1) {
            // General failure, not password
            out_error = "Extraction failed (exit code " + std::to_string(exit_code) + "): " + output;
            return false;
        }
        if (is_password_err && attempt + 1 == pw_list.size()) {
            out_error = "Password required or incorrect password";
            return false;
        }
    }

    out_error = "Extraction failed";
    return false;
}

} // namespace waterfall::core
