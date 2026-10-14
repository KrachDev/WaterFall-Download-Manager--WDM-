<div align="center">

  <img src="assets/waterfall_logo.png" alt="Waterfall Logo" width="220" height="220" style="border-radius: 50%; filter: drop-shadow(0 0 25px rgba(56, 189, 248, 0.65));" />

  # 🌊 WATERFALL DOWNLOAD ACCELERATOR (WDM)
  ### The Modern Hybrid Download Suite
  **IDM Multi-Segment Turbo Acceleration × JDownloader 2 Batch LinkGrabber & Crawler**

  <p align="center">
    <a href="https://github.com/KrachDev/WaterFall-Download-Manager--WDM-/releases"><img src="https://img.shields.io/badge/Release-v1.0.0-0ea5e9?style=for-the-badge&logo=github&logoColor=white" alt="Release v1.0.0"></a>
    <a href="https://github.com/KrachDev/WaterFall-Download-Manager--WDM-/releases"><img src="https://img.shields.io/badge/Platform-Windows%2010%20%7C%2011%20(x64)-38bdf8?style=for-the-badge&logo=windows&logoColor=white" alt="Windows Platform"></a>
    <img src="https://img.shields.io/badge/Architecture-Electron%20%7C%20Node.js%20%7C%20Win32-0284c7?style=for-the-badge" alt="Architecture">
    <img src="https://img.shields.io/badge/Engine-32x%20Parallel%20Segments-06b6d4?style=for-the-badge&logo=fastapi&logoColor=white" alt="32x Engine">
    <img src="https://img.shields.io/badge/UI-Tactile%20Obsidian%20Gunmetal-1e293b?style=for-the-badge" alt="Obsidian Gunmetal UI">
    <img src="https://img.shields.io/badge/License-MIT-10b981?style=for-the-badge" alt="License">
  </p>

  <p align="center">
    <b>Ultra-lightweight (<35 MB RAM)</b> • <b>Instant Startup (<1s)</b> • <b>8–32 Stream Multi-Segment Engine</b> • <b>YouTube & Media Studio</b> • <b>Auto Archive Unpacker</b> • <b>OS Library Routing</b>
  </p>

</div>

---

## ⚡ The Philosophy: Why Waterfall?

For over a decade, power users had to compromise between two legacy downloading paradigms:
1. **Internet Download Manager (IDM)**: Incredible multi-stream download speeds and small memory footprint, but trapped in an outdated 1990s Win32 user interface, proprietary closed source, and incapable of deep package crawling or container extraction.
2. **JDownloader 2**: Rich link crawling, package management, and hoster recognition, but weighed down by a monstrous Java JVM runtime that consumes 500 MB – 1.5 GB of RAM, takes 15–30 seconds to launch, and suffers from a laggy Swing interface.

**Waterfall (WDM)** is built from the ground up to synthesize the best of both worlds:
- **IDM's raw power**: Multi-segment chunk acceleration with up to 32 concurrent HTTP range streams, in-place zero-copy file assembly, live speedometer, and dedicated floating single-download progress inspectors.
- **JDownloader's intelligence**: Batch LinkGrabber, recursive web page link extraction, YouTube playlist and video crawling, hoster detection, container packages, and automatic multi-part archive unpacking.
- **Modern Next-Gen Architecture**: A responsive, GPU-accelerated **Tactile Obsidian Gunmetal** interface, instant startup (< 1 second), tiny memory footprint (~35 MB), auto-routing to native Windows libraries, and a seamless companion browser extension.

---

## 📊 Performance Benchmark Comparison

| Metric / Feature | Legacy JDownloader 2 | Legacy IDM | 🌊 **Waterfall (WDM)** |
| :--- | :--- | :--- | :--- |
| **RAM Footprint (Idle)** | ~500 MB – 1.5+ GB *(Java JVM)* | ~25 MB | **~35 MB** *(Node.js optimized engine)* |
| **Cold Startup Time** | 12 – 25 seconds | Instant (<1s) | **< 1 second (Instant)** |
| **Interface Aesthetics** | Legacy Java Swing | 1990s Win32 MFC | **Tactile Obsidian Gunmetal (Glassmorphic Dark)** |
| **Multi-Segment Engine** | Basic sequential chunks | 8–32 parallel streams | **8–32 parallel HTTP Range streams + in-place direct writing** |
| **YouTube & Audio Studio** | Slow plugin / external ffmpeg | Basic browser grabber | **Native `yt-dlp` + `ffmpeg` studio (MP3 320k, FLAC, WAV, MP4 HD)** |
| **OS Library Organization** | Single flat folder | Single flat folder | **Smart routing to `Music`, `Videos`, `Documents`, `Pictures`, etc.** |
| **Metadata Preservation** | Basic | Basic | **Server `Last-Modified` timestamps, ID3 tags, and `.meta.json` sidecars** |
| **LinkGrabber & Crawler** | Yes *(Core strength)* | No *(Single URL only)* | **Yes (Batch paste, deep regex crawler, hoster detection)** |
| **Floating Progress Window** | No | Yes | **Yes (IDM-style single download window with options & connection map)** |
| **Automatic Archive Unpacker**| Plugin / High CPU | No | **Native 7-Zip & NanaZip integration with password vault** |
| **Bandwidth Limiter** | Global toggle | Manual slider | **Dynamic token-bucket limiter + live 60fps throughput speedometer** |
| **Queue Management** | Basic list | Manual queue | **Smart queue, drag-and-drop ordering, column sorting & date tracking** |

