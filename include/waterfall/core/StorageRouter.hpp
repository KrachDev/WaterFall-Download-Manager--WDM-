#pragma once

#include <string>
#include <filesystem>
#include <map>

namespace waterfall::core {

enum class FileCategory {
    General,
    Media,
    Audio,
    Compressed,
    Documents,
    Programs,
    Pictures
};

class StorageRouter {
public:
    static StorageRouter& Instance();

    [[nodiscard]] std::filesystem::path GetDefaultDownloadDir() const;
    [[nodiscard]] std::filesystem::path GetAppDataDir() const;
    [[nodiscard]] std::filesystem::path ResolveTargetDirectory(const std::string& filename, bool category_subfolders = true) const;
    [[nodiscard]] std::filesystem::path ResolveCategoryDirectory(FileCategory cat, const std::filesystem::path& base_dir) const;
    [[nodiscard]] std::map<std::string, std::string> GetAllCategoryDirectories(const std::filesystem::path& base_dir) const;
    [[nodiscard]] FileCategory CategorizeFile(const std::string& filename) const;
    [[nodiscard]] std::string CategoryToString(FileCategory cat) const;
    [[nodiscard]] FileCategory StringToCategory(const std::string& str) const;
    [[nodiscard]] std::string SanitizeFilename(const std::string& filename) const;

    void SetCustomDownloadDir(const std::filesystem::path& dir);

private:
    StorageRouter();
    std::filesystem::path base_download_dir_;
};

} // namespace waterfall::core
