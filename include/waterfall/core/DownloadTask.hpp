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
};

struct DownloadTask {
    int id = 0;
    std::string url;
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
