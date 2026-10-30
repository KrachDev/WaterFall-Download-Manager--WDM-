#include "waterfall/core/StorageRouter.hpp"
#include "waterfall/core/ConfigManager.hpp"

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
    std::string cfg_dir = ConfigManager::Instance().GetDownloadDirectory();
    if (!cfg_dir.empty()) {
        return std::filesystem::path(cfg_dir);
    }
    return base_download_dir_;
}

std::filesystem::path StorageRouter::GetAppDataDir() const {
    PWSTR path = nullptr;
    if (SUCCEEDED(SHGetKnownFolderPath(FOLDERID_RoamingAppData, 0, nullptr, &path))) {
        std::filesystem::path p = std::filesystem::path(path) / "Waterfall";
        CoTaskMemFree(path);
        std::error_code ec;
        std::filesystem::create_directories(p, ec);
        return p;
    }
    std::filesystem::path fallback = std::filesystem::current_path() / "data";
    std::error_code ec;
    std::filesystem::create_directories(fallback, ec);
    return fallback;
}

void StorageRouter::SetCustomDownloadDir(const std::filesystem::path& dir) {
    base_download_dir_ = dir;
}

FileCategory StorageRouter::CategorizeFile(const std::string& filename) const {
    std::filesystem::path p(filename);
    std::string ext = p.extension().string();
    std::transform(ext.begin(), ext.end(), ext.begin(), [](unsigned char c) { return (char)std::tolower(c); });

    std::string fn_lower = filename;
    std::transform(fn_lower.begin(), fn_lower.end(), fn_lower.begin(), [](unsigned char c) { return (char)std::tolower(c); });

    // 1. Compressed / Archives
    if (ext == ".zip" || ext == ".rar" || ext == ".7z" || ext == ".tar" || ext == ".gz" || ext == ".bz2" ||
        ext == ".xz" || ext == ".iso" || ext == ".001" || ext == ".cab" || ext == ".dmg" || ext == ".pkg" ||
        ext == ".tgz" || ext == ".z" || ext == ".lzma" ||
        fn_lower.ends_with(".tar.gz") || fn_lower.ends_with(".tar.bz2")) {
        return FileCategory::Compressed;
    }
    // 2. Video / Media Streams
    if (ext == ".mp4" || ext == ".mkv" || ext == ".avi" || ext == ".mov" || ext == ".webm" || ext == ".flv" ||
        ext == ".wmv" || ext == ".m4v" || ext == ".ts" || ext == ".3gp" || ext == ".vob" || ext == ".ogv") {
        return FileCategory::Media;
    }
    // 3. Audio / Music
    if (ext == ".mp3" || ext == ".flac" || ext == ".wav" || ext == ".m4a" || ext == ".ogg" || ext == ".aac" ||
        ext == ".opus" || ext == ".alac" || ext == ".wma" || ext == ".aiff" || ext == ".mid" || ext == ".midi") {
        return FileCategory::Audio;
    }
    // 4. Documents & Books
    if (ext == ".pdf" || ext == ".docx" || ext == ".doc" || ext == ".xlsx" || ext == ".xls" || ext == ".pptx" ||
        ext == ".ppt" || ext == ".txt" || ext == ".epub" || ext == ".odt" || ext == ".rtf" || ext == ".csv" ||
        ext == ".cbz" || ext == ".cbr" || ext == ".md" || ext == ".chm") {
        return FileCategory::Documents;
    }
    // 5. Programs & Executables
    if (ext == ".exe" || ext == ".msi" || ext == ".apk" || ext == ".bat" || ext == ".cmd" || ext == ".bin" ||
        ext == ".appimage" || ext == ".deb" || ext == ".rpm" || ext == ".sh" || ext == ".vbs" || ext == ".jar") {
        return FileCategory::Programs;
    }
    // 6. Pictures & Images
    if (ext == ".png" || ext == ".jpg" || ext == ".jpeg" || ext == ".webp" || ext == ".gif" || ext == ".svg" ||
        ext == ".bmp" || ext == ".tiff" || ext == ".ico" || ext == ".psd" || ext == ".ai" || ext == ".raw" || ext == ".heic") {
        return FileCategory::Pictures;
    }

    return FileCategory::General;
}

std::filesystem::path StorageRouter::ResolveCategoryDirectory(FileCategory cat, const std::filesystem::path& base_dir) const {
    switch (cat) {
        case FileCategory::Compressed: return base_dir / "Compressed";
        case FileCategory::Programs: return base_dir / "Programs";
        case FileCategory::Media: return base_dir / "Video";
        case FileCategory::Audio: return base_dir / "Music";
        case FileCategory::Documents: return base_dir / "Documents";
        case FileCategory::Pictures: return base_dir / "Pictures";
        default: return base_dir;
    }
}

std::map<std::string, std::string> StorageRouter::GetAllCategoryDirectories(const std::filesystem::path& base_dir) const {
    return {
        {"Compressed", (base_dir / "Compressed").string()},
        {"Programs", (base_dir / "Programs").string()},
        {"Video", (base_dir / "Video").string()},
        {"Audio", (base_dir / "Music").string()},
        {"Documents", (base_dir / "Documents").string()},
        {"Pictures", (base_dir / "Pictures").string()},
        {"General", base_dir.string()}
    };
}

std::filesystem::path StorageRouter::ResolveTargetDirectory(const std::string& filename, bool category_subfolders) const {
    auto base_dir = GetDefaultDownloadDir();
    if (!category_subfolders) {
        return base_dir;
    }

    FileCategory cat = CategorizeFile(filename);
    return ResolveCategoryDirectory(cat, base_dir);
}

std::string StorageRouter::CategoryToString(FileCategory cat) const {
    switch (cat) {
        case FileCategory::Compressed: return "Compressed";
        case FileCategory::Programs: return "Programs";
        case FileCategory::Media: return "Video";
        case FileCategory::Audio: return "Audio";
        case FileCategory::Documents: return "Documents";
        case FileCategory::Pictures: return "Pictures";
        default: return "General";
    }
}

FileCategory StorageRouter::StringToCategory(const std::string& str) const {
    std::string s = str;
    std::transform(s.begin(), s.end(), s.begin(), [](unsigned char c) { return (char)std::tolower(c); });
    if (s == "compressed" || s == "zip" || s == "archive" || s == "archives") return FileCategory::Compressed;
    if (s == "video" || s == "media" || s == "videos") return FileCategory::Media;
    if (s == "audio" || s == "music") return FileCategory::Audio;
    if (s == "programs" || s == "program" || s == "apps" || s == "app") return FileCategory::Programs;
    if (s == "documents" || s == "document" || s == "docs" || s == "doc") return FileCategory::Documents;
    if (s == "pictures" || s == "picture" || s == "images" || s == "image") return FileCategory::Pictures;
    return FileCategory::General;
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
