#pragma once

#include <string>
#include <vector>
#include <functional>

namespace waterfall::core {

struct MultipartInfo {
    bool is_multipart = false;
    std::string group_key;
    std::string base_name;
    int part_number = 1;
    bool is_root_part = false;
    std::string format;
};

class ArchiveEngine {
public:
    using ProgressCallback = std::function<void(float percent)>;

    static ArchiveEngine& Instance();

    bool IsArchiveFile(const std::string& path);
    MultipartInfo ParseMultipartInfo(const std::string& filename, const std::string& package_name = "");
    std::string FindRootArchivePart(const std::vector<std::string>& file_paths);

    bool UnpackArchive(const std::string& archive_path,
                       const std::string& output_dir,
                       const std::vector<std::string>& passwords,
                       bool delete_after,
                       const std::vector<std::string>& all_part_paths,
                       ProgressCallback on_progress,
                       std::string& out_error);

private:
    ArchiveEngine();
    std::string LocateExtractorBinary();
    std::string extractor_bin_;
};

} // namespace waterfall::core
