#pragma once

#include <string>
#include "waterfall/core/DownloadTask.hpp"

namespace waterfall::core {

class ScriptEngine {
public:
    static ScriptEngine& Instance();

    bool ExecuteScript(const std::string& script_path, const DownloadTask& task);

private:
    ScriptEngine() = default;
    std::string ReplaceTokens(const std::string& input, const DownloadTask& task);
};

} // namespace waterfall::core
