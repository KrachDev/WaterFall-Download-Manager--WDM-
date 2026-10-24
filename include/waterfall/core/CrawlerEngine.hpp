#pragma once

#include <string>
#include <vector>
#include <memory>

namespace waterfall::core {

struct CrawlerItem {
    std::string original_url;
    std::string direct_url;
    std::string filename;
    int64_t size = 0;
    std::string hoster = "Direct";
    std::string package_name;
    bool is_media = false;
    std::string media_format;
};

struct CrawlerPackage {
    std::string name;
    std::string hoster;
    std::vector<CrawlerItem> items;
};

class CrawlerEngine {
public:
    static CrawlerEngine& Instance();

    std::vector<std::string> ExtractRawUrls(const std::string& input_text);
    CrawlerPackage CrawlUrl(const std::string& url);
    std::vector<CrawlerPackage> CrawlText(const std::string& input_text);

private:
    CrawlerEngine() = default;

    CrawlerPackage ResolvePixeldrain(const std::string& url);
    CrawlerPackage ResolveGofile(const std::string& url);
    CrawlerPackage ResolveFuckingFast(const std::string& url);
    CrawlerPackage ResolveGoogleDrive(const std::string& url);
    CrawlerPackage ResolveDropbox(const std::string& url);
    CrawlerPackage ResolvePaste(const std::string& url);
    CrawlerPackage ScrapeWebpage(const std::string& url);

    std::string FetchHttp(const std::string& url, int timeout_sec = 6);
};

} // namespace waterfall::core
