#pragma once

#include <string>
#include <filesystem>

namespace waterfall::core {

enum class FileCategory {
    General,
    Media,
    Audio,
    Compressed,
    Documents,
    Programs
};

class StorageRouter {
public:
    static StorageRouter& Instance();

    [[nodiscard]] std::filesystem::path GetDefaultDownloadDir() const;
    [[nodiscard]] std::filesystem::path GetAppDataDir() const;
    [[nodiscard]] std::filesystem::path ResolveTargetDirectory(const std::string& filename, bool category_subfolders = true) const;
    [[nodiscard]] FileCategory CategorizeFile(const std::string& filename) const;
    [[nodiscard]] std::string SanitizeFilename(const std::string& filename) const;

    void SetCustomDownloadDir(const std::filesystem::path& dir);

private:
    StorageRouter();
    std::filesystem::path base_download_dir_;
};

} // namespace waterfall::core