---

## 🚀 Key Feature Highlights

### ⚡ 1. Multi-Segment Chunk Acceleration Engine
- Divides files into 8, 16, or 32 dynamic byte-range segments and streams them simultaneously over parallel HTTP/HTTPS sockets.
- Writes incoming chunks directly into pre-allocated sparse disk storage, completely eliminating end-of-download file reassembly lag.
- Resumes broken, interrupted, or paused downloads seamlessly without data loss.

### 🕷️ 2. Batch LinkGrabber & Crawler
- Paste raw blocks of text, HTML source, or lists of links; Waterfall automatically parses and validates all downloadable URLs.
- Groups multipart files, archive sets (`.part1.rar`, `.part2.rar`), and mirrors into cohesive packages.
- Hoster identification recognizes direct download hosters, CDNs, cloud drives, and video platforms.

### 🎵 3. High-Fidelity YouTube & Media Studio
- Native integration with `yt-dlp` and `ffmpeg` for lightning-fast extraction.
- **YouTube Playlists & Full Albums**: Paste any playlist or album link to preview all tracks, select individual songs or download entire discographies in one click.
- **Audiophile Audio Conversion**: 320 kbps MP3, FLAC, AAC, M4A, or WAV with automatic high-resolution album art embedding and ID3 metadata tagging (artist, title, release date, chapters).
- **Video Extraction**: 4K UHD, 1440p QHD, 1080p Full HD with hardware-accelerated video/audio muxing.

### 📦 4. Automated Multi-Part Archive Unpacker
- Automatically unpacks completed archives (`.zip`, `.rar`, `.7z`, `.tar.gz`, `.iso`) using native 7-Zip / NanaZip / `tar.exe`.
- Built-in **Password Vault**: Save extraction passwords; Waterfall will automatically try known passwords during batch extractions.
- Direct clickable `📦 Extracted` badge opens the output folder immediately.

### 🖥️ 5. Mini IDM-Style Download Progress Window
- Separate standalone window for monitoring individual downloads without needing the main window open.
- **Live Transfer Visualizer**: Speedometer, real-time chunk segment bar showing active thread progress, elapsed time, and ETA.
- **Connections Inspector**: Detailed breakdown of each individual download thread, socket state, and bytes received.
- **Options Tab**:
  - Speed Limiter toggle and slider.
  - Automatic archive extraction toggle and custom password field.
  - Completion actions: *Do Nothing*, *Open File*, *Open Folder*, *Sleep PC*, *Shutdown PC*.
  - Post-download custom script runner (PowerShell / Batch script executed on finish).

### 📅 6. Comprehensive Date Tracking & Column Sorting
- **Date Added Badges**: Every entry shows a clean calendar tag (`📅 Today, 4:15 pm • [package] • C:\...`).
- **Date / Est. Finish Column**:
  - Live downloading: Real-time countdown timer (`2m 15s`) with creation date underneath (`Added: Oct 14, 4:15 pm`).
  - Completed: Green completion timestamp (`✓ Oct 14, 4:18 pm`) with creation date.
  - Paused / Queued: Formatted creation date with status pill.
- Interactive column sorting: Sort by Name, Size, Progress, Speed, Status, or Date with ascending/descending order.

### 🛡️ 7. OS Standard Library Auto-Routing
Files are automatically routed to standard Windows user libraries based on content type:

