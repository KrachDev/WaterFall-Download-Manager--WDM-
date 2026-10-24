#pragma once

#include <memory>
#include <string>
#include <vector>

namespace Rml {
    class Context;
    class ElementDocument;
}

namespace waterfall::ui {

class UiManager {
public:
    UiManager();
    ~UiManager();

    bool Initialize(int width = 1200, int height = 750);
    void Run();
    void Shutdown();

    void RequestDataUpdate();

private:
    void SetupDataModel();
    void LoadDocument();

    Rml::Context* context_ = nullptr;
    Rml::ElementDocument* document_ = nullptr;
    bool is_running_ = false;
    bool needs_model_dirty_ = false;
};

} // namespace waterfall::ui
