# 🌊 WATERFALL DOWNLOAD ACCELERATOR (WDM)
## Complete Feature, UI/UX, Behavioral & Technical Specification
### Architecture Blueprint for High-Performance Native C++ Rebuild

---

## 📑 Table of Contents
1. [Executive Summary & Instability Root-Cause Analysis](#1-executive-summary--instability-root-cause-analysis)
2. [High-Level Architecture & C++ Target Blueprint](#2-high-level-architecture--c-target-blueprint)
3. [Core Download Engine & Multi-Segment Acceleration](#3-core-download-engine--multi-segment-acceleration)
4. [LinkGrabber, Crawler & Hoster Extraction System](#4-linkgrabber-crawler--hoster-extraction-system)
5. [YouTube & Media Processing Studio](#5-youtube--media-processing-studio)
6. [Multi-Part Archive Grouping & Decompression Engine](#6-multi-part-archive-grouping--decompression-engine)
7. [Queue Management, Priority Scheduling & Fault Tolerance](#7-queue-management-priority-scheduling--fault-tolerance)
8. [Storage, File System & OS Library Auto-Routing](#8-storage-file-system--os-library-auto-routing)
9. [Post-Download Script Automation Engine](#9-post-download-script-automation-engine)
10. [Companion Browser Extension & Interception Protocols](#10-companion-browser-extension--interception-protocols)
11. [Complete UI Inventory: Screens, Modals & Every Button Behavior](#11-complete-ui-inventory-screens-modals--every-button-behavior)
12. [State Schema, API Endpoints & IPC Specifications](#12-state-schema-api-endpoints--ipc-specifications)
13. [Recommended C++ Technology Stack & Implementation Roadmap](#13-recommended-c-technology-stack--implementation-roadmap)

---

## 1. Executive Summary & Instability Root-Cause Analysis

### 1.1 Why the Current Architecture is Unstable
The current implementation of Waterfall (WDM) is an Electron + Node.js application attempting to perform ultra-high-throughput multi-socket network downloads, sparse disk writes, process memory compaction, and process orchestration on Windows. This hybrid architecture suffers from severe structural bottlenecks:

1. **V8 Garbage Collection Stalls & Buffer Thrashing**:
   - At gigabit download speeds across 32 concurrent HTTP sockets, Node.js allocates tens of thousands of `Buffer` chunks per second. V8 garbage collection pauses (Stop-The-World) cause socket buffer overflows, stalled network connections, and dropped chunks.
2. **Aggressive Working Set Trimming Side-Effects**:
   - The app periodically invokes `waterfall-trim.exe` (`EmptyWorkingSet` Win32 API) every 10 seconds to artificially force RAM under 35 MB. This flushes active working memory to the Windows page file, causing massive hard page faults, frame stutter, and intermittent process freezing whenever the UI or network threads access paged-out memory.
3. **Windows NTFS File Descriptor Lock Contention**:
   - The in-place zero-assembly writing engine shares open file descriptors (`fs.openSync`) across concurrent async workers. On Windows NTFS, concurrent uncoordinated writes and atomic renames (`fs.renameSync`) frequently trigger `EBUSY` / `EPERM` lock violations, especially when anti-virus or Windows Search Indexer intercepts open handles.
4. **Child Process Spawning Overhead**:
   - Calling `powershell.exe` for Action Center toasts (`send_os_toast.ps1`), file icons (`get_app_icon.ps1`), and folder browsing spawns full .NET/PowerShell runtimes consuming 40–80 MB of RAM and 300–600ms of CPU time per call.
5. **WebSocket Telemetry Serialization Overhead**:
   - The backend serializes full JSON snapshots of all active tasks every 250ms over WebSocket (`/ws`). As queue sizes grow to hundreds of items, JSON stringification and IPC messaging saturate the event loop.
6. **Fragile JSON State Persistence**:
   - State is stored in flat JSON files (`downloads.json`, `config.json`). File corruption risks during unexpected power loss, shutdown, or concurrent writes require `.bak` fallback hacks.

### 1.2 The Native C++ Solution
Rebuilding Waterfall in native **C++20 (Windows x64)** resolves 100% of these failure points:
- **Zero-Copy Network & Disk Pipeline**: Win32 I/O Completion Ports (`IOCP`) or `libcurl` multi-interface piping directly into pre-allocated sparse files with Win32 `SetFilePointerEx` / `SetEndOfFile`.
- **True Flat Memory Footprint**: Deterministic memory management without a runtime GC. Memory usage remains stable at **8–15 MB RAM** even under 32-stream multi-gigabit saturating loads.
- **Native Win32 Shell & Notification APIs**: Direct calls to `ITaskbarList3`, `Shell_NotifyIconW`, `SHGetFileInfoW`, and Windows Action Center WinRT Toast APIs (`Windows.UI.Notifications`) with **0ms latency** and **0 child process overhead**.
- **ACID State Persistence**: Embedded **SQLite3** in WAL (Write-Ahead Logging) mode, providing atomic, crash-proof task state management.

---

## 2. High-Level Architecture & C++ Target Blueprint

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           WATERFALL C++ ARCHITECTURE                        │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
        ┌─────────────────────────────┴─────────────────────────────┐
        ▼                                                           ▼
┌──────────────────────────────┐            ┌──────────────────────────────┐
│     GUI / PRESENTATION       │            │         CORE ENGINE          │
│  (Qt 6 C++20 / QWidgets)     │◄──Signals──┤   (Multithreaded C++ Core)   │
│  - Tactile Obsidian Theme    │   Events   │  - Task Scheduler & Queue    │
│  - Main Window & Tree View   │            │  - Segment Allocation Mgr    │
│  - Floating Progress Window  │            │  - Bandwidth Limiter (Bucket)│
│  - Confirmation Dialog Modal │            │  - Archive Unpacker Worker   │
│  - 60 FPS Speedometer Graph  │            │  - Media / yt-dlp Pipeline   │
└──────────────────────────────┘            └──────────────┬───────────────┘
        │                                                  │
        │ Win32 Native Shell                               ▼ Win32 IOCP / libcurl
┌───────┴──────────────────────┐            ┌──────────────────────────────┐
│      WIN32 OS INTEGRATION    │            │     STORAGE & NETWORK I/O    │
│  - Taskbar Progress (ITaskbar)│           │  - Multi-Socket Range Engine │
│  - System Tray & Balloon     │            │  - Sparse File Pre-Allocator │
│  - Native WinRT Toast Notifs │            │  - Atomic Disk Finalizer     │
│  - Shell Associations/Icons  │            │  - SQLite3 WAL DB Storage    │
└──────────────────────────────┘            └──────────────┬───────────────┘
                                                           │
                                                           ▼ HTTP / WS Loopback
                                            ┌──────────────────────────────┐
                                            │ LOCAL EMBEDDED REST SERVER   │
                                            │ (Port 4567, httplib / Crow)  │
                                            │ - Browser Extension Bridge   │
                                            │ - Click'n'Load / FlashGot    │
                                            └──────────────────────────────┘
```

---

## 3. Core Download Engine & Multi-Segment Acceleration

### 3.1 Network Range Detection & Handshake
1. **Probe Phase**:
   - Issues an HTTP `HEAD` request with `User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) WaterfallDL/2.0`.
   - If the server rejects `HEAD` or returns `405 Method Not Allowed`, immediately falls back to `GET` with header `Range: bytes=0-0`.
2. **Capability Assessment**:
   - Inspects `Accept-Ranges: bytes` or `Content-Range: bytes 0-0/12345678`.
   - Extracts total file size from `Content-Range` denominator or `Content-Length`.
   - If `Content-Range` is present, `acceptRanges = true`.
   - If server returns `200 OK` ignoring the Range header, `acceptRanges = false`, and engine automatically downgrades to a single continuous stream.
   - Preserves `Last-Modified` server header for filesystem modification timestamp sync.

### 3.2 Segment Allocation Matrix
- **Configurable Parallel Streams**: 1 (Single Stream), 8, 16, or 32 threads.
- **Dynamic Byte Splitting**:
  $$\text{ChunkSize} = \left\lfloor \frac{\text{TotalBytes}}{N} \right\rfloor$$
  - Segment $i$ ranges from $i \times \text{ChunkSize}$ to $(i+1) \times \text{ChunkSize} - 1$.
  - The final segment $N-1$ spans up to $\text{TotalBytes} - 1$ to capture any remainder bytes.
- **Threshold Rule**: If total size $\le 256 \text{ KB}$ or server does not support byte ranges, force single stream ($N=1$).

### 3.3 Storage Write Modes
1. **`inPlace` Mode (Zero-Assembly / Pre-allocated Sparse File) - Primary Mode**:
   - Creates `[filename].part` in the target folder.
   - Pre-allocates file size using sparse allocation (`ftruncate` / Win32 `SetEndOfFile`) to eliminate disk fragmentation.
   - Each download worker streams chunks directly into its assigned byte offset without intermediate temporary segment files.
   - **Batching Buffer**: Sockets write into an in-memory 256 KB buffer before issuing asynchronous disk writes to minimize system call overhead.
   - **Zero Reassembly Lag**: When all segments reach 100%, the file is already complete in-place. The engine flushes open handles and atomically renames `[filename].part` $\to$ `[filename]`.
2. **`singleStream` Mode (Whole File / Stream Buffer)**:
   - Used for live YouTube streaming, non-resumable servers, or small payloads.
3. **`legacyTemp` Mode (Staged Merging)**:
   - Downloads segments into separate files: `%TEMP%\Waterfall\chunks\[id]_seg_[i].part`.
   - Merges sequentially at completion into the target file, then unlinks parts.

### 3.4 Resumption & Fault Tolerance
- **Sidecar Metadata File (`.meta.json` in Temp)**:
  - Saved in `%LOCALAPPDATA%\Waterfall\metadata\[task-id].meta.json` (never polluting user's download directory).
  - Persists: `startByte`, `endByte`, `downloadedBytes`, `status` for each segment.
- **Socket Stall Watchdog**:
  - A 25-second watchdog timer monitors each socket. If zero bytes are received for 25s, the socket is forcibly aborted and auto-reconnected at the exact current disk offset.
- **Auto-Reconnection**:
  - Exponential backoff ($1\text{s}, 2\text{s}, 3\text{s}, 5\text{s}$) up to 5 retries on transient connection resets (`ECONNRESET`, `ETIMEDOUT`).
- **HTTP 401/403/410/416 Expiration Recovery**:
  - Automatically invokes the crawler engine to retrieve a fresh direct CDN URL from the origin link and resumes seamlessly without user intervention.

### 3.5 Token-Bucket Bandwidth Limiter
- Dynamically throttles download sockets when speed limit is enabled.
- Divides global limit by active segment threads:
  $$\text{ThreadCap} = \max\left(8192, \left\lfloor \frac{\text{GlobalCap}}{N_{\text{active}}} \right\rfloor\right)$$
- Uses micro-sleep delays between chunk flushes to enforce the target throughput curve smoothly without jitter.

---

## 4. LinkGrabber, Crawler & Hoster Extraction System

### 4.1 Input Text Ingestion & Parsing
The LinkGrabber accepts unformatted blocks of text, HTML source code, Markdown, or BBCode:
1. **HTML Entity Unescaping**: Decodes `&amp;`, `&quot;`, `&#39;`, `&lt;`, `&gt;`.
2. **BBCode Extraction**: Resolves `[url=TARGET]text[/url]` and `[url]TARGET[/url]`.
3. **Markdown Extraction**: Resolves `[text](TARGET)`.
4. **HTML Anchor Parsing**: Extracts `href` and `data-url` attributes from `<a>`, `<button>`, and `<div>`.
5. **Plaintext URL Pattern Matcher**: Cleans punctuation wrappers (`(`, `)`, `<`, `>`, `"`).

### 4.2 Deep Webpage Crawler
- If a target URL returns `text/html` instead of a binary file, the crawler fetches the page with an automated Chromium User-Agent.
- Scrapes the document for downloadable file extensions (`.zip`, `.rar`, `.7z`, `.iso`, `.exe`, `.mp4`, `.mp3`, etc.) and recognized hoster domains.
- Extracts page title (`<title>`) and automatically groups extracted items under that package name.

### 4.3 Container Decrypter & Pastes
- **Pastebin**: Detects `pastebin.com/[id]`, fetches raw text from `pastebin.com/raw/[id]`, extracts all enclosed URLs.
- **Rentry**: Detects `rentry.co/[id]`, fetches `rentry.co/raw/[id]`.

### 4.4 Hoster Resolution Architecture
Waterfall implements a modular plugin architecture for hosters:
| Hoster | Detection Pattern | Resolution Behavior |
| :--- | :--- | :--- |
| **Gofile** | `gofile.io/d/[id]` | Calls Gofile API (`/contents/[id]`), retrieves file listing, tokens, and direct CDN links. Supports multi-file folders as a package. |
| **Pixeldrain** | `pixeldrain.com/u/[id]` or `/l/[id]` | Single file: `/api/file/[id]`. Album/List: queries `/api/list/[id]`, extracts all items into a unified package. |
| **Archive.org** | `archive.org/details/[id]` | Queries Metadata API (`/metadata/[id]`), lists all files, builds direct download URLs with server headers. |
| **Transfer.it** | `transfer.it/[id]` | Parses download token and redirects to direct file stream. |
| **FuckingFast** | `fuckingfast.co/[id]` | Extracts direct CDN download button and solves initial redirection. |
| **Krakenfiles** | `krakenfiles.com/view/[id]` | Scrapes direct download token from webpage form. |
| **Buzzheavier** | `buzzheavier.com/[id]` | Scrapes direct file CDN URL. |
| **MediaFire** | `mediafire.com/file/[id]` | Scrapes direct `downloadButton` link. |
| **Google Drive** | `drive.google.com/file/d/[id]` | Converts to direct export URL: `drive.google.com/uc?export=download&id=[id]`. |
| **Dropbox** | `dropbox.com/s/[id]` | Converts `dl=0` $\to$ `dl=1` for immediate direct HTTP streaming. |
| **Catbox** | `files.catbox.moe/[id]` | Direct HTTP access. |
| **Universal Bridge**| Any media link | Fallback to `yt-dlp --dump-single-json` supporting 1,800+ sites. |

---

## 5. YouTube & Media Processing Studio

### 5.1 Pipeline Architecture
Waterfall uses an integrated native media pipeline utilizing embedded `yt-dlp` and `ffmpeg`:
1. **Probe**: Queries media metadata via `yt-dlp --dump-json --no-warnings`.
2. **Download & Extraction**:
   - **Audio Mode**: `yt-dlp -x --audio-format [fmt] --audio-quality [qual] --embed-thumbnail --embed-metadata --paths temp:[tempDir]`.
   - **Video Mode**: `yt-dlp -f [format_spec] --merge-output-format mp4 --embed-metadata --embed-thumbnail --embed-chapters`.
3. **Format Options**:
   - `mp3-320`: MP3 High Quality (320 kbps VBR best)
   - `mp3-192`: MP3 Standard (192 kbps)
   - `m4a-best`: M4A / AAC (Apple Quality)
   - `flac-lossless`: FLAC Lossless
   - `wav-lossless`: WAV Uncompressed
   - `mp4-1080`: Full HD 1080p
   - `mp4-720`: HD 720p
   - `mp4-best`: Best available UHD / 4K

### 5.2 Playlist & Album Batch Crawler
- Detects `list=[id]` or `/playlist` in URL.
- Invokes `yt-dlp --dump-single-json --flat-playlist` to fetch track lists within 1–2 seconds.
- Displays modal preview with thumbnails, track durations, artist, and track selection checkboxes.
- Enqueues batch tasks with playlist metadata: `{ playlistId, name, totalTracks, index }`.

### 5.3 Background Stream Pre-Resolver
- Resolves queued media stream URLs in advance so downloads begin instantly when worker slots open up, eliminating startup latency.

### 5.4 Live In-Progress Streaming ("Watch as you download")
- Embedded HTTP partial content streamer (`/api/downloads/:id/stream`):
  - Listens for HTTP `Range` requests from video players.
  - Pipes data from `.part` file currently growing on disk.
  - Supports seeking within already-downloaded byte ranges.
  - Includes UI button: **"▶ Watch as Download Starts"** to launch internal player or external VLC.

---

## 6. Multi-Part Archive Grouping & Decompression Engine

### 6.1 Multipart Detection Heuristics
Archives are classified into cohesive multipart packages using regex parsing:
1. `name.part01.rar`, `name.part02.rar` $\to$ Group: `name`, Part: $1, 2, \dots$
2. `name.7z.001`, `name.7z.002` $\to$ Group: `name`, Part: $1, 2, \dots$
3. `name.z01`, `name.z02`, `name.zip` $\to$ Group: `name`, Span zip set.
4. `name.r00`, `name.r01`, `name.rar` $\to$ Group: `name`, Legacy rar set.
*Guard: Video files (`.mp4`, `.mkv`, etc.) are explicitly excluded from archive grouping.*

### 6.2 Multipart Sequencing & Auto-Force
- Parts belonging to the same group are scheduled contiguously in order (`part1` $\to$ `part2` $\to$ `part3`).
- **Waiting All Parts State**: When a part finishes, it enters status `waiting_all_parts` if siblings are still downloading.
- **Auto-Force Timeout (20s)**: If parts stall or have gaps (e.g. user selected parts 1, 3, 5), a 20-second timer auto-forces download of remaining parts or triggers extraction of available parts.
- **Root Part Identification**: Determines the primary entry archive part (`findRootArchivePart`) to hand to the decompressor.

### 6.3 Extraction Execution & Password Vault
- **Tool Hierarchy**:
  1. `7z.exe` / `NanaZipC.exe` (handles `.rar`, `.7z`, `.zip`, multipart)
  2. Built-in `tar.exe` (Windows 10/11 native)
  3. PowerShell `Expand-Archive` (fallback for `.zip`)
- **Password Vault**:
  - Tries blank password first (`-p-`).
  - If password is required, automatically tries all passwords saved in configuration vault (`archivePasswords` array).
  - If all fail, flags task with `extractPasswordRequired` and triggers UI prompt.
  - Supports **"Remember Password"** checkbox to persist successful passwords into vault.
- **Post-Extraction Cleanup**:
  - If `deleteArchiveAfterExtract` is enabled, all archive part files are securely unlinked upon successful decompression.
- **UI Interaction**:
  - Displays clickable `📦 Extracted` badge next to completed tasks that opens the extracted folder in Windows Explorer.

---

## 7. Queue Management, Priority Scheduling & Fault Tolerance

### 7.1 Queue Scheduling Logic
- **Concurrency Caps**:
  - `maxConcurrentDownloads`: Total active downloads (default: 3).
  - `maxConcurrentPerHost`: Maximum parallel tasks against the same domain (default: 2, media hosts boosted to 4).
- **Priority Weights**:
  - `high`: Weight 3
  - `normal`: Weight 2
  - `low`: Weight 1
- **Sorting Hierarchy for Next Task**:
  1. Priority level descending
  2. Multipart group sequencing (keeps group parts together in order)
  3. User custom queue order index
  4. Added timestamp ascending

### 7.2 Interactive Queue Reordering
- API & UI actions: `move-top`, `move-up`, `move-down`, `move-bottom`, and drag-and-drop index reordering.
- Emits real-time `queueReordered` event to synchronize UI rows.

### 7.3 Power Actions on Completion
- User can configure post-queue system behavior:
  - `none`: Do nothing (default).
  - `sleep`: Invokes `powrprof.dll,SetSuspendState 0,1,0`.
  - `shutdown`: Invokes `shutdown.exe /s /t 60 /c "Waterfall queue finished..."` (with 60-second cancel window via `shutdown /a`).

---

## 8. Storage, File System & OS Library Auto-Routing

### 8.1 OS Standard Library Auto-Routing
Files are automatically organized into Windows user libraries:
| Category | File Extensions | Destination Library Folder |
| :--- | :--- | :--- |
| **Music / Audio** | `.mp3`, `.flac`, `.m4a`, `.wav`, `.aac`, `.ogg`, `.opus`, `.alac` | `%USERPROFILE%\Music\Waterfall Music\[Package]\` |
| **Videos** | `.mp4`, `.mkv`, `.avi`, `.webm`, `.mov`, `.wmv`, `.flv`, `.m4v` | `%USERPROFILE%\Videos\Waterfall Videos\[Package]\` |
| **Documents** | `.pdf`, `.doc`, `.docx`, `.xls`, `.xlsx`, `.ppt`, `.pptx`, `.txt`, `.epub`| `%USERPROFILE%\Documents\Waterfall Documents\` |
| **Pictures** | `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`, `.svg`, `.bmp`, `.ico` | `%USERPROFILE%\Pictures\Waterfall Pictures\` |
| **Compressed** | `.zip`, `.rar`, `.7z`, `.tar`, `.gz`, `.bz2`, `.xz`, `.iso`, `.pkg` | `%USERPROFILE%\Downloads\Waterfall Compressed\[Package]\` |
| **Programs** | `.exe`, `.msi`, `.apk`, `.bin`, `.dmg`, `.appimage`, `.deb`, `.rpm` | `%USERPROFILE%\Downloads\Waterfall Programs\[Package]\` |
| **Other** | All unrecognized file extensions | `%USERPROFILE%\Downloads\Waterfall Other\[Package]\` |

### 8.2 Duplicate Handling Rules
When an incoming download matches an existing filename:
- **`rename`**: Appends incremental suffix `[name] (1).ext`, `[name] (2).ext`.
- **`overwrite`**: Replaces existing disk file.
- **`skip`**: Ignores task.
- **Resume Existing**: If an incomplete download matches the URL/file on disk, auto-updates direct URL and resumes without duplicating.

### 8.3 File Metadata Preservation
- Sets target file `mtime` (modified timestamp) to remote server `Last-Modified` date header.
- Calculates streaming SHA-256 hash upon completion for file integrity verification.

---

## 9. Post-Download Script Automation Engine

### 9.1 Script Trigger Conditions
- Trigger on **100% completion** OR intermediate percentage milestone (`triggerAtPercent`, e.g. 80%).
- Filter by category: `all`, `video`, `audio`, `compressed`, `programs`, `documents`.

### 9.2 Interpreters Supported
- **Auto-Detect**: Based on script extension (`.py` $\to$ Python, `.ps1` $\to$ PowerShell, `.bat` $\to$ Cmd, `.js` $\to$ Node).
- **Explicit**: User-specified compiler/executable (e.g. `C:\Python312\python.exe`).

### 9.3 Placeholder Substitutions
| Token | Replaced Value | Example |
| :--- | :--- | :--- |
| `%FILE%` | Full path to downloaded file | `C:\Downloads\file.zip` |
| `%DIR%` | Containing directory path | `C:\Downloads\` |
| `%NAME%` | File name with extension | `file.zip` |
| `%URL%` | Origin download URL | `https://example.com/file.zip` |
| `%SIZE%` | Total file size in bytes | `104857600` |
| `%CATEGORY%` | Content category | `Compressed` |
| `%STATUS%` | Task status | `completed` |

---

## 10. Companion Browser Extension & Interception Protocols

### 10.1 Browser Interception Engine
- Intercepts Chrome / Edge `chrome.downloads.onCreated` events.
- Evaluates file extension against configurable whitelist (38 extensions).
- Compares size against minimum threshold (default: 500 KB) to prevent capturing small web assets.
- Cancels browser native download and dispatches URL, headers, and referrer to Waterfall local daemon (`http://127.0.0.1:4567/api/downloads`).
- **Bypass Key**: Holding **Ctrl** or **Alt** bypasses Waterfall and lets browser download natively.

### 10.2 Context Menus
- Right-click any link $\to$ **"Download with Waterfall (IDM Engine)"**.
- Right-click video/audio/page $\to$ **"Convert to MP3 (320k HQ) with Waterfall"**.

### 10.3 FlashGot & Click'n'Load Compatibility
- Implements standard JDownloader / FlashGot loopback endpoints:
  - `POST /flashgot` & `POST /flash/add`: Ingests batch links from browser download managers.
  - `GET /jdcheck.js`: Returns `jdownloader=true; var version="Waterfall 1.0.0";`.
  - `GET /crossdomain.xml`: Permissive cross-domain policy for web button integrations.

---

## 11. Complete UI Inventory: Screens, Modals & Every Button Behavior

### 11.1 Main Window (`index.html` & `app.js`)

#### Top Command Toolbar
| UI ID | Label / Icon | Action / Behavior |
| :--- | :--- | :--- |
| `btn-add-url` | **Add Download** | Opens unified Download Source dialog (Ctrl+N). |
| `btn-add-dropdown-toggle` | Chevron ($\triangledown$) | Opens dropdown menu with direct links: Direct URL, YouTube Converter, Batch LinkGrabber. |
| `menu-add-direct` | Direct URL Download | Opens Add URL Modal directly in Direct URL tab. |
| `menu-add-youtube` | YouTube / Media Converter | Opens Add URL Modal in YouTube conversion tab. |
| `menu-add-grabber` | Batch LinkGrabber | Switches workspace to JDownloader LinkGrabber view (Ctrl+L). |
| `btn-resume-all` | **Resume All** | Sends `POST /api/downloads/resume-all`, transitions all paused tasks to queued/downloading. |
| `btn-pause-all` | **Pause All** | Sends `POST /api/downloads/pause-all`, gracefully pauses all active threads and flushes disk buffers. |
| `btn-clear-completed` | **Clear Done** | Sends `POST /api/downloads/clear-completed`, removes finished tasks from UI queue (leaves files on disk). |
| `btn-toolbar-delete` | **Delete** | Opens Delete Confirmation modal for currently selected task(s). |
| `btn-topbar-sort` | **Sort Queue** | Toggles queue sorting dropdown with 9 sort modes. |
| `btn-settings` | **Options** | Opens Settings modal with 6 configuration tabs. |
| `btn-pin-top` | **Pin** | Toggles main window Always-On-Top state. |
| `btn-power-menu` | **Power: [State]** | Opens power menu: Do Nothing, Sleep PC when done, Shutdown PC when done. |

#### Sidebar Navigation Tree
- **Status Tree**:
  - `[data-filter="all"]`: Shows all downloads (`badge-all`).
  - `[data-filter="downloading"]`: Shows active downloading & assembling tasks (`badge-downloading`).
  - `[data-filter="paused"]`: Shows paused and queued tasks (`badge-paused`).
  - `[data-filter="completed"]`: Shows completed downloads (`badge-completed`).
  - `[data-filter="error"]`: Shows canceled and error tasks (`badge-error`).
  - `[data-filter="extracting"]`: Shows archives currently extracting (`badge-extracting-tab`).
  - `[data-filter="linkgrabber"]`: Shows staged LinkGrabber items (`badge-grabber`).
- **File Type Categories**:
  - `Compressed` (ZIP), `Audio` (MP3), `Video` (VID), `Programs` (APP), `Pictures` (IMG), `Documents` (DOC).
- **Speed Monitor Widget**:
  - HTML5 Canvas live 60fps throughput speedometer showing real-time network throughput and peak rate.

#### Content Workspace & Downloads Table
- `search-input`: Real-time filter filtering by file name, package, or hoster.
- `btn-toggle-finished`: Quick button toggling visibility of completed tasks in "All Downloads" view.
- `btn-speed-limiter`: Quick toggle showing limiter status and opening Speed Limiter modal.
- `tab-downloads-view` vs `tab-grabber-view`: Switches between IDM queue table and JDownloader crawler workspace.
- **Table Columns (Interactive Resizing & Sorting)**:
  - Selection Checkbox
  - Name / File Title (with Windows shell icon and metadata badges)
  - Size (formatted in B, KB, MB, GB)
  - Status / Progress Bar (segmented dynamic bars with percentage)
  - Speed (real-time transfer rate)
  - Date / Est. Finish (live countdown or completed date badge)
  - Actions (individual Pause/Resume, Inspect, Open Folder, Delete)
- **Multipart Group Row**:
  - Displays package banner, part count badge, total group size, combined progress bar, `⏸ Pause All`, `▶ Resume All`, and `📦 Extract Package Now`.
- **Multi-Selection Batch Bar**:
  - Appears when $\ge 2$ checkboxes are selected: `▶️ Resume Selected`, `⏸️ Pause Selected`, `🗑️ Delete Selected`.

#### Context Menu (Right-Click on Task)
| Context Item | Action |
| :--- | :--- |
| `ctx-open-file` | Launches downloaded file with Windows default application. |
| `ctx-open-folder` | Opens Windows Explorer with the file highlighted (`explorer.exe /select,path`). |
| `ctx-open-extracted-folder` | Opens directory where archive was decompressed. |
| `ctx-extract-archive` | Triggers manual decompression of selected archive. |
| `ctx-verify-checksum` | Computes SHA-256 hash and displays verification badge. |
| `ctx-copy-link` | Copies origin download URL to Windows clipboard. |
| `ctx-update-link` | Opens modal to supply fresh URL for expired downloads. |
| `ctx-pause-resume` | Toggles pause/resume state. |
| `ctx-move-top` / `up` / `down` / `bottom` | Adjusts position in queue order. |
| `ctx-set-priority-high` / `normal` / `low` | Sets queue scheduling priority. |
| `ctx-delete-disk` | Permanently deletes file from disk and removes from queue. |
| `ctx-delete-list` | Removes task from list only, keeping file on disk. |

---

### 11.2 Floating Download Progress Window (`download-progress.html`)
Standalone IDM-style progress dialog for individual tasks:
- **Header**: File icon, filename, origin URL, `📋 Copy URL` button, `⚡ Open when finished` toggle.
- **Tab 1: Progress Tab**:
  - Dynamic status dot (green=downloading, amber=paused, blue=assembling, purple=extracting).
  - Overall progress bar with percentage and animated highlight.
  - Multi-Segment Bar: Visual blocks representing thread segment states.
  - Live Metrics: File Size, Download Speed, Downloaded Bytes, ETA, Resumable indicator, Thread count.
  - "▶ Open Player / Watch as Download Starts" button.
- **Tab 2: Speed Limiter Tab**:
  - Enable Limiter checkbox, range slider (0–50 MB/s), numeric input box, unit selector (KB/s, MB/s).
  - Preset chips: 500 KB/s, 1 MB/s, 5 MB/s, 10 MB/s, 20 MB/s, Unlimited.
  - `⚡ Apply Cap` button.
- **Tab 3: Options & Script Tab**:
  - Completion Action dropdown: Do Nothing, Close Dialog, Open File, Open Folder, Sleep PC, Shutdown PC.
  - Trigger at percentage milestone input (e.g. 80%).
  - Enable Script checkbox, script interpreter picker (Python, PowerShell, Batch, Node, Custom), script path input with `Browse...` button, argument template box with helper token chips (`%FILE%`, `%DIR%`, `%NAME%`, etc.).
- **Tab 4: Extraction Tab**:
  - Auto-extract archive checkbox.
  - Archive Password input with show/hide eye toggle (`👁️`).
  - Delete archive after successful extraction checkbox.
- **Finish View**:
  - Shown when download completes: final size, average speed, destination path, auto-extraction progress bar.
  - Password entry box if archive is password-protected with `🔓 Unlock & Extract` button.
  - Buttons: `Open File`, `Open Folder`, `Open Extracted Folder`, `Close`.
- **Footer**: `Pause` / `Resume`, `Cancel`, `💾 Save Options`, `Hide` (minimize to background).

---

### 11.3 Confirmation Dialog (`confirm.html`)
Shown before starting download (IDM File Info dialog):
- Origin URL and remote server name.
- File Name input box with auto-detected category badge.
- File Size and Resumable badge.
- Estimated download duration based on historical average speed.
- Destination folder input with `Browse...` button and Quick Folder Chips (`📥 Downloads`, `🖥️ Desktop`, `📂 Category Folder`).
- Download Engine dropdown: `inPlace-8`, `inPlace-16`, `inPlace-32`, `singleStream`.
- YouTube Media Box (if media): Thumbnail preview, video title, channel, format selector.
- Archive Options (if archive): Auto-extract checkbox, password field with eye toggle, delete archive checkbox.
- Duplicate Alert Banner (if file already exists): Shows existing status with direct `Open File` / `Show in Folder` buttons.
- Actions: `Cancel`, `Download Later` (adds paused), `⚡ Start Download Now`.

---

## 12. State Schema, API Endpoints & IPC Specifications

### 12.1 Task Object Data Model
```typescript
interface DownloadTask {
  id: string;                      // UUIDv4
  name: string;                    // File name with extension
  category: string;                // 'Compressed' | 'Video' | 'Audio' | 'Programs' | 'Pictures' | 'Documents' | 'Uncategorized'
  packageName: string;             // Group / album / archive package name
  url: string;                     // Origin download URL
  directUrl: string;               // Direct resolved CDN / stream URL
  hoster: string;                  // 'YouTube' | 'Gofile' | 'Pixeldrain' | 'Direct Web' | etc.
  status: 'queued' | 'downloading' | 'paused' | 'assembling' | 'completing' | 'completed' | 'error' | 'retrying';
  priority: 'high' | 'normal' | 'low';
  queueOrder: number;              // Position in queue
  retryCount: number;              // Number of retries attempted
  maxRetries: number;              // Default: 5
  totalBytes: number;              // Total size in bytes (0 if unknown stream)
  downloadedBytes: number;         // Bytes downloaded to disk
  speed: number;                   // Bytes per second
  averageSpeed: number;            // Average transfer rate over task lifetime
  eta: number;                     // Seconds remaining
  savePath: string;                // Absolute disk path
  acceptRanges: boolean;           // True if HTTP Range 206 is supported
  downloadHeaders: Record<string, string> | null;
  
  // Multi-Segment Engine
  downloadEngineMode: 'inPlace' | 'singleStream' | 'legacyTemp';
  singleStream: boolean;
  segmentsCount: number;
  segments: Array<{
    id: number;
    startByte: number;
    endByte: number;
    totalBytes: number;
    downloadedBytes: number;
    status: 'pending' | 'downloading' | 'completed' | 'paused' | 'error';
    speed: number;
  }>;

  // Multipart & Archive Attributes
  multipart: {
    isMultipart: boolean;
    groupKey: string | null;
    baseName: string;
    partNumber: number;
    isRootPart: boolean;
    format: string | null;
  };
  archivePassword: string;
  autoExtract: boolean;
  deleteAfterExtract: boolean;
  extractStatus: 'none' | 'extract_queued' | 'extracting' | 'extracted' | 'extract_failed' | 'extract_password_required' | 'waiting_all_parts';
  extractedPath: string | null;
  extractProgress: number;         // 0 - 100
  extractError: string | null;

  // Media Attributes
  isMedia: boolean;
  mediaOptions?: {
    mediaType: 'audio' | 'video';
    audioFormat?: string;
    audioQuality?: string;
    videoQuality?: string;
  };

  // Speed Limiter & Post Actions
  speedLimitEnabled: boolean;
  speedLimitBytesPerSec: number;
  openWhenFinished: boolean;
  onCompleteAction: 'none' | 'closeDialog' | 'openFile' | 'openFolder' | 'sleep' | 'shutdown';
  triggerAtPercent: number | null;
  customScript?: {
    enabled: boolean;
    type?: string;
    path?: string;
    compiler?: string;
    args?: string;
    triggerAtPercent?: number;
  };

  // Timestamps & Verification
  addedAt: number;
  startedAt: number | null;
  completedAt: number | null;
  verifiedSha256?: string;
  error?: string | null;
}
```

### 12.2 Local REST API Endpoints (Port 4567)
| Route | Method | Purpose |
| :--- | :--- | :--- |
| `/api/downloads` | `GET` | Returns list of all download tasks. |
| `/api/downloads` | `POST` | Creates new download task or triggers probe confirmation. |
| `/api/downloads/probe` | `POST` | Probes URL metadata (size, range support, filename, server, media). |
| `/api/downloads/:id/pause` | `POST` | Pauses download task. |
| `/api/downloads/:id/resume`| `POST` | Resumes download task. |
| `/api/downloads/:id/update-url` | `POST` | Updates download URL for expired task and resumes. |
| `/api/downloads/:id` | `DELETE`| Deletes task (query `?deleteFile=true` to delete from disk). |
| `/api/downloads/:id/extract` | `POST` | Manually triggers archive extraction with optional password. |
| `/api/downloads/:id/set-password` | `POST` | Submits extraction password for locked archive. |
| `/api/downloads/:id/options` | `POST` | Updates task options (limiter, onComplete, scripts). |
| `/api/downloads/:id/stream` | `GET` | HTTP 206 Partial Content media streamer for in-progress downloads. |
| `/api/downloads/:id/verify` | `GET` | Computes SHA-256 hash. |
| `/api/downloads/batch` | `POST` | Batch operations (`pause`, `resume`, `delete`). |
| `/api/downloads/pause-all` | `POST` | Pauses all active downloads. |
| `/api/downloads/resume-all`| `POST` | Resumes all queued downloads. |
| `/api/downloads/clear-completed` | `POST` | Clears completed downloads from list. |
| `/api/queue/move-up` | `POST` | Moves task up in queue. |
| `/api/queue/move-down` | `POST` | Moves task down in queue. |
| `/api/queue/move-top` | `POST` | Moves task to head of queue. |
| `/api/queue/move-bottom`| `POST` | Moves task to tail of queue. |
| `/api/queue/priority` | `POST` | Updates task priority (`high`, `normal`, `low`). |
| `/api/linkgrabber` | `GET` | Retrieves staged LinkGrabber items. |
| `/api/linkgrabber/crawl`| `POST` | Ingests text/links and crawls hosters. |
| `/api/linkgrabber/transfer` | `POST` | Transfers staged items into download queue. |
| `/api/linkgrabber/:id` | `DELETE`| Removes staged item. |
| `/api/linkgrabber/clear`| `POST` | Clears all staged items. |
| `/api/media/probe` | `POST` | Probes YouTube / media formats via yt-dlp. |
| `/api/media/batch-add` | `POST` | Batch adds YouTube playlist tracks. |
| `/api/settings` | `GET` / `POST` | Retrieves or saves application settings. |
| `/api/power` | `GET` / `POST` | Gets or sets completion power action. |
| `/flashgot` & `/flash/add` | `ALL` | FlashGot / Click'n'Load link ingestion. |
| `/jdcheck.js` | `GET` | JDownloader detection probe. |

---

## 13. Recommended C++ Technology Stack & Implementation Roadmap

### 13.1 C++ Technology Stack Selection
1. **Core Language & Compiler**:
   - **C++20** (MSVC 2022 v17.x or Clang 18 on Windows x64).
   - Use standard library concurrency: `std::jthread`, `std::atomic`, `std::latch`, `std::stop_token`.
2. **GUI Framework**:
   - **Qt 6.7+ (C++ / QWidgets or QML)**:
     - Exceptional GPU-accelerated dark theme styling with custom QSS / QPainter.
     - Native Windows High-DPI handling and system tray integration.
     - Direct access to Win32 `HWND` for Windows 10/11 taskbar progress (`ITaskbarList3`).
3. **Network & HTTP Acceleration Engine**:
   - **`libcurl` (with c-ares and OpenSSL 3.0 / Schannel)**:
     - High-performance multi-socket non-blocking transfers (`curl_multi_socket_action`).
     - Native HTTP/1.1 and HTTP/2 Range streaming.
     - Zero memory allocations per packet; pipes directly into sparse file handles.
4. **File System & Asynchronous I/O**:
   - **Win32 Overlapped I/O with I/O Completion Ports (IOCP)**:
     - `CreateFileW` with `FILE_FLAG_OVERLAPPED` and `FILE_FLAG_NO_BUFFERING` (optional for multi-gigabit).
     - Sparse file preallocation via `FSCTL_SET_SPARSE` and `SetFilePointerEx`.
5. **Database & Persistence**:
   - **SQLite3 (Amalgamation, WAL Mode)**:
     - Replaces flat JSON files. Guaranteed ACID durability during unexpected power loss.
6. **Archive Decompression**:
   - **7-Zip LZMA SDK / direct `7z.dll` binding** or **`libarchive`**:
     - Direct in-process extraction without spawning external child processes.
7. **Local HTTP Server for Browser Extension**:
   - **`cpp-httplib`** or **`Crow`**:
     - Ultra-lightweight embedded C++ HTTP & WebSocket server binding to `127.0.0.1:4567`.

### 13.2 Project Directory Structure for the C++ Rebuild
```
waterfall-cpp/
├── CMakeLists.txt
├── vcpkg.json                    # Dependencies: libcurl, sqlite3, qt6, openssl
├── src/
│   ├── main.cpp                  # Entry point, single-instance mutex, crash handler
│   ├── core/
│   │   ├── DownloadManager.hpp/cpp
│   │   ├── ChunkEngine.hpp/cpp   # libcurl multi + Win32 IOCP writer
│   │   ├── QueueScheduler.hpp/cpp# Priority & host-limited scheduling
│   │   ├── TokenBucket.hpp/cpp   # Speed limiter
│   │   ├── StorageRouter.hpp/cpp # OS Library auto-routing
│   │   ├── NamingEngine.hpp/cpp  # RFC 6266 / Content-Disposition parser
│   │   └── ChecksumVerifier.hpp/cpp # Streaming SHA-256
│   ├── hosters/
│   │   ├── HosterRegistry.hpp/cpp
│   │   ├── GofilePlugin.hpp/cpp
│   │   ├── PixeldrainPlugin.hpp/cpp
│   │   ├── ArchiveOrgPlugin.hpp/cpp
│   │   └── MediaCrawler.hpp/cpp  # yt-dlp interop
│   ├── archive/
│   │   ├── ArchiveManager.hpp/cpp# Multipart grouping logic
│   │   ├── ExtractionQueue.hpp/cpp
│   │   └── SevenZipBridge.hpp/cpp# Native 7z decompression
│   ├── server/
│   │   ├── LocalHttpServer.hpp/cpp # Port 4567 REST API & WebSocket
│   │   └── FlashGotHandler.hpp/cpp
│   ├── os/
│   │   ├── Win32Taskbar.hpp/cpp  # ITaskbarList3 progress & states
│   │   ├── Win32Tray.hpp/cpp     # System tray & notification balloons
│   │   ├── Win32Toast.hpp/cpp    # Windows Action Center toasts
│   │   └── Win32Power.hpp/cpp    # Sleep & Shutdown execution
│   └── ui/
│       ├── MainWindow.hpp/cpp    # Obsidian Gunmetal dark theme
│       ├── DownloadsModel.hpp/cpp# QAbstractTableModel with 60fps telemetry
│       ├── ProgressDialog.hpp/cpp# Floating single-download inspector
│       ├── ConfirmDialog.hpp/cpp # File Info & probe modal
│       ├── SegmentMatrix.hpp/cpp # 50-block visualizer
│       ├── SpeedGraphWidget.hpp/cpp # Custom painted QWidget chart
│       └── SettingsDialog.hpp/cpp# 6-tab options configurator
└── assets/
    ├── icon.ico
    └── logo.png
```

---
*Waterfall Download Accelerator (WDM) — Specification compiled for full C++ native rebirth.*
