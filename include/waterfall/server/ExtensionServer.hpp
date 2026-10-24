#pragma once

#include <memory>
#include <thread>
#include <atomic>
#include <string>

namespace httplib {
    class Server;
}

namespace waterfall::server {

class ExtensionServer {
public:
    ExtensionServer(int port = 4567);
    ~ExtensionServer();

    bool Start();
    void Stop();

private:
    void SetupRoutes();

    int port_;
    std::unique_ptr<httplib::Server> server_;
    std::thread server_thread_;
    std::atomic<bool> is_running_{false};
};

} // namespace waterfall::server
