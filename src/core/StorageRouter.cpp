#include "waterfall/core/StorageRouter.hpp"

#include <windows.h>
#include <shlobj.h>
#include <algorithm>
#include <regex>

namespace waterfall::core {

StorageRouter& StorageRouter::Instance() {
    static StorageRouter router;
    return router;
}

StorageRouter::StorageRouter() {
    PWSTR path = nullptr;
    if (SUCCEEDED(SHGetKnownFolderPath(FOLDERID_Downloads, 0, nullptr, &path))) {
        base_download_dir_ = std::filesystem::path(path);
        CoTaskMemFree(path);
    } else {
        base_download_dir_ = std::filesystem::current_path() / "downloads";
    }
}

std::filesystem::path StorageRouter::GetDefaultDownloadDir() const {
    return base_download_dir_;
}

void StorageRouter::SetCustomDownloadDir(const std::filesystem::path& dir) {
    base_download_dir_ = dir;
}

FileCategory StorageRouter::CategorizeFile(const std::string& filename) const {
    std::filesystem::path p(filename);
    std::string ext = p.extension().string();
    std::transform(ext.begin(), ext.end(), ext.begin(), [](unsigned char c) { return std::tolower(c); });

    if (ext == ".mp4" || ext == ".mkv" || ext == ".avi" || ext == ".mov" || ext == ".webm" || ext == ".flv") {
        return FileCategory::Media;
    }
    if (ext == ".mp3" || ext == ".flac" || ext == ".wav" || ext == ".m4a" || ext == ".ogg" || ext == ".aac") {
        return FileCategory::Audio;
    }
    if (ext == ".zip" || ext == ".rar" || ext == ".7z" || ext == ".tar" || ext == ".gz" || ext == ".iso" || ext == ".001") {
        return FileCategory::Compressed;
    }
    if (ext == ".pdf" || ext == ".docx" || ext == ".xlsx" || ext == ".pptx" || ext == ".txt" || ext == ".epub") {
        return FileCategory::Documents;
    }
    if (ext == ".exe" || ext == ".msi" || ext == ".apk" || ext == ".bat" || ext == ".cmd") {
        return FileCategory::Programs;
    }
    return FileCategory::General;
}

std::filesystem::path StorageRouter::ResolveTargetDirectory(const std::string& filename, bool category_subfolders) const {
    if (!category_subfolders) {
        return base_download_dir_;
    }

    FileCategory cat = CategorizeFile(filename);
    switch (cat) {
        case FileCategory::Media: return base_download_dir_ / "Videos";
        case FileCategory::Audio: return base_download_dir_ / "Music";
        case FileCategory::Compressed: return base_download_dir_ / "Compressed";
        case FileCategory::Documents: return base_download_dir_ / "Documents";
        case FileCategory::Programs: return base_download_dir_ / "Programs";
        default: return base_download_dir_;
    }
}

std::string StorageRouter::SanitizeFilename(const std::string& filename) const {
    // Replace Windows invalid filename chars: \ / : * ? " < > |
    std::string result = filename;
    const std::string invalid_chars = "\\/:*?\"<>|";
    for (char& c : result) {
        if (invalid_chars.find(c) != std::string::npos || static_cast<unsigned char>(c) < 32) {
            c = '_';
        }
    }
    // Trim leading/trailing dots and spaces
    while (!result.empty() && (result.front() == '.' || result.front() == ' ')) {
        result.erase(result.begin());
    }
    while (!result.empty() && (result.back() == '.' || result.back() == ' ')) {
        result.pop_back();
    }
    return result.empty() ? "download" : result;
}

} // namespace waterfall::core