| Content Type | Extensions | Target Library Path |
| :--- | :--- | :--- |
| 🎵 **Music & Audio** | `.mp3`, `.flac`, `.m4a`, `.wav`, `.aac`, `.ogg`, `.opus` | `%USERPROFILE%\Music\Waterfall Music\` |
| 🎬 **Videos** | `.mp4`, `.mkv`, `.avi`, `.webm`, `.mov`, `.wmv` | `%USERPROFILE%\Videos\Waterfall Videos\` |
| 📄 **Documents** | `.pdf`, `.doc`, `.docx`, `.xls`, `.ppt`, `.txt`, `.epub` | `%USERPROFILE%\Documents\Waterfall Documents\` |
| 🖼️ **Pictures** | `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`, `.svg`, `.bmp` | `%USERPROFILE%\Pictures\Waterfall Pictures\` |
| 📦 **Archives** | `.zip`, `.rar`, `.7z`, `.tar`, `.gz`, `.iso` | `%USERPROFILE%\Downloads\Waterfall Compressed\[Package]\` |
| ⚙️ **Programs** | `.exe`, `.msi`, `.apk`, `.bin`, `.dmg` | `%USERPROFILE%\Downloads\Waterfall Programs\[Package]\` |
| 📁 **Other** | All other file types | `%USERPROFILE%\Downloads\Waterfall Other\[Package]\` |

*Custom download locations can also be selected anytime via the download confirmation dialog.*

### 🧩 8. Companion Browser Extension (Chrome & Edge)
- Intercepts browser download events seamlessly.
- Context menu shortcuts:
  - Right-click any link ➔ **Download with Waterfall (IDM Engine)**
  - Right-click any video or audio ➔ **Convert to MP3 (320k HQ) with Waterfall**
- Hold **Ctrl** key while clicking any link to bypass Waterfall and use the browser's native download manager.

---

## 🛠️ Installation & Getting Started

### Method 1: Pre-Built Binary (Recommended)
1. Download the latest `Waterfall-v1.0.0-windows-x64.zip` from the [Releases](https://github.com/KrachDev/WaterFall-Download-Manager--WDM-/releases) page.
2. Extract the archive to any folder (e.g. `C:\Program Files\Waterfall` or your user directory).
3. Run `Waterfall.exe`.
4. *(Optional)* Run the desktop shortcut generator to pin Waterfall to your Desktop and Start Menu:
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\create-desktop-shortcut.ps1
   ```

### Method 2: Running from Source

#### Prerequisites
- [Node.js](https://nodejs.org/) v18+ (LTS recommended)
- Windows 10 or 11 (64-bit)

#### Setup Steps
```powershell
# 1. Clone the repository
git clone https://github.com/KrachDev/WaterFall-Download-Manager--WDM-.git
cd WaterFall-Download-Manager--WDM-

# 2. Install dependencies
npm install

# 3. Launch the desktop application
npm run app
```

#### Additional Run Modes
- **Headless Background Daemon**:
  ```powershell
  npm run daemon
  ```
  Access the web interface at **http://localhost:4567** in any browser.
- **Build Standalone Production Package**:
  ```powershell
  npm run build
  ```
  Creates the standalone distribution package under `dist\Waterfall-win32-x64\Waterfall.exe`.

---

## 🔌 Installing the Browser Extension

1. Open your Chromium-based browser (Google Chrome, Microsoft Edge, Brave, Opera, Vivaldi).
2. Navigate to extensions management:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
3. Enable **Developer mode** toggle in the top-right corner.
4. Click **Load unpacked** and select the `extension/` directory inside the Waterfall folder.
5. The Waterfall extension icon will appear in your browser toolbar, ready to intercept downloads!

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| <kbd>Ctrl</kbd> + <kbd>N</kbd> | Add Direct Download URL |
| <kbd>Ctrl</kbd> + <kbd>L</kbd> | Open Batch LinkGrabber & Crawler |
| <kbd>Ctrl</kbd> + <kbd>Y</kbd> | Open YouTube / Media Converter |
| <kbd>Ctrl</kbd> + <kbd>F</kbd> | Focus Search & Filter Bar |
| <kbd>Ctrl</kbd> + <kbd>A</kbd> | Select All Downloads |
| <kbd>Space</kbd> | Pause / Resume Selected Download |
| <kbd>Delete</kbd> | Remove Selected Download from List |
| <kbd>Shift</kbd> + <kbd>Delete</kbd> | Permanently Delete File from Disk |

---

## 🏗️ Tech Stack & Architecture

- **Core Runtime**: [Electron](https://www.electronjs.org/) + [Node.js](https://nodejs.org/)
- **Backend Architecture**: High-throughput multi-socket streaming engine, Express API, WebSocket real-time telemetry
- **Media Processing**: `yt-dlp` & `ffmpeg` native pipelines
- **Archive Extraction**: 7-Zip & NanaZip command interface + Windows `tar.exe`
- **Frontend Engine**: Pure Vanilla JavaScript (ES6+), Hardware-accelerated CSS3 glassmorphism, JetBrains Mono & Inter typography
- **OS Integration**: Windows Shell integration, Taskbar progress state, System Tray daemon, Win32 Power API

---

## 📄 License

This project is licensed under the [MIT License](LICENSE) — free for personal and commercial use.

<div align="center">
  <sub>Built with ❤️ for speed, efficiency, and aesthetics. WaterFall Download Manager — Rebirth of IDM & JDownloader.</sub>
</div>
