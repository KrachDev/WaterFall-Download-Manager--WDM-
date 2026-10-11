# WATERFALL — Modern IDM & JDownloader Hybrid Suite

An ultra-lightweight, high-performance download manager combining the **streamlined, high-efficiency download queue & multi-segment acceleration of Internet Download Manager (IDM)** with the **deep link crawling, hoster recognition, and package management of JDownloader 2**, plus **native YouTube video/audio stream extraction and high-fidelity MP3/FLAC conversion**.

---

## ⚡ Performance Comparison

| Metric / Feature | Legacy JDownloader 2 | Legacy IDM | **Waterfall** |
| :--- | :--- | :--- | :--- |
| **Memory Footprint** | ~500 MB – 1.5+ GB (Java JVM) | ~25 MB | **~35 MB** (Node.js engine) |
| **Startup Time** | 12 – 25 seconds | Instant | **< 1 second** |
| **User Interface** | Outdated Java Swing | Classic Win32 | **Tactile Obsidian Gunmetal (Modern IDM)** |
| **Multi-Segment Engine** | Basic chunks | 8–32 parallel streams | **8–32 parallel HTTP Range streams + in-place direct writing** |
| **YouTube & MP3 Converter** | Slow plugin / external ffmpeg | Basic browser grabber | **Native `yt-dlp` + `ffmpeg` converter (MP3 320k, M4A, FLAC, WAV, MP4)** |
| **OS Library Organization** | Single flat folder | Basic downloads folder | **Auto-routed to standard OS folders (`Music`, `Videos`, `Documents`, `Pictures`, `Downloads`)** |
| **Metadata Preservation** | Basic | Basic | **Server `Last-Modified` timestamps, ID3 tags, and `.meta.json` sidecars (with SHA256)** |
| **LinkGrabber & Crawler** | Yes (Core strength) | No (single link only) | **Yes (Batch paste, regex extractor, hoster detection)** |
| **Bandwidth Limiter** | Yes | Yes | **Dynamic token-bucket limiter + live 60fps graph** |

---

## 📂 OS Standard Library Routing & Structure

Files are automatically routed to standard Windows user libraries based on file type and package:

| Content Type | File Extensions | Target OS Folder | Example Target Path |
| :--- | :--- | :--- | :--- |
| **Music & Audio** | `.mp3`, `.flac`, `.m4a`, `.wav`, `.aac`, `.ogg`, `.opus` | `%USERPROFILE%\Music\Waterfall Music\` | `C:\Users\...\Music\Waterfall Music\song.mp3` |
| **Videos** | `.mp4`, `.mkv`, `.avi`, `.webm`, `.mov`, `.wmv` | `%USERPROFILE%\Videos\Waterfall Videos\` | `C:\Users\...\Videos\Waterfall Videos\video.mp4` |
| **Documents** | `.pdf`, `.doc`, `.docx`, `.xls`, `.ppt`, `.txt`, `.epub` | `%USERPROFILE%\Documents\Waterfall Documents\` | `C:\Users\...\Documents\Waterfall Documents\doc.pdf` |
| **Pictures** | `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`, `.svg`, `.bmp` | `%USERPROFILE%\Pictures\Waterfall Pictures\` | `C:\Users\...\Pictures\Waterfall Pictures\image.png` |
| **Archives** | `.zip`, `.rar`, `.7z`, `.tar`, `.gz`, `.iso`, `.pkg` | `%USERPROFILE%\Downloads\Waterfall Compressed\` | `C:\Users\...\Downloads\Waterfall Compressed\[Package]\archive.zip` |
| **Programs** | `.exe`, `.msi`, `.apk`, `.bin`, `.dmg`, `.appimage` | `%USERPROFILE%\Downloads\Waterfall Programs\` | `C:\Users\...\Downloads\Waterfall Programs\[Package]\app.exe` |
| **Other** | All unrecognized extensions | `%USERPROFILE%\Downloads\Waterfall Other\` | `C:\Users\...\Downloads\Waterfall Other\[Package]\file.dat` |

*When a package name is supplied (e.g., from JDownloader LinkGrabber batch grouping), files are cleanly nested in a dedicated subfolder for that package.*

---

## 🛡️ Metadata Preservation System

1. **Remote Server Timestamps**: Captures HTTP `Last-Modified` headers and synchronizes file system modification time (`mtime`) and access time (`atime`) using `fs.utimesSync`.
2. **Audio & Video Tagging**: Uses `yt-dlp` and `ffmpeg` with `--mtime`, `--embed-metadata`, `--embed-thumbnail`, and `--embed-chapters` to preserve upload dates, album art, artists, and chapter markers.
3. **Cryptographic Metadata Sidecars (`.meta.json`)**: Every downloaded file generates a companion `.meta.json` sidecar storing source URL, hoster name, category, exact byte size, and SHA-256 hash.

---

## 🛠️ How to Launch

### Option 1: Optimized Native Desktop App (Electron)
Double-click `start.bat` or run:
```powershell
npm run app
```
- **In-Process Server:** Express and WebSocket daemon hosted directly inside Electron's main process.
- **V8 Heap Capping (`--max-old-space-size=128`):** Aggressive garbage collection to prevent memory creep.
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
Then visit **http://localhost:4567** in any browser.

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
- Waterfall crawls the full tracklist and displays title, duration, and track selectors.
- Convert all tracks to high-bitrate MP3 (320k), FLAC, or Full HD video in 1 click with automatic ID3 tagging and embedded artwork.

---

## 🧩 Browser Companion Extension
Load unpacked extension directly into Edge or Chrome (`edge://extensions` or `chrome://extensions`):
- Right-click any web link ➔ **Download with Waterfall (IDM Engine)**
- Right-click any video or audio ➔ **Convert to MP3 (320k HQ) with Waterfall**
- Hold **Ctrl** while clicking a link to force native browser download.
