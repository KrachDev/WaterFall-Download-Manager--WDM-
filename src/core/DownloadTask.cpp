#include "waterfall/core/DownloadTask.hpp"
#include <iomanip>
#include <sstream>

namespace waterfall::core {

std::string DownloadTask::GetStatusString() const {
    switch (status) {
        case TaskStatus::Queued: return "Queued";
        case TaskStatus::Probing: return "Connecting";
        case TaskStatus::Downloading: return "Downloading";
        case TaskStatus::Paused: return "Paused";
        case TaskStatus::Extracting: return "Extracting " + std::to_string(static_cast<int>(extract_progress)) + "%";
        case TaskStatus::WaitingAllParts: return "Waiting Other Parts";
        case TaskStatus::Completed: return "Completed";
        case TaskStatus::Error: return "Error: " + error_message;
        default: return "Unknown";
    }
}

std::string DownloadTask::FormatBytes(int64_t bytes) {
    if (bytes <= 0) return "0 B";
    const char* units[] = { "B", "KB", "MB", "GB", "TB" };
    double d = static_cast<double>(bytes);
    int unit = 0;
    while (d >= 1024.0 && unit < 4) {
        d /= 1024.0;
        unit++;
    }
    std::ostringstream ss;
    ss << std::fixed << std::setprecision(unit == 0 ? 0 : (unit >= 2 ? 2 : 1)) << d << " " << units[unit];
    return ss.str();
}

std::string DownloadTask::GetSpeedFormatted() const {
    if (status != TaskStatus::Downloading || speed_bps <= 0) {
        return "-- KB/s";
    }
    return FormatBytes(speed_bps) + "/s";
}

std::string DownloadTask::GetDownloadedFormatted() const {
    return FormatBytes(downloaded_bytes);
}

std::string DownloadTask::GetTotalFormatted() const {
    if (total_bytes <= 0) return "Unknown";
    return FormatBytes(total_bytes);
}

float DownloadTask::GetProgressPercent() const {
    if (status == TaskStatus::Completed) return 100.0f;
    if (status == TaskStatus::Extracting) return extract_progress;
    if (total_bytes <= 0) return 0.0f;
    return static_cast<float>((static_cast<double>(downloaded_bytes) / static_cast<double>(total_bytes)) * 100.0);
}

std::string DownloadTask::GetEtaFormatted() const {
    if (status != TaskStatus::Downloading || speed_bps <= 0 || total_bytes <= 0) {
        return "--";
    }
    int64_t remaining_bytes = total_bytes - downloaded_bytes;
    if (remaining_bytes <= 0) return "0s";
    
    int64_t seconds = remaining_bytes / speed_bps;
    if (seconds < 60) {
        return std::to_string(seconds) + "s";
    }
    if (seconds < 3600) {
        int64_t mins = seconds / 60;
        int64_t secs = seconds % 60;
        return std::to_string(mins) + "m " + std::to_string(secs) + "s";
    }
    int64_t hours = seconds / 3600;
    int64_t mins = (seconds % 3600) / 60;
    return std::to_string(hours) + "h " + std::to_string(mins) + "m";
}

} // namespace waterfall::core
