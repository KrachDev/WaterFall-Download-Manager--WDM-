#include "waterfall/core/CrawlerEngine.hpp"
#include <windows.h>
#include <winhttp.h>
#include <nlohmann/json.hpp>
#include <regex>
#include <iostream>
#include <sstream>
#include <set>

namespace waterfall::core {

using json = nlohmann::json;

static std::wstring ToWide(const std::string& str) {
    if (str.empty()) return L"";
    int size = MultiByteToWideChar(CP_UTF8, 0, str.c_str(), -1, nullptr, 0);
    std::wstring result(size - 1, 0);
    MultiByteToWideChar(CP_UTF8, 0, str.c_str(), -1, &result[0], size);
    return result;
}

static std::string ToUtf8(const std::wstring& str) {
    if (str.empty()) return "";
    int size = WideCharToMultiByte(CP_UTF8, 0, str.c_str(), -1, nullptr, 0, nullptr, nullptr);
    std::string result(size - 1, 0);
    WideCharToMultiByte(CP_UTF8, 0, str.c_str(), -1, &result[0], size, nullptr, nullptr);
    return result;
}

CrawlerEngine& CrawlerEngine::Instance() {
    static CrawlerEngine instance;
    return instance;
}

std::string CrawlerEngine::FetchHttp(const std::string& url, int timeout_sec) {
    std::wstring wide_url = ToWide(url);
    URL_COMPONENTS url_comp = {0};
    url_comp.dwStructSize = sizeof(url_comp);
    url_comp.dwSchemeLength = static_cast<DWORD>(-1);
    url_comp.dwHostNameLength = static_cast<DWORD>(-1);
    url_comp.dwUrlPathLength = static_cast<DWORD>(-1);
    url_comp.dwExtraInfoLength = static_cast<DWORD>(-1);

    if (!WinHttpCrackUrl(wide_url.c_str(), 0, 0, &url_comp)) return "";

    std::wstring host(url_comp.lpszHostName, url_comp.dwHostNameLength);
    std::wstring path(url_comp.lpszUrlPath, url_comp.dwUrlPathLength);
    if (url_comp.dwExtraInfoLength > 0) {
        path.append(url_comp.lpszExtraInfo, url_comp.dwExtraInfoLength);
    }

    HINTERNET h_session = WinHttpOpen(L"Mozilla/5.0 (Windows NT 10.0; Win64; x64) Waterfall/2.0",
                                      WINHTTP_ACCESS_TYPE_DEFAULT_PROXY,
                                      WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0);
    if (!h_session) return "";

    DWORD timeout_ms = timeout_sec * 1000;
    WinHttpSetTimeouts(h_session, timeout_ms, timeout_ms, timeout_ms, timeout_ms);

    HINTERNET h_connect = WinHttpConnect(h_session, host.c_str(), url_comp.nPort, 0);
    if (!h_connect) {
        WinHttpCloseHandle(h_session);
        return "";
    }

    DWORD flags = (url_comp.nScheme == INTERNET_SCHEME_HTTPS) ? WINHTTP_FLAG_SECURE : 0;
    HINTERNET h_request = WinHttpOpenRequest(h_connect, L"GET", path.c_str(),
                                             nullptr, WINHTTP_NO_REFERER,
                                             WINHTTP_DEFAULT_ACCEPT_TYPES, flags);

    std::string response;
    if (h_request) {
        DWORD opt = WINHTTP_OPTION_REDIRECT_POLICY_ALWAYS;
        WinHttpSetOption(h_request, WINHTTP_OPTION_REDIRECT_POLICY, &opt, sizeof(opt));

        if (WinHttpSendRequest(h_request, WINHTTP_NO_ADDITIONAL_HEADERS, 0,
                               WINHTTP_NO_REQUEST_DATA, 0, 0, 0) &&
            WinHttpReceiveResponse(h_request, nullptr)) {

            char buffer[4096];
            DWORD bytes_read = 0;
            while (WinHttpReadData(h_request, buffer, sizeof(buffer) - 1, &bytes_read) && bytes_read > 0) {
                buffer[bytes_read] = '\0';
                response.append(buffer, bytes_read);
            }
        }
        WinHttpCloseHandle(h_request);
    }

    WinHttpCloseHandle(h_connect);
    WinHttpCloseHandle(h_session);
    return response;
}

std::vector<std::string> CrawlerEngine::ExtractRawUrls(const std::string& input_text) {
    std::set<std::string> unique_urls;

    // 1. Markdown: [text](URL)
    std::regex md_regex(R"(\[(?:[^\]]+)\]\((https?://[^\s\)]+)\))", std::regex::icase);
    auto md_begin = std::sregex_iterator(input_text.begin(), input_text.end(), md_regex);
    for (auto it = md_begin; it != std::sregex_iterator(); ++it) {
        unique_urls.insert((*it)[1].str());
    }

    // 2. BBCode: [url=URL]text[/url] or [url]URL[/url]
    std::regex bb_regex(R"(\[url[=\]](https?://[^\]]+)\])", std::regex::icase);
    auto bb_begin = std::sregex_iterator(input_text.begin(), input_text.end(), bb_regex);
    for (auto it = bb_begin; it != std::sregex_iterator(); ++it) {
        unique_urls.insert((*it)[1].str());
    }

    // 3. HTML anchors: href="URL"
    std::regex html_regex(R"(href=["'](https?://[^"']+)["'])", std::regex::icase);
    auto html_begin = std::sregex_iterator(input_text.begin(), input_text.end(), html_regex);
    for (auto it = html_begin; it != std::sregex_iterator(); ++it) {
        unique_urls.insert((*it)[1].str());
    }

