# HYDRA — Modern IDM & JDownloader Hybrid Suite

An ultra-lightweight, high-performance download manager combining the **streamlined, high-efficiency download queue & multi-segment acceleration of Internet Download Manager (IDM)** with the **deep link crawling, hoster recognition, and package management of JDownloader 2**, plus **native YouTube video/audio stream extraction and high-fidelity MP3/FLAC conversion**.

---

## ⚡ Performance Comparison

| Metric / Feature | Legacy JDownloader 2 | Legacy IDM | **Hydra** |
| :--- | :--- | :--- | :--- |
| **Memory Footprint** | ~500 MB – 1.5+ GB (Java JVM) | ~25 MB | **~35 MB** (Node.js engine) |
| **Startup Time** | 12 – 25 seconds | Instant | **< 1 second** |
| **User Interface** | Outdated Java Swing (cramped, grey) | Classic Win32 | **Tactile Obsidian Gunmetal (Modern IDM)** |
| **Multi-Segment Engine** | Basic chunks | 8–32 parallel streams | **8–32 parallel HTTP Range streams + 50-cell memory block matrix** |
| **YouTube & MP3 Converter** | Slow plugin / external ffmpeg | Basic browser grabber | **Native `yt-dlp` + `ffmpeg` converter (MP3 320k, M4A, FLAC, WAV, MP4)** |
| **OS Library Organization** | Single flat folder | Basic downloads folder | **Auto-routed to standard OS folders (`Music`, `Videos`, `Documents`, `Pictures`, `Downloads/App DataType`)** |
| **Metadata Preservation** | Basic | Basic | **Server `Last-Modified` timestamps, ID3 tags, and `.meta.json` sidecars (with SHA256)** |
| **LinkGrabber & Crawler** | Yes (Core strength) | No (single link only) | **Yes (Batch paste, regex extractor, hoster detection)** |
| **Bandwidth Limiter** | Yes | Yes | **Dynamic token-bucket limiter + live 60fps graph** |

---

## 📂 OS Standard Library Routing & Structure

Files are automatically routed to standard Windows user libraries based on file type and package:

| Content Type | File Extensions | Target OS Folder | Example Target Path |
| :--- | :--- | :--- | :--- |
| **Music & Audio** | `.mp3`, `.flac`, `.m4a`, `.wav`, `.aac`, `.ogg`, `.opus` | `%USERPROFILE%\Music\Hydra Music\` | `C:\Users\...\Music\Hydra Music\song.mp3` |
| **Videos** | `.mp4`, `.mkv`, `.avi`, `.webm`, `.mov`, `.wmv` | `%USERPROFILE%\Videos\Hydra Videos\` | `C:\Users\...\Videos\Hydra Videos\video.mp4` |
| **Documents** | `.pdf`, `.doc`, `.docx`, `.xls`, `.ppt`, `.txt`, `.epub` | `%USERPROFILE%\Documents\Hydra Documents\` | `C:\Users\...\Documents\Hydra Documents\doc.pdf` |
| **Pictures** | `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`, `.svg`, `.bmp` | `%USERPROFILE%\Pictures\Hydra Pictures\` | `C:\Users\...\Pictures\Hydra Pictures\image.png` |
| **Archives** | `.zip`, `.rar`, `.7z`, `.tar`, `.gz`, `.iso`, `.pkg` | `%USERPROFILE%\Downloads\Hydra Compressed\` | `C:\Users\...\Downloads\Hydra Compressed\[Package]\archive.zip` |
| **Programs** | `.exe`, `.msi`, `.apk`, `.bin`, `.dmg`, `.appimage` | `%USERPROFILE%\Downloads\Hydra Programs\` | `C:\Users\...\Downloads\Hydra Programs\[Package]\app.exe` |
| **Other** | All unrecognized extensions | `%USERPROFILE%\Downloads\Hydra Other\` | `C:\Users\...\Downloads\Hydra Other\[Package]\file.dat` |

*When a package name is supplied (e.g., from JDownloader LinkGrabber batch grouping), files are cleanly nested in a dedicated subfolder for that package.*

---

## 🛡️ Metadata Preservation System

1. **Remote Server Timestamps**: Captures HTTP `Last-Modified` headers and synchronizes file system modification time (`mtime`) and access time (`atime`) using `fs.utimesSync`.
2. **Audio & Video Tagging**: Uses `yt-dlp` and `ffmpeg` with `--mtime`, `--embed-metadata`, `--embed-thumbnail`, and `--embed-chapters` to preserve upload dates, album art, artists, and chapter markers.
3. **Cryptographic Metadata Sidecars (`.meta.json`)**: Every downloaded file generates a companion `.meta.json` sidecar storing:
   - Source URL & Direct Download Mirror
   - Hoster name
   - Category & Package group
   - Exact byte size
   - Download ISO timestamp
   - Cryptographic SHA-256 integrity hash

---

## 🛠️ How to Launch

### Option 1: Optimized Native Desktop App (Electron)
Double-click [start.bat](file:///c:/Users/Kracher.Krach/Documents/Jdownloader%20rebirth/start.bat) or run:
```powershell
npm run app
```
- **In-Process Server:** Express and WebSocket daemon hosted directly inside Electron's main process (no duplicate Node processes).
- **V8 Heap Capping (`--max-old-space-size=128`):** Aggressive garbage collection to prevent memory creep.
- **Spellcheck & Background Subsystems Disabled:** Saves ~30 MB RAM by stripping Chromium dictionary and crash analytics.
- **Windows Taskbar Live Progress Bar:** Real-time green download progress indicator directly on the Windows taskbar icon.
- **System Tray:** Minimize-to-tray with double-click restore, Pause/Resume all, and clean exit.

### Option 2: Desktop Shortcut
Create a direct shortcut on your Windows desktop:
```powershell
npm run shortcut
```

### Option 3: Headless Daemon (Web UI)
```powershell
npm run daemon
```
Then visit **[http://localhost:4567](http://localhost:4567)** in any browser.

---

## 📦 Automatic Archive Unpacker
- Automatically unpacks completed archives (`.zip`, `.rar`, `.7z`, `.tar.gz`, `.iso`) using native NanaZip/7-Zip and Windows built-in `tar.exe`.
- Creates dedicated destination directories with clickable `📦 Extracted` badges.
- Can also be triggered on-demand via right-click on any archive item in the download list.

---

## ⚡ IDM Power Management ("Turn Off When Done")
- Located directly in the top header toolbar:
  - **Do Nothing**: Keeps system running.
  - **💤 Sleep PC**: Suspends computer into sleep state when download queue completes.
  - **⚡ Shutdown PC**: Triggers graceful 60-second system shutdown when queue completes (abortable via `shutdown /a`).

---

## 🎵 YouTube Playlists & Albums Extraction
- Paste any YouTube playlist or album URL into the **YouTube / MP3** modal.
- Hydra crawls the full tracklist and displays title, duration, and track selectors.
- Convert all tracks to high-bitrate MP3 (320k), FLAC, or Full HD video in 1 click with automatic ID3 tagging and embedded artwork.

---

## 🧩 Browser Companion Extension
Load unpacked extension directly into Edge or Chrome (`edge://extensions` or `chrome://extensions`):
- Right-click any web link ➔ **Download with Hydra (IDM Engine)**
- Right-click any video or audio ➔ **Convert to MP3 (320k HQ) with Hydra**
- See [extension/README.md](file:///c:/Users/Kracher.Krach/Documents/Jdownloader%20rebirth/extension/README.md) for quick setup guide.

