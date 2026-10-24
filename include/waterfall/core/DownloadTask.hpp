#pragma once

#include <string>
#include <vector>
#include <cstdint>
#include <chrono>

namespace waterfall::core {

enum class TaskStatus {
    Queued,
    Probing,
    Downloading,
    Paused,
    Extracting,
    WaitingAllParts,
    Completed,
    Error
};

struct ChunkInfo {
    int id = 0;
    int64_t start_byte = 0;
    int64_t end_byte = 0;
    int64_t current_byte = 0;
    int64_t speed_bps = 0;
    bool is_active = false;
    bool is_completed = false;

    [[nodiscard]] float GetProgress() const {
        int64_t total = end_byte - start_byte + 1;
        if (total <= 0) return 0.0f;
        int64_t done = current_byte - start_byte;
        return static_cast<float>((static_cast<double>(done) / static_cast<double>(total)) * 100.0);
    }
};

struct DownloadTask {
    int id = 0;
    std::string url;
    std::string direct_url;
    std::string filename;
    std::string save_path;
    std::string temp_path;
    
    int64_t total_bytes = 0;
    int64_t downloaded_bytes = 0;
    int64_t speed_bps = 0;
    int active_connections = 1;
    bool is_resumable = true;
    
    TaskStatus status = TaskStatus::Queued;
    std::string error_message;
    std::vector<ChunkInfo> chunks;

    // Metadata & Classification
    std::string hoster = "Direct";
    std::string package_name;
    std::string category = "Other";
    int priority = 2; // 1=Low, 2=Normal, 3=High
    int queue_order = 0;

    // Media Pipeline
    bool is_media = false;
    std::string media_format; // e.g. "mp3-320", "mp4-1080"
    std::string media_thumbnail;

    // Multipart Archive Engine
    bool is_multipart = false;
    std::string multipart_group;
    int multipart_part = 1;
    int multipart_total_parts = 1;
    bool is_root_part = false;
    float extract_progress = 0.0f;

    // Checksum & Integrity
    std::string sha256_hash;

    std::chrono::system_clock::time_point created_at = std::chrono::system_clock::now();
    std::chrono::system_clock::time_point completed_at;

    // Formatting helper methods for UI / data binding
    [[nodiscard]] std::string GetStatusString() const;
    [[nodiscard]] std::string GetSpeedFormatted() const;
    [[nodiscard]] std::string GetDownloadedFormatted() const;
    [[nodiscard]] std::string GetTotalFormatted() const;
    [[nodiscard]] float GetProgressPercent() const;
    [[nodiscard]] std::string GetEtaFormatted() const;
    
    static std::string FormatBytes(int64_t bytes);
};

} // namespace waterfall::core
