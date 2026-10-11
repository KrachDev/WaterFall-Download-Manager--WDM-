# Waterfall Download Suite — IDM Companion Extension

A modern, high-performance browser extension that brings **Internet Download Manager (IDM)** and **JDownloader** grade superpowers directly to Chromium-based browsers (Google Chrome, Microsoft Edge, Brave, Opera, Vivaldi), seamlessly paired with the **Waterfall Desktop Suite**.

---

## ⚡ Key Features

### 1. 🎬 Sleek Morphing Video Grabber (Non-Intrusive)
* **Hover-Only Morphing Badge:** Appears as an obsidian glassmorphic mini-pill (`[ ⚡ Waterfall | × ]`) only when hovering over HTML5 video players.
* **Auto-Hide on Inactivity:** Smoothly fades out after 2.4 seconds of cursor idle time so you can watch movies and streams undisturbed.
* **Instant 1-Click Dismiss (`×`):** Dismisses the badge for that video for the remainder of your browsing session with a feedback toast.
* **1-Click YouTube & Media Converter:**
  * **⚡ Download:** Standard multi-threaded chunk download.
  * **🎵 MP3:** Converts stream directly to **320 kbps High-Quality MP3** using Waterfall's built-in `yt-dlp` and `ffmpeg` engine!
  * **🎬 1080p MP4:** Downloads full high-definition video.
* **Full Position Controls:** Repositionable to Top-Right, Top-Left, Bottom-Right, or Bottom-Left in settings.

### 2. 📑 Powerful Batch Link Grabber
* **Instant Page Scraper:** Scrapes all download links, media streams, images, and document links from the active tab.
* **Smart Categorization Chips:**
  * 🎬 **Videos:** `.mp4`, `.mkv`, `.avi`, `.mov`, `.webm`, `.flv`, `.ts`, `.m3u8`
  * 🎵 **Audio:** `.mp3`, `.flac`, `.wav`, `.aac`, `.m4a`, `.ogg`, `.opus`
  * 📦 **Archives:** `.zip`, `.rar`, `.7z`, `.tar`, `.gz`, `.iso`
  * 📄 **Documents:** `.pdf`, `.epub`, `.doc`, `.docx`, `.xls`, `.xlsx`, `.ppt`
  * 🖼️ **Images:** `.png`, `.jpg`, `.jpeg`, `.webp`, `.svg`, `.gif`
* **Real-time Search & Filter:** Filter instantly by keyword or file extension.
* **Direct Download or Stage:** Choose between **Download Selected** (begins immediate chunk transfer) or **Stage in LinkGrabber** (reviews and organizes before downloading).

### 3. 🌐 Network Stream Sniffer (IDM Sniffing Engine)
* Monitors web network responses (`video/*`, `audio/*`, `application/vnd.apple.mpegurl`, HLS `.m3u8`, `.mpd`, `.mp4`).
* Captures hidden streaming URLs that standard right-click menus cannot reach.
* Dedicated **Media Sniffer tab** with stream sizes, 1-click download, and 1-click MP3 converter.

### 4. 🚀 Seamless Download Interception (Zero Duplicate Downloads)
* **Dual-Hook Interception Engine:** Captures file downloads via `chrome.downloads` before the browser opens the "Save As..." dialog or download shelf.
* **Zero Browser Duplicates:** Automatically cancels and erases the native browser download while forwarding the link to Waterfall's high-speed engine.
* **Hold `Ctrl` (or `Alt`) to Bypass:** Press and hold the **Ctrl** or **Alt** key while clicking any download link to temporarily bypass Waterfall and force your browser's native downloader.
* Customizable file extensions list in options.

### 5. 🎯 Right-Click Context Menu Integration
* **⚡ Download Link with Waterfall**
* **🎬 Download Media with Waterfall**
* **🎵 Convert to MP3 (320k) with Waterfall**
* **📥 Download Selected Links with Waterfall**
* **📑 Download All Links on Page with Waterfall**
* **🌐 Download Page URL with Waterfall**

### 6. 🛠️ Direct URL Bulk Injector & Presets
* Multi-line paste area for mass-injecting URLs, direct download links, magnet links, or YouTube videos.
* Preset selector: Default, MP3 320k, FLAC Lossless, 1080p MP4.
* Optional archive password extraction field.

### 7. 📊 Real-Time Diagnostics & Self-Test
* Live latency indicator (e.g. `Waterfall Online (4ms)`).
* Dedicated Options Dashboard (`options/options.html`) with self-test download dispatcher to verify connectivity.
* **Dual Engine Support:** Communicates with **Waterfall Engine** (`http://127.0.0.1:4567`) by default, with optional fallback support for JDownloader (`http://127.0.0.1:9666`).

---

## 📦 How to Load the Extension in Your Browser

Built with **Manifest V3** with zero build steps needed:

### Step 1: Open Extension Management
* **Google Chrome / Brave:** Navigate to `chrome://extensions`
* **Microsoft Edge:** Navigate to `edge://extensions`

### Step 2: Enable Developer Mode
* Toggle on **Developer mode** in the top-right corner.

### Step 3: Load the Extension
1. Click the **Load unpacked** button in the top-left.
2. Select this directory:
   ```
   c:\Users\Kracher.Krach\Documents\Jdownloader rebirth\extension
   ```
3. **Waterfall Download Suite — IDM Companion** will now appear in your browser toolbar!

---

## 🔒 Privacy & Local Security
* Communicates directly and exclusively with your local Waterfall instance (`http://127.0.0.1:4567`).
* Zero external servers, zero telemetry, zero analytics.
