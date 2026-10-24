#pragma once

#include <string>
#include <vector>
#include <functional>
#include <memory>

namespace waterfall::core {

struct MediaFormatOption {
    std::string id;
    std::string type; // "audio" or "video"
    std::string ext;
    std::string quality;
    std::string label;
};

struct MediaEntry {
    std::string id;
    std::string title;
    std::string url;
    std::string duration;
    int duration_seconds = 0;
    std::string thumbnail;
};

struct MediaMetadata {
    bool is_valid = false;
    bool is_playlist = false;
    std::string id;
    std::string title;
    std::string uploader;
    std::string duration;
    int duration_seconds = 0;
    std::string thumbnail;
    std::string webpage_url;
    std::vector<MediaFormatOption> formats;
    std::vector<MediaEntry> playlist_entries;
};

class MediaEngine {
public:
    using ProgressCallback = std::function<void(float percent, int64_t speed_bps, const std::string& eta)>;
    using CompleteCallback = std::function<void(bool success, const std::string& error)>;

    static MediaEngine& Instance();

    bool IsMediaUrl(const std::string& url);
    MediaMetadata ProbeMedia(const std::string& url);

    bool StartDownload(const std::string& url,
                       const std::string& format_id,
                       const std::string& output_folder,
                       const std::string& output_filename,
                       ProgressCallback on_progress,
                       CompleteCallback on_complete);

    std::string GetYtDlpPath() const { return yt_dlp_path_; }
    std::string GetFfmpegPath() const { return ffmpeg_path_; }

private:
    MediaEngine();
    void LocateBinaries();

    std::string yt_dlp_path_;
    std::string ffmpeg_path_;
};

} // namespace waterfall::core