    // 4. Plaintext URLs
    std::regex plain_regex(R"((https?://[^\s"'<>\(\)]+))", std::regex::icase);
    auto plain_begin = std::sregex_iterator(input_text.begin(), input_text.end(), plain_regex);
    for (auto it = plain_begin; it != std::sregex_iterator(); ++it) {
        std::string u = (*it)[1].str();
        while (!u.empty() && (u.back() == '.' || u.back() == ',' || u.back() == ')' || u.back() == ']')) {
            u.pop_back();
        }
        unique_urls.insert(u);
    }

    return std::vector<std::string>(unique_urls.begin(), unique_urls.end());
}

CrawlerPackage CrawlerEngine::ResolvePixeldrain(const std::string& url) {
    CrawlerPackage pkg;
    pkg.hoster = "Pixeldrain";

    std::smatch m;
    std::regex px_regex(R"(pixeldrain\.com/(u|l|d)/([a-zA-Z0-9_-]+))", std::regex::icase);
    if (!std::regex_search(url, m, px_regex)) return pkg;

    std::string type = m[1].str();
    std::string id = m[2].str();

    if (type == "l") {
        // Multi-file album
        std::string json_data = FetchHttp("https://pixeldrain.com/api/list/" + id);
        try {
            auto j = json::parse(json_data);
            pkg.name = j.value("title", "Pixeldrain Album " + id);
            if (j.contains("files") && j["files"].is_array()) {
                for (const auto& f : j["files"]) {
                    CrawlerItem item;
                    std::string f_id = f.value("id", "");
                    item.original_url = "https://pixeldrain.com/u/" + f_id;
                    item.direct_url = "https://pixeldrain.com/api/file/" + f_id;
                    item.filename = f.value("name", "pixeldrain_" + f_id);
                    item.size = f.value("size", 0LL);
                    item.hoster = "Pixeldrain";
                    item.package_name = pkg.name;
                    pkg.items.push_back(item);
                }
            }
        } catch (...) {}
    } else {
        // Single file
        CrawlerItem item;
        item.original_url = url;
        item.direct_url = "https://pixeldrain.com/api/file/" + id;
        item.hoster = "Pixeldrain";

        std::string info_json = FetchHttp("https://pixeldrain.com/api/file/" + id + "/info");
        try {
            auto j = json::parse(info_json);
            item.filename = j.value("name", "pixeldrain_" + id);
            item.size = j.value("size", 0LL);
        } catch (...) {
            item.filename = "pixeldrain_" + id;
        }
        pkg.name = item.filename;
        item.package_name = pkg.name;
        pkg.items.push_back(item);
    }

    return pkg;
}

CrawlerPackage CrawlerEngine::ResolveGoogleDrive(const std::string& url) {
    CrawlerPackage pkg;
    pkg.hoster = "Google Drive";

    std::smatch m;
    std::regex gd_regex(R"((?:drive|docs)\.google\.com/(?:file/d/|open\?id=)([a-zA-Z0-9_-]+))", std::regex::icase);
    if (std::regex_search(url, m, gd_regex)) {
        std::string id = m[1].str();
        CrawlerItem item;
        item.original_url = url;
        item.direct_url = "https://drive.google.com/uc?export=download&id=" + id;
        item.filename = "gdrive_" + id;
        item.hoster = "Google Drive";
        pkg.name = item.filename;
        item.package_name = pkg.name;
        pkg.items.push_back(item);
    }
    return pkg;
}

CrawlerPackage CrawlerEngine::ResolveDropbox(const std::string& url) {
    CrawlerPackage pkg;
    pkg.hoster = "Dropbox";

    std::string direct = url;
    size_t dl_pos = direct.find("dl=0");
    if (dl_pos != std::string::npos) {
        direct.replace(dl_pos, 4, "dl=1");
    } else if (direct.find('?') == std::string::npos) {
        direct += "?dl=1";
    } else {
        direct += "&dl=1";
    }

    CrawlerItem item;
    item.original_url = url;
    item.direct_url = direct;
    item.hoster = "Dropbox";
    
    // Extract filename from URL path
    size_t last_slash = url.find_last_of('/');
    if (last_slash != std::string::npos) {
        std::string fn = url.substr(last_slash + 1);
        size_t q = fn.find('?');
        if (q != std::string::npos) fn = fn.substr(0, q);
        item.filename = fn.empty() ? "dropbox_download" : fn;
    } else {
        item.filename = "dropbox_download";
    }

    pkg.name = item.filename;
    item.package_name = pkg.name;
    pkg.items.push_back(item);
    return pkg;
}

CrawlerPackage CrawlerEngine::ResolvePaste(const std::string& url) {
    CrawlerPackage pkg;
    pkg.hoster = "Paste Container";

    std::string raw_url = url;
    if (url.find("pastebin.com/") != std::string::npos && url.find("/raw/") == std::string::npos) {
        size_t pos = url.find("pastebin.com/");
        raw_url = url.substr(0, pos) + "pastebin.com/raw/" + url.substr(pos + 13);
    } else if (url.find("rentry.co/") != std::string::npos && url.find("/raw/") == std::string::npos) {
        size_t pos = url.find("rentry.co/");
        raw_url = url.substr(0, pos) + "rentry.co/raw/" + url.substr(pos + 10);
    }

    std::string body = FetchHttp(raw_url);
    if (!body.empty()) {
        auto urls = ExtractRawUrls(body);
        pkg.name = "Paste Package (" + std::to_string(urls.size()) + " files)";
        for (const auto& u : urls) {
            CrawlerItem item;
            item.original_url = u;
            item.direct_url = u;
            item.filename = "download";
            item.hoster = "Container Link";
            item.package_name = pkg.name;
            pkg.items.push_back(item);
        }
    }

    return pkg;
}

CrawlerPackage CrawlerEngine::ScrapeWebpage(const std::string& url) {
    CrawlerPackage pkg;
    pkg.hoster = "Web Scraper";

    std::string html = FetchHttp(url, 8);
    if (html.empty()) return pkg;

    // Extract title
    std::smatch title_match;
    std::regex title_regex(R"(<title[^>]*>([^<]+)</title>)", std::regex::icase);
    if (std::regex_search(html, title_match, title_regex)) {
        pkg.name = title_match[1].str();
        // Clean title
        while (!pkg.name.empty() && (pkg.name.back() == ' ' || pkg.name.back() == '\r' || pkg.name.back() == '\n')) pkg.name.pop_back();
    } else {
        pkg.name = "Web Download Package";
    }

    auto all_urls = ExtractRawUrls(html);
    std::regex downloadable_regex(R"(\.(zip|rar|7z|tar|gz|iso|exe|msi|bin|mp4|mkv|mp3|flac|pdf|epub)(\?.*)?$)", std::regex::icase);
    std::regex hoster_regex(R"((pixeldrain\.com|gofile\.io|mediafire\.com|catbox\.moe|krakenfiles\.com|buzzheavier\.com|fuckingfast\.co))", std::regex::icase);

    for (const auto& u : all_urls) {
        if (std::regex_search(u, downloadable_regex) || std::regex_search(u, hoster_regex)) {
            CrawlerItem item;
            item.original_url = u;
            item.direct_url = u;
            item.hoster = "Web Link";
            item.package_name = pkg.name;

            // Guess filename from URL path
            size_t slash = u.find_last_of('/');
            if (slash != std::string::npos) {
                std::string fn = u.substr(slash + 1);
                size_t q = fn.find('?');
                if (q != std::string::npos) fn = fn.substr(0, q);
                item.filename = fn.empty() ? "download" : fn;
            } else {
                item.filename = "download";
            }

            pkg.items.push_back(item);
        }
    }

    return pkg;
}

CrawlerPackage CrawlerEngine::CrawlUrl(const std::string& url) {
    if (url.find("pixeldrain.com") != std::string::npos) {
        return ResolvePixeldrain(url);
    }
    if (url.find("drive.google.com") != std::string::npos) {
        return ResolveGoogleDrive(url);
    }
    if (url.find("dropbox.com") != std::string::npos) {
        return ResolveDropbox(url);
    }
    if (url.find("pastebin.com") != std::string::npos || url.find("rentry.co") != std::string::npos) {
        return ResolvePaste(url);
    }

    // Default: Check if web page or direct URL
    std::regex direct_ext(R"(\.(zip|rar|7z|tar|gz|iso|exe|msi|bin|mp4|mkv|mp3|flac|pdf)(\?.*)?$)", std::regex::icase);
    if (std::regex_search(url, direct_ext)) {
        CrawlerPackage pkg;
        pkg.name = "Direct Download";
        pkg.hoster = "Direct";
        CrawlerItem item;
        item.original_url = url;
        item.direct_url = url;
        item.hoster = "Direct";
        
        size_t slash = url.find_last_of('/');
        if (slash != std::string::npos) {
            std::string fn = url.substr(slash + 1);
            size_t q = fn.find('?');
            if (q != std::string::npos) fn = fn.substr(0, q);
            item.filename = fn;
        } else {
            item.filename = "download.bin";
        }
        item.package_name = pkg.name;
        pkg.items.push_back(item);
        return pkg;
    }

    // Otherwise deep crawl webpage
    return ScrapeWebpage(url);
}

std::vector<CrawlerPackage> CrawlerEngine::CrawlText(const std::string& input_text) {
    std::vector<CrawlerPackage> packages;
    auto urls = ExtractRawUrls(input_text);

    for (const auto& u : urls) {
        auto pkg = CrawlUrl(u);
        if (!pkg.items.empty()) {
            packages.push_back(pkg);
        }
    }

    return packages;
}

} // namespace waterfall::core
