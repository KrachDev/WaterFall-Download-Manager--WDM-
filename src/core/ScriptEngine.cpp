#include "waterfall/core/ScriptEngine.hpp"
#include <windows.h>
#include <filesystem>
#include <iostream>
#include <vector>

namespace waterfall::core {

namespace fs = std::filesystem;

static std::wstring ToWide(const std::string& str) {
    if (str.empty()) return L"";
    int size = MultiByteToWideChar(CP_UTF8, 0, str.c_str(), -1, nullptr, 0);
    std::wstring result(size - 1, 0);
    MultiByteToWideChar(CP_UTF8, 0, str.c_str(), -1, &result[0], size);
    return result;
}

ScriptEngine& ScriptEngine::Instance() {
    static ScriptEngine instance;
    return instance;
}

std::string ScriptEngine::ReplaceTokens(const std::string& input, const DownloadTask& task) {
    std::string s = input;

    auto replace_all = [&s](const std::string& from, const std::string& to) {
        size_t start = 0;
        while ((start = s.find(from, start)) != std::string::npos) {
            s.replace(start, from.length(), to);
            start += to.length();
        }
    };

    fs::path p(task.save_path);
    replace_all("%FILE%", task.save_path);
    replace_all("%DIR%", p.parent_path().string());
    replace_all("%NAME%", task.filename);
    replace_all("%URL%", task.url);
    replace_all("%SIZE%", std::to_string(task.total_bytes));
    replace_all("%CATEGORY%", task.category);
    replace_all("%STATUS%", task.GetStatusString());

    return s;
}

bool ScriptEngine::ExecuteScript(const std::string& script_path, const DownloadTask& task) {
    if (script_path.empty()) return false;

    std::string resolved_path = ReplaceTokens(script_path, task);
    fs::path p(script_path);
    std::string ext = p.extension().string();

    std::wstring cmd;
    if (ext == ".py") {
        cmd = L"python.exe \"" + ToWide(resolved_path) + L"\"";
    } else if (ext == ".ps1") {
        cmd = L"powershell.exe -ExecutionPolicy Bypass -File \"" + ToWide(resolved_path) + L"\"";
    } else if (ext == ".bat" || ext == ".cmd") {
        cmd = L"cmd.exe /c \"" + ToWide(resolved_path) + L"\"";
    } else {
        cmd = L"\"" + ToWide(resolved_path) + L"\"";
    }

    STARTUPINFOW si = { sizeof(si) };
    si.dwFlags = STARTF_USESHOWWINDOW;
    si.wShowWindow = SW_HIDE;

    PROCESS_INFORMATION pi = {0};
    std::vector<wchar_t> cmd_buf(cmd.begin(), cmd.end());
    cmd_buf.push_back(L'\0');

    BOOL res = CreateProcessW(nullptr, cmd_buf.data(), nullptr, nullptr, FALSE,
                              CREATE_NO_WINDOW, nullptr, nullptr, &si, &pi);
    if (res) {
        CloseHandle(pi.hProcess);
        CloseHandle(pi.hThread);
        std::cout << "[ScriptEngine] Executed post-download script: " << script_path << std::endl;
        return true;
    }

    std::cerr << "[ScriptEngine] Failed to launch script: " << script_path << std::endl;
    return false;
}

} // namespace waterfall::core
