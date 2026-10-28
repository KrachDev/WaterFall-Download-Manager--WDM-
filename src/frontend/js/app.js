/**
 * Main Frontend Application Controller
 * High-performance IDM Table + JDownloader LinkGrabber + YouTube/Audio Converter
 */

// Web Audio API Synthesized Chime (IDM Classic Notification)
function playCompletionChime() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    
    const now = ctx.currentTime;
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();

    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(587.33, now); // D5
    osc1.frequency.exponentialRampToValueAtTime(880, now + 0.15); // A5

    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(880, now + 0.15);
    osc2.frequency.exponentialRampToValueAtTime(1174.66, now + 0.35); // D6

    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);

    osc1.start(now);
    osc1.stop(now + 0.2);
    osc2.start(now + 0.15);
    osc2.stop(now + 0.5);
  } catch (_) {}
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

document.addEventListener('DOMContentLoaded', () => {
  const desktop = window.waterfallDesktop || window.hydraDesktop;

  // DOM Elements
  const tableBody = document.getElementById('downloads-table-body');
  const emptyState = document.getElementById('empty-downloads-state');
  const globalSpeedDisplay = document.getElementById('global-speed-display');
  const searchInput = document.getElementById('search-input');
  const tabDownloadsView = document.getElementById('tab-downloads-view');
  const tabGrabberView = document.getElementById('tab-grabber-view');
  const downloadsViewPanel = document.getElementById('downloads-view-panel');
  const grabberViewPanel = document.getElementById('grabber-view-panel');

  // Sidebar Badges
  const badgeAll = document.getElementById('badge-all');
  const badgeDownloading = document.getElementById('badge-downloading');
  const badgePaused = document.getElementById('badge-paused');
  const badgeCompleted = document.getElementById('badge-completed');
  const badgeGrabber = document.getElementById('badge-grabber');
  const badgeCompressed = document.getElementById('badge-compressed');
  const badgePrograms = document.getElementById('badge-programs');
  const badgeVideo = document.getElementById('badge-video');
  const badgeAudio = document.getElementById('badge-audio');
  const badgePictures = document.getElementById('badge-pictures');
  const badgeDocuments = document.getElementById('badge-documents');

  // LinkGrabber Elements
  const grabberRawText = document.getElementById('grabber-raw-text');
  const grabberPackageName = document.getElementById('grabber-package-name');
  const btnCrawlLinks = document.getElementById('btn-crawl-links');
  const btnPasteClipboard = document.getElementById('btn-paste-clipboard');
  const grabberStagedList = document.getElementById('grabber-staged-list');
  const grabberCountLabel = document.getElementById('grabber-count-label');
  const grabberSelectedCount = document.getElementById('grabber-selected-count');
  const grabberTotalSize = document.getElementById('grabber-total-size');
  const btnGrabberClear = document.getElementById('btn-grabber-clear');
  const btnGrabberStartAll = document.getElementById('btn-grabber-start-all');
  const checkGrabberSelectAll = document.getElementById('check-grabber-select-all');

  // YouTube Converter Elements
  const btnOpenYouTube = document.getElementById('btn-open-youtube');
  const modalYouTubeConverter = document.getElementById('modal-youtube-converter');
  const ytInputUrl = document.getElementById('yt-input-url');
  const ytBtnInspect = document.getElementById('yt-btn-inspect');
  const ytPreviewCard = document.getElementById('yt-preview-card');
  const ytThumbImg = document.getElementById('yt-thumb-img');
  const ytDurationBadge = document.getElementById('yt-duration-badge');
  const ytVideoTitle = document.getElementById('yt-video-title');
  const ytVideoAuthor = document.getElementById('yt-video-author');
  const ytFormatSelector = document.getElementById('yt-format-selector');
  const ytBtnDownload = document.getElementById('yt-btn-download');
  const ytCheckAutoStart = document.getElementById('yt-check-auto-start');

  let currentYtMeta = null;
  let selectedYtFormat = { type: 'audio', format: 'mp3', quality: '0' };
  let selectedPlaylistFormat = 'mp3-320';

  // Batch & Multi-Select
  const batchBar = document.getElementById('batch-bar');
  const batchSelectedCount = document.getElementById('batch-selected-count');
  const btnBatchResume = document.getElementById('btn-batch-resume');
  const btnBatchPause = document.getElementById('btn-batch-pause');
  const btnBatchDelete = document.getElementById('btn-batch-delete');
  const checkSelectAllDownloads = document.getElementById('check-select-all-downloads');
  const selectedTaskIds = new Set();
  const appIconClientCache = new Map();
  const appIconInFlightPromises = new Map();
  const filterTabsBar = document.getElementById('filter-tabs-bar');

  // O(1) DOM Caches & Multipart Grouping State for High-Performance Ticks
  const rowDomCache = new Map();
  const groupDomCache = new Map();
  window.expandedGroupKeys = window.expandedGroupKeys || new Set();
  let extractPasswordTargetTaskId = null;

  // Desktop Context Menu
  const contextMenu = document.getElementById('context-menu');
  let contextTask = null;

  // Power Actions
  const btnPowerMenu = document.getElementById('btn-power-menu');
  const powerDropdownMenu = document.getElementById('power-dropdown-menu');
  const powerStatusLabel = document.getElementById('power-status-label');

  // Queue Controls (Hide Finished & Sorting)
  const btnToggleFinished = document.getElementById('btn-toggle-finished');
  const labelToggleFinished = document.getElementById('label-toggle-finished');
  const badgeFinishedHidden = document.getElementById('badge-finished-hidden');
  const btnSortMenu = document.getElementById('btn-sort-menu');
  const sortDropdownMenu = document.getElementById('sort-dropdown-menu');
  const sortStatusLabel = document.getElementById('sort-status-label');
  const btnTopbarSort = document.getElementById('btn-topbar-sort');
  const btnTopbarSortChevron = document.getElementById('btn-topbar-sort-chevron');
  const topbarSortMenu = document.getElementById('topbar-sort-menu');
  const topbarSortLabel = document.getElementById('topbar-sort-label');
  const emptyFinishedHint = document.getElementById('empty-finished-hint');
  const emptyBtnShowFinished = document.getElementById('empty-btn-show-finished');
  const emptyBtnViewFinishedTab = document.getElementById('empty-btn-view-finished-tab');
  const emptyBtnClearFinished = document.getElementById('empty-btn-clear-finished');

  // Initialize sorting and filter states from localStorage / config
  const savedHideFinished = localStorage.getItem('waterfall_hide_finished');
  window.appState.hideFinished = savedHideFinished !== null
    ? savedHideFinished === 'true'
    : Boolean(window.appState.config?.hideFinishedInAllDownloads);

  const savedSortMode = localStorage.getItem('waterfall_sort_mode');
  window.appState.sortMode = savedSortMode || window.appState.config?.defaultQueueSorting || 'active-first';
  window.appState.sortCol = localStorage.getItem('waterfall_sort_col') || null;
  window.appState.sortDir = localStorage.getItem('waterfall_sort_dir') || 'desc';

  // Playlist Elements
  const ytPlaylistCard = document.getElementById('yt-playlist-card');
  const ytPlaylistTitle = document.getElementById('yt-playlist-title');
  const ytPlaylistCount = document.getElementById('yt-playlist-count');
  const ytPlaylistItems = document.getElementById('yt-playlist-items');
  const ytPlaylistFormatSelector = document.getElementById('yt-playlist-format-selector');
  const ytPlaylistToggleAll = document.getElementById('yt-playlist-toggle-all');

  // Modals
  const modalAddUrl = document.getElementById('modal-add-url');
  const modalSpeedLimiter = document.getElementById('modal-speed-limiter');
  const modalSettings = document.getElementById('modal-settings');
  const modalUpdateUrl = document.getElementById('modal-update-url');
  const btnSubmitUpdateUrl = document.getElementById('btn-submit-update-url');
  const inputNewUrl = document.getElementById('input-new-url');
  const updateUrlFilename = document.getElementById('update-url-filename');
  const updateUrlCurrent = document.getElementById('update-url-current');
  let currentUpdatingTaskId = null;

  // Toolbar Actions
  const btnAddUrl = document.getElementById('btn-add-url');
  const btnAddDropdownToggle = document.getElementById('btn-add-dropdown-toggle');
  const addDownloadDropdownMenu = document.getElementById('add-download-dropdown-menu');
  const menuAddDirect = document.getElementById('menu-add-direct');
  const menuAddYouTube = document.getElementById('menu-add-youtube');
  const menuAddGrabber = document.getElementById('menu-add-grabber');
  const addModalTabDirect = document.getElementById('add-modal-tab-direct');
  const addModalTabYouTube = document.getElementById('add-modal-tab-youtube');
  const addModalTabGrabber = document.getElementById('add-modal-tab-grabber');
  const limiterStatusLabel = document.getElementById('limiter-status-label');
  const btnToggleGrabber = document.getElementById('btn-toggle-grabber');
  const btnResumeAll = document.getElementById('btn-resume-all');
  const btnPauseAll = document.getElementById('btn-pause-all');
  const btnClearCompleted = document.getElementById('btn-clear-completed');
  const btnSpeedLimiter = document.getElementById('btn-speed-limiter');
  const btnSettings = document.getElementById('btn-settings');
  const btnSubmitAddUrl = document.getElementById('btn-submit-add-url');
  const btnSaveSpeedLimiter = document.getElementById('btn-save-speed-limiter');
  const btnSaveSettings = document.getElementById('btn-save-settings');

  // Format Helpers
  function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    if (!bytes) return 'Unknown';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  function formatSpeed(bytes) {
    if (!bytes || bytes === 0) return '0.0 KB/s';
    if (bytes >= 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB/s';
    if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB/s';
    return (bytes / 1024).toFixed(1) + ' KB/s';
  }

  function formatETADuration(seconds) {
    if (!seconds || seconds <= 0 || !isFinite(seconds)) return '';
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (d > 0) return `${d}d ${h}h remaining`;
    if (h > 0) return `${h}h ${m}m remaining`;
    if (m > 0) return `${m}m ${s}s remaining`;
    return `${s}s remaining`;
  }

  function formatETA(seconds) {
    if (!seconds || seconds <= 0 || !isFinite(seconds)) return '--';

    const now = new Date();
    const target = new Date(Date.now() + seconds * 1000);

    // 12-hour clock format with am/pm (e.g. 2:15pm or 2pm when minutes == 0)
    let hours = target.getHours();
    const minutes = target.getMinutes();
    const ampm = hours >= 12 ? 'pm' : 'am';
    hours = hours % 12;
    hours = hours ? hours : 12;
    const timeStr = (minutes === 0)
      ? `${hours} ${ampm}`
      : `${hours}:${minutes < 10 ? '0' + minutes : minutes} ${ampm}`;

    // Calendar day comparison based on midnight boundaries
    const nowMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const targetMidnight = new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime();
    const dayDiff = Math.round((targetMidnight - nowMidnight) / (1000 * 60 * 60 * 24));

    const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const weekday = weekdays[target.getDay()];

    if (dayDiff === 0) {
      return `Today at ${timeStr}`;
    } else if (dayDiff === 1) {
      return `Tomorrow at ${timeStr}`;
    } else if (dayDiff === 2) {
      return `In 2 days (${weekday}) at ${timeStr}`;
    } else if (dayDiff >= 3 && dayDiff <= 7) {
      return `In ${dayDiff} days (${weekday}) at ${timeStr}`;
    } else {
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      return `In ${dayDiff} days (${months[target.getMonth()]} ${target.getDate()}) at ${timeStr}`;
    }
  }

  function formatTaskDate(timestamp) {
    if (!timestamp) return '--';
    const d = new Date(timestamp);
    if (isNaN(d.getTime())) return '--';
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();

    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday = d.toDateString() === yesterday.toDateString();

    const hours = d.getHours();
    const mins = d.getMinutes();
    const ampm = hours >= 12 ? 'pm' : 'am';
    const h12 = hours % 12 || 12;
    const mStr = mins < 10 ? '0' + mins : mins;
    const timeStr = `${h12}:${mStr} ${ampm}`;

    if (isToday) {
      return `Today, ${timeStr}`;
    }
    if (isYesterday) {
      return `Yesterday, ${timeStr}`;
    }

    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = months[d.getMonth()];
    const day = d.getDate();
    const year = d.getFullYear();
    const currentYear = now.getFullYear();

    if (year === currentYear) {
      return `${month} ${day}, ${timeStr}`;
    }
    return `${month} ${day}, ${year}`;
  }

  function formatTaskDateFull(timestamp) {
    if (!timestamp) return '';
    const d = new Date(timestamp);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString([], {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }

  function getTypeBadge(task) {
    if (task.isMedia || (task.hoster && task.hoster.includes('YouTube'))) {
      return { cls: 'yt', text: task.category === 'Audio' ? 'MP3' : 'VID' };
    }
    switch (task.category) {
      case 'Compressed': return { cls: 'zip', text: 'ZIP' };
      case 'Programs': return { cls: 'exe', text: 'APP' };
      case 'Video': return { cls: 'vid', text: 'VID' };
      case 'Audio': return { cls: 'mus', text: 'AUD' };
      case 'Pictures': return { cls: 'pic', text: 'IMG' };
      case 'Documents': return { cls: 'doc', text: 'DOC' };
      default: return { cls: 'gen', text: 'FILE' };
    }
  }

  // View Switching
  function switchView(view) {
    window.appState.activeView = view;
    if (view === 'downloads') {
      tabDownloadsView.classList.add('active');
      tabGrabberView.classList.remove('active');
      downloadsViewPanel.style.display = 'block';
      grabberViewPanel.style.display = 'none';
      renderDownloads();
    } else {
      tabDownloadsView.classList.remove('active');
      tabGrabberView.classList.add('active');
      downloadsViewPanel.style.display = 'none';
      grabberViewPanel.style.display = 'flex';
      renderGrabber();
    }
  }

  tabDownloadsView.addEventListener('click', () => switchView('downloads'));
  tabGrabberView.addEventListener('click', () => switchView('grabber'));
  if (btnToggleGrabber) btnToggleGrabber.addEventListener('click', () => switchView('grabber'));

  // Unified Add Download Split Button & Dropdown Menu
  if (btnAddDropdownToggle && addDownloadDropdownMenu) {
    btnAddDropdownToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      if (typeof closeAllSortMenus === 'function') closeAllSortMenus();
      addDownloadDropdownMenu.classList.toggle('show');
    });
  }

  document.addEventListener('click', (e) => {
    if (addDownloadDropdownMenu && !e.target.closest('.add-download-dropdown-wrap')) {
      addDownloadDropdownMenu.classList.remove('show');
    }
  });

  if (menuAddDirect) {
    menuAddDirect.addEventListener('click', () => {
      if (addDownloadDropdownMenu) addDownloadDropdownMenu.classList.remove('show');
      if (modalAddUrl) {
        const inputUrl = document.getElementById('input-url');
        if (inputUrl) { inputUrl.value = ''; setTimeout(() => inputUrl.focus(), 60); }
        modalAddUrl.classList.add('open');
      }
    });
  }

  if (menuAddYouTube) {
    menuAddYouTube.addEventListener('click', () => {
      if (addDownloadDropdownMenu) addDownloadDropdownMenu.classList.remove('show');
      if (modalYouTubeConverter) {
        modalYouTubeConverter.classList.add('open');
        if (ytInputUrl) ytInputUrl.focus();
      }
    });
  }

  if (menuAddGrabber) {
    menuAddGrabber.addEventListener('click', () => {
      if (addDownloadDropdownMenu) addDownloadDropdownMenu.classList.remove('show');
      switchView('grabber');
    });
  }

  if (addModalTabYouTube) {
    addModalTabYouTube.addEventListener('click', () => {
      if (modalAddUrl) modalAddUrl.classList.remove('open');
      if (modalYouTubeConverter) {
        modalYouTubeConverter.classList.add('open');
        if (ytInputUrl) ytInputUrl.focus();
      }
    });
  }

  if (addModalTabGrabber) {
    addModalTabGrabber.addEventListener('click', () => {
      if (modalAddUrl) modalAddUrl.classList.remove('open');
      switchView('grabber');
    });
  }

  // Empty State Quick Action Buttons
  const emptyBtnAddUrl = document.getElementById('empty-btn-add-url');
  const emptyBtnYt = document.getElementById('empty-btn-yt');
  const emptyBtnGrabber = document.getElementById('empty-btn-grabber');

  if (emptyBtnAddUrl) {
    emptyBtnAddUrl.addEventListener('click', () => {
      if (modalAddUrl) {
        const inputUrl = document.getElementById('input-url');
        if (inputUrl) { inputUrl.value = ''; setTimeout(() => inputUrl.focus(), 60); }
        modalAddUrl.classList.add('open');
      }
    });
  }

  if (emptyBtnYt) {
    emptyBtnYt.addEventListener('click', () => {
      if (modalYouTubeConverter) {
        modalYouTubeConverter.classList.add('open');
        if (ytInputUrl) ytInputUrl.focus();
      }
    });
  }

  if (emptyBtnGrabber) {
    emptyBtnGrabber.addEventListener('click', () => {
      switchView('grabber');
    });
  }

  // Top Filter Tabs Bar Visibility Controller
  function updateFilterTabsBarVisibility(show) {
    if (filterTabsBar) {
      filterTabsBar.style.display = show ? 'flex' : 'none';
    }
  }

  // Interactive Filter Tabs Bar (All, Done, Paused, Canceled, Videos, Photos, etc.)
  if (filterTabsBar) {
    filterTabsBar.querySelectorAll('.filter-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const type = tab.dataset.tabType;
        const val = tab.dataset.tabVal;

        if (type === 'status') {
          window.appState.activeFilter = val;
          window.appState.activeCategory = null;
        } else if (type === 'category') {
          window.appState.activeCategory = val;
          window.appState.activeFilter = 'all';
        }

        syncSidebarActiveFilter();
        renderDownloads();
      });
    });
  }

  function syncSidebarActiveFilter() {
    const filter = window.appState.activeFilter;
    const category = window.appState.activeCategory;

    document.querySelectorAll('.sidebar .nav-link').forEach(link => {
      link.classList.remove('active');
      if (category && link.dataset.category === category) {
        link.classList.add('active');
      } else if (!category && link.dataset.filter === filter) {
        link.classList.add('active');
      }
    });

    if (filterTabsBar) {
      filterTabsBar.querySelectorAll('.filter-tab').forEach(tab => {
        tab.classList.remove('active');
        if (category && tab.dataset.tabType === 'category' && tab.dataset.tabVal === category) {
          tab.classList.add('active');
        } else if (!category && tab.dataset.tabType === 'status' && tab.dataset.tabVal === filter) {
          tab.classList.add('active');
        }
      });
    }
  }

  // Sidebar Filter Clicking
  document.querySelectorAll('.sidebar .nav-link').forEach(item => {
    item.addEventListener('click', () => {
      const filter = item.dataset.filter;
      const category = item.dataset.category;

      if (filter === 'linkgrabber') {
        switchView('grabber');
        return;
      }

      switchView('downloads');
      window.appState.activeFilter = filter || 'all';
      window.appState.activeCategory = category || null;
      syncSidebarActiveFilter();
      renderDownloads();
    });
  });

  // Search input filtering
  searchInput.addEventListener('input', (e) => {
    window.appState.searchQuery = e.target.value.toLowerCase().trim();
    if (window.appState.activeView === 'downloads') {
      renderDownloads();
    } else {
      renderGrabber();
    }
  });

  // Extraction helpers
  function findExtractedPathForTask(t) {
    if (!t) return null;
    if (t.extractedPath) return t.extractedPath;
    if (t.multipart && t.multipart.groupKey && window.appState && Array.isArray(window.appState.tasks)) {
      const match = window.appState.tasks.find(o => o.multipart && o.multipart.groupKey === t.multipart.groupKey && o.extractedPath);
      if (match) return match.extractedPath;
    }
    const checkPath = t.savePath || t.path || t.filename || t.name;
    if (!checkPath || typeof checkPath !== 'string') return null;
    const isArch = /\.(zip|rar|7z|tar\.gz|tar\.bz2|tar|tgz|bz2|xz|iso|part\d+\.rar|part\d+|001|r00|r01)$/i.test(checkPath);
    if (!isArch) return null;
    const parts = checkPath.replace(/\\/g, '/').split('/');
    const fname = parts.pop() || '';
    const dir = parts.join('\\');
    const extMatch = fname.match(/\.(zip|rar|7z|tar\.gz|tar\.bz2|tar|tgz|bz2|xz|iso|part\d+\.rar|part\d+|001|r00|r01)$/i);
    const baseName = extMatch ? fname.slice(0, extMatch.index).trim() : fname;
    if (dir && baseName) {
      return `${dir}\\${baseName}`;
    }
    return null;
  }

  // Extraction badge helper
  function renderExtractionBadge(t) {
    if (t.extractStatus === 'extracted') {
      return `<span class="badge-extracted" data-path="${escapeHtml(t.extractedPath || '')}" title="Extracted to folder (Click to open)">📦 Extracted</span>`;
    }
    if (t.extractStatus === 'extracting') {
      return `<span class="badge-extracting" title="Unpacking archive in background...">📦 Extracting (${escapeHtml(t.extractProgress || 0)}%)...</span>`;
    }
    if (t.extractStatus === 'waiting_parts') {
      return `<span class="badge-waiting-parts" title="Waiting for all parts of package to finish before extracting">⏳ Waiting for Parts</span>`;
    }
    if (t.extractStatus === 'password_required') {
      return `<span class="badge-password-req" data-id="${encodeURIComponent(t.id)}" title="Archive is password protected! Click to enter password">🔑 Password Required</span>`;
    }
    if (t.extractStatus === 'error') {
      return `<span class="state-tag error" style="font-size: 0.65rem; padding: 1px 5px;" title="${escapeHtml(t.extractError || 'Decompression failed')}">⚠️ Extract Failed</span>`;
    }
    return '';
  }

  // Multipart Downloads Grouping Helper
  const VIDEO_EXTS_REGEX = /\.(mp4|mkv|avi|mov|wmv|flv|webm|m4v|ts|m2ts|vob|ogv|3gp|mpg|mpeg|m2v|divx|asf|rm|rmvb|f4v)$/i;
  function isTaskVideo(t) {
    if (t.category === 'Video' || t.isMedia) return true;
    const name = t.name || t.filename || '';
    return VIDEO_EXTS_REGEX.test(name.trim());
  }

  function getGroupedDownloads(tasks) {
    const multipartGroups = new Map();
    const playlistGroups = new Map();

    for (const t of tasks) {
      if (t.multipart && t.multipart.groupKey && !isTaskVideo(t)) {
        const gk = t.multipart.groupKey;
        if (!multipartGroups.has(gk)) multipartGroups.set(gk, []);
        multipartGroups.get(gk).push(t);
      } else if (t.playlistId || t.playlistGroup?.id || (t.isMedia && t.packageName && t.packageName !== 'YouTube Downloads' && t.packageName.trim().length > 0)) {
        const pk = t.playlistId || t.playlistGroup?.id || ('pl_' + t.packageName.trim().toLowerCase());
        if (!playlistGroups.has(pk)) playlistGroups.set(pk, []);
        playlistGroups.get(pk).push(t);
      }
    }

    const items = [];
    const handledGroups = new Set();

    for (const t of tasks) {
      // 1. Multipart archive groups
      if (t.multipart && t.multipart.groupKey && !isTaskVideo(t)) {
        const gk = t.multipart.groupKey;
        const gTasks = multipartGroups.get(gk);
        if (gTasks && (gTasks.length > 1 || (t.multipart.totalParts && t.multipart.totalParts > 1))) {
          if (!handledGroups.has(gk)) {
            handledGroups.add(gk);
            gTasks.sort((a, b) => (a.multipart?.partNumber || 0) - (b.multipart?.partNumber || 0));
            const maxAddedAt = Math.max(...gTasks.map(gt => gt.addedAt || gt.createdAt || 0));
            items.push({
              type: 'group',
              isPlaylist: false,
              groupKey: gk,
              groupName: t.multipart.groupName || gk,
              tasks: gTasks,
              addedAt: maxAddedAt
            });
          }
          continue;
        }
      }

      // 2. YouTube / Media Playlist groups
      const pk = t.playlistId || t.playlistGroup?.id || (t.isMedia && t.packageName && t.packageName !== 'YouTube Downloads' && t.packageName.trim().length > 0 ? ('pl_' + t.packageName.trim().toLowerCase()) : null);
      if (pk) {
        const pTasks = playlistGroups.get(pk);
        if (pTasks && pTasks.length > 1) {
          if (!handledGroups.has(pk)) {
            handledGroups.add(pk);
            pTasks.sort((a, b) => (a.playlistGroup?.index || 0) - (b.playlistGroup?.index || 0));
            const maxAddedAt = Math.max(...pTasks.map(pt => pt.addedAt || pt.createdAt || 0));
            const playlistTitle = t.playlistGroup?.name || t.packageName || 'YouTube Playlist';
            items.push({
              type: 'group',
              isPlaylist: true,
              groupKey: pk,
              groupName: playlistTitle,
              tasks: pTasks,
              addedAt: maxAddedAt
            });
          }
          continue;
        }
      }

      items.push({ type: 'single', task: t, addedAt: t.addedAt || t.createdAt || 0 });
    }

    // Always sort newest first (most recent timestamp at the top)
    items.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));

    return items;
  }

  // Render Single Task Row HTML
  function renderTaskRowHtml(t, isChild = false, parentGroupKey = null) {
    const percent = (t.totalBytes > 0)
      ? Math.min(100, Math.floor((t.downloadedBytes / t.totalBytes) * 100))
      : (t.status === 'completed' ? 100 : 0);

    const badge = getTypeBadge(t);
    const isDl = t.status === 'downloading';
    const isDone = t.status === 'completed';
    const isSelected = selectedTaskIds.has(t.id);
    const extractionBadge = renderExtractionBadge(t);

    const ext = t.name && t.name.includes('.') ? ('.' + t.name.split('.').pop().toLowerCase()) : '';
    const iconCacheKey = ext || (t.savePath ? t.savePath.toLowerCase() : t.id);
    const cachedAppInfo = appIconClientCache.get(iconCacheKey);

    let appIconHtml = '';
    if (cachedAppInfo && cachedAppInfo.icon) {
      appIconHtml = `
        <div class="file-app-icon-wrap" id="row-icon-wrap-${t.id}" title="Opens with: ${cachedAppInfo.appName || 'Default Application'}">
          <img class="row-app-icon-img" src="${cachedAppInfo.icon}" alt="${cachedAppInfo.appName || 'App'}">
          <span class="row-mini-type-badge ${badge.cls}">${badge.text}</span>
        </div>
      `;
    } else {
      appIconHtml = `
        <div class="file-app-icon-wrap" id="row-icon-wrap-${t.id}" title="${badge.text}">
          <span class="type-badge ${badge.cls}">${badge.text}</span>
        </div>
      `;

      fetchAppIcon(t.savePath, t.name).then(info => {
        if (info && info.icon) {
          appIconClientCache.set(iconCacheKey, info);
          const wrap = document.getElementById(`row-icon-wrap-${t.id}`);
          if (wrap) {
            wrap.title = `Opens with: ${info.appName || 'Default Application'}`;
            wrap.innerHTML = `
              <img class="row-app-icon-img" src="${info.icon}" alt="${info.appName || 'App'}">
              <span class="row-mini-type-badge ${badge.cls}">${badge.text}</span>
            `;
          }
          const label = document.getElementById(`row-app-label-${t.id}`);
          if (label && info.appName) {
            label.textContent = `Opens with ${info.appName}`;
            label.style.display = 'inline-block';
          }
        }
      });
    }

    const priorityTag = t.priority === 'high'
      ? `<span class="priority-tag priority-high" title="High Queue Priority">High</span>`
      : (t.priority === 'low' ? `<span class="priority-tag priority-low" title="Low Queue Priority">Low</span>` : '');

    const childBranchPrefix = isChild
      ? `<span class="child-indent-branch">↳</span><span class="group-parts-badge" style="margin-right: 4px;">${t.playlistGroup?.index ? `Track ${t.playlistGroup.index}` : (t.multipart?.partNumber ? `Part ${t.multipart.partNumber}` : 'Item')}</span>`
      : '';

    let progressCellHtml = '';
    if (t.extractStatus === 'extracting') {
      const extPct = t.extractProgress !== undefined ? t.extractProgress : 0;
      progressCellHtml = `
        <div class="meter-track extract-track" title="Extracting archive (${extPct}%)">
          <div class="meter-fill extracting" style="width: ${extPct}%; background: linear-gradient(90deg, #9333ea, #a855f7, #c084fc);"></div>
        </div>
        <div class="meter-stat" style="color: #c084fc; font-weight: 600;">Extracting • ${extPct}%</div>
      `;
    } else if (isDone) {
      if (t.extractStatus === 'extracted') {
        progressCellHtml = `
          <div class="progress-done-state" style="color: #34d399;">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
            <span>Extracted • 100%</span>
          </div>
          <div class="meter-stat">${formatBytes(t.totalBytes || t.downloadedBytes)}</div>
        `;
      } else {
        progressCellHtml = `
          <div class="progress-done-state">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#3fb950" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
            <span>Complete • 100%</span>
          </div>
          <div class="meter-stat">${formatBytes(t.totalBytes || t.downloadedBytes)}</div>
        `;
      }
    } else if (t.status === 'canceled') {
      progressCellHtml = `
        <div class="progress-canceled-state">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#8b949e" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>
          <span>Canceled</span>
        </div>
        <div class="meter-stat">${percent}% • ${formatBytes(t.downloadedBytes)}</div>
      `;
    } else if (t.status === 'error') {
      progressCellHtml = `
        <div class="progress-error-state">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#f85149" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
          <span>Failed</span>
        </div>
        <div class="meter-stat" title="${(t.error || '').replace(/"/g, '&quot;')}">${t.error ? t.error.slice(0, 24) : 'Error'}</div>
      `;
    } else if (t.status === 'paused' || t.status === 'queued') {
      progressCellHtml = `
        <div class="meter-track">
          <div class="meter-fill paused" style="width: ${percent}%;"></div>
        </div>
        <div class="meter-stat">${percent}% • ${t.status === 'queued' ? (t.streamPreResolved ? '⚡ Stream Ready (Queued)' : 'Queued') : 'Paused'} (${formatBytes(t.downloadedBytes)})</div>
      `;
    } else {
      progressCellHtml = `
        <div class="meter-track">
          <div class="meter-fill active" style="width: ${percent}%;"></div>
        </div>
        <div class="meter-stat">${percent}% • ${formatBytes(t.downloadedBytes)}</div>
      `;
    }

    return `
      <tr data-id="${encodeURIComponent(t.id)}" ${parentGroupKey ? `data-parent-group="${encodeURIComponent(parentGroupKey)}"` : ''} class="download-row ${isChild ? 'child-download-row' : ''} ${isSelected ? 'row-selected' : ''}">
        <td><input type="checkbox" class="task-checkbox" data-id="${encodeURIComponent(t.id)}" ${isSelected ? 'checked' : ''}></td>
        <td>
          <div class="file-block">
            ${appIconHtml}
            <div class="file-details">
              <div style="display: flex; align-items: center; gap: 6px; min-width: 0; overflow: hidden;">
                ${childBranchPrefix}
                <span class="file-title" style="flex: 1; min-width: 0;" title="${escapeHtml(t.name)}" onclick="window.segmentVisualizer.open('${encodeURIComponent(t.id)}')">${escapeHtml(t.name)}</span>
                ${priorityTag}
                ${extractionBadge}
                ${t.streamPreResolved && t.status === 'queued' ? '<span class="badge-inplace" style="font-size: 0.65rem; background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.35); border-radius: 3px; padding: 1px 5px; white-space: nowrap;" title="Media stream URL pre-fetched in background. Starts instantly!">⚡ Pre-cached</span>' : ''}
                ${t.singleStream ? '<span class="badge-single-stream" style="font-size: 0.65rem; background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3); border-radius: 3px; padding: 1px 5px; white-space: nowrap;" title="Whole File Mode (Single Stream - 1 Socket, No Chunks)">📦 Whole File</span>' : (t.downloadEngineMode === 'inPlace' ? '<span class="badge-inplace" style="font-size: 0.65rem; background: rgba(16, 185, 129, 0.12); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.25); border-radius: 3px; padding: 1px 5px; white-space: nowrap;" title="In-Place Direct Writing (Zero Lag, Instant Completion)">⚡ Direct</span>' : '')}
                <span class="row-app-handler-label" id="row-app-label-${encodeURIComponent(t.id)}" style="${cachedAppInfo && cachedAppInfo.appName ? 'display:inline-block;' : 'display:none;'}" title="Default Handler">
                  ${cachedAppInfo && cachedAppInfo.appName ? `Opens with ${escapeHtml(cachedAppInfo.appName)}` : ''}
                </span>
              </div>
              <div class="file-subtext">
                <span class="file-entry-date" title="Added: ${formatTaskDateFull(t.addedAt || t.completedAt)}">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: -1px; margin-right: 3px; opacity: 0.8;"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>${formatTaskDate(t.addedAt || t.completedAt)}
                </span>
                <span class="subtext-sep">•</span>
                ${t.packageName ? `[${escapeHtml(t.packageName)}] • ` : ''}${escapeHtml(t.savePath || '')}
              </div>
            </div>
          </div>
        </td>
        <td><span style="font-family: var(--font-mono); font-weight: 600;">${formatBytes(t.totalBytes)}</span></td>
        <td>
          <span class="state-tag ${t.status}">
            ${t.streamPreResolved && t.status === 'queued' ? '⚡ ready' : t.status}
          </span>
        </td>
        <td class="progress-col">
          ${progressCellHtml}
        </td>
        <td>
          <span style="font-family: var(--font-mono); font-weight: 600; color: ${isDl ? '#3fb950' : 'var(--text-muted)'};">
            ${isDl ? formatSpeed(t.speed) : '--'}
          </span>
        </td>
        <td title="${isDl ? `${formatETADuration(t.eta)} (Added: ${formatTaskDateFull(t.addedAt)})` : (isDone ? `Completed: ${formatTaskDateFull(t.completedAt || t.addedAt)}` : `Added: ${formatTaskDateFull(t.addedAt)}`)}">
          <div class="date-finish-cell">
            ${isDl ? `
              <span class="date-finish-eta">${formatETA(t.eta)}</span>
              <span class="date-finish-sub">Added: ${formatTaskDate(t.addedAt)}</span>
            ` : (isDone ? `
              <span class="date-finish-done">✓ ${formatTaskDate(t.completedAt || t.addedAt)}</span>
              ${t.completedAt && t.addedAt && Math.abs(t.completedAt - t.addedAt) > 60000 ? `<span class="date-finish-sub">Added: ${formatTaskDate(t.addedAt)}</span>` : ''}
            ` : `
              <span class="date-finish-added">Added: ${formatTaskDate(t.addedAt)}</span>
              <span class="date-finish-sub">${t.status === 'error' ? 'Failed' : (t.status === 'queued' ? 'Queued' : 'Paused')}</span>
            `)}
          </div>
        </td>
        <td><span class="hoster-chip">${escapeHtml(t.hoster || 'Direct')}</span></td>
        <td style="text-align: right;">
          <div class="row-actions">
            ${isDone
              ? `<button class="icon-btn btn-open-file" data-path="${escapeHtml(t.savePath || '')}" title="Open File in default application">
                   <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                 </button>`
              : ''
            }
            ${t.status === 'downloading'
              ? `<button class="icon-btn btn-pause" data-id="${encodeURIComponent(t.id)}" title="Pause">
                   <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>
                 </button>`
              : (t.status !== 'completed'
                ? `<button class="icon-btn btn-resume" data-id="${encodeURIComponent(t.id)}" title="Resume">
                     <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                   </button>`
                : '')
            }
            ${t.status === 'error' || t.status === 'paused'
              ? `<button class="icon-btn btn-update-url" data-id="${encodeURIComponent(t.id)}" title="Refresh / Update Download URL & Resume">
                   <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
                 </button>`
              : ''
            }
            ${((t.isMedia || /\.(mp4|mkv|webm|avi|mov|mp3|m4a|flac|wav|ogg|opus)$/i.test(t.name || '')) && (t.status === 'downloading' || t.status === 'completed' || t.status === 'paused'))
              ? `<button class="icon-btn btn-watch-stream" data-id="${encodeURIComponent(t.id)}" title="Watch Media Stream Live (Buffer playback while downloading)" style="color: #38bdf8;">
                   <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                 </button>`
              : ''
            }
            <button class="icon-btn btn-inspect" onclick="window.segmentVisualizer.open('${encodeURIComponent(t.id)}')" title="Inspect IDM Segments & Allocation Map">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
            </button>
            ${(t.extractedPath || t.extractStatus === 'extracted')
              ? `<button class="icon-btn btn-extracted-folder" data-path="${escapeHtml(t.extractedPath || '')}" title="Open Extracted Folder (${escapeHtml(t.extractedPath || '')})">
                   <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path><path d="M12 11v6m-3-3l3-3 3 3"></path></svg>
                 </button>`
              : ''
            }
            <button class="icon-btn btn-folder" data-path="${escapeHtml(t.savePath || '')}" title="Open Folder">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
            </button>
            <button class="icon-btn btn-del btn-del-disk" data-id="${encodeURIComponent(t.id)}" title="Delete Download (Remove from list or permanently delete from disk)">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
            </button>
          </div>
        </td>
      </tr>
    `;
  }

  // Render Multipart Group Parent Row HTML
  function renderGroupRowHtml(item) {
    const isExpanded = window.expandedGroupKeys.has(item.groupKey);
    let totalBytes = 0;
    let downloadedBytes = 0;
    let totalSpeed = 0;
    let maxEta = 0;
    let completedCount = 0;
    let anyDl = false;
    let anyExtracting = false;
    let allExtracted = true;
    let anyPasswordReq = false;
    let isAllSelected = true;

    let earliestAddedAt = 0;
    let latestCompletedAt = 0;
    for (const t of item.tasks) {
      totalBytes += (t.totalBytes || 0);
      downloadedBytes += (t.downloadedBytes || 0);
      const a = t.addedAt || t.createdAt || 0;
      if (a > 0 && (earliestAddedAt === 0 || a < earliestAddedAt)) earliestAddedAt = a;
      if (t.completedAt && t.completedAt > latestCompletedAt) latestCompletedAt = t.completedAt;
      if (t.status === 'downloading') {
        anyDl = true;
        totalSpeed += (t.speed || 0);
        if (t.eta > maxEta) maxEta = t.eta;
      }
      if (t.status === 'completed') completedCount++;
      if (t.extractStatus === 'extracting') anyExtracting = true;
      if (t.extractStatus !== 'extracted') allExtracted = false;
      if (t.extractStatus === 'password_required') anyPasswordReq = true;
      if (!selectedTaskIds.has(t.id)) isAllSelected = false;
    }

    const allDone = completedCount === item.tasks.length;
    const percent = totalBytes > 0
      ? Math.min(100, Math.floor((downloadedBytes / totalBytes) * 100))
      : (allDone ? 100 : 0);

    let groupStatus = 'queued';
    if (anyDl) groupStatus = 'downloading';
    else if (anyExtracting) groupStatus = 'extracting';
    else if (allDone) groupStatus = 'completed';
    else if (item.tasks.some(t => t.status === 'paused')) groupStatus = 'paused';

    let groupExtractBadge = '';
    const rootTask = item.tasks.find(t => t.multipart?.partNumber === 1) || item.tasks[0];
    const preResolvedCount = item.tasks.filter(t => t.streamPreResolved || t.status === 'completed').length;

    if (item.isPlaylist) {
      if (allDone) {
        groupExtractBadge = `<span class="badge-extracted" style="background: rgba(16, 185, 129, 0.15); color: #34d399; border-color: rgba(16, 185, 129, 0.35);">✔ All Tracks Downloaded</span>`;
      } else if (anyDl) {
        groupExtractBadge = `<span class="badge-waiting-parts" style="background: rgba(56, 189, 248, 0.15); color: #38bdf8; border-color: rgba(56, 189, 248, 0.35);">⚡ Downloading (${completedCount}/${item.tasks.length})</span>`;
      } else if (preResolvedCount > 0) {
        groupExtractBadge = `<span class="badge-waiting-parts" style="background: rgba(56, 189, 248, 0.15); color: #38bdf8; border-color: rgba(56, 189, 248, 0.35);">⚡ ${preResolvedCount}/${item.tasks.length} Stream Ready</span>`;
      }
    } else if (allExtracted) {
      groupExtractBadge = `<span class="badge-extracted" data-path="${(rootTask.extractedPath || '').replace(/"/g, '&quot;')}" title="Extracted to folder (Click to open)">📦 Extracted</span>`;
    } else if (anyExtracting) {
      groupExtractBadge = `<span class="badge-extracting" title="Extracting package in background...">📦 Extracting...</span>`;
    } else if (anyPasswordReq) {
      groupExtractBadge = `<span class="badge-password-req" data-id="${rootTask.id}" title="Password required to extract package! Click to unlock">🔑 Password Required</span>`;
    } else if (!allDone) {
      if (anyDl) {
        groupExtractBadge = `<span class="badge-waiting-parts" style="background: rgba(46, 160, 67, 0.15); color: #3fb950; border-color: rgba(46, 160, 67, 0.3);" title="Active parts are currently downloading">⚡ Downloading (${completedCount}/${item.tasks.length})</span>`;
      } else {
        groupExtractBadge = `<span class="badge-waiting-parts btn-group-force" data-group="${item.groupKey}" style="cursor: pointer;" title="Waiting for parts. Click to Force Download / Extract Now!">⏳ Waiting for Parts (Click to Force)</span>`;
      }
    }

    const groupIconHtml = item.isPlaylist
      ? `<div class="file-app-icon-wrap" style="width: 32px; height: 32px; background: rgba(239, 68, 68, 0.15); color: #ef4444; display: flex; align-items: center; justify-content: center; border-radius: 6px; font-weight: 700; font-size: 0.72rem; border: 1px solid rgba(239, 68, 68, 0.35);">
           <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>
         </div>`
      : `<div class="file-app-icon-wrap" style="width: 32px; height: 32px; background: rgba(56, 189, 248, 0.12); color: #38bdf8; display: flex; align-items: center; justify-content: center; border-radius: 6px; font-weight: 700; font-size: 0.72rem;">PKG</div>`;

    const groupTitlePrefix = item.isPlaylist ? '🎵' : '📦';
    const groupBadgeText = item.isPlaylist ? `${completedCount}/${item.tasks.length} tracks` : `${completedCount}/${item.tasks.length} parts`;
    const playlistFolder = rootTask.savePath ? rootTask.savePath.replace(/\\/g, '/').split('/').slice(0, -1).join('/') : '';
    const groupSubtext = item.isPlaylist
      ? `YouTube Playlist • ${item.tasks.length} tracks • Folder: ${playlistFolder}`
      : `Multipart Package • ${item.tasks.length} files • ${playlistFolder}`;

    const parentRowHtml = `
      <tr data-group-key="${encodeURIComponent(item.groupKey)}" class="group-parent-row ${item.isPlaylist ? 'playlist-group-row' : ''} ${isAllSelected ? 'row-selected' : ''}">
        <td><input type="checkbox" class="group-checkbox" data-group="${encodeURIComponent(item.groupKey)}" ${isAllSelected ? 'checked' : ''}></td>
        <td>
          <div class="file-block">
            ${groupIconHtml}
            <div class="file-details">
              <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
                <button type="button" class="group-expand-toggle ${isExpanded ? 'expanded' : ''}" data-group="${encodeURIComponent(item.groupKey)}" title="${isExpanded ? 'Collapse' : 'Expand'}">
                  ▶
                </button>
                <span class="file-title" style="flex: 1; min-width: 0; font-weight: 700; color: #e6edf3;" title="${escapeHtml(item.groupName)}">
                  ${groupTitlePrefix} ${escapeHtml(item.groupName)}
                </span>
                <span class="group-parts-badge">${escapeHtml(groupBadgeText)}</span>
                ${groupExtractBadge}
              </div>
              <div class="file-subtext">
                <span class="file-entry-date" title="Added: ${formatTaskDateFull(earliestAddedAt)}">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: -1px; margin-right: 3px; opacity: 0.8;"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>${formatTaskDate(earliestAddedAt)}
                </span>
                <span class="subtext-sep">•</span>
                ${escapeHtml(groupSubtext)}
              </div>
            </div>
          </div>
        </td>
        <td><span style="font-family: var(--font-mono); font-weight: 600;">${formatBytes(totalBytes)}</span></td>
        <td>
          <span class="state-tag ${groupStatus}">${groupStatus}</span>
        </td>
        <td class="progress-col">
          ${anyExtracting ? `
            <div class="meter-track extract-track" title="Extracting package (${(rootTask && rootTask.extractProgress !== undefined) ? rootTask.extractProgress : 0}%)">
              <div class="meter-fill extracting" style="width: ${(rootTask && rootTask.extractProgress !== undefined) ? rootTask.extractProgress : 0}%; background: linear-gradient(90deg, #9333ea, #a855f7, #c084fc);"></div>
            </div>
            <div class="meter-stat" style="color: #c084fc; font-weight: 600;">Extracting • ${(rootTask && rootTask.extractProgress !== undefined) ? rootTask.extractProgress : 0}%</div>
          ` : (allDone ? (allExtracted ? `
            <div class="progress-done-state" style="color: #34d399;">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
              <span>Extracted • 100%</span>
            </div>
            <div class="meter-stat">${formatBytes(totalBytes)}</div>
          ` : `
            <div class="progress-done-state">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#3fb950" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
              <span>Complete • 100%</span>
            </div>
            <div class="meter-stat">${formatBytes(totalBytes)}</div>
          `) : (groupStatus === 'canceled' ? `
            <div class="progress-canceled-state">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#8b949e" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>
              <span>Canceled</span>
            </div>
            <div class="meter-stat">${percent}% • ${formatBytes(downloadedBytes)}</div>
          ` : (groupStatus === 'paused' ? `
            <div class="meter-track">
              <div class="meter-fill paused" style="width: ${percent}%;"></div>
            </div>
            <div class="meter-stat">${percent}% • Paused (${formatBytes(downloadedBytes)})</div>
          ` : `
            <div class="meter-track">
              <div class="meter-fill ${anyDl ? 'active' : ''}" style="width: ${percent}%;"></div>
            </div>
            <div class="meter-stat">${percent}% • ${formatBytes(downloadedBytes)}</div>
          `)))}
        </td>
        <td>
          <span style="font-family: var(--font-mono); font-weight: 600; color: ${anyDl ? '#3fb950' : 'var(--text-muted)'};">
            ${anyDl ? formatSpeed(totalSpeed) : '--'}
          </span>
        </td>
        <td title="${anyDl ? `${formatETADuration(maxEta)} (Added: ${formatTaskDateFull(earliestAddedAt)})` : (allDone ? `Completed: ${formatTaskDateFull(latestCompletedAt || earliestAddedAt)}` : `Added: ${formatTaskDateFull(earliestAddedAt)}`)}">
          <div class="date-finish-cell">
            ${anyDl ? `
              <span class="date-finish-eta">${formatETA(maxEta)}</span>
              <span class="date-finish-sub">Added: ${formatTaskDate(earliestAddedAt)}</span>
            ` : (allDone ? `
              <span class="date-finish-done">✓ ${formatTaskDate(latestCompletedAt || earliestAddedAt)}</span>
              ${latestCompletedAt && earliestAddedAt && Math.abs(latestCompletedAt - earliestAddedAt) > 60000 ? `<span class="date-finish-sub">Added: ${formatTaskDate(earliestAddedAt)}</span>` : ''}
            ` : `
              <span class="date-finish-added">Added: ${formatTaskDate(earliestAddedAt)}</span>
              <span class="date-finish-sub">${groupStatus}</span>
            `)}
          </div>
        </td>
        <td><span class="hoster-chip">${item.isPlaylist ? 'YouTube Playlist' : (rootTask.hoster || 'Package')}</span></td>
        <td style="text-align: right;">
          <div class="row-actions">
            ${anyDl
              ? `<button class="icon-btn btn-group-pause" data-group="${item.groupKey}" title="Pause all downloads in ${item.isPlaylist ? 'playlist' : 'package'}">
                   <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>
                 </button>`
              : (!allDone
                ? `<button class="icon-btn btn-group-resume" data-group="${item.groupKey}" title="Resume all downloads in ${item.isPlaylist ? 'playlist' : 'package'}">
                     <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                   </button>`
                : '')
            }
            ${item.isPlaylist ? '' : `
              <button class="icon-btn btn-group-force" data-group="${item.groupKey}" style="color: #e3b341;" title="⚡ Force Download & Extract Now">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
              </button>
              <button class="icon-btn btn-group-inspect" data-group="${item.groupKey}" title="Open Multipart Micro-Manager Inspector">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
              </button>
            `}
            ${(allExtracted || (rootTask && rootTask.extractedPath)) ? `
              <button class="icon-btn btn-group-extracted-folder" data-path="${escapeHtml((rootTask && rootTask.extractedPath) || '')}" title="Open Extracted Folder (${escapeHtml((rootTask && rootTask.extractedPath) || '')})">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path><path d="M12 11v6m-3-3l3-3 3 3"></path></svg>
              </button>
            ` : ''}
            <button class="icon-btn btn-group-folder" data-path="${(rootTask.savePath || '').replace(/"/g, '&quot;')}" title="${item.isPlaylist ? 'Open Playlist Folder' : 'Open Folder'}">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
            </button>
            <button class="icon-btn btn-group-del" data-group="${item.groupKey}" title="Delete All in ${item.isPlaylist ? 'Playlist' : 'Package'}">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
            </button>
          </div>
        </td>
      </tr>
    `;

    let childrenHtml = '';
    if (isExpanded) {
      for (const t of item.tasks) {
        childrenHtml += renderTaskRowHtml(t, true, item.groupKey);
      }
    }

    return parentRowHtml + childrenHtml;
  }

  function getItemValue(item, field) {
    if (item.type === 'group') {
      switch (field) {
        case 'name':
          return (item.groupName || '').toLowerCase();
        case 'size':
          return item.tasks.reduce((sum, t) => sum + (t.totalBytes || 0), 0);
        case 'status': {
          let maxWeight = 0;
          for (const t of item.tasks) {
            const w = getStatusWeight(t.status, t.extractStatus);
            if (w > maxWeight) maxWeight = w;
          }
          return maxWeight;
        }
        case 'progress': {
          const tot = item.tasks.reduce((s, t) => s + (t.totalBytes || 0), 0);
          const done = item.tasks.reduce((s, t) => s + (t.downloadedBytes || 0), 0);
          return tot > 0 ? (done / tot) : 0;
        }
        case 'speed':
          return item.tasks.reduce((s, t) => s + (t.status === 'downloading' ? (t.speed || 0) : 0), 0);
        case 'finish':
        case 'date':
        case 'addedAt':
          return item.addedAt || Math.max(...item.tasks.map(t => t.addedAt || t.createdAt || 0), 0);
        case 'hoster':
          return (item.tasks[0]?.hoster || '').toLowerCase();
        default:
          return 0;
      }
    } else {
      const t = item.task;
      switch (field) {
        case 'name':
          return (t.name || t.filename || '').toLowerCase();
        case 'size':
          return t.totalBytes || 0;
        case 'status':
          return getStatusWeight(t.status, t.extractStatus);
        case 'progress':
          return (t.totalBytes > 0) ? (t.downloadedBytes / t.totalBytes) : (t.status === 'completed' ? 1 : 0);
        case 'speed':
          return (t.status === 'downloading') ? (t.speed || 0) : 0;
        case 'finish':
        case 'date':
        case 'addedAt':
          return t.addedAt || t.createdAt || 0;
        case 'hoster':
          return (t.hoster || '').toLowerCase();
        default:
          return 0;
      }
    }
  }

  function getStatusWeight(status, extractStatus) {
    if (extractStatus === 'extracting') return 95;
    switch (status) {
      case 'downloading':
      case 'assembling':
        return 100;
      case 'extracting':
        return 95;
      case 'paused':
        return 80;
      case 'queued':
        return 75;
      case 'error':
      case 'canceled':
        return 40;
      case 'completed':
        return 10;
      default:
        return 50;
    }
  }

  function sortDownloadItems(items, sortMode, sortCol, sortDir) {
    if (sortCol) {
      const isAsc = sortDir === 'asc';
      items.sort((a, b) => {
        const valA = getItemValue(a, sortCol);
        const valB = getItemValue(b, sortCol);
        if (typeof valA === 'string' && typeof valB === 'string') {
          const cmp = valA.localeCompare(valB);
          return isAsc ? cmp : -cmp;
        }
        if (valA !== valB) {
          return isAsc ? (valA > valB ? 1 : -1) : (valB > valA ? 1 : -1);
        }
        const timeA = a.addedAt || 0;
        const timeB = b.addedAt || 0;
        return timeB - timeA;
      });
      return;
    }

    switch (sortMode) {
      case 'active-first':
        items.sort((a, b) => {
          const weightA = getItemValue(a, 'status');
          const weightB = getItemValue(b, 'status');
          if (weightB !== weightA) return weightB - weightA;
          const timeA = a.addedAt || 0;
          const timeB = b.addedAt || 0;
          return timeB - timeA;
        });
        break;

      case 'date-desc':
        items.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
        break;

      case 'date-asc':
        items.sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0));
        break;

      case 'name-asc':
        items.sort((a, b) => getItemValue(a, 'name').localeCompare(getItemValue(b, 'name')));
        break;

      case 'name-desc':
        items.sort((a, b) => getItemValue(b, 'name').localeCompare(getItemValue(a, 'name')));
        break;

      case 'size-desc':
        items.sort((a, b) => getItemValue(b, 'size') - getItemValue(a, 'size'));
        break;

      case 'size-asc':
        items.sort((a, b) => getItemValue(a, 'size') - getItemValue(b, 'size'));
        break;

      case 'progress-desc':
        items.sort((a, b) => getItemValue(b, 'progress') - getItemValue(a, 'progress'));
        break;

      case 'progress-asc':
        items.sort((a, b) => getItemValue(a, 'progress') - getItemValue(b, 'progress'));
        break;

      case 'speed-desc':
        items.sort((a, b) => getItemValue(b, 'speed') - getItemValue(a, 'speed'));
        break;

      case 'hoster-asc':
        items.sort((a, b) => getItemValue(a, 'hoster').localeCompare(getItemValue(b, 'hoster')));
        break;

      default:
        items.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
        break;
    }
  }

  function updateSortControlsUI() {
    let text = '';
    if (window.appState.sortCol) {
      const colLabels = {
        name: 'Name',
        size: 'Size',
        status: 'Status',
        progress: 'Progress',
        speed: 'Speed',
        finish: 'Est. Finish',
        hoster: 'Hoster'
      };
      const colName = colLabels[window.appState.sortCol] || window.appState.sortCol;
      const arrow = window.appState.sortDir === 'asc' ? '▲' : '▼';
      text = `Sort: ${colName} ${arrow}`;
    } else {
      const modeLabels = {
        'active-first': '⚡ Active First',
        'date-desc': '🕒 Newest Added',
        'date-asc': '🕒 Oldest Added',
        'name-asc': '🔤 Name (A → Z)',
        'name-desc': '🔤 Name (Z → A)',
        'size-desc': '📦 Size (Largest)',
        'size-asc': '📦 Size (Smallest)',
        'progress-desc': '📊 Progress (Highest)',
        'progress-asc': '📊 Progress (Lowest)',
        'speed-desc': '🚀 Speed (Fastest)',
        'hoster-asc': '🌐 Hoster (A → Z)'
      };
      text = `Sort: ${modeLabels[window.appState.sortMode] || 'Active First'}`;
    }

    if (sortStatusLabel) sortStatusLabel.textContent = text;
    if (topbarSortLabel) topbarSortLabel.textContent = text;

    document.querySelectorAll('.sort-dropdown-menu').forEach(menu => {
      menu.querySelectorAll('.sort-option').forEach(opt => {
        const checkEl = opt.querySelector('.sort-check');
        if (!window.appState.sortCol && opt.dataset.sort === window.appState.sortMode) {
          opt.classList.add('selected');
          if (checkEl) checkEl.textContent = '✓';
        } else {
          opt.classList.remove('selected');
          if (checkEl) checkEl.textContent = '';
        }
      });
    });

    // Update table header arrows
    document.querySelectorAll('.downloads-table th.sortable-th').forEach(th => {
      const col = th.dataset.col;
      th.classList.remove('sorted-asc', 'sorted-desc');
      const arrowEl = th.querySelector('.sort-arrow');
      if (arrowEl) arrowEl.textContent = '';

      if (window.appState.sortCol === col) {
        if (window.appState.sortDir === 'asc') {
          th.classList.add('sorted-asc');
          if (arrowEl) arrowEl.textContent = '▲';
        } else {
          th.classList.add('sorted-desc');
          if (arrowEl) arrowEl.textContent = '▼';
        }
      }
    });
  }

  function initTableColumnSorting() {
    const table = document.getElementById('downloads-table');
    if (!table) return;

    table.querySelectorAll('th.sortable-th').forEach(th => {
      th.addEventListener('click', (e) => {
        if (e.target.closest('.col-resize-handle')) return;

        const col = th.dataset.col;
        if (!col) return;

        if (window.appState.sortCol === col) {
          window.appState.sortDir = (window.appState.sortDir === 'asc') ? 'desc' : 'asc';
        } else {
          window.appState.sortCol = col;
          if (col === 'name' || col === 'hoster') {
            window.appState.sortDir = 'asc';
          } else {
            window.appState.sortDir = 'desc';
          }
        }

        window.appState.sortMode = null;
        try {
          localStorage.setItem('waterfall_sort_col', window.appState.sortCol);
          localStorage.setItem('waterfall_sort_dir', window.appState.sortDir);
          localStorage.removeItem('waterfall_sort_mode');
        } catch (_) {}

        updateSortControlsUI();
        renderDownloads();
      });
    });
  }

  // Render Downloads Table
  function renderDownloads() {
    const tasks = window.appState.tasks;
    const filter = window.appState.activeFilter;
    const category = window.appState.activeCategory;
    const search = window.appState.searchQuery;
    const hideFinished = Boolean(window.appState.hideFinished);

    const filtered = tasks.filter(t => {
      if (category && t.category !== category) return false;

      // Filter out completed tasks if hideFinished is active in All Downloads
      // (Completed tasks remain always available when filter === 'completed')
      if (hideFinished && filter === 'all' && t.status === 'completed') {
        return false;
      }

      if (filter === 'downloading' && t.status !== 'downloading' && t.status !== 'assembling') return false;
      if (filter === 'paused' && t.status !== 'paused' && t.status !== 'queued') return false;
      if (filter === 'completed' && t.status !== 'completed') return false;
      if (filter === 'error' && t.status !== 'error' && t.status !== 'canceled') return false;
      if (filter === 'extracting') {
        const isExt = t.extractStatus === 'extracting' ||
                      t.extractStatus === 'extract_queued' ||
                      t.extractStatus === 'password_required' ||
                      t.extractStatus === 'extract_password_required' ||
                      t.extractStatus === 'waiting_parts' ||
                      t.extractStatus === 'waiting_all_parts' ||
                      t.status === 'extracting';
        let siblingExtracting = false;
        if (!isExt && t.multipart && t.multipart.groupKey) {
          siblingExtracting = tasks.some(sib => sib.multipart && sib.multipart.groupKey === t.multipart.groupKey && (
            sib.extractStatus === 'extracting' ||
            sib.extractStatus === 'extract_queued' ||
            sib.extractStatus === 'password_required' ||
            sib.extractStatus === 'extract_password_required' ||
            sib.extractStatus === 'waiting_parts' ||
            sib.extractStatus === 'waiting_all_parts' ||
            sib.status === 'extracting'
          ));
        }
        if (!isExt && !siblingExtracting) return false;
      }

      if (search) {
        const matchName = t.name && t.name.toLowerCase().includes(search);
        const matchHost = t.hoster && t.hoster.toLowerCase().includes(search);
        const matchPack = t.packageName && t.packageName.toLowerCase().includes(search);
        if (!matchName && !matchHost && !matchPack) return false;
      }

      return true;
    });

    if (filtered.length === 0) {
      tableBody.innerHTML = '';
      emptyState.style.display = 'flex';
      const emptyTitle = emptyState.querySelector('.empty-title') || emptyState.querySelector('div:nth-of-type(1)');
      const emptyDesc = emptyState.querySelector('.empty-desc') || emptyState.querySelector('div:nth-of-type(2)');
      const finishedHint = document.getElementById('empty-finished-hint');

      const completedCount = tasks.filter(t => t.status === 'completed').length;
      if (hideFinished && filter === 'all' && completedCount > 0) {
        if (emptyTitle) emptyTitle.textContent = 'Active Queue is Clear';
        if (emptyDesc) emptyDesc.textContent = `${completedCount} finished download${completedCount > 1 ? 's are' : ' is'} hidden. You can show them below or view them anytime under the Finished tab.`;
        if (finishedHint) finishedHint.style.display = 'flex';
      } else {
        if (finishedHint) finishedHint.style.display = 'none';
        if (emptyTitle && emptyDesc) {
          if (filter === 'extracting') {
            emptyTitle.textContent = 'No Archives Currently Being Extracted';
            emptyDesc.textContent = 'Archives currently unpacking, queued, or awaiting password input will appear here in real-time.';
          } else if (filter === 'completed') {
            emptyTitle.textContent = 'No Finished Downloads';
            emptyDesc.textContent = 'Completed downloads will appear here with instant file opening and folder explorer shortcuts.';
          } else {
            emptyTitle.textContent = 'Queue is Ready for Downloads';
            emptyDesc.textContent = 'Add direct URLs, download YouTube playlists and audio streams, or crawl links with multi-socket acceleration.';
          }
        }
      }
      rowDomCache.clear();
      groupDomCache.clear();
      return;
    }

    const finishedHint = document.getElementById('empty-finished-hint');
    if (finishedHint) finishedHint.style.display = 'none';
    emptyState.style.display = 'none';

    const renderItems = getGroupedDownloads(filtered);
    sortDownloadItems(renderItems, window.appState.sortMode, window.appState.sortCol, window.appState.sortDir);
    updateSortControlsUI();
    let html = '';

    for (const item of renderItems) {
      if (item.type === 'group') {
        html += renderGroupRowHtml(item);
      } else {
        html += renderTaskRowHtml(item.task, false, null);
      }
    }

    tableBody.innerHTML = html;

    // Cache DOM Elements for O(1) Updates during High-Frequency 250ms Ticks
    rowDomCache.clear();
    groupDomCache.clear();

    tableBody.querySelectorAll('tr.download-row').forEach(row => {
      const id = row.dataset.id;
      if (!id) return;
      rowDomCache.set(id, {
        row,
        fill: row.querySelector('.meter-fill'),
        stat: row.querySelector('.meter-stat'),
        speedSpan: row.children[5]?.querySelector('span'),
        etaSpan: row.children[6]?.querySelector('.date-finish-eta') || row.children[6]?.querySelector('span'),
        etaTd: row.children[6],
        statusTag: row.children[3]?.querySelector('.state-tag')
      });
    });

    tableBody.querySelectorAll('tr.group-parent-row').forEach(gRow => {
      const gk = gRow.dataset.groupKey;
      if (!gk) return;
      groupDomCache.set(gk, {
        row: gRow,
        fill: gRow.querySelector('.meter-fill'),
        stat: gRow.querySelector('.meter-stat'),
        speedSpan: gRow.children[5]?.querySelector('span'),
        etaSpan: gRow.children[6]?.querySelector('.date-finish-eta') || gRow.children[6]?.querySelector('span'),
        etaTd: gRow.children[6],
        statusTag: gRow.children[3]?.querySelector('.state-tag'),
        countBadge: gRow.querySelector('.group-parts-badge')
      });
    });

    updateBatchBar();
  }

  function updateBatchBar() {
    if (!batchBar) return;
    if (selectedTaskIds.size > 0) {
      batchBar.style.display = 'flex';
      batchSelectedCount.textContent = `${selectedTaskIds.size} task${selectedTaskIds.size > 1 ? 's' : ''} selected`;
    } else {
      batchBar.style.display = 'none';
    }
  }

  function getGroupSiblings(gk) {
    if (!gk) return [];
    return window.appState.tasks.filter(t => 
      (t.multipart && t.multipart.groupKey === gk) ||
      (t.playlistId === gk) ||
      (t.playlistGroup && t.playlistGroup.id === gk) ||
      ('pl_' + (t.packageName || '').trim().toLowerCase() === gk)
    );
  }

  // High-Performance Event Delegation for Downloads Table (Single listener per event type)
  function initTableDelegatedEvents() {
    if (!tableBody) return;

    // 1. Delegated Change Events (Checkboxes)
    tableBody.addEventListener('change', (e) => {
      const target = e.target;
      if (!target) return;

      if (target.classList.contains('task-checkbox')) {
        const id = target.dataset.id;
        if (target.checked) {
          selectedTaskIds.add(id);
        } else {
          selectedTaskIds.delete(id);
        }
        updateBatchBar();
        const row = target.closest('tr');
        if (row) row.classList.toggle('row-selected', target.checked);
        return;
      }

      if (target.classList.contains('group-checkbox')) {
        const gk = target.dataset.group;
        const siblings = getGroupSiblings(gk);
        for (const s of siblings) {
          if (target.checked) {
            selectedTaskIds.add(s.id);
          } else {
            selectedTaskIds.delete(s.id);
          }
        }
        updateBatchBar();
        renderDownloads();
        return;
      }
    });

    // 2. Delegated Click Events (Buttons, Badges, Toggles)
    tableBody.addEventListener('click', (e) => {
      const target = e.target;
      if (!target) return;

      // Group expand/collapse toggle
      const expandToggle = target.closest('.group-expand-toggle');
      if (expandToggle) {
        e.stopPropagation();
        const gk = expandToggle.dataset.group;
        if (window.expandedGroupKeys.has(gk)) {
          window.expandedGroupKeys.delete(gk);
        } else {
          window.expandedGroupKeys.add(gk);
        }
        renderDownloads();
        return;
      }

      // Extracted folder badges
      const extractedBadge = target.closest('.badge-extracted');
      if (extractedBadge) {
        e.stopPropagation();
        const folder = extractedBadge.dataset.path;
        if (folder) openFolder(folder);
        return;
      }

      // Password required badges
      const pwdBadge = target.closest('.badge-password-req');
      if (pwdBadge) {
        e.stopPropagation();
        const id = pwdBadge.dataset.id;
        const task = window.appState.tasks.find(t => t.id === id);
        openExtractPasswordPrompt(id, task ? task.name : 'Encrypted Archive');
        return;
      }

      // Group Pause
      const btnGroupPause = target.closest('.btn-group-pause');
      if (btnGroupPause) {
        e.stopPropagation();
        const gk = btnGroupPause.dataset.group;
        const siblings = getGroupSiblings(gk);
        fetch('/api/downloads/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'pause', ids: siblings.map(s => s.id) })
        });
        return;
      }

      // Group Resume
      const btnGroupResume = target.closest('.btn-group-resume');
      if (btnGroupResume) {
        e.stopPropagation();
        const gk = btnGroupResume.dataset.group;
        const siblings = getGroupSiblings(gk);
        fetch('/api/downloads/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'resume', ids: siblings.map(s => s.id) })
        });
        return;
      }

      // Group Force
      const btnGroupForce = target.closest('.btn-group-force');
      if (btnGroupForce) {
        e.stopPropagation();
        const gk = btnGroupForce.dataset.group;
        btnGroupForce.disabled = true;
        fetch(`/api/downloads/group/${encodeURIComponent(gk)}/force-download`, { method: 'POST' })
          .catch(err => alert('Force download failed: ' + err.message))
          .finally(() => { btnGroupForce.disabled = false; });
        return;
      }

      // Group Inspect
      const btnGroupInspect = target.closest('.btn-group-inspect');
      if (btnGroupInspect) {
        e.stopPropagation();
        if (window.segmentVisualizer && window.segmentVisualizer.openGroup) {
          window.segmentVisualizer.openGroup(btnGroupInspect.dataset.group);
        }
        return;
      }

      // Group Extracted Folder
      const btnGroupExtractedFolder = target.closest('.btn-group-extracted-folder');
      if (btnGroupExtractedFolder) {
        e.stopPropagation();
        const p = btnGroupExtractedFolder.dataset.path;
        if (p) openFolder(p);
        return;
      }

      // Group Folder
      const btnGroupFolder = target.closest('.btn-group-folder');
      if (btnGroupFolder) {
        e.stopPropagation();
        const p = btnGroupFolder.dataset.path;
        if (p) openFolder(p);
        return;
      }

      // Group Delete
      const btnGroupDel = target.closest('.btn-group-del');
      if (btnGroupDel) {
        e.stopPropagation();
        const gk = btnGroupDel.dataset.group;
        const siblings = getGroupSiblings(gk);
        if (siblings.length > 0) openDeleteConfirmModal(siblings);
        return;
      }

      // Open File
      const btnOpenFile = target.closest('.btn-open-file');
      if (btnOpenFile) {
        e.stopPropagation();
        openFile(btnOpenFile.dataset.path);
        return;
      }

      // Task Pause
      const btnPause = target.closest('.btn-pause');
      if (btnPause) {
        e.stopPropagation();
        fetch(`/api/downloads/${btnPause.dataset.id}/pause`, { method: 'POST' });
        return;
      }

      // Task Resume
      const btnResume = target.closest('.btn-resume');
      if (btnResume) {
        e.stopPropagation();
        fetch(`/api/downloads/${btnResume.dataset.id}/resume`, { method: 'POST' });
        return;
      }

      // Task Delete
      const btnDel = target.closest('.btn-del');
      if (btnDel) {
        e.stopPropagation();
        const id = btnDel.dataset.id;
        const task = window.appState.tasks.find(t => t.id === id || String(t.id) === String(id));
        if (!task) return;
        if (e.shiftKey) {
          if (confirm(`Permanently delete "${task.name || task.filename}" from disk and remove from list?`)) {
            window.appState.tasks = window.appState.tasks.filter(t => t.id !== task.id && String(t.id) !== String(task.id));
            selectedTaskIds.delete(task.id);
            selectedTaskIds.delete(String(task.id));
            renderDownloads();
            updateBadges();
            fetch(`/api/downloads/${task.id}?deleteFile=true`, { method: 'DELETE' });
          }
        } else {
          openDeleteConfirmModal([task]);
        }
        return;
      }

      // Task Extracted Folder
      const btnExtractedFolder = target.closest('.btn-extracted-folder');
      if (btnExtractedFolder) {
        e.stopPropagation();
        const p = btnExtractedFolder.dataset.path;
        if (p) openFolder(p);
        return;
      }

      // Task Folder
      const btnFolder = target.closest('.btn-folder');
      if (btnFolder) {
        e.stopPropagation();
        const p = btnFolder.dataset.path;
        if (p) openFolder(p);
        return;
      }

      // Update URL
      const btnUpdateUrl = target.closest('.btn-update-url');
      if (btnUpdateUrl) {
        e.stopPropagation();
        const task = window.appState.tasks.find(t => t.id === btnUpdateUrl.dataset.id);
        if (task) openUpdateUrlModal(task);
        return;
      }

      // Watch Stream / Media Player
      const btnWatch = target.closest('.btn-watch-stream');
      if (btnWatch) {
        e.stopPropagation();
        const task = window.appState.tasks.find(t => t.id === btnWatch.dataset.id);
        if (task) openMediaPlayer(task);
        return;
      }
    });

    // 3. Delegated Context Menu (Right-Click)
    tableBody.addEventListener('contextmenu', (e) => {
      const row = e.target.closest('tr.download-row');
      if (row) {
        e.preventDefault();
        const task = window.appState.tasks.find(t => t.id === row.dataset.id);
        if (task) {
          openContextMenu(e.clientX, e.clientY, task);
        }
      }
    });

    // 4. Delegated Double-Click
    tableBody.addEventListener('dblclick', (e) => {
      if (e.target.closest('button, input, a, select')) return;
      const row = e.target.closest('tr.download-row');
      if (row) {
        const task = window.appState.tasks.find(t => t.id === row.dataset.id);
        if (task) {
          if (task.status === 'completed' && task.savePath) {
            openFile(task.savePath);
          } else {
            window.segmentVisualizer.open(task.id);
          }
        }
      }
    });
  }

  initTableDelegatedEvents();

  // Header Select All Checkbox
  if (checkSelectAllDownloads) {
    checkSelectAllDownloads.onchange = () => {
      const isChecked = checkSelectAllDownloads.checked;
      tableBody.querySelectorAll('.task-checkbox').forEach(cb => {
        cb.checked = isChecked;
        if (isChecked) {
          selectedTaskIds.add(cb.dataset.id);
        } else {
          selectedTaskIds.delete(cb.dataset.id);
        }
        const row = cb.closest('tr');
        if (row) row.classList.toggle('row-selected', isChecked);
      });
      updateBatchBar();
    };
  }

  // Batch Bar Actions
  if (btnBatchResume) {
    btnBatchResume.onclick = async () => {
      if (selectedTaskIds.size === 0) return;
      await fetch('/api/downloads/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'resume', ids: Array.from(selectedTaskIds) })
      });
    };
  }

  if (btnBatchPause) {
    btnBatchPause.onclick = async () => {
      if (selectedTaskIds.size === 0) return;
      await fetch('/api/downloads/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'pause', ids: Array.from(selectedTaskIds) })
      });
    };
  }

  if (btnBatchDelete) {
    btnBatchDelete.onclick = () => {
      if (selectedTaskIds.size === 0) return;
      const tasks = window.appState.tasks.filter(t => selectedTaskIds.has(t.id));
      openDeleteConfirmModal(tasks);
    };
  }

  // Desktop Context Menu Implementation
  function openContextMenu(x, y, task) {
    contextTask = task;
    if (!contextMenu) return;

    // Boundary check so menu doesn't go off screen
    const menuWidth = 220;
    const menuHeight = 240;
    const posX = (x + menuWidth > window.innerWidth) ? (window.innerWidth - menuWidth - 10) : x;
    const posY = (y + menuHeight > window.innerHeight) ? (window.innerHeight - menuHeight - 10) : y;

    contextMenu.style.left = `${posX}px`;
    contextMenu.style.top = `${posY}px`;
    contextMenu.style.display = 'block';

    // Show/hide or disable specific options based on task state
    const isCompleted = task.status === 'completed';
    const isArchive = task.name && (/\.(zip|rar|7z|tar\.gz|tar\.bz2|tar|tgz|001|r00|r01|part1\.rar|part\d+\.rar)$/i.test(task.name) || Boolean(task.multipart));

    const itemExtract = document.getElementById('ctx-extract-archive');
    if (itemExtract) {
      itemExtract.style.display = (isArchive && isCompleted) ? 'flex' : 'none';
    }

    const itemOpenExtracted = document.getElementById('ctx-open-extracted-folder');
    if (itemOpenExtracted) {
      itemOpenExtracted.style.display = (task.extractedPath || task.extractStatus === 'extracted') ? 'flex' : 'none';
    }

    const itemUpdateLink = document.getElementById('ctx-update-link');
    if (itemUpdateLink) {
      itemUpdateLink.style.display = isCompleted ? 'none' : 'flex';
    }

    const itemPauseResume = document.getElementById('ctx-pause-resume');
    if (itemPauseResume) {
      itemPauseResume.textContent = (task.status === 'downloading') ? '⏸️ Pause Download' : '▶️ Resume Download';
      itemPauseResume.style.display = isCompleted ? 'none' : 'flex';
    }

    // Queue reordering options (only for incomplete downloads)
    const mTop = document.getElementById('ctx-move-top');
    const mUp = document.getElementById('ctx-move-up');
    const mDown = document.getElementById('ctx-move-down');
    const mBottom = document.getElementById('ctx-move-bottom');
    if (mTop) mTop.style.display = isCompleted ? 'none' : 'flex';
    if (mUp) mUp.style.display = isCompleted ? 'none' : 'flex';
    if (mDown) mDown.style.display = isCompleted ? 'none' : 'flex';
    if (mBottom) mBottom.style.display = isCompleted ? 'none' : 'flex';

    // Priority labels
    const prioHigh = document.getElementById('ctx-set-priority-high');
    const prioNormal = document.getElementById('ctx-set-priority-normal');
    if (prioHigh) {
      prioHigh.textContent = task.priority === 'high' ? '✓ 🔴 High Queue Priority' : '🔴 High Queue Priority';
    }
    if (prioNormal) {
      prioNormal.textContent = (task.priority !== 'high' && task.priority !== 'low') ? '✓ 🔵 Normal Priority' : '🔵 Normal Priority';
    }
  }

  function hideContextMenu() {
    if (contextMenu) contextMenu.style.display = 'none';
    contextTask = null;
  }

  document.addEventListener('click', (e) => {
    if (contextMenu && !contextMenu.contains(e.target)) {
      hideContextMenu();
    }
    if (powerDropdownMenu && !e.target.closest('.power-dropdown-wrap')) {
      powerDropdownMenu.classList.remove('show');
    }
  });

  // Open helpers (supports Electron native shell & web backend)
  async function openFile(filePath) {
    if (!filePath) return;
    if (desktop && desktop.openFile) {
      return desktop.openFile(filePath);
    }
    return fetch('/api/open-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath })
    }).then(r => r.json()).catch(() => {});
  }

  async function openFolder(filePath) {
    if (!filePath) return;
    if (desktop && desktop.openFolder) {
      return desktop.openFolder(filePath);
    }
    return fetch('/api/open-folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath })
    }).then(r => r.json()).catch(() => {});
  }

  // Context Menu Item Listeners
  const ctxOpenFile = document.getElementById('ctx-open-file');
  if (ctxOpenFile) {
    ctxOpenFile.onclick = () => {
      if (contextTask && contextTask.savePath) {
        openFile(contextTask.savePath);
      }
      hideContextMenu();
    };
  }

  const ctxOpenFolder = document.getElementById('ctx-open-folder');
  if (ctxOpenFolder) {
    ctxOpenFolder.onclick = () => {
      if (contextTask && contextTask.savePath) {
        openFolder(contextTask.savePath);
      }
      hideContextMenu();
    };
  }

  const ctxOpenExtFolder = document.getElementById('ctx-open-extracted-folder');
  if (ctxOpenExtFolder) {
    ctxOpenExtFolder.onclick = () => {
      if (contextTask && contextTask.extractedPath) {
        openFolder(contextTask.extractedPath);
      }
      hideContextMenu();
    };
  }

  const ctxExtractArchive = document.getElementById('ctx-extract-archive');
  if (ctxExtractArchive) {
    ctxExtractArchive.onclick = async () => {
      if (contextTask) {
        const id = contextTask.id;
        const taskName = contextTask.name;
        hideContextMenu();
        const res = await fetch(`/api/downloads/${id}/extract`, { method: 'POST' });
        const data = await res.json();
        if (data.passwordRequired) {
          openExtractPasswordPrompt(id, taskName);
        } else if (data.success) {
          alert(`Archive queued/extracted to:\n${data.outDir}`);
        } else {
          alert(`Extraction status: ${data.error || 'Queued in worker'}`);
        }
      }
    };
  }

  const ctxVerifyChecksum = document.getElementById('ctx-verify-checksum');
  if (ctxVerifyChecksum) {
    ctxVerifyChecksum.onclick = async () => {
      if (contextTask) {
        const id = contextTask.id;
        hideContextMenu();
        const res = await fetch(`/api/downloads/${id}/verify`);
        const data = await res.json();
        if (data.success) {
          alert(`File Integrity Verified (SHA-256):\n\n${data.sha256}`);
        } else {
          alert(`Verification failed: ${data.error || 'File not found'}`);
        }
      }
    };
  }

  const ctxCopyLink = document.getElementById('ctx-copy-link');
  if (ctxCopyLink) {
    ctxCopyLink.onclick = () => {
      if (contextTask && contextTask.url) {
        navigator.clipboard.writeText(contextTask.url);
      }
      hideContextMenu();
    };
  }

  const ctxUpdateLink = document.getElementById('ctx-update-link');
  if (ctxUpdateLink) {
    ctxUpdateLink.onclick = () => {
      if (contextTask) openUpdateUrlModal(contextTask);
      hideContextMenu();
    };
  }

  const ctxPauseResume = document.getElementById('ctx-pause-resume');
  if (ctxPauseResume) {
    ctxPauseResume.onclick = () => {
      if (contextTask) {
        if (contextTask.status === 'downloading') {
          fetch(`/api/downloads/${contextTask.id}/pause`, { method: 'POST' });
        } else {
          fetch(`/api/downloads/${contextTask.id}/resume`, { method: 'POST' });
        }
      }
      hideContextMenu();
    };
  }

  // Queue Reorder Actions
  const ctxMoveTop = document.getElementById('ctx-move-top');
  if (ctxMoveTop) {
    ctxMoveTop.onclick = async () => {
      if (contextTask) {
        const id = contextTask.id;
        hideContextMenu();
        await fetch('/api/queue/move-top', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id })
        });
      }
    };
  }

  const ctxMoveUp = document.getElementById('ctx-move-up');
  if (ctxMoveUp) {
    ctxMoveUp.onclick = async () => {
      if (contextTask) {
        const id = contextTask.id;
        hideContextMenu();
        await fetch('/api/queue/move-up', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id })
        });
      }
    };
  }

  const ctxMoveDown = document.getElementById('ctx-move-down');
  if (ctxMoveDown) {
    ctxMoveDown.onclick = async () => {
      if (contextTask) {
        const id = contextTask.id;
        hideContextMenu();
        await fetch('/api/queue/move-down', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id })
        });
      }
    };
  }

  const ctxMoveBottom = document.getElementById('ctx-move-bottom');
  if (ctxMoveBottom) {
    ctxMoveBottom.onclick = async () => {
      if (contextTask) {
        const id = contextTask.id;
        hideContextMenu();
        await fetch('/api/queue/move-bottom', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id })
        });
      }
    };
  }

  const ctxSetPrioHigh = document.getElementById('ctx-set-priority-high');
  if (ctxSetPrioHigh) {
    ctxSetPrioHigh.onclick = async () => {
      if (contextTask) {
        const id = contextTask.id;
        hideContextMenu();
        await fetch('/api/queue/priority', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, priority: 'high' })
        });
      }
    };
  }

  const ctxSetPrioNormal = document.getElementById('ctx-set-priority-normal');
  if (ctxSetPrioNormal) {
    ctxSetPrioNormal.onclick = async () => {
      if (contextTask) {
        const id = contextTask.id;
        hideContextMenu();
        await fetch('/api/queue/priority', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, priority: 'normal' })
        });
      }
    };
  }

  const ctxDeleteDisk = document.getElementById('ctx-delete-disk');
  if (ctxDeleteDisk) {
    ctxDeleteDisk.onclick = () => {
      if (contextTask) {
        const task = contextTask;
        hideContextMenu();
        openDeleteConfirmModal([task]);
      }
    };
  }

  const ctxDeleteList = document.getElementById('ctx-delete-list');
  if (ctxDeleteList) {
    ctxDeleteList.onclick = () => {
      if (contextTask) {
        const id = contextTask.id;
        hideContextMenu();
        window.appState.tasks = window.appState.tasks.filter(t => t.id !== id && String(t.id) !== String(id));
        selectedTaskIds.delete(id);
        selectedTaskIds.delete(String(id));
        renderDownloads();
        updateBadges();
        fetch(`/api/downloads/${id}?deleteFile=false`, { method: 'DELETE' });
      }
    };
  }

  // Power Management Dropdown Handlers
  if (btnPowerMenu && powerDropdownMenu) {
    btnPowerMenu.onclick = (e) => {
      e.stopPropagation();
      powerDropdownMenu.classList.toggle('show');
    };

    powerDropdownMenu.querySelectorAll('.power-option').forEach(opt => {
      opt.onclick = async () => {
        const action = opt.dataset.power;
        await fetch('/api/power', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action })
        });
        powerDropdownMenu.querySelectorAll('.power-option').forEach(o => o.classList.remove('selected'));
        opt.classList.add('selected');
        powerDropdownMenu.classList.remove('show');
        updatePowerLabel(action);
      };
    });
  }

  function updatePowerLabel(action) {
    if (!powerStatusLabel) return;
    if (action === 'shutdown') {
      powerStatusLabel.textContent = 'Power: ⚡ Shutdown';
      powerStatusLabel.style.color = '#ef4444';
    } else if (action === 'sleep') {
      powerStatusLabel.textContent = 'Power: 💤 Sleep';
      powerStatusLabel.style.color = '#3b82f6';
    } else {
      powerStatusLabel.textContent = 'Power: Off';
      powerStatusLabel.style.color = '';
    }
  }

  // Fetch initial power status
  fetch('/api/power').then(r => r.json()).then(data => {
    if (data && data.action) updatePowerLabel(data.action);
  }).catch(() => {});

  // Update Tick (Zero-DOM-Query High-Performance Animation Frame Loop)
  window.addEventListener('state:tick', (e) => {
    if (globalSpeedDisplay) globalSpeedDisplay.textContent = formatSpeed(window.appState.globalSpeed);
    updateBadges();

    if (window.appState.activeView === 'downloads') {
      window.requestAnimationFrame(() => {
        const activeUpdates = (e.detail && e.detail.tasks) ? e.detail.tasks : window.appState.tasks;
        const touchedGroups = new Set();

        for (const update of activeUpdates) {
          const cached = rowDomCache.get(update.id);
          if (cached) {
            if (update.extractStatus === 'extracting') {
              const extPct = update.extractProgress !== undefined ? update.extractProgress : 0;
              if (cached.fill) {
                cached.fill.style.width = extPct + '%';
                cached.fill.style.background = 'linear-gradient(90deg, #9333ea, #a855f7, #c084fc)';
              } else if (cached.row) {
                const progCol = cached.row.querySelector('.progress-col');
                if (progCol) {
                  progCol.innerHTML = `
                    <div class="meter-track extract-track" title="Extracting archive (${extPct}%)">
                      <div class="meter-fill extracting" style="width: ${extPct}%; background: linear-gradient(90deg, #9333ea, #a855f7, #c084fc);"></div>
                    </div>
                    <div class="meter-stat" style="color: #c084fc; font-weight: 600;">Extracting • ${extPct}%</div>
                  `;
                  cached.fill = progCol.querySelector('.meter-fill');
                  cached.stat = progCol.querySelector('.meter-stat');
                }
              }
              if (cached.stat) {
                cached.stat.textContent = `Extracting • ${extPct}%`;
                cached.stat.style.color = '#c084fc';
              }
              if (cached.statusTag) {
                cached.statusTag.textContent = 'extracting';
                cached.statusTag.className = 'state-tag extracting';
              }
              if (cached.speedSpan) {
                cached.speedSpan.textContent = 'Extracting';
                cached.speedSpan.style.color = '#c084fc';
              }
              if (cached.etaSpan) {
                cached.etaSpan.textContent = `${extPct}%`;
              }
            } else {
              const percent = (update.totalBytes > 0)
                ? Math.min(100, Math.floor((update.downloadedBytes / update.totalBytes) * 100))
                : (update.status === 'completed' ? 100 : 0);

              if (cached.fill) {
                cached.fill.style.width = percent + '%';
                if (update.status === 'downloading') cached.fill.style.background = '';
              }
              if (cached.stat) {
                cached.stat.textContent = `${percent}% • ${formatBytes(update.downloadedBytes)}`;
                cached.stat.style.color = '';
              }
              if (cached.speedSpan) {
                cached.speedSpan.textContent = (update.status === 'downloading') ? formatSpeed(update.speed) : '--';
                cached.speedSpan.style.color = (update.status === 'downloading') ? '#3fb950' : 'var(--text-muted)';
              }
              if (cached.etaSpan) {
                cached.etaSpan.textContent = (update.status === 'downloading')
                  ? formatETA(update.eta)
                  : (update.status === 'completed' ? 'Completed' : '--');
                if (cached.etaTd) {
                  cached.etaTd.title = (update.status === 'downloading')
                    ? formatETADuration(update.eta)
                    : '';
                }
              }
            }

            const fullTask = window.appState.tasks.find(t => t.id === update.id);
            if (fullTask && fullTask.multipart && fullTask.multipart.groupKey) {
              touchedGroups.add(fullTask.multipart.groupKey);
            }
          }
        }

        // Batch update touched multipart parent groups in O(1)
        for (const gk of touchedGroups) {
          const gCached = groupDomCache.get(gk);
          if (!gCached) continue;
          const groupTasks = window.appState.tasks.filter(t => t.multipart && t.multipart.groupKey === gk);
          let gTotal = 0, gDownloaded = 0, gSpeed = 0, gMaxEta = 0;
          let anyDl = false;
          let completedCount = 0;
          for (const t of groupTasks) {
            gTotal += (t.totalBytes || 0);
            gDownloaded += (t.downloadedBytes || 0);
            if (t.status === 'downloading') {
              anyDl = true;
              gSpeed += (t.speed || 0);
              if (t.eta > gMaxEta) gMaxEta = t.eta;
            }
            if (t.status === 'completed') completedCount++;
          }

          const anyGroupExtracting = groupTasks.some(t => t.extractStatus === 'extracting');
          if (anyGroupExtracting) {
            const root = groupTasks.find(t => t.multipart?.partNumber === 1) || groupTasks[0];
            const extPct = (root && root.extractProgress !== undefined) ? root.extractProgress : (groupTasks.find(t => t.extractProgress !== undefined)?.extractProgress || 0);
            if (gCached.fill) {
              gCached.fill.style.width = extPct + '%';
              gCached.fill.style.background = 'linear-gradient(90deg, #9333ea, #a855f7, #c084fc)';
            } else if (gCached.row) {
              const progCol = gCached.row.querySelector('.progress-col');
              if (progCol) {
                progCol.innerHTML = `
                  <div class="meter-track extract-track" title="Extracting package (${extPct}%)">
                    <div class="meter-fill extracting" style="width: ${extPct}%; background: linear-gradient(90deg, #9333ea, #a855f7, #c084fc);"></div>
                  </div>
                  <div class="meter-stat" style="color: #c084fc; font-weight: 600;">Extracting • ${extPct}%</div>
                `;
                gCached.fill = progCol.querySelector('.meter-fill');
                gCached.stat = progCol.querySelector('.meter-stat');
              }
            }
            if (gCached.stat) {
              gCached.stat.textContent = `Extracting • ${extPct}%`;
              gCached.stat.style.color = '#c084fc';
            }
            if (gCached.statusTag) {
              gCached.statusTag.textContent = 'extracting';
              gCached.statusTag.className = 'state-tag extracting';
            }
            if (gCached.speedSpan) {
              gCached.speedSpan.textContent = 'Extracting';
              gCached.speedSpan.style.color = '#c084fc';
            }
            if (gCached.etaSpan) {
              gCached.etaSpan.textContent = `${extPct}%`;
            }
          } else {
            const gPercent = gTotal > 0 ? Math.min(100, Math.floor((gDownloaded / gTotal) * 100)) : 0;
            if (gCached.fill) {
              gCached.fill.style.width = gPercent + '%';
              if (anyDl) gCached.fill.style.background = '';
            }
            if (gCached.stat) {
              gCached.stat.textContent = `${gPercent}% • ${formatBytes(gDownloaded)}`;
              gCached.stat.style.color = '';
            }
            if (gCached.speedSpan) {
              gCached.speedSpan.textContent = anyDl ? formatSpeed(gSpeed) : '--';
              gCached.speedSpan.style.color = anyDl ? '#3fb950' : 'var(--text-muted)';
            }
            if (gCached.etaSpan) {
              gCached.etaSpan.textContent = anyDl ? formatETA(gMaxEta) : (completedCount === groupTasks.length ? 'Completed' : '--');
            }
            if (gCached.countBadge) {
              gCached.countBadge.textContent = `${completedCount}/${groupTasks.length} parts`;
            }
          }
        }
      });
    }

    // Sync with Electron Taskbar (only for active running downloads)
    if (desktop && desktop.updateTaskbarProgress) {
      const activeTasks = window.appState.tasks.filter(t => t.status === 'downloading' || t.status === 'assembling');

      if (activeTasks.length === 0) {
        desktop.updateTaskbarProgress({ progress: -1, activeCount: 0 });
      } else {
        let total = 0, downloaded = 0;
        for (const t of activeTasks) {
          if (t.totalBytes > 0) {
            total += t.totalBytes;
            downloaded += (t.downloadedBytes || 0);
          }
        }
        const progress = total > 0 ? (downloaded / total) : 0;
        const primaryTask = activeTasks[0];
        desktop.updateTaskbarProgress({
          progress,
          speed: formatSpeed(window.appState.globalSpeed),
          status: 'downloading',
          activeCount: activeTasks.length,
          taskName: primaryTask ? (primaryTask.name || primaryTask.filename) : 'Active Downloads'
        });
      }
    }
  });

  // State Change / Full Re-render
  window.addEventListener('state:change', () => {
    renderDownloads();
    updateBadges();
  });

  window.addEventListener('state:init', () => {
    renderDownloads();
    renderGrabber();
    updateBadges();
  });

  window.addEventListener('state:grabber', () => {
    renderGrabber();
    updateBadges();
  });

  // Cold-start & initial state recovery: render immediately if state already exists, plus fallback API fetch
  if (window.appState && window.appState.tasks && window.appState.tasks.length > 0) {
    renderDownloads();
    renderGrabber();
    updateBadges();
  }

  fetch('/api/downloads')
    .then(r => r.json())
    .then(tasks => {
      if (tasks && Array.isArray(tasks)) {
        window.appState.tasks = tasks;
        renderDownloads();
        updateBadges();
      }
    })
    .catch(() => {});

  const completionContainer = document.getElementById('completion-notifications-container');

  // Request browser notification permission on first user interaction if supported
  if ('Notification' in window && Notification.permission === 'default') {
    const requestNotif = () => {
      Notification.requestPermission();
      document.removeEventListener('click', requestNotif);
    };
    document.addEventListener('click', requestNotif, { once: true });
  }

  // Default Application Icon & Metadata Provider
  async function fetchAppIcon(filePath, filename) {
    const ext = filename && filename.includes('.') ? ('.' + filename.split('.').pop().toLowerCase()) : '';
    const iconCacheKey = ext || (filePath ? filePath.toLowerCase() : '');

    if (iconCacheKey && appIconClientCache.has(iconCacheKey)) {
      return appIconClientCache.get(iconCacheKey);
    }
    if (iconCacheKey && appIconInFlightPromises.has(iconCacheKey)) {
      return appIconInFlightPromises.get(iconCacheKey);
    }

    const promise = (async () => {
      // Check if running in Electron
      if (desktop && desktop.getAppIcon) {
        try {
          const res = await desktop.getAppIcon(filePath, ext);
          if (res && res.icon) {
            if (iconCacheKey) appIconClientCache.set(iconCacheKey, res);
            return res;
          }
        } catch (_) {}
      }

      // Call Waterfall backend
      try {
        const q = new URLSearchParams();
        if (filePath) q.set('path', filePath);
        if (ext) q.set('ext', ext);
        const res = await fetch(`/api/app-icon?${q.toString()}`);
        if (res.ok) {
          const data = await res.json();
          if (iconCacheKey && data && data.icon) {
            appIconClientCache.set(iconCacheKey, data);
          }
          return data;
        }
      } catch (_) {}

      return null;
    })().finally(() => {
      if (iconCacheKey) appIconInFlightPromises.delete(iconCacheKey);
    });

    if (iconCacheKey) appIconInFlightPromises.set(iconCacheKey, promise);
    return promise;
  }

  function showCompletionNotification(task) {
    if (!task) return;

    // Check sound setting
    const config = window.appState.config || {};
    if (config.soundChime !== false) {
      playCompletionChime();
    }

    // Trigger browser native notification ONLY when running in standard browser mode (not desktop Electron) and document is hidden
    if (!desktop && 'Notification' in window && Notification.permission === 'granted' && document.hidden) {
      try {
        const notif = new Notification(`✓ Download Complete: ${task.name || task.filename}`, {
          body: `Size: ${formatBytes(task.totalBytes || task.downloadedBytes)} • Click to open`,
          icon: '/assets/icon.png'
        });
        notif.onclick = () => {
          window.focus();
          if (task.savePath) openFile(task.savePath);
        };
      } catch (_) {}
    }

    if (!completionContainer) return;

    const toastId = 'toast-' + Math.random().toString(36).substring(2, 9);
    const badgeInfo = getTypeBadge(task);
    const toast = document.createElement('div');
    toast.className = 'completion-toast';

    const fileName = task.name || task.filename || 'Downloaded File';
    const fileSize = formatBytes(task.totalBytes || task.downloadedBytes);
    const categoryName = task.category || (task.isMedia ? 'Media' : 'File');
    const savePath = task.savePath || 'Downloads folder';

    const extractedPath = task.extractedPath || findExtractedPathForTask(task);

    toast.innerHTML = `
      <div class="completion-toast-header">
        <div class="completion-toast-status">
          <div class="completion-toast-dot"></div>
          <span>Download Complete</span>
        </div>
        <button class="completion-toast-close" title="Dismiss">&times;</button>
      </div>

      <div class="completion-toast-body">
        <div class="completion-app-icon-wrap" id="app-icon-wrap-${toastId}">
          <div class="completion-toast-badge ${badgeInfo.cls}">${badgeInfo.text}</div>
        </div>
        <div class="completion-toast-info">
          <div class="completion-toast-title" title="${fileName}">${fileName}</div>
          <div class="completion-toast-meta">
            <span class="completion-toast-size">${fileSize}</span>
            <span class="completion-toast-category">${categoryName}</span>
            <span class="completion-app-name-chip" id="app-name-chip-${toastId}"></span>
          </div>
          <div class="completion-toast-path" title="${savePath}">
            📁 ${savePath}
          </div>
        </div>
      </div>

      <div class="completion-toast-actions">
        <button class="toast-btn-open" title="Open downloaded file directly">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
          Open
        </button>
        <button class="toast-btn-folder" title="Show file in folder">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
          Open Folder
        </button>
        ${extractedPath ? `
        <button class="toast-btn-extracted" style="display: inline-flex; align-items: center; gap: 5px; background: rgba(168, 85, 247, 0.2); border: 1px solid rgba(168, 85, 247, 0.45); color: #d8b4fe; padding: 4px 10px; font-size: 0.75rem; border-radius: 4px; cursor: pointer;" title="Open Extracted Directory (${escapeHtml(extractedPath)})">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path><path d="M12 11v6m-3-3l3-3 3 3"></path></svg>
          Open Extracted Folder
        </button>
        ` : ''}
        <button class="toast-btn-dismiss">Dismiss</button>
      </div>

      <div class="toast-timer-bar" style="animation-duration: 14s;"></div>
    `;

    const btnOpen = toast.querySelector('.toast-btn-open');
    const btnFolder = toast.querySelector('.toast-btn-folder');
    const btnExtracted = toast.querySelector('.toast-btn-extracted');
    const btnDismiss = toast.querySelector('.toast-btn-dismiss');
    const btnClose = toast.querySelector('.completion-toast-close');

    let dismissed = false;
    const dismiss = () => {
      if (dismissed) return;
      dismissed = true;
      toast.classList.add('dismissing');
      setTimeout(() => {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 250);
    };

    btnOpen.onclick = (e) => {
      e.stopPropagation();
      if (task.savePath) openFile(task.savePath);
      dismiss();
    };

    btnFolder.onclick = (e) => {
      e.stopPropagation();
      if (task.savePath) openFolder(task.savePath);
      dismiss();
    };

    if (btnExtracted && extractedPath) {
      btnExtracted.onclick = (e) => {
        e.stopPropagation();
        openFolder(extractedPath);
        dismiss();
      };
    }

    btnDismiss.onclick = (e) => {
      e.stopPropagation();
      dismiss();
    };

    btnClose.onclick = (e) => {
      e.stopPropagation();
      dismiss();
    };

    const timer = setTimeout(() => {
      dismiss();
    }, 14000);

    toast.onmouseenter = () => {
      clearTimeout(timer);
    };

    while (completionContainer.children.length >= 3) {
      completionContainer.removeChild(completionContainer.firstChild);
    }

    completionContainer.appendChild(toast);

    // Asynchronously resolve and display default application icon and name
    fetchAppIcon(task.savePath, fileName).then((info) => {
      if (!info) return;
      const iconWrap = toast.querySelector(`#app-icon-wrap-${toastId}`);
      const nameChip = toast.querySelector(`#app-name-chip-${toastId}`);

      if (info.icon && iconWrap) {
        iconWrap.innerHTML = `
          <div class="completion-app-icon-box" title="Opens with: ${info.appName || 'Associated Application'}">
            <img class="completion-app-img" src="${info.icon}" alt="${info.appName || 'Default App'}">
            <span class="completion-mini-badge ${badgeInfo.cls}">${badgeInfo.text}</span>
          </div>
        `;
      }

      if (info.appName && nameChip) {
        nameChip.textContent = `Opens with: ${info.appName}`;
        nameChip.style.display = 'inline-flex';
      }
    });
  }

  function openDesktopProgressWindow(task) {
    if (!task) return;
    const taskId = (typeof task === 'object' && task !== null) ? (task.id || 0) : task;
    if (!taskId) return;
    const cfg = window.appState.config || {};

    // 1. Desktop Bridge
    if (window.waterfallDesktop && typeof window.waterfallDesktop.openProgressWindow === 'function') {
      window.waterfallDesktop.openProgressWindow(taskId);
      return;
    }

    // 2. Native Waterfall C++ Desktop Dialog Window
    fetch('/api/window/open-progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId: taskId, topmost: false })
    }).catch(() => {});

    // 3. Tauri fallback
    if (window.__TAURI__ && window.__TAURI__.core && typeof window.__TAURI__.core.invoke === 'function') {
      window.__TAURI__.core.invoke('open_progress_window', { taskId: String(taskId) }).catch(() => {});
      return;
    }

    // 4. Web Popup Window fallback
    try {
      const popup = window.open(
        `/download-progress.html?taskId=${encodeURIComponent(taskId)}`,
        `progress_${String(taskId).replace(/-/g, '_')}`,
        'width=640,height=560,resizable=yes,scrollbars=yes,status=no,location=no,toolbar=no,menubar=no'
      );
      if (popup && !popup.closed) {
        popup.focus();
      }
    } catch (_) {}
  }

  function openDesktopConfirmWindow(probeData) {
    if (!probeData) return;

    // 1. Desktop Bridge
    if (window.waterfallDesktop && typeof window.waterfallDesktop.openConfirmWindow === 'function') {
      window.waterfallDesktop.openConfirmWindow(probeData);
      return;
    }

    // 2. Native Waterfall C++ Desktop Dialog Window
    fetch('/api/window/open-confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(probeData)
    }).catch(() => {});

    // 3. Tauri 2 Native Invocation
    if (window.__TAURI__ && window.__TAURI__.core && typeof window.__TAURI__.core.invoke === 'function') {
      window.__TAURI__.core.invoke('open_confirm_window').catch(() => {});
      return;
    }

    // 4. Web Popup Window fallback
    try {
      const popup = window.open(
        '/confirm.html',
        'waterfall_confirm_window',
        'width=680,height=740,resizable=yes,scrollbars=yes,status=no,location=no,toolbar=no,menubar=no'
      );
      if (popup && !popup.closed) {
        popup.focus();
        return;
      }
    } catch (_) {}
  }

  window.addEventListener('task:created', (e) => {
    const task = e.detail;
    const cfg = window.appState.config || {};
    if (cfg.showDownloadProgressDialog !== false && task && (task.status === 'downloading' || task.status === 'pending') && !task.isPlaylist) {
      openDesktopProgressWindow(task);
    }
  });

  window.addEventListener('task:completed', (e) => {
    const task = e.detail;
    showCompletionNotification(task);
    const cfg = window.appState.config || {};
    if (cfg.showDownloadCompleteDialog !== false && task) {
      // Bring done window to top
      fetch('/api/window/open-progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: task.id, topmost: true, bringToFront: true })
      }).catch(() => {});
    }
  });

  window.addEventListener('task:failed', (e) => {
    const detail = e.detail;
    const task = (detail && detail.task) ? detail.task : detail;
    showFailureNotification(detail);
    if (task) {
      // Bring error window to top
      fetch('/api/window/open-progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: task.id, topmost: true, bringToFront: true })
      }).catch(() => {});
    }
  });

  function openUpdateUrlModal(task) {
    if (!task) return;
    currentUpdatingTaskId = task.id;
    if (updateUrlFilename) {
      updateUrlFilename.textContent = task.name || task.filename || 'Unknown file';
    }
    if (updateUrlCurrent) {
      updateUrlCurrent.textContent = task.url || task.directUrl || '--';
    }
    if (inputNewUrl) {
      inputNewUrl.value = task.url || task.directUrl || '';
      setTimeout(() => {
        inputNewUrl.focus();
        inputNewUrl.select();
      }, 60);
    }
    if (modalUpdateUrl) {
      modalUpdateUrl.classList.add('open');
    }
  }

  function showFailureNotification(detail) {
    const task = (detail && detail.task) ? detail.task : detail;
    if (!task) return;
    const errorMsg = (detail && detail.error) || (task && task.error) || 'Download encountered an unexpected network error.';

    const config = window.appState.config || {};
    if (config.soundChime !== false) {
      playCompletionChime();
    }

    if (!desktop && 'Notification' in window && Notification.permission === 'granted' && document.hidden) {
      try {
        const notif = new Notification(`✕ Download Failed: ${task.name || task.filename}`, {
          body: `${errorMsg}\nClick to update download link and resume`,
          icon: '/assets/icon.png'
        });
        notif.onclick = () => {
          window.focus();
          openUpdateUrlModal(task);
        };
      } catch (_) {}
    }

    if (!completionContainer) return;

    const toast = document.createElement('div');
    toast.className = 'completion-toast failure-toast';

    const fileName = task.name || task.filename || 'Downloaded File';

    toast.innerHTML = `
      <div class="completion-toast-header">
        <div class="completion-toast-status">
          <div class="completion-toast-dot"></div>
          <span>Download Failed</span>
        </div>
        <button class="completion-toast-close" title="Dismiss">&times;</button>
      </div>

      <div class="completion-toast-body">
        <div class="completion-app-icon-wrap">
          <div class="completion-toast-badge yt">✕</div>
        </div>
        <div class="completion-toast-info">
          <div class="completion-toast-title" title="${fileName}">${fileName}</div>
          <div class="completion-toast-meta">
            <span style="color: #ff7b72; font-weight: 500; word-break: break-all;">${errorMsg}</span>
          </div>
        </div>
      </div>

      <div class="completion-toast-actions">
        <button class="toast-btn-update-url" title="Refresh or update expired download link">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
          Update Link & Resume
        </button>
        <button class="toast-btn-folder toast-btn-retry" title="Retry download immediately">
          Retry
        </button>
        <button class="toast-btn-dismiss">Dismiss</button>
      </div>

      <div class="toast-timer-bar" style="animation-duration: 20s;"></div>
    `;

    const btnUpdate = toast.querySelector('.toast-btn-update-url');
    const btnRetry = toast.querySelector('.toast-btn-retry');
    const btnDismiss = toast.querySelector('.toast-btn-dismiss');
    const btnClose = toast.querySelector('.completion-toast-close');

    let dismissed = false;
    const dismiss = () => {
      if (dismissed) return;
      dismissed = true;
      toast.classList.add('dismissing');
      setTimeout(() => {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 250);
    };

    btnUpdate.onclick = (e) => {
      e.stopPropagation();
      openUpdateUrlModal(task);
      dismiss();
    };

    btnRetry.onclick = (e) => {
      e.stopPropagation();
      fetch(`/api/downloads/${task.id}/resume`, { method: 'POST' });
      dismiss();
    };

    btnDismiss.onclick = (e) => {
      e.stopPropagation();
      dismiss();
    };

    btnClose.onclick = (e) => {
      e.stopPropagation();
      dismiss();
    };

    const timer = setTimeout(() => {
      dismiss();
    }, 20000);

    toast.onmouseenter = () => {
      clearTimeout(timer);
    };

    while (completionContainer.children.length >= 3) {
      completionContainer.removeChild(completionContainer.firstChild);
    }

    completionContainer.appendChild(toast);
  }

  window.addEventListener('task:failed', (e) => {
    showFailureNotification(e.detail);
  });

  function updateBadges() {
    const tasks = window.appState.tasks;
    const staged = window.appState.staged;

    let dlCount = 0, pauseCount = 0, doneCount = 0, cancelCount = 0;
    let compCount = 0, progCount = 0, vidCount = 0, audCount = 0, picCount = 0, docCount = 0;

    for (const t of tasks) {
      if (t.status === 'downloading' || t.status === 'assembling') dlCount++;
      else if (t.status === 'paused' || t.status === 'queued') pauseCount++;
      else if (t.status === 'completed') doneCount++;
      else if (t.status === 'error' || t.status === 'canceled') cancelCount++;

      if (t.category === 'Compressed') compCount++;
      else if (t.category === 'Programs') progCount++;
      else if (t.category === 'Video') vidCount++;
      else if (t.category === 'Audio') audCount++;
      else if (t.category === 'Pictures') picCount++;
      else if (t.category === 'Documents') docCount++;
    }

    if (window.appState.hideFinished) {
      const activeAll = tasks.length - doneCount;
      badgeAll.textContent = activeAll;
      badgeAll.title = `${activeAll} active downloads (${doneCount} finished hidden)`;
      if (badgeFinishedHidden) {
        badgeFinishedHidden.style.display = doneCount > 0 ? 'inline-flex' : 'none';
        badgeFinishedHidden.textContent = `${doneCount}`;
      }
      if (btnToggleFinished) {
        btnToggleFinished.classList.add('active');
        if (labelToggleFinished) labelToggleFinished.textContent = 'Finished Hidden';
      }
    } else {
      badgeAll.textContent = tasks.length;
      badgeAll.title = 'All downloads';
      if (badgeFinishedHidden) badgeFinishedHidden.style.display = 'none';
      if (btnToggleFinished) {
        btnToggleFinished.classList.remove('active');
        if (labelToggleFinished) labelToggleFinished.textContent = 'Hide Finished';
      }
    }

    badgeDownloading.textContent = dlCount;
    badgePaused.textContent = pauseCount;
    badgeCompleted.textContent = doneCount;
    badgeGrabber.textContent = staged.length;

    badgeCompressed.textContent = compCount;
    badgePrograms.textContent = progCount;
    badgeVideo.textContent = vidCount;
    badgeAudio.textContent = audCount;
    if (badgePictures) badgePictures.textContent = picCount;
    badgeDocuments.textContent = docCount;

    let extractCount = 0;
    const handledExtractGroups = new Set();
    for (const t of tasks) {
      const isExt = t.extractStatus === 'extracting' ||
                    t.extractStatus === 'extract_queued' ||
                    t.extractStatus === 'password_required' ||
                    t.extractStatus === 'extract_password_required' ||
                    t.extractStatus === 'waiting_parts' ||
                    t.extractStatus === 'waiting_all_parts' ||
                    t.status === 'extracting';
      if (isExt) {
        if (t.multipart && t.multipart.groupKey) {
          if (!handledExtractGroups.has(t.multipart.groupKey)) {
            handledExtractGroups.add(t.multipart.groupKey);
            extractCount++;
          }
        } else {
          extractCount++;
        }
      }
    }

    const badgeExtractingTab = document.getElementById('badge-extracting-tab');
    if (badgeExtractingTab) badgeExtractingTab.textContent = extractCount;

    const badgeError = document.getElementById('badge-error');
    if (badgeError) badgeError.textContent = cancelCount;

    // Filter Tabs Count Badges
    const tabCountAll = document.getElementById('tab-count-all');
    const tabCountDone = document.getElementById('tab-count-done');
    const tabCountDownloading = document.getElementById('tab-count-downloading');
    const tabCountPaused = document.getElementById('tab-count-paused');
    const tabCountCanceled = document.getElementById('tab-count-canceled');
    const tabCountExtracting = document.getElementById('tab-count-extracting');
    const tabCountVideo = document.getElementById('tab-count-video');
    const tabCountPictures = document.getElementById('tab-count-pictures');
    const tabCountAudio = document.getElementById('tab-count-audio');
    const tabCountCompressed = document.getElementById('tab-count-compressed');
    const tabCountPrograms = document.getElementById('tab-count-programs');
    const tabCountDocuments = document.getElementById('tab-count-documents');

    if (tabCountAll) tabCountAll.textContent = tasks.length;
    if (tabCountDone) tabCountDone.textContent = doneCount;
    if (tabCountDownloading) tabCountDownloading.textContent = dlCount;
    if (tabCountPaused) tabCountPaused.textContent = pauseCount;
    if (tabCountCanceled) tabCountCanceled.textContent = cancelCount;
    if (tabCountExtracting) tabCountExtracting.textContent = extractCount;
    if (tabCountVideo) tabCountVideo.textContent = vidCount;
    if (tabCountPictures) tabCountPictures.textContent = picCount;
    if (tabCountAudio) tabCountAudio.textContent = audCount;
    if (tabCountCompressed) tabCountCompressed.textContent = compCount;
    if (tabCountPrograms) tabCountPrograms.textContent = progCount;
    if (tabCountDocuments) tabCountDocuments.textContent = docCount;
  }

  // ==========================================================================
  // YouTube Downloader & Audio/Video Converter Controller
  // ==========================================================================
  if (btnOpenYouTube) {
    btnOpenYouTube.addEventListener('click', () => {
      modalYouTubeConverter.classList.add('open');
      ytInputUrl.focus();
    });
  }

  async function inspectYouTubeUrl() {
    const url = ytInputUrl.value.trim();
    if (!url) return;

    ytBtnInspect.disabled = true;
    ytBtnInspect.textContent = 'Inspecting...';
    if (ytPreviewCard) ytPreviewCard.style.display = 'none';
    if (ytPlaylistCard) ytPlaylistCard.style.display = 'none';

    try {
      const res = await fetch('/api/media/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });

      if (!res.ok) {
        throw new Error(await res.text());
      }

      const data = await res.json();
      currentYtMeta = data;

      if (data.isPlaylist) {
        // Render YouTube Playlist
        if (ytPlaylistTitle) ytPlaylistTitle.textContent = data.title || 'YouTube Playlist';
        if (ytPlaylistCount) ytPlaylistCount.textContent = `${data.totalTracks} Tracks Available`;

        let tracksHtml = '';
        (data.entries || []).forEach((tr, idx) => {
          tracksHtml += `
            <div class="yt-playlist-item">
              <input type="checkbox" class="yt-track-cb" data-idx="${idx}" checked>
              <span class="yt-track-title" title="${tr.title}">${idx + 1}. ${tr.title}</span>
              <span class="yt-track-duration">${tr.duration}</span>
            </div>
          `;
        });

        if (ytPlaylistItems) {
          ytPlaylistItems.innerHTML = tracksHtml;
          ytPlaylistItems.querySelectorAll('.yt-track-cb').forEach(cb => {
            cb.addEventListener('change', updatePlaylistSelectedCount);
          });
        }
        if (ytPlaylistCard) ytPlaylistCard.style.display = 'flex';
        ytBtnDownload.textContent = `Download All Tracks (${data.totalTracks})`;
        ytBtnDownload.disabled = false;
      } else {
        // Render Single Video Preview
        ytVideoTitle.textContent = data.title;
        ytVideoAuthor.textContent = data.uploader;
        ytDurationBadge.textContent = data.duration;
        if (data.thumbnail) {
          ytThumbImg.src = data.thumbnail;
        }
        if (ytPreviewCard) ytPreviewCard.style.display = 'flex';
        ytBtnDownload.textContent = 'Download & Convert';
        ytBtnDownload.disabled = false;
      }
    } catch (err) {
      alert('Could not inspect YouTube stream: ' + err.message);
    } finally {
      ytBtnInspect.disabled = false;
      ytBtnInspect.textContent = 'Inspect';
    }
  }

  function updatePlaylistSelectedCount() {
    if (!ytPlaylistItems || !ytBtnDownload) return;
    const all = ytPlaylistItems.querySelectorAll('.yt-track-cb');
    const checked = ytPlaylistItems.querySelectorAll('.yt-track-cb:checked');
    if (checked.length === all.length) {
      ytBtnDownload.textContent = `Download All Tracks (${all.length})`;
    } else {
      ytBtnDownload.textContent = `Download Selected Tracks (${checked.length})`;
    }
    ytBtnDownload.disabled = (checked.length === 0);
    if (ytPlaylistCount) {
      ytPlaylistCount.textContent = `${checked.length} of ${all.length} Selected`;
    }
  }

  if (ytPlaylistToggleAll) {
    ytPlaylistToggleAll.addEventListener('click', () => {
      if (!ytPlaylistItems) return;
      const all = ytPlaylistItems.querySelectorAll('.yt-track-cb');
      const checked = ytPlaylistItems.querySelectorAll('.yt-track-cb:checked');
      const shouldCheck = (checked.length < all.length);
      all.forEach(cb => cb.checked = shouldCheck);
      updatePlaylistSelectedCount();
    });
  }

  ytBtnInspect.addEventListener('click', inspectYouTubeUrl);
  ytInputUrl.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') inspectYouTubeUrl();
  });

  // Single format selection
  ytFormatSelector.querySelectorAll('.format-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      ytFormatSelector.querySelectorAll('.format-pill').forEach(p => p.classList.remove('selected'));
      pill.classList.add('selected');
      selectedYtFormat = {
        type: pill.dataset.type,
        format: pill.dataset.format,
        quality: pill.dataset.quality
      };
    });
  });

  // Playlist format selection
  if (ytPlaylistFormatSelector) {
    ytPlaylistFormatSelector.querySelectorAll('.format-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        ytPlaylistFormatSelector.querySelectorAll('.format-pill').forEach(p => p.classList.remove('selected'));
        pill.classList.add('selected');
        selectedPlaylistFormat = pill.dataset.format;
      });
    });
  }

  // Submit YouTube Download (Single or Playlist)
  ytBtnDownload.addEventListener('click', async () => {
    const url = ytInputUrl.value.trim();
    if (!url || !currentYtMeta) return;

    const autoStart = ytCheckAutoStart ? ytCheckAutoStart.checked : true;

    if (currentYtMeta.isPlaylist) {
      // Gather checked tracks from playlist
      const selectedEntries = [];
      const checkboxes = ytPlaylistItems.querySelectorAll('.yt-track-cb:checked');
      checkboxes.forEach(cb => {
        const idx = parseInt(cb.dataset.idx, 10);
        if (currentYtMeta.entries && currentYtMeta.entries[idx]) {
          selectedEntries.push(currentYtMeta.entries[idx]);
        }
      });

      if (selectedEntries.length === 0) {
        alert('Please select at least one track to download.');
        return;
      }

      ytBtnDownload.disabled = true;
      ytBtnDownload.textContent = `Adding ${selectedEntries.length} Tracks...`;

      try {
        const res = await fetch('/api/media/batch-add', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            entries: selectedEntries,
            format: selectedPlaylistFormat,
            packageName: currentYtMeta.title || 'YouTube Playlist',
            autoStart
          })
        });

        if (!res.ok) {
          throw new Error(await res.text());
        }

        const batchResult = await res.json();

        // Refresh downloads immediately
        try {
          const r = await fetch('/api/downloads');
          if (r.ok) {
            window.appState.tasks = await r.json();
            renderDownloads();
          }
        } catch (_) {}

        if (batchResult.count === 0 && batchResult.duplicates > 0) {
          alert(`Selected tracks are already completed or queued in your downloads.`);
        }
      } catch (err) {
        alert('Could not add YouTube playlist: ' + err.message);
        ytBtnDownload.disabled = false;
        updatePlaylistSelectedCount();
        return;
      }
    } else {
      // Single track download
      const mediaOptions = {
        mediaType: selectedYtFormat.type,
        audioFormat: selectedYtFormat.format,
        audioQuality: selectedYtFormat.quality,
        videoQuality: selectedYtFormat.quality
      };

      const ext = (selectedYtFormat.type === 'audio') ? selectedYtFormat.format : 'mp4';
      const filename = `${currentYtMeta.title}.${ext}`;

      try {
        const res = await fetch('/api/downloads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url,
            filename,
            isMedia: true,
            mediaOptions,
            autoStart,
            packageName: ''
          })
        });

        if (!res.ok) throw new Error(await res.text());

        try {
          const r = await fetch('/api/downloads');
          if (r.ok) {
            window.appState.tasks = await r.json();
            renderDownloads();
          }
        } catch (_) {}
      } catch (err) {
        alert('Could not add YouTube download: ' + err.message);
        return;
      }
    }

    modalYouTubeConverter.classList.remove('open');
    ytInputUrl.value = '';
    if (ytPreviewCard) ytPreviewCard.style.display = 'none';
    if (ytPlaylistCard) ytPlaylistCard.style.display = 'none';
    currentYtMeta = null;
    switchView('downloads');
  });

  // ==========================================================================
  // JDownloader LinkGrabber
  // ==========================================================================
  btnCrawlLinks.addEventListener('click', async () => {
    const text = grabberRawText.value.trim();
    if (!text) {
      alert('Please enter or paste URLs to crawl.');
      return;
    }

    const packageName = grabberPackageName.value.trim();
    btnCrawlLinks.disabled = true;
    btnCrawlLinks.textContent = 'Crawling...';

    try {
      await fetch('/api/linkgrabber/crawl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, packageName })
      });
      grabberRawText.value = '';
    } catch (err) {
      alert('Failed to crawl links: ' + err.message);
    } finally {
      btnCrawlLinks.disabled = false;
      btnCrawlLinks.textContent = 'Analyze & Crawl Links';
    }
  });

  window.addEventListener('crawler:progress', (e) => {
    const p = e.detail;
    if (btnCrawlLinks && btnCrawlLinks.disabled && p) {
      if (p.total > 1) {
        btnCrawlLinks.textContent = `Crawling (${p.processed}/${p.total})...`;
      } else if (p.stagedCount > 0) {
        btnCrawlLinks.textContent = `Found ${p.stagedCount} link${p.stagedCount > 1 ? 's' : ''}...`;
      } else {
        btnCrawlLinks.textContent = 'Deep analyzing...';
      }
    }
  });

  btnPasteClipboard.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) grabberRawText.value = text;
    } catch (_) {
      alert('Clipboard access not permitted in browser; please paste manually.');
    }
  });

  btnGrabberClear.addEventListener('click', () => {
    fetch('/api/linkgrabber/clear', { method: 'POST' });
  });

  btnGrabberStartAll.addEventListener('click', async () => {
    const staged = window.appState.staged;
    if (staged.length === 0) {
      alert('No staged links in LinkGrabber to start.');
      return;
    }

    await fetch('/api/linkgrabber/transfer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ autoStart: true })
    });

    switchView('downloads');
  });

  function renderGrabber() {
    const staged = window.appState.staged;
    grabberCountLabel.textContent = `${staged.length} links staged`;

    let totalBytes = 0;
    let selectedCount = 0;

    let html = '';
    staged.forEach(item => {
      if (item.selected) {
        selectedCount++;
        totalBytes += (item.size || 0);
      }

      html += `
        <div class="staged-item">
          <div class="staged-left">
            <input type="checkbox" class="staged-checkbox" data-id="${item.id}" ${item.selected ? 'checked' : ''}>
            <div>
              <div class="staged-name">${item.filename}</div>
              <div class="staged-meta">
                <span>[${item.packageName}]</span>
                <span>•</span>
                <span>${item.hoster}</span>
                <span>•</span>
                <span>${formatBytes(item.size)}</span>
                <span>•</span>
                <span class="online-tag ${item.isOnline}">
                  ${item.isOnline.toUpperCase()}
                </span>
              </div>
            </div>
          </div>
          <button class="icon-btn btn-del btn-delete-staged" data-id="${item.id}" title="Remove">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
      `;
    });

    if (staged.length === 0) {
      html = `
        <div class="empty-view" style="padding: 50px 20px;">
          <div style="font-weight: 600;">LinkGrabber Staging Empty</div>
          <div style="font-size: 0.75rem; color: var(--text-muted);">Paste multiple links, forum posts, or YouTube links above.</div>
        </div>
      `;
    }

    grabberStagedList.innerHTML = html;
    grabberSelectedCount.textContent = `${selectedCount} selected`;
    grabberTotalSize.textContent = `Total: ${formatBytes(totalBytes)}`;
  }

  function initGrabberDelegatedEvents() {
    if (!grabberStagedList) return;

    grabberStagedList.addEventListener('change', (e) => {
      const cb = e.target.closest('.staged-checkbox');
      if (cb) {
        const item = window.appState.staged.find(i => i.id === cb.dataset.id);
        if (item) item.selected = cb.checked;
        renderGrabber();
      }
    });

    grabberStagedList.addEventListener('click', (e) => {
      const btn = e.target.closest('.btn-delete-staged');
      if (btn) {
        e.stopPropagation();
        const id = btn.dataset.id;
        window.appState.staged = (window.appState.staged || []).filter(i => i.id !== id && String(i.id) !== String(id));
        renderGrabber();
        updateBadges();
        fetch(`/api/linkgrabber/${id}`, { method: 'DELETE' });
      }
    });
  }

  initGrabberDelegatedEvents();

  // IDM Quick Actions
  btnResumeAll.addEventListener('click', () => fetch('/api/downloads/resume-all', { method: 'POST' }));
  btnPauseAll.addEventListener('click', () => fetch('/api/downloads/pause-all', { method: 'POST' }));
  btnClearCompleted.addEventListener('click', () => {
    window.appState.tasks = window.appState.tasks.filter(t => t.status !== 'completed');
    renderDownloads();
    updateBadges();
    fetch('/api/downloads/clear-completed', { method: 'POST' });
  });

  // Hide Finished Toggle Button
  if (btnToggleFinished) {
    btnToggleFinished.addEventListener('click', () => {
      window.appState.hideFinished = !window.appState.hideFinished;
      try {
        localStorage.setItem('waterfall_hide_finished', window.appState.hideFinished);
      } catch (_) {}
      updateBadges();
      renderDownloads();
    });
  }

  // Queue Sorting Menu Button & Options
  // Queue Sorting Menu Buttons & Options (Supporting both Content Toolbar & Topbar)
  function closeAllSortMenus() {
    document.querySelectorAll('.sort-dropdown-menu').forEach(m => m.classList.remove('show'));
    document.querySelectorAll('.sort-btn, .sort-dropdown-wrap').forEach(b => b.classList.remove('open'));
    if (addDownloadDropdownMenu) addDownloadDropdownMenu.classList.remove('show');
  }

  function setupSortMenuTrigger(btn, menu) {
    if (!btn || !menu) return;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = menu.classList.contains('show');
      closeAllSortMenus();
      if (!isOpen) {
        menu.classList.add('show');
        btn.classList.add('open');
        const wrap = btn.closest('.sort-dropdown-wrap');
        if (wrap) wrap.classList.add('open');
      }
    });
  }

  setupSortMenuTrigger(btnSortMenu, sortDropdownMenu);
  setupSortMenuTrigger(btnTopbarSort, topbarSortMenu);
  setupSortMenuTrigger(btnTopbarSortChevron, topbarSortMenu);

  document.querySelectorAll('.sort-dropdown-menu .sort-option').forEach(opt => {
    opt.addEventListener('click', (e) => {
      e.stopPropagation();
      const mode = opt.dataset.sort;
      window.appState.sortMode = mode;
      window.appState.sortCol = null;
      window.appState.sortDir = null;
      try {
        localStorage.setItem('waterfall_sort_mode', mode);
        localStorage.removeItem('waterfall_sort_col');
        localStorage.removeItem('waterfall_sort_dir');
      } catch (_) {}

      closeAllSortMenus();
      updateSortControlsUI();
      renderDownloads();
    });
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.sort-dropdown-wrap')) {
      closeAllSortMenus();
    }
  });

  // Empty State Action Buttons for Hidden Finished Downloads
  if (emptyBtnShowFinished) {
    emptyBtnShowFinished.addEventListener('click', () => {
      window.appState.hideFinished = false;
      try {
        localStorage.setItem('waterfall_hide_finished', 'false');
      } catch (_) {}
      updateBadges();
      renderDownloads();
    });
  }

  if (emptyBtnViewFinishedTab) {
    emptyBtnViewFinishedTab.addEventListener('click', () => {
      window.appState.activeFilter = 'completed';
      window.appState.activeCategory = null;
      syncSidebarActiveFilter();
      renderDownloads();
    });
  }

  if (emptyBtnClearFinished) {
    emptyBtnClearFinished.addEventListener('click', () => {
      if (btnClearCompleted) btnClearCompleted.click();
    });
  }

  // Modals Management & Event Wiring
  function closeModal(modalEl) {
    if (!modalEl) return;
    modalEl.classList.remove('open');
    if (modalEl.id === 'modal-segment-inspector' && window.segmentVisualizer) {
      window.segmentVisualizer.close();
    }
  }

  function closeAllModals() {
    document.querySelectorAll('.modal-overlay.open, .modal.open').forEach(m => {
      m.classList.remove('open');
    });
    if (window.segmentVisualizer && window.segmentVisualizer.isOpen()) {
      window.segmentVisualizer.close();
    }
  }

  // 1. Delegated click handler on document for all .modal-close-btn buttons and backdrop clicks
  document.addEventListener('click', (e) => {
    // If clicked on any .modal-close-btn or child of it (like 'x' or icon)
    const closeBtn = e.target.closest('.modal-close-btn');
    if (closeBtn) {
      e.preventDefault();
      e.stopPropagation();
      const modal = closeBtn.closest('.modal-overlay') || closeBtn.closest('.modal');
      if (modal) {
        closeModal(modal);
      } else {
        closeAllModals();
      }
      return;
    }

    // If clicked directly on the modal-overlay backdrop outside the modal-card
    if (e.target.classList && (e.target.classList.contains('modal-overlay') || e.target.classList.contains('modal'))) {
      closeModal(e.target);
    }
  });

  // 2. Global Escape key closes any active modal or context menu
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.key === 'Esc') {
      const openModals = document.querySelectorAll('.modal-overlay.open, .modal.open');
      if (openModals.length > 0 || (window.segmentVisualizer && window.segmentVisualizer.isOpen())) {
        e.preventDefault();
        closeAllModals();
      }
      if (contextMenu && contextMenu.style.display !== 'none') {
        hideContextMenu();
      }
    }

    if (e.key === 'Delete' || e.key === 'Del') {
      const activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable)) {
        return;
      }
      if (selectedTaskIds && selectedTaskIds.size > 0) {
        e.preventDefault();
        const tasks = window.appState.tasks.filter(t => selectedTaskIds.has(t.id) || selectedTaskIds.has(String(t.id)));
        if (e.shiftKey) {
          if (confirm(`Permanently delete ${tasks.length} selected download(s) from disk and remove from list?`)) {
            const delIds = new Set(tasks.map(t => String(t.id)));
            window.appState.tasks = window.appState.tasks.filter(t => !delIds.has(String(t.id)));
            tasks.forEach(t => {
              selectedTaskIds.delete(t.id);
              selectedTaskIds.delete(String(t.id));
            });
            renderDownloads();
            updateBadges();
            updateBatchBar();
            fetch('/api/downloads/batch', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'delete', ids: tasks.map(t => t.id), deleteFiles: true })
            });
          }
        } else {
          openDeleteConfirmModal(tasks);
        }
      }
    }
  });

  // Add URL Modal
  btnAddUrl.addEventListener('click', () => {
    const inputUrl = document.getElementById('input-url');
    if (inputUrl) {
      inputUrl.value = '';
      setTimeout(() => inputUrl.focus(), 60);
    }
    modalAddUrl.classList.add('open');
  });

  if (btnSubmitAddUrl) {
    btnSubmitAddUrl.addEventListener('click', async () => {
      const inputUrl = document.getElementById('input-url');
      const inputFilename = document.getElementById('input-filename');
      const inputPackage = document.getElementById('input-package');
      const selectAddMode = document.getElementById('select-add-mode');
      const addModeVal = selectAddMode ? selectAddMode.value : 'inPlace-8';

      const url = (inputUrl ? inputUrl.value : '').trim();
      if (!url) {
        alert('Please enter a valid download URL.');
        if (inputUrl) inputUrl.focus();
        return;
      }

      btnSubmitAddUrl.disabled = true;
      btnSubmitAddUrl.textContent = 'Inspecting...';

      const probeCtrl = new AbortController();
      const probeTimer = setTimeout(() => probeCtrl.abort(), 2500);
      try {
        const probeRes = await fetch('/api/downloads/probe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url }),
          signal: probeCtrl.signal
        });
        clearTimeout(probeTimer);

        let probeData;
        if (probeRes.ok) {
          probeData = await probeRes.json();
        } else {
          probeData = {
            url,
            filename: (inputFilename ? inputFilename.value.trim() : '') || 'download_' + Date.now(),
            category: 'General',
            totalBytes: 0,
            acceptRanges: true,
            defaultSaveDir: window.appState.config?.downloadDir || '',
            avgSpeed: 10 * 1024 * 1024,
            historyCount: 0
          };
        }

        if (inputFilename && inputFilename.value.trim()) {
          probeData.filename = inputFilename.value.trim();
        }
        if (inputPackage && inputPackage.value.trim()) {
          probeData.packageName = inputPackage.value.trim();
        }
        probeData.initialModeVal = addModeVal;

        modalAddUrl.classList.remove('open');
        if (probeData.existingMatch) {
          showDuplicatePrompt(probeData, (opts = {}) => {
            if (opts && opts.allowDuplicate) probeData.allowDuplicate = true;
            openIdmConfirmation(probeData);
          });
        } else {
          openIdmConfirmation(probeData);
        }
      } catch (err) {
        modalAddUrl.classList.remove('open');
        openIdmConfirmation({
          url,
          filename: (inputFilename ? inputFilename.value.trim() : '') || 'download',
          category: 'General',
          totalBytes: 0,
          acceptRanges: true,
          defaultSaveDir: window.appState.config?.downloadDir || '',
          avgSpeed: 10 * 1024 * 1024,
          historyCount: 0,
          initialModeVal: addModeVal
        });
      } finally {
        btnSubmitAddUrl.disabled = false;
        btnSubmitAddUrl.textContent = 'Inspect & Download';
      }
    });
  }

  // ==========================================================================
  // Duplicate Download Detection & In-Progress File Update Prompt
  // ==========================================================================
  const modalDuplicatePrompt = document.getElementById('modal-duplicate-prompt');

  function showDuplicatePrompt(probeData, onProceedWithDuplicate) {
    const match = probeData && probeData.existingMatch;
    if (!match) {
      if (typeof onProceedWithDuplicate === 'function') onProceedWithDuplicate();
      return;
    }

    if (!modalDuplicatePrompt) {
      if (typeof onProceedWithDuplicate === 'function') onProceedWithDuplicate();
      return;
    }

    const titleEl = document.getElementById('duplicate-prompt-title');
    const subtitleEl = document.getElementById('duplicate-prompt-subtitle');
    const iconEl = document.getElementById('duplicate-header-icon');
    const bannerEl = document.getElementById('duplicate-prompt-banner');
    const bannerIconEl = document.getElementById('duplicate-prompt-banner-icon');
    const bannerTextEl = document.getElementById('duplicate-prompt-banner-text');
    const filenameEl = document.getElementById('duplicate-prompt-filename');
    const statusEl = document.getElementById('duplicate-prompt-status');
    const sizeEl = document.getElementById('duplicate-prompt-size');
    const pathEl = document.getElementById('duplicate-prompt-path');
    const progressBox = document.getElementById('duplicate-prompt-progress-box');
    const percentEl = document.getElementById('duplicate-prompt-percent');
    const progressBar = document.getElementById('duplicate-prompt-bar');
    const newUrlBox = document.getElementById('duplicate-prompt-newurl-box');
    const newUrlEl = document.getElementById('duplicate-prompt-newurl');
    const footerEl = document.getElementById('duplicate-prompt-footer');

    const isDone = Boolean(match.isDone);
    if (filenameEl) filenameEl.textContent = match.name || probeData.filename || 'download';
    if (pathEl) pathEl.textContent = match.savePath || probeData.savePath || '--';

    if (isDone) {
      // -------------------------------------------------------------
      // SCENARIO 1: ALREADY COMPLETED (DONE) - DUPLICATE ALERT
      // -------------------------------------------------------------
      if (titleEl) titleEl.textContent = 'File Already Downloaded';
      if (subtitleEl) subtitleEl.textContent = 'A completed file with matching name/URL is already present on disk';
      if (iconEl) {
        iconEl.textContent = '📁';
        iconEl.style.background = 'rgba(63, 185, 80, 0.15)';
        iconEl.style.color = '#3fb950';
      }

      if (bannerEl) {
        bannerEl.style.background = 'rgba(63, 185, 80, 0.12)';
        bannerEl.style.borderColor = 'rgba(63, 185, 80, 0.35)';
        bannerEl.style.color = '#7ee787';
      }
      if (bannerIconEl) bannerIconEl.textContent = '✓';
      if (bannerTextEl) {
        bannerTextEl.innerHTML = `<strong>File is already completed!</strong> This file was already downloaded to your disk. You can open it directly, view it in Windows Explorer, or download a separate duplicate copy.`;
      }

      if (statusEl) {
        statusEl.textContent = 'Completed (100%)';
        statusEl.className = 'type-badge badge-done';
        statusEl.style.color = '#3fb950';
      }

      const totalSz = match.formattedSize || (match.totalBytes > 0 ? formatBytes(match.totalBytes) : formatBytes(match.downloadedBytes || 0));
      if (sizeEl) sizeEl.textContent = totalSz;
      if (progressBox) progressBox.style.display = 'none';
      if (newUrlBox) newUrlBox.style.display = 'none';

      const extractedPath = match.extractedPath || findExtractedPathForTask(match);
      const extractRow = document.getElementById('duplicate-prompt-extract-row');
      const extractPathEl = document.getElementById('duplicate-prompt-extracted-path');
      if (extractRow && extractPathEl) {
        if (extractedPath) {
          extractRow.style.display = 'flex';
          extractPathEl.textContent = extractedPath;
          extractPathEl.title = extractedPath;
        } else {
          extractRow.style.display = 'none';
        }
      }

      if (footerEl) {
        footerEl.innerHTML = `
          <button type="button" class="tool-btn modal-close-btn" id="dup-btn-cancel">Cancel</button>
          <div style="display: flex; gap: 8px; flex-wrap: wrap;">
            <button type="button" class="tool-btn" id="dup-btn-open-folder" title="Highlight file in Windows Explorer">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
              Show in Folder
            </button>
            <button type="button" class="tool-btn" id="dup-btn-open-file" title="Launch with default application">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
              Open File
            </button>
            ${extractedPath ? `
            <button type="button" class="tool-btn" id="dup-btn-open-extracted" style="display: inline-flex; align-items: center; gap: 6px; background: rgba(168, 85, 247, 0.2); border: 1px solid rgba(168, 85, 247, 0.45); color: #d8b4fe;" title="Open Extracted Directory (${escapeHtml(extractedPath)})">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path><path d="M12 11v6m-3-3l3-3 3 3"></path></svg>
              Open Extracted Folder
            </button>
            ` : ''}
            <button type="button" class="tool-btn primary" id="dup-btn-download-copy" title="Download a new copy (will be saved as filename (1))">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
              Download Duplicate Copy
            </button>
          </div>
        `;

        document.getElementById('dup-btn-cancel').onclick = () => {
          modalDuplicatePrompt.classList.remove('open');
        };

        document.getElementById('dup-btn-open-file').onclick = async () => {
          modalDuplicatePrompt.classList.remove('open');
          if (match.savePath) await openFile(match.savePath);
        };

        document.getElementById('dup-btn-open-folder').onclick = async () => {
          modalDuplicatePrompt.classList.remove('open');
          if (match.savePath) await openFolder(match.savePath);
        };

        const btnExt = document.getElementById('dup-btn-open-extracted');
        if (btnExt && extractedPath) {
          btnExt.onclick = async () => {
            modalDuplicatePrompt.classList.remove('open');
            await openFolder(extractedPath);
          };
        }

        document.getElementById('dup-btn-download-copy').onclick = () => {
          modalDuplicatePrompt.classList.remove('open');
          if (typeof onProceedWithDuplicate === 'function') {
            onProceedWithDuplicate({ allowDuplicate: true });
          }
        };
      }

    } else {
      // -------------------------------------------------------------
      // SCENARIO 2: STILL DOWNLOADING / PAUSED / ERROR - FILE UPDATE OFFER
      // -------------------------------------------------------------
      if (titleEl) titleEl.textContent = 'Download Already In Progress';
      if (subtitleEl) subtitleEl.textContent = 'Existing task found • Offer to update link & resume without restarting';
      if (iconEl) {
        iconEl.textContent = '🔄';
        iconEl.style.background = 'rgba(56, 189, 248, 0.15)';
        iconEl.style.color = '#38bdf8';
      }

      const statusName = (match.status || 'paused').toUpperCase();
      if (bannerEl) {
        bannerEl.style.background = 'rgba(56, 189, 248, 0.12)';
        bannerEl.style.borderColor = 'rgba(56, 189, 248, 0.35)';
        bannerEl.style.color = '#79c0ff';
      }
      if (bannerIconEl) bannerIconEl.textContent = '🔄';
      if (bannerTextEl) {
        bannerTextEl.innerHTML = `<strong>Download already in queue (${statusName})!</strong> You have already downloaded <strong>${formatBytes(match.downloadedBytes)}</strong> (${match.percent}%). Would you like to update the download link and resume from where it left off, or download as a separate copy?`;
      }

      if (statusEl) {
        statusEl.textContent = `${statusName} (${match.percent}%)`;
        statusEl.className = 'type-badge badge-' + (match.status || 'paused').toLowerCase();
      }

      const totalSz = match.totalBytes > 0 ? formatBytes(match.totalBytes) : 'Unknown';
      if (sizeEl) sizeEl.textContent = `${formatBytes(match.downloadedBytes || 0)} / ${totalSz} (${match.percent}%)`;

      if (progressBox) progressBox.style.display = 'flex';
      if (percentEl) percentEl.textContent = `${match.percent}%`;
      if (progressBar) progressBar.style.width = `${match.percent}%`;

      if (newUrlBox && newUrlEl) {
        if (probeData.url) {
          newUrlBox.style.display = 'block';
          newUrlEl.textContent = probeData.url;
        } else {
          newUrlBox.style.display = 'none';
        }
      }

      if (footerEl) {
        footerEl.innerHTML = `
          <button type="button" class="tool-btn modal-close-btn" id="dup-btn-cancel">Cancel</button>
          <div style="display: flex; gap: 8px; flex-wrap: wrap;">
            <button type="button" class="tool-btn" id="dup-btn-separate" title="Keep existing task and download this as a separate task">
              ➕ Download as Separate Copy
            </button>
            <button type="button" class="tool-btn primary" id="dup-btn-update-resume" style="background: #238636; border-color: #2ea043; color: #fff; font-weight: 700;" title="Update existing download's link and resume seamlessly from disk">
              🔄 Update Link & Resume (${match.percent}%)
            </button>
          </div>
        `;

        document.getElementById('dup-btn-cancel').onclick = () => {
          modalDuplicatePrompt.classList.remove('open');
        };

        document.getElementById('dup-btn-separate').onclick = () => {
          modalDuplicatePrompt.classList.remove('open');
          if (typeof onProceedWithDuplicate === 'function') {
            onProceedWithDuplicate({ allowDuplicate: true });
          }
        };

        document.getElementById('dup-btn-update-resume').onclick = async () => {
          modalDuplicatePrompt.classList.remove('open');
          try {
            const res = await fetch(`/api/downloads/${match.id}/update-url`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ url: probeData.url })
            });
            if (!res.ok) throw new Error(await res.text());
            switchView('downloads');
            renderDownloads();
          } catch (err) {
            alert('Failed to update download link: ' + err.message);
          }
        };
      }
    }

    closeAllModals();
    modalDuplicatePrompt.classList.add('open');
  }

  // ==========================================================================
  // IDM Download Confirmation Window & Performance Predictor
  // ==========================================================================
  const modalIdmConfirm = document.getElementById('modal-idm-confirm');
  let activeConfirmPromptUrl = null;
  let lastConfirmPromptTimestamp = 0;

  function openIdmConfirmation(probeData) {
    if (!probeData || !probeData.url) return;

    const now = Date.now();
    if (activeConfirmPromptUrl === probeData.url && (now - lastConfirmPromptTimestamp < 1500)) {
      return;
    }
    activeConfirmPromptUrl = probeData.url;
    lastConfirmPromptTimestamp = now;

    currentConfirmData = probeData;

    try {
      localStorage.setItem('waterfall_confirm_data', JSON.stringify(probeData));
    } catch (_) {}

    fetch('/api/downloads/pending-confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(probeData)
    }).catch(() => {});

    // 1. Desktop Bridge
    if (window.waterfallDesktop && typeof window.waterfallDesktop.openConfirmWindow === 'function') {
      window.waterfallDesktop.openConfirmWindow(probeData);
      return;
    }

    // 2. Native Waterfall C++ Desktop Dialog Window
    fetch('/api/window/open-confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(probeData)
    }).catch(() => {});
    if (window.__TAURI__ && window.__TAURI__.core && typeof window.__TAURI__.core.invoke === 'function') {
      window.__TAURI__.core.invoke('open_confirm_window').catch(() => {});
      return;
    }

    // 3. Web Browser Popup Window fallback
    try {
      const popup = window.open(
        '/confirm.html',
        'waterfall_confirm_window',
        'width=680,height=740,resizable=yes,scrollbars=yes,status=no,location=no,toolbar=no,menubar=no'
      );
      if (popup && !popup.closed && typeof popup.closed !== 'undefined') {
        popup.focus();
        return;
      }
    } catch (_) {}

    // 3. Fallback to in-page modal if popups are blocked or desktop shell is not present
    if (!modalIdmConfirm) return;

    const urlEl = document.getElementById('idm-confirm-url');
    const serverEl = document.getElementById('idm-confirm-server');
    const nameEl = document.getElementById('idm-confirm-filename');
    const catBadge = document.getElementById('idm-confirm-category-badge');
    const sizeEl = document.getElementById('idm-confirm-size');
    const resumableEl = document.getElementById('idm-confirm-resumable');
    const etaEl = document.getElementById('idm-confirm-eta');
    const avgSpeedEl = document.getElementById('idm-confirm-avg-speed');
    const folderEl = document.getElementById('idm-confirm-folder');
    const mediaBox = document.getElementById('idm-confirm-media-box');
    const engineModeEl = document.getElementById('idm-confirm-engine-mode');
    const scriptCheck = document.getElementById('idm-confirm-enable-script');
    const scriptDetails = document.getElementById('idm-confirm-script-details');
    const scriptPathEl = document.getElementById('idm-confirm-script-path');
    const scriptTypeEl = document.getElementById('idm-confirm-script-type');
    const scriptArgsEl = document.getElementById('idm-confirm-script-args');

    // Duplicate notification banner within IDM Confirmation Window
    const dupAlert = document.getElementById('idm-confirm-duplicate-alert');
    const dupIcon = document.getElementById('idm-duplicate-alert-icon');
    const dupMsg = document.getElementById('idm-duplicate-alert-msg');
    const dupActions = document.getElementById('idm-duplicate-alert-actions');

    if (dupAlert && probeData.existingMatch) {
      const match = probeData.existingMatch;
      dupAlert.style.display = 'block';
      if (match.isDone) {
        dupAlert.style.background = 'rgba(63, 185, 80, 0.12)';
        dupAlert.style.border = '1px solid rgba(63, 185, 80, 0.35)';
        dupAlert.style.color = '#7ee787';
        if (dupIcon) dupIcon.textContent = '✓';
        if (dupMsg) dupMsg.textContent = `File already completed on disk (${match.name})`;
        if (dupActions) {
          const extractedPath = match.extractedPath || findExtractedPathForTask(match);
          dupActions.innerHTML = `
            <button type="button" class="tool-btn" id="idm-dup-btn-open" style="padding: 2px 8px; font-size: 0.72rem;">Open File</button>
            <button type="button" class="tool-btn" id="idm-dup-btn-folder" style="padding: 2px 8px; font-size: 0.72rem;">Show Folder</button>
            ${extractedPath ? `
            <button type="button" class="tool-btn" id="idm-dup-btn-extracted" style="padding: 2px 8px; font-size: 0.72rem; background: rgba(168, 85, 247, 0.2); border: 1px solid rgba(168, 85, 247, 0.45); color: #d8b4fe;" title="Open Extracted Directory (${escapeHtml(extractedPath)})">Open Extracted Folder</button>
            ` : ''}
          `;
          document.getElementById('idm-dup-btn-open').onclick = () => openFile(match.savePath);
          document.getElementById('idm-dup-btn-folder').onclick = () => openFolder(match.savePath);
          const btnExt = document.getElementById('idm-dup-btn-extracted');
          if (btnExt && extractedPath) {
            btnExt.onclick = () => openFolder(extractedPath);
          }
        }
      } else {
        dupAlert.style.background = 'rgba(56, 189, 248, 0.12)';
        dupAlert.style.border = '1px solid rgba(56, 189, 248, 0.35)';
        dupAlert.style.color = '#79c0ff';
        if (dupIcon) dupIcon.textContent = '🔄';
        if (dupMsg) dupMsg.textContent = `Active download found (${match.status.toUpperCase()}, ${match.percent}% completed)`;
        if (dupActions) {
          dupActions.innerHTML = `
            <button type="button" class="tool-btn primary" id="idm-dup-btn-update" style="padding: 2px 10px; font-size: 0.72rem; background: #238636; border-color: #2ea043; color: #fff;">Update Link & Resume</button>
          `;
          document.getElementById('idm-dup-btn-update').onclick = async () => {
            modalIdmConfirm.classList.remove('open');
            try {
              await fetch(`/api/downloads/${match.id}/update-url`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: probeData.url })
              });
              switchView('downloads');
              renderDownloads();
            } catch (_) {}
          };
        }
      }
    } else if (dupAlert) {
      dupAlert.style.display = 'none';
    }

    if (urlEl) urlEl.value = probeData.url || '';
    if (serverEl) serverEl.textContent = probeData.server ? `Server: ${probeData.server}` : '';
    if (nameEl) nameEl.value = probeData.filename || 'download';

    const cat = probeData.category || 'General';
    if (catBadge) {
      catBadge.textContent = cat;
      catBadge.className = 'type-badge badge-' + cat.toLowerCase();
    }

    const totalBytes = probeData.totalBytes || 0;
    if (sizeEl) {
      sizeEl.textContent = totalBytes > 0 ? formatBytes(totalBytes) : (probeData.formattedSize || 'Unknown / Stream');
    }
    if (resumableEl) {
      resumableEl.textContent = probeData.acceptRanges ? '✓ Resumable (Range byte headers supported)' : '⚠️ Single Stream / Direct';
      resumableEl.style.color = probeData.acceptRanges ? '#3fb950' : '#d29922';
    }

    const avgSpeed = probeData.avgSpeed || 10 * 1024 * 1024;
    const historyCount = probeData.historyCount || 0;
    const estSec = probeData.estimatedTimeSec || (totalBytes > 0 ? Math.ceil(totalBytes / avgSpeed) : 0);

    if (etaEl) {
      etaEl.textContent = (estSec > 0)
        ? `${formatETA(estSec)} (${formatETADuration(estSec)})`
        : (totalBytes > 0 ? '< 1s' : 'Dynamic Stream');
    }
    if (avgSpeedEl) {
      const spdFormatted = probeData.formattedAvgSpeed || formatSpeed(avgSpeed);
      avgSpeedEl.textContent = historyCount > 0
        ? `Based on ${spdFormatted} (Avg of last ${historyCount} downloads)`
        : `Based on ${spdFormatted} (Default baseline)`;
    }

    const defFolder = probeData.defaultSaveDir || (window.appState.config?.downloadDir || '');
    if (folderEl) folderEl.value = defFolder;

    const isMedia = Boolean(probeData.isMedia || /\.(mp4|mkv|webm|avi|mov|mp3|m4a|flac|wav|ogg|opus)$/i.test(probeData.filename || ''));
    if (mediaBox) {
      mediaBox.style.display = isMedia ? 'block' : 'none';
    }

    if (engineModeEl) {
      engineModeEl.value = probeData.initialModeVal || (isMedia ? 'singleStream' : 'inPlace-8');
    }

    // Archive Decompression & Password Options
    const isArchive = /\.(zip|rar|7z|tar\.gz|tar\.bz2|tar|tgz|001|r00|r01|part1\.rar|part\d+\.rar)$/i.test(probeData.filename || '');
    const extractBox = document.getElementById('idm-confirm-extract-box');
    if (extractBox) {
      extractBox.style.display = isArchive ? 'block' : 'none';
    }
    const extractCheck = document.getElementById('idm-confirm-enable-extract');
    if (extractCheck) extractCheck.checked = true;
    const extractPwd = document.getElementById('idm-confirm-archive-password');
    if (extractPwd) {
      extractPwd.value = '';
      extractPwd.type = 'password';
    }
    const deleteArchiveCheck = document.getElementById('idm-confirm-delete-archive');
    if (deleteArchiveCheck) deleteArchiveCheck.checked = false;

    const cfg = window.appState.config || {};
    // Script execution for individual download prompts must be OFF by default
    if (scriptCheck) scriptCheck.checked = false;
    if (scriptDetails) scriptDetails.style.display = 'none';
    if (scriptPathEl) scriptPathEl.value = cfg.postDownloadScriptPath || '';
    if (scriptTypeEl) scriptTypeEl.value = cfg.postDownloadScriptType || 'auto';
    if (scriptArgsEl) scriptArgsEl.value = cfg.postDownloadArguments || '"%FILE%"';

    closeAllModals();
    modalIdmConfirm.classList.add('open');
    if (nameEl) setTimeout(() => nameEl.focus(), 60);

    // Force window to top when download confirmation is shown
    if (window.waterfallDesktop && window.waterfallDesktop.forceTop) {
      window.waterfallDesktop.forceTop();
    }
  }

  window.addEventListener('download:confirm', (e) => {
    if (e.detail) {
      if (window.waterfallDesktop && typeof window.waterfallDesktop.openConfirmWindow === 'function') {
        window.waterfallDesktop.openConfirmWindow(e.detail);
        return;
      }
      if (window.waterfallDesktop && window.waterfallDesktop.focusWindow) {
        window.waterfallDesktop.focusWindow();
      }
      if (e.detail.existingMatch) {
        showDuplicatePrompt(e.detail, (opts = {}) => {
          if (opts && opts.allowDuplicate) e.detail.allowDuplicate = true;
          openIdmConfirmation(e.detail);
        });
      } else {
        openIdmConfirmation(e.detail);
      }
    }
  });

  // Folder chips
  const chipDownloads = document.getElementById('chip-folder-downloads');
  const chipDesktop = document.getElementById('chip-folder-desktop');
  const chipCategory = document.getElementById('chip-folder-category');
  const btnBrowseFolder = document.getElementById('idm-confirm-btn-browse');
  const inputConfirmFolder = document.getElementById('idm-confirm-folder');

  if (chipDownloads) {
    chipDownloads.addEventListener('click', () => {
      if (inputConfirmFolder) inputConfirmFolder.value = (window.appState.config?.downloadDir || '');
    });
  }
  if (chipDesktop) {
    chipDesktop.addEventListener('click', () => {
      const base = window.appState.config?.downloadDir || '';
      const userHome = base.split('\\Downloads')[0] || base.split('/Downloads')[0] || '';
      if (userHome && inputConfirmFolder) inputConfirmFolder.value = `${userHome}\\Desktop`;
    });
  }
  if (chipCategory) {
    chipCategory.addEventListener('click', () => {
      if (currentConfirmData && currentConfirmData.defaultSaveDir && inputConfirmFolder) {
        inputConfirmFolder.value = currentConfirmData.defaultSaveDir;
      }
    });
  }

  if (btnBrowseFolder) {
    btnBrowseFolder.addEventListener('click', async () => {
      const currentPath = inputConfirmFolder ? inputConfirmFolder.value.trim() : '';
      if (window.waterfallDesktop && window.waterfallDesktop.selectFolder) {
        const chosen = await window.waterfallDesktop.selectFolder(currentPath);
        if (chosen && inputConfirmFolder) inputConfirmFolder.value = chosen;
      } else {
        try {
          const res = await fetch('/api/browse-folder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ defaultPath: currentPath })
          });
          const data = await res.json();
          if (data && data.success && data.folder && inputConfirmFolder) {
            inputConfirmFolder.value = data.folder;
          }
        } catch (_) {}
      }
    });
  }

  // Script checkbox accordion toggle
  const idmScriptCheck = document.getElementById('idm-confirm-enable-script');
  const idmScriptDetails = document.getElementById('idm-confirm-script-details');
  if (idmScriptCheck && idmScriptDetails) {
    idmScriptCheck.addEventListener('change', () => {
      idmScriptDetails.style.display = idmScriptCheck.checked ? 'block' : 'none';
    });
  }

  // Confirm modal submission helper
  async function submitConfirmedDownload(autoStart = true, watchNow = false) {
    if (!currentConfirmData) return;
    const url = currentConfirmData.url;
    const filename = document.getElementById('idm-confirm-filename')?.value.trim() || currentConfirmData.filename;
    const saveDir = document.getElementById('idm-confirm-folder')?.value.trim() || currentConfirmData.defaultSaveDir;
    const modeVal = document.getElementById('idm-confirm-engine-mode')?.value || 'inPlace-8';

    let downloadEngineMode = 'inPlace';
    let singleStream = false;
    let segments = 8;

    if (modeVal === 'singleStream' || watchNow) {
      downloadEngineMode = 'singleStream';
      singleStream = true;
      segments = 1;
    } else if (modeVal === 'inPlace-16') {
      downloadEngineMode = 'inPlace';
      segments = 16;
    } else if (modeVal === 'inPlace-4') {
      downloadEngineMode = 'inPlace';
      segments = 4;
    } else if (modeVal === 'legacyTemp') {
      downloadEngineMode = 'legacyTemp';
      segments = 8;
    }

    let customScript = null;
    const enableScript = document.getElementById('idm-confirm-enable-script')?.checked;
    if (enableScript) {
      customScript = {
        enabled: true,
        type: document.getElementById('idm-confirm-script-type')?.value || 'auto',
        path: document.getElementById('idm-confirm-script-path')?.value.trim() || '',
        args: document.getElementById('idm-confirm-script-args')?.value.trim() || '"%FILE%"'
      };
    } else {
      customScript = { enabled: false };
    }

    const enableExtract = Boolean(document.getElementById('idm-confirm-enable-extract')?.checked);
    const archivePassword = document.getElementById('idm-confirm-archive-password')?.value.trim() || '';
    const deleteArchiveOnExtract = Boolean(document.getElementById('idm-confirm-delete-archive')?.checked);

    try {
      const res = await fetch('/api/downloads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          filename,
          size: currentConfirmData.totalBytes || 0,
          saveDir,
          autoStart,
          downloadEngineMode,
          singleStream,
          segments,
          customScript,
          isMedia: currentConfirmData.isMedia,
          autoExtract: enableExtract,
          archivePassword,
          deleteAfterExtract: deleteArchiveOnExtract,
          allowDuplicate: Boolean(currentConfirmData && currentConfirmData.allowDuplicate),
          confirmed: true
        })
      });

      if (!res.ok) throw new Error(await res.text());
      const task = await res.json();

      if (task && task.isDuplicate && !currentConfirmData?.allowDuplicate) {
        if (modalIdmConfirm) modalIdmConfirm.classList.remove('open');
        showDuplicatePrompt({ existingMatch: { ...task, isDone: true }, ...currentConfirmData }, () => {
          if (currentConfirmData) currentConfirmData.allowDuplicate = true;
          submitConfirmedDownload(autoStart, watchNow);
        });
        return;
      }

      if (modalIdmConfirm) modalIdmConfirm.classList.remove('open');
      switchView('downloads');
      renderDownloads();

      if (watchNow && task) {
        setTimeout(() => openMediaPlayer(task), 300);
      }
    } catch (err) {
      alert('Could not start download: ' + err.message);
    }
  }

  const btnIdmStart = document.getElementById('idm-confirm-btn-start');
  const btnIdmLater = document.getElementById('idm-confirm-btn-later');
  const btnIdmWatch = document.getElementById('idm-confirm-btn-watch-now');
  const btnIdmCancel = document.getElementById('idm-confirm-btn-cancel');

  if (btnIdmStart) btnIdmStart.addEventListener('click', () => submitConfirmedDownload(true, false));
  if (btnIdmLater) btnIdmLater.addEventListener('click', () => submitConfirmedDownload(false, false));
  if (btnIdmWatch) btnIdmWatch.addEventListener('click', () => submitConfirmedDownload(true, true));
  if (btnIdmCancel) btnIdmCancel.addEventListener('click', () => {
    if (modalIdmConfirm) modalIdmConfirm.classList.remove('open');
  });

  const btnTogglePwdConfirm = document.getElementById('btn-toggle-pwd-confirm');
  if (btnTogglePwdConfirm) {
    btnTogglePwdConfirm.onclick = () => {
      const pwdIn = document.getElementById('idm-confirm-archive-password');
      if (pwdIn) pwdIn.type = pwdIn.type === 'password' ? 'text' : 'password';
    };
  }

  // ==========================================================================
  // Archive Password Required Modal Engine
  // ==========================================================================
  const modalExtractPassword = document.getElementById('modal-extract-password');
  const inputExtractPassword = document.getElementById('input-extract-password');
  const checkRememberExtractPassword = document.getElementById('check-remember-extract-password');
  const extractPwdFilename = document.getElementById('extract-pwd-filename');
  const btnSubmitExtractPassword = document.getElementById('btn-submit-extract-password');
  const btnTogglePwdPrompt = document.getElementById('btn-toggle-pwd-prompt');

  function openExtractPasswordPrompt(taskId, filename) {
    extractPasswordTargetTaskId = taskId;
    if (extractPwdFilename) extractPwdFilename.textContent = filename || 'Encrypted Archive';
    if (inputExtractPassword) {
      inputExtractPassword.value = '';
      inputExtractPassword.type = 'password';
    }
    if (modalExtractPassword) {
      closeAllModals();
      modalExtractPassword.classList.add('open');
      setTimeout(() => inputExtractPassword?.focus(), 60);
    }
  }
  window.openExtractPasswordPrompt = openExtractPasswordPrompt;

  window.addEventListener('extract:password-required', (e) => {
    if (e.detail && e.detail.taskId) {
      openExtractPasswordPrompt(e.detail.taskId, e.detail.name || e.detail.groupKey);
    }
  });

  if (btnSubmitExtractPassword) {
    btnSubmitExtractPassword.onclick = async () => {
      if (!extractPasswordTargetTaskId) return;
      const password = inputExtractPassword?.value || '';
      const remember = checkRememberExtractPassword ? checkRememberExtractPassword.checked : true;

      try {
        const res = await fetch(`/api/downloads/${extractPasswordTargetTaskId}/set-password`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password, remember })
        });
        const data = await res.json();
        if (modalExtractPassword) modalExtractPassword.classList.remove('open');
        extractPasswordTargetTaskId = null;
      } catch (err) {
        alert('Could not submit archive password: ' + err.message);
      }
    };
  }

  if (btnTogglePwdPrompt && inputExtractPassword) {
    btnTogglePwdPrompt.onclick = () => {
      inputExtractPassword.type = inputExtractPassword.type === 'password' ? 'text' : 'password';
    };
  }

  if (inputExtractPassword) {
    inputExtractPassword.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (btnSubmitExtractPassword) btnSubmitExtractPassword.click();
      }
    });
  }

  // ==========================================================================
  // Delete Download Confirmation Modal (Disk Cleanup Engine)
  // ==========================================================================
  const modalDeleteConfirm = document.getElementById('modal-delete-confirm');
  const deleteConfirmPrompt = document.getElementById('delete-confirm-prompt');
  const deleteConfirmFilename = document.getElementById('delete-confirm-filename');
  const deleteConfirmPath = document.getElementById('delete-confirm-path');
  const deleteConfirmSize = document.getElementById('delete-confirm-size');
  const btnDeleteFromDisk = document.getElementById('btn-delete-from-disk');
  const btnDeleteListOnly = document.getElementById('btn-delete-list-only');
  const btnToolbarDelete = document.getElementById('btn-toolbar-delete');
  let tasksPendingDelete = [];

  function openDeleteConfirmModal(tasks = []) {
    if (!tasks || tasks.length === 0) return;
    tasksPendingDelete = tasks;

    if (!modalDeleteConfirm) {
      const delDisk = confirm(`Delete ${tasks.length} task(s)? Click OK to also delete downloaded files from disk, or Cancel to keep files on disk.`);
      const delIds = new Set(tasks.map(t => String(t.id)));
      window.appState.tasks = window.appState.tasks.filter(t => !delIds.has(String(t.id)));
      tasks.forEach(t => {
        selectedTaskIds.delete(t.id);
        selectedTaskIds.delete(String(t.id));
      });
      renderDownloads();
      updateBadges();
      updateBatchBar();
      if (checkSelectAllDownloads) checkSelectAllDownloads.checked = false;

      if (tasks.length === 1) {
        fetch(`/api/downloads/${tasks[0].id}?deleteFile=${delDisk}`, { method: 'DELETE' });
      } else {
        fetch('/api/downloads/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'delete', ids: tasks.map(t => t.id), deleteFiles: delDisk })
        });
      }
      return;
    }

    if (tasks.length === 1) {
      const t = tasks[0];
      if (deleteConfirmPrompt) deleteConfirmPrompt.textContent = `Are you sure you want to delete this download?`;
      if (deleteConfirmFilename) deleteConfirmFilename.textContent = t.name || t.filename || 'Download';
      if (deleteConfirmPath) deleteConfirmPath.textContent = t.savePath || 'Default Downloads folder';
      const sz = t.totalBytes || t.downloadedBytes || 0;
      if (deleteConfirmSize) deleteConfirmSize.textContent = sz > 0 ? formatBytes(sz) : 'Unknown / Stream';
    } else {
      if (deleteConfirmPrompt) deleteConfirmPrompt.textContent = `Are you sure you want to delete ${tasks.length} selected downloads?`;
      if (deleteConfirmFilename) deleteConfirmFilename.textContent = `${tasks.length} download tasks selected`;
      if (deleteConfirmPath) deleteConfirmPath.textContent = `Multiple disk storage paths`;
      const totalSz = tasks.reduce((acc, t) => acc + (t.totalBytes || t.downloadedBytes || 0), 0);
      if (deleteConfirmSize) deleteConfirmSize.textContent = totalSz > 0 ? formatBytes(totalSz) : 'Multiple files';
    }

    closeAllModals();
    modalDeleteConfirm.classList.add('open');
  }

  if (btnDeleteFromDisk) {
    btnDeleteFromDisk.onclick = async () => {
      if (tasksPendingDelete.length === 0) return;
      btnDeleteFromDisk.disabled = true;
      const toDelete = [...tasksPendingDelete];
      modalDeleteConfirm.classList.remove('open');
      tasksPendingDelete = [];

      // Optimistic instant UI removal
      const delIds = new Set(toDelete.map(t => String(t.id)));
      window.appState.tasks = window.appState.tasks.filter(t => !delIds.has(String(t.id)));
      toDelete.forEach(t => {
        selectedTaskIds.delete(t.id);
        selectedTaskIds.delete(String(t.id));
      });
      renderDownloads();
      updateBadges();
      updateBatchBar();
      if (checkSelectAllDownloads) checkSelectAllDownloads.checked = false;

      try {
        if (toDelete.length === 1) {
          await fetch(`/api/downloads/${toDelete[0].id}?deleteFile=true`, { method: 'DELETE' });
        } else {
          await fetch('/api/downloads/batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'delete', ids: toDelete.map(t => t.id), deleteFiles: true })
          });
        }
      } catch (err) {
        console.warn('Delete from disk error:', err);
      } finally {
        btnDeleteFromDisk.disabled = false;
      }
    };
  }

  if (btnDeleteListOnly) {
    btnDeleteListOnly.onclick = async () => {
      if (tasksPendingDelete.length === 0) return;
      btnDeleteListOnly.disabled = true;
      const toDelete = [...tasksPendingDelete];
      modalDeleteConfirm.classList.remove('open');
      tasksPendingDelete = [];

      // Optimistic instant UI removal
      const delIds = new Set(toDelete.map(t => String(t.id)));
      window.appState.tasks = window.appState.tasks.filter(t => !delIds.has(String(t.id)));
      toDelete.forEach(t => {
        selectedTaskIds.delete(t.id);
        selectedTaskIds.delete(String(t.id));
      });
      renderDownloads();
      updateBadges();
      updateBatchBar();
      if (checkSelectAllDownloads) checkSelectAllDownloads.checked = false;

      try {
        if (toDelete.length === 1) {
          await fetch(`/api/downloads/${toDelete[0].id}?deleteFile=false`, { method: 'DELETE' });
        } else {
          await fetch('/api/downloads/batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'delete', ids: toDelete.map(t => t.id), deleteFiles: false })
          });
        }
      } catch (err) {
        console.warn('Delete from list error:', err);
      } finally {
        btnDeleteListOnly.disabled = false;
      }
    };
  }

  if (btnToolbarDelete) {
    btnToolbarDelete.onclick = () => {
      if (selectedTaskIds && selectedTaskIds.size > 0) {
        const tasks = window.appState.tasks.filter(t => selectedTaskIds.has(t.id) || selectedTaskIds.has(String(t.id)));
        openDeleteConfirmModal(tasks);
      } else if (window.appState.tasks && window.appState.tasks.length > 0) {
        const first = window.appState.tasks[0];
        openDeleteConfirmModal([first]);
      } else {
        alert('There are no downloads in the queue to delete.');
      }
    };
  }

  // ==========================================================================
  // Cinema Live Media Streaming Player ("Watch While Downloading")
  // ==========================================================================
  const modalMediaPlayer = document.getElementById('modal-media-player');
  const playerVideo = document.getElementById('player-video-el');
  const playerAudio = document.getElementById('player-audio-el');
  const playerTitle = document.getElementById('player-title');
  const playerStats = document.getElementById('player-live-stats');
  const playerBtnExternal = document.getElementById('player-btn-external');
  const btnClosePlayer = document.getElementById('btn-close-player');
  let activePlayingTaskId = null;

  function openMediaPlayer(task) {
    if (!task) return;
    activePlayingTaskId = task.id;
    const streamUrl = `/api/downloads/${task.id}/stream`;
    const isAudio = /\.(mp3|m4a|flac|wav|ogg|opus)$/i.test(task.name || '');

    if (playerTitle) playerTitle.textContent = task.name || 'Live Media Preview';
    if (playerStats) playerStats.textContent = `Buffering ${formatBytes(task.downloadedBytes)} of ${formatBytes(task.totalBytes)} • ${formatSpeed(task.speed)}`;

    if (isAudio) {
      if (playerVideo) { playerVideo.pause(); playerVideo.style.display = 'none'; playerVideo.src = ''; }
      if (playerAudio) {
        playerAudio.style.display = 'block';
        playerAudio.src = streamUrl;
        playerAudio.play().catch(() => {});
      }
    } else {
      if (playerAudio) { playerAudio.pause(); playerAudio.style.display = 'none'; playerAudio.src = ''; }
      if (playerVideo) {
        playerVideo.style.display = 'block';
        playerVideo.src = streamUrl;
        playerVideo.play().catch(() => {});
      }
    }

    if (playerBtnExternal) {
      playerBtnExternal.onclick = () => {
        const fullStreamUrl = `http://127.0.0.1:4567/api/downloads/${task.id}/stream`;
        if (window.waterfallDesktop && window.waterfallDesktop.openExternal) {
          window.waterfallDesktop.openExternal(fullStreamUrl);
        } else {
          window.open(fullStreamUrl, '_blank');
        }
      };
    }

    if (modalMediaPlayer) modalMediaPlayer.classList.add('open');
  }

  function closeMediaPlayer() {
    activePlayingTaskId = null;
    if (playerVideo) { playerVideo.pause(); playerVideo.removeAttribute('src'); playerVideo.load(); }
    if (playerAudio) { playerAudio.pause(); playerAudio.removeAttribute('src'); playerAudio.load(); }
    if (modalMediaPlayer) modalMediaPlayer.classList.remove('open');
  }

  if (btnClosePlayer) btnClosePlayer.addEventListener('click', closeMediaPlayer);

  window.addEventListener('state:tick', () => {
    if (activePlayingTaskId && modalMediaPlayer && modalMediaPlayer.classList.contains('open')) {
      const current = window.appState.tasks.find(t => t.id === activePlayingTaskId);
      if (current && playerStats) {
        playerStats.textContent = `Buffering ${formatBytes(current.downloadedBytes)} of ${formatBytes(current.totalBytes)} • ${formatSpeed(current.speed)}`;
      }
    }
  });

  const inputUrlEl = document.getElementById('input-url');
  if (inputUrlEl) {
    inputUrlEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (btnSubmitAddUrl) btnSubmitAddUrl.click();
      }
    });
  }

  function updateLimiterStatusLabel(cfg) {
    if (!limiterStatusLabel) return;
    const config = cfg || window.appState.config || {};
    const btnLimiter = document.getElementById('btn-speed-limiter');
    if (config.speedLimitEnabled && config.speedLimitBytesPerSec > 0) {
      limiterStatusLabel.textContent = `Limit: ${formatSpeed(config.speedLimitBytesPerSec)}`;
      if (btnLimiter) btnLimiter.classList.add('limiter-active');
    } else {
      limiterStatusLabel.textContent = 'Speed Limit: Off';
      if (btnLimiter) btnLimiter.classList.remove('limiter-active');
    }
  }

  // Speed Limiter Modal
  if (btnSpeedLimiter) {
    btnSpeedLimiter.addEventListener('click', () => {
      const cfg = window.appState.config || {};
      const checkEnable = document.getElementById('check-enable-limiter');
      const inputVal = document.getElementById('input-limiter-val');
      const selectUnit = document.getElementById('select-limiter-unit');

      if (checkEnable) checkEnable.checked = !!cfg.speedLimitEnabled;
      const limitBytes = cfg.speedLimitBytesPerSec || 0;
      if (limitBytes >= 1024 * 1024) {
        if (inputVal) inputVal.value = parseFloat((limitBytes / (1024 * 1024)).toFixed(1));
        if (selectUnit) selectUnit.value = 'MB';
      } else if (limitBytes > 0) {
        if (inputVal) inputVal.value = Math.round(limitBytes / 1024);
        if (selectUnit) selectUnit.value = 'KB';
      } else {
        if (inputVal) inputVal.value = 5;
        if (selectUnit) selectUnit.value = 'MB';
      }
      modalSpeedLimiter.classList.add('open');
    });
  }

  if (btnSaveSpeedLimiter) {
    btnSaveSpeedLimiter.addEventListener('click', async () => {
      const checkEnable = document.getElementById('check-enable-limiter');
      const inputVal = document.getElementById('input-limiter-val');
      const selectUnit = document.getElementById('select-limiter-unit');

      const enabled = checkEnable ? checkEnable.checked : false;
      const val = parseFloat(inputVal ? inputVal.value : '5') || 5;
      const unit = selectUnit ? selectUnit.value : 'MB';
      const limitBytes = unit === 'MB' ? Math.round(val * 1024 * 1024) : Math.round(val * 1024);

      btnSaveSpeedLimiter.disabled = true;
      btnSaveSpeedLimiter.textContent = 'Applying...';

      try {
        const res = await fetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            speedLimitEnabled: enabled,
            speedLimitBytesPerSec: limitBytes
          })
        });
        const updated = await res.json();
        window.appState.config = updated;
        updateLimiterStatusLabel(updated);
        modalSpeedLimiter.classList.remove('open');
      } catch (err) {
        alert('Failed to apply speed limit: ' + err.message);
      } finally {
        btnSaveSpeedLimiter.disabled = false;
        btnSaveSpeedLimiter.textContent = 'Apply';
      }
    });
  }
  // --------------------------------------------------------------------------
  // Acoustic Notification Chime Synthesizer (Web Audio API)
  // --------------------------------------------------------------------------
  function playCompletionChime(volume = null) {
    try {
      const config = window.appState.config || {};
      if (volume === null && config.soundChimeEnabled === false) return;
      const volLevel = (volume !== null) ? volume : (config.soundChimeVolume !== undefined ? config.soundChimeVolume : 0.8);
      if (volLevel <= 0) return;

      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();

      const now = ctx.currentTime;
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();

      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(659.25, now);
      osc1.frequency.exponentialRampToValueAtTime(987.77, now + 0.12);

      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(1318.51, now);
      osc2.frequency.exponentialRampToValueAtTime(1975.53, now + 0.12);

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(volLevel * 0.35, now + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.75);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + 0.8);
      osc2.stop(now + 0.8);
    } catch (_) {}
  }

  // --------------------------------------------------------------------------
  // Dynamic Accent Theme Switching
  // --------------------------------------------------------------------------
  function applyThemeAccent(accent) {
    const accents = {
      cyan: { blue: '#388bfd', glow: 'rgba(56, 139, 253, 0.3)' },
      purple: { blue: '#a371f7', glow: 'rgba(163, 113, 247, 0.3)' },
      emerald: { blue: '#2ea043', glow: 'rgba(46, 160, 67, 0.3)' },
      amber: { blue: '#d29922', glow: 'rgba(210, 153, 34, 0.3)' },
      crimson: { blue: '#f85149', glow: 'rgba(248, 81, 73, 0.3)' }
    };
    const c = accents[accent] || accents.cyan;
    document.documentElement.style.setProperty('--accent-idm-blue', c.blue);
    document.documentElement.style.setProperty('--accent-idm-blue-glow', c.glow);
  }

  function updatePinTopButton(isPinned) {
    const btnPin = document.getElementById('btn-pin-top');
    const labelPin = document.getElementById('pin-top-label');
    if (!btnPin) return;
    if (isPinned) {
      btnPin.classList.add('active');
      btnPin.style.background = 'rgba(88, 166, 255, 0.25)';
      btnPin.style.borderColor = 'var(--accent-primary, #58a6ff)';
      btnPin.style.color = '#58a6ff';
      if (labelPin) labelPin.textContent = 'Pinned';
    } else {
      btnPin.classList.remove('active');
      btnPin.style.background = '';
      btnPin.style.borderColor = '';
      btnPin.style.color = '';
      if (labelPin) labelPin.textContent = 'Pin';
    }
  }

  const btnPinTop = document.getElementById('btn-pin-top');
  if (btnPinTop) {
    btnPinTop.addEventListener('click', async () => {
      const currentPinned = !!(window.appState.config && window.appState.config.alwaysOnTop);
      const newPinned = !currentPinned;
      if (!window.appState.config) window.appState.config = {};
      window.appState.config.alwaysOnTop = newPinned;
      updatePinTopButton(newPinned);
      if (window.waterfallDesktop && window.waterfallDesktop.setAlwaysOnTop) {
        window.waterfallDesktop.setAlwaysOnTop(newPinned);
      }
      try {
        await fetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ alwaysOnTop: newPinned })
        });
      } catch (_) {}
    });
  }

  window.addEventListener('state:init', () => {
    if (window.appState.config) {
      if (window.appState.config.themeAccent) {
        applyThemeAccent(window.appState.config.themeAccent);
      }
      const isPinned = Boolean(window.appState.config.alwaysOnTop);
      updatePinTopButton(isPinned);
      if (window.waterfallDesktop && window.waterfallDesktop.setAlwaysOnTop) {
        window.waterfallDesktop.setAlwaysOnTop(isPinned);
      }
      updateLimiterStatusLabel(window.appState.config);
      updateFilterTabsBarVisibility(Boolean(window.appState.config.showTopFilterBar));
    }
  });

  window.addEventListener('state:config', () => {
    if (window.appState.config) {
      if (window.appState.config.themeAccent) {
        applyThemeAccent(window.appState.config.themeAccent);
      }
      const isPinned = Boolean(window.appState.config.alwaysOnTop);
      updatePinTopButton(isPinned);
      if (window.waterfallDesktop && window.waterfallDesktop.setAlwaysOnTop) {
        window.waterfallDesktop.setAlwaysOnTop(isPinned);
      }
      updateLimiterStatusLabel(window.appState.config);
      updateFilterTabsBarVisibility(Boolean(window.appState.config.showTopFilterBar));
    }
  });

  // --------------------------------------------------------------------------
  // Settings Center Modal Wiring
  // --------------------------------------------------------------------------
  const btnResetSettings = document.getElementById('btn-reset-settings');
  const btnTestChime = document.getElementById('btn-test-chime');
  const cfgSoundVolume = document.getElementById('cfg-sound-volume');
  const cfgVolumeLabel = document.getElementById('cfg-volume-label');
  const accentSwatches = document.querySelectorAll('.accent-swatch');

  // Tab navigation inside Settings modal
  document.querySelectorAll('.settings-nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-tab');
      document.querySelectorAll('.settings-nav-item').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.settings-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      const panel = document.getElementById(targetId);
      if (panel) panel.classList.add('active');
    });
  });

  // Audio volume slider
  if (cfgSoundVolume && cfgVolumeLabel) {
    cfgSoundVolume.addEventListener('input', (e) => {
      cfgVolumeLabel.textContent = `${Math.round(parseFloat(e.target.value) * 100)}%`;
    });
  }

  // Audio test chime
  if (btnTestChime) {
    btnTestChime.addEventListener('click', () => {
      const vol = cfgSoundVolume ? parseFloat(cfgSoundVolume.value) : 0.8;
      playCompletionChime(vol);
    });
  }

  // Accent swatches
  accentSwatches.forEach(swatch => {
    swatch.addEventListener('click', () => {
      accentSwatches.forEach(s => s.classList.remove('active'));
      swatch.classList.add('active');
      applyThemeAccent(swatch.getAttribute('data-accent'));
    });
  });

  function populateSettingsForm(cfg) {
    if (!cfg) return;

    // 1. Engine & Network
    if (document.getElementById('cfg-segments')) document.getElementById('cfg-segments').value = cfg.segmentsPerFile || 8;
    if (document.getElementById('cfg-engine-mode')) document.getElementById('cfg-engine-mode').value = cfg.downloadEngineMode || 'inPlace';
    if (document.getElementById('cfg-max-active')) document.getElementById('cfg-max-active').value = cfg.maxConcurrentDownloads || 3;
    if (document.getElementById('cfg-buffer-size')) document.getElementById('cfg-buffer-size').value = cfg.bufferSizeBytes || 1048576;
    if (document.getElementById('cfg-conn-timeout')) document.getElementById('cfg-conn-timeout').value = cfg.connectionTimeoutSec || 15;
    if (document.getElementById('cfg-max-retries')) document.getElementById('cfg-max-retries').value = cfg.maxRetries || 5;
    if (document.getElementById('cfg-retry-delay')) document.getElementById('cfg-retry-delay').value = cfg.retryDelaySec || 3;
    if (document.getElementById('cfg-user-agent')) document.getElementById('cfg-user-agent').value = cfg.customUserAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) WaterfallDL/2.0';

    // 2. Storage & Folders
    if (document.getElementById('cfg-download-dir')) document.getElementById('cfg-download-dir').value = cfg.downloadDir || '';
    if (document.getElementById('cfg-temp-dir')) document.getElementById('cfg-temp-dir').value = cfg.tempDir || '';
    if (document.getElementById('cfg-use-os-folders')) document.getElementById('cfg-use-os-folders').checked = cfg.useOsMediaFolders !== false;
    if (document.getElementById('cfg-create-pkg-subfolders')) document.getElementById('cfg-create-pkg-subfolders').checked = !!cfg.createPackageSubfolders;
    if (document.getElementById('cfg-preserve-meta')) document.getElementById('cfg-preserve-meta').checked = cfg.preserveMetadata !== false;
    if (document.getElementById('cfg-dup-action')) document.getElementById('cfg-dup-action').value = cfg.duplicateAction || 'rename';

    // 3. Limiter
    if (document.getElementById('cfg-limiter-enabled')) document.getElementById('cfg-limiter-enabled').checked = !!cfg.speedLimitEnabled;
    const limitBytes = cfg.speedLimitBytesPerSec || 0;
    if (limitBytes >= 1024 * 1024) {
      if (document.getElementById('cfg-limiter-val')) document.getElementById('cfg-limiter-val').value = parseFloat((limitBytes / (1024 * 1024)).toFixed(1));
      if (document.getElementById('cfg-limiter-unit')) document.getElementById('cfg-limiter-unit').value = 'MB';
    } else if (limitBytes > 0) {
      if (document.getElementById('cfg-limiter-val')) document.getElementById('cfg-limiter-val').value = Math.round(limitBytes / 1024);
      if (document.getElementById('cfg-limiter-unit')) document.getElementById('cfg-limiter-unit').value = 'KB';
    } else {
      if (document.getElementById('cfg-limiter-val')) document.getElementById('cfg-limiter-val').value = 5;
      if (document.getElementById('cfg-limiter-unit')) document.getElementById('cfg-limiter-unit').value = 'MB';
    }

    // 4. Media & YouTube
    if (document.getElementById('cfg-video-quality')) document.getElementById('cfg-video-quality').value = cfg.defaultVideoQuality || '1080';
    if (document.getElementById('cfg-audio-format')) document.getElementById('cfg-audio-format').value = cfg.defaultAudioFormat || 'mp3';
    if (document.getElementById('cfg-audio-quality')) document.getElementById('cfg-audio-quality').value = cfg.defaultAudioQuality || '0';
    if (document.getElementById('cfg-media-node-accel')) document.getElementById('cfg-media-node-accel').value = cfg.nodeJsAcceleration !== false ? 'true' : 'false';
    if (document.getElementById('cfg-media-embed-meta')) document.getElementById('cfg-media-embed-meta').checked = cfg.embedMediaMetadata !== false;
    if (document.getElementById('cfg-media-embed-thumb')) document.getElementById('cfg-media-embed-thumb').checked = cfg.embedMediaThumbnail !== false;
    if (document.getElementById('cfg-media-embed-chapters')) document.getElementById('cfg-media-embed-chapters').checked = cfg.embedMediaChapters !== false;

    // 5. Automation & Script Execution Engine
    if (document.getElementById('cfg-auto-extract')) document.getElementById('cfg-auto-extract').checked = cfg.autoExtractArchives !== false;
    if (document.getElementById('cfg-delete-archive')) document.getElementById('cfg-delete-archive').checked = !!cfg.deleteArchiveAfterExtract;
    if (document.getElementById('cfg-power-action')) document.getElementById('cfg-power-action').value = cfg.powerActionOnComplete || 'none';
    if (document.getElementById('cfg-script-enabled')) document.getElementById('cfg-script-enabled').checked = !!cfg.postDownloadScriptEnabled;
    if (document.getElementById('cfg-script-type')) document.getElementById('cfg-script-type').value = cfg.postDownloadScriptType || 'auto';
    if (document.getElementById('cfg-script-path')) document.getElementById('cfg-script-path').value = cfg.postDownloadScriptPath || '';
    if (document.getElementById('cfg-script-compiler')) document.getElementById('cfg-script-compiler').value = cfg.postDownloadCustomCompiler || '';
    if (document.getElementById('cfg-script-args')) document.getElementById('cfg-script-args').value = cfg.postDownloadArguments || '"%FILE%"';
    if (document.getElementById('cfg-script-condition')) document.getElementById('cfg-script-condition').value = cfg.postDownloadRunCondition || 'all';

    // 6. Notifications & Sound
    if (document.getElementById('cfg-native-notif')) document.getElementById('cfg-native-notif').checked = cfg.nativeOsNotifications !== false;
    if (document.getElementById('cfg-inapp-notif')) document.getElementById('cfg-inapp-notif').checked = cfg.inAppCompletionToast !== false;
    if (document.getElementById('cfg-sound-chime')) document.getElementById('cfg-sound-chime').checked = cfg.soundChimeEnabled !== false;
    const vol = cfg.soundChimeVolume !== undefined ? cfg.soundChimeVolume : 0.8;
    if (document.getElementById('cfg-sound-volume')) document.getElementById('cfg-sound-volume').value = vol;
    if (document.getElementById('cfg-volume-label')) document.getElementById('cfg-volume-label').textContent = `${Math.round(vol * 100)}%`;

    // 7. Theme & System
    if (document.getElementById('cfg-show-top-filter-bar')) document.getElementById('cfg-show-top-filter-bar').checked = !!cfg.showTopFilterBar;
    updateFilterTabsBarVisibility(Boolean(cfg.showTopFilterBar));
    if (document.getElementById('cfg-hide-finished')) document.getElementById('cfg-hide-finished').checked = !!cfg.hideFinishedInAllDownloads;
    if (document.getElementById('cfg-default-sort')) document.getElementById('cfg-default-sort').value = cfg.defaultQueueSorting || 'active-first';
    if (document.getElementById('cfg-show-confirm')) document.getElementById('cfg-show-confirm').checked = cfg.showDownloadConfirmation !== false;
    if (document.getElementById('cfg-start-with-windows')) document.getElementById('cfg-start-with-windows').checked = cfg.startWithWindows !== false;
    if (document.getElementById('cfg-start-with-window')) document.getElementById('cfg-start-with-window').checked = !!cfg.startWithWindow;
    if (document.getElementById('cfg-show-download-progress')) document.getElementById('cfg-show-download-progress').checked = cfg.showDownloadProgressDialog !== false;
    if (document.getElementById('cfg-show-download-complete')) document.getElementById('cfg-show-download-complete').checked = cfg.showDownloadCompleteDialog !== false;
    if (document.getElementById('cfg-close-action')) document.getElementById('cfg-close-action').value = cfg.closeAction || cfg.close_action || 'ask';
    if (document.getElementById('cfg-show-console')) document.getElementById('cfg-show-console').checked = !!(cfg.showConsole || cfg.show_console);
    if (document.getElementById('cfg-auto-download-no-confirm')) document.getElementById('cfg-auto-download-no-confirm').checked = !!cfg.autoDownloadWithoutConfirmation;
    if (document.getElementById('cfg-force-top-download')) document.getElementById('cfg-force-top-download').checked = !!cfg.forceTopOnDownload;
    if (document.getElementById('cfg-always-on-top')) document.getElementById('cfg-always-on-top').checked = !!cfg.alwaysOnTop;
    if (document.getElementById('cfg-media-stream-preview')) document.getElementById('cfg-media-stream-preview').checked = cfg.mediaStreamPreviewEnabled !== false;
    if (document.getElementById('cfg-high-fps')) document.getElementById('cfg-high-fps').checked = cfg.highFramerateTick !== false;
    if (document.getElementById('cfg-clipboard-monitor')) document.getElementById('cfg-clipboard-monitor').checked = !!cfg.clipboardMonitoring;
    if (document.getElementById('cfg-listen-port')) document.getElementById('cfg-listen-port').value = cfg.listenPort || 4567;

    const accent = cfg.themeAccent || 'cyan';
    accentSwatches.forEach(s => s.classList.toggle('active', s.getAttribute('data-accent') === accent));
    applyThemeAccent(accent);
  }

  btnSettings.addEventListener('click', async () => {
    try {
      const res = await fetch('/api/settings');
      const cfg = await res.json();
      window.appState.config = cfg;
      populateSettingsForm(cfg);
    } catch (_) {
      populateSettingsForm(window.appState.config);
    }
    refreshCrawlerEngineInfo();
    modalSettings.classList.add('open');
  });

  if (btnResetSettings) {
    btnResetSettings.addEventListener('click', async () => {
      if (!confirm('Are you sure you want to restore all Waterfall settings to factory defaults?')) return;
      try {
        const res = await fetch('/api/settings/reset', { method: 'POST' });
        const defaults = await res.json();
        window.appState.config = defaults;
        populateSettingsForm(defaults);
      } catch (err) {
        alert('Reset failed: ' + err.message);
      }
    });
  }

  const btnRelaunchWizard = document.getElementById('btn-relaunch-wizard');
  if (btnRelaunchWizard) {
    btnRelaunchWizard.addEventListener('click', () => {
      modalSettings.classList.remove('open');
      if (window.waterfallDesktop && typeof window.waterfallDesktop.openWelcomeWindow === 'function') {
        window.waterfallDesktop.openWelcomeWindow();
      } else {
        fetch('/api/window/open-welcome', { method: 'POST' }).catch(() => {});
      }
    });
  }

  btnSaveSettings.addEventListener('click', async () => {
    btnSaveSettings.disabled = true;
    btnSaveSettings.textContent = 'Saving...';

    const limiterVal = parseFloat(document.getElementById('cfg-limiter-val')?.value || '5');
    const limiterUnit = document.getElementById('cfg-limiter-unit')?.value || 'MB';
    const limitBytes = limiterUnit === 'MB' ? Math.round(limiterVal * 1024 * 1024) : Math.round(limiterVal * 1024);

    const activeSwatch = document.querySelector('.accent-swatch.active');
    const themeAccent = activeSwatch ? activeSwatch.getAttribute('data-accent') : 'cyan';

    const payload = {
      // Engine
      segmentsPerFile: parseInt(document.getElementById('cfg-segments')?.value, 10) || 8,
      downloadEngineMode: document.getElementById('cfg-engine-mode')?.value || 'inPlace',
      maxConcurrentDownloads: parseInt(document.getElementById('cfg-max-active')?.value, 10) || 3,
      bufferSizeBytes: parseInt(document.getElementById('cfg-buffer-size')?.value, 10) || 1048576,
      connectionTimeoutSec: parseInt(document.getElementById('cfg-conn-timeout')?.value, 10) || 15,
      maxRetries: parseInt(document.getElementById('cfg-max-retries')?.value, 10) || 5,
      retryDelaySec: parseInt(document.getElementById('cfg-retry-delay')?.value, 10) || 3,
      customUserAgent: document.getElementById('cfg-user-agent')?.value.trim() || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) WaterfallDL/2.0',

      // Storage
      downloadDir: document.getElementById('cfg-download-dir')?.value.trim(),
      tempDir: document.getElementById('cfg-temp-dir')?.value.trim(),
      useOsMediaFolders: document.getElementById('cfg-use-os-folders')?.checked,
      createPackageSubfolders: document.getElementById('cfg-create-pkg-subfolders')?.checked,
      preserveMetadata: document.getElementById('cfg-preserve-meta')?.checked,
      duplicateAction: document.getElementById('cfg-dup-action')?.value || 'rename',

      // Limiter
      speedLimitEnabled: document.getElementById('cfg-limiter-enabled')?.checked,
      speedLimitBytesPerSec: limitBytes,

      // Media
      defaultVideoQuality: document.getElementById('cfg-video-quality')?.value || '1080',
      defaultAudioFormat: document.getElementById('cfg-audio-format')?.value || 'mp3',
      defaultAudioQuality: document.getElementById('cfg-audio-quality')?.value || '0',
      nodeJsAcceleration: document.getElementById('cfg-media-node-accel')?.value === 'true',
      embedMediaMetadata: document.getElementById('cfg-media-embed-meta')?.checked,
      embedMediaThumbnail: document.getElementById('cfg-media-embed-thumb')?.checked,
      embedMediaChapters: document.getElementById('cfg-media-embed-chapters')?.checked,

      // Automation & Post-Download Script Engine
      autoExtractArchives: document.getElementById('cfg-auto-extract')?.checked,
      deleteArchiveAfterExtract: document.getElementById('cfg-delete-archive')?.checked,
      powerActionOnComplete: document.getElementById('cfg-power-action')?.value || 'none',
      postDownloadScriptEnabled: document.getElementById('cfg-script-enabled')?.checked || false,
      postDownloadScriptType: document.getElementById('cfg-script-type')?.value || 'auto',
      postDownloadScriptPath: document.getElementById('cfg-script-path')?.value.trim() || '',
      postDownloadCustomCompiler: document.getElementById('cfg-script-compiler')?.value.trim() || '',
      postDownloadArguments: document.getElementById('cfg-script-args')?.value.trim() || '"%FILE%"',
      postDownloadRunCondition: document.getElementById('cfg-script-condition')?.value || 'all',

      // Notifications
      nativeOsNotifications: document.getElementById('cfg-native-notif')?.checked,
      inAppCompletionToast: document.getElementById('cfg-inapp-notif')?.checked,
      soundChimeEnabled: document.getElementById('cfg-sound-chime')?.checked,
      soundChimeVolume: parseFloat(document.getElementById('cfg-sound-volume')?.value || '0.8'),

      // Interface
      showTopFilterBar: document.getElementById('cfg-show-top-filter-bar')?.checked || false,
      hideFinishedInAllDownloads: Boolean(document.getElementById('cfg-hide-finished')?.checked),
      defaultQueueSorting: document.getElementById('cfg-default-sort')?.value || 'active-first',
      showDownloadConfirmation: document.getElementById('cfg-show-confirm')?.checked,
      startWithWindows: document.getElementById('cfg-start-with-windows')?.checked !== false,
      startWithWindow: Boolean(document.getElementById('cfg-start-with-window')?.checked),
      showDownloadProgressDialog: document.getElementById('cfg-show-download-progress')?.checked !== false,
      showDownloadCompleteDialog: document.getElementById('cfg-show-download-complete')?.checked !== false,
      closeAction: document.getElementById('cfg-close-action')?.value || 'ask',
      close_action: document.getElementById('cfg-close-action')?.value || 'ask',
      showConsole: Boolean(document.getElementById('cfg-show-console')?.checked),
      show_console: Boolean(document.getElementById('cfg-show-console')?.checked),
      autoDownloadWithoutConfirmation: document.getElementById('cfg-auto-download-no-confirm')?.checked || false,
      forceTopOnDownload: Boolean(document.getElementById('cfg-force-top-download')?.checked),
      alwaysOnTop: document.getElementById('cfg-always-on-top')?.checked || false,
      mediaStreamPreviewEnabled: document.getElementById('cfg-media-stream-preview')?.checked,
      highFramerateTick: document.getElementById('cfg-high-fps')?.checked,
      clipboardMonitoring: document.getElementById('cfg-clipboard-monitor')?.checked,
      listenPort: parseInt(document.getElementById('cfg-listen-port')?.value, 10) || 4567,
      themeAccent
    };

    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const updated = await res.json();
      window.appState.config = updated;
      window.appState.hideFinished = Boolean(updated.hideFinishedInAllDownloads);
      try {
        localStorage.setItem('waterfall_hide_finished', window.appState.hideFinished);
      } catch (_) {}
      if (!window.appState.sortCol) {
        window.appState.sortMode = updated.defaultQueueSorting || 'active-first';
        try {
          localStorage.setItem('waterfall_sort_mode', window.appState.sortMode);
        } catch (_) {}
      }
      applyThemeAccent(themeAccent);
      updateLimiterStatusLabel(updated);
      updatePinTopButton(Boolean(updated.alwaysOnTop));
      updateFilterTabsBarVisibility(Boolean(updated.showTopFilterBar));
      if (window.waterfallDesktop && window.waterfallDesktop.setAlwaysOnTop) {
        window.waterfallDesktop.setAlwaysOnTop(Boolean(updated.alwaysOnTop));
      }
      updateSortControlsUI();
      updateBadges();
      renderDownloads();
      modalSettings.classList.remove('open');
    } catch (err) {
      alert('Failed to save settings: ' + err.message);
    } finally {
      btnSaveSettings.disabled = false;
      btnSaveSettings.textContent = 'Save Settings';
    }
  });

  // ==========================================================================
  // Waterfall Auto-Updater Controller (GitHub Releases)
  // ==========================================================================
  const modalUpdate = document.getElementById('modal-update-available');
  const modalUpdateCurrVer = document.getElementById('modal-update-curr-ver');
  const modalUpdateLatestVer = document.getElementById('modal-update-latest-ver');
  const modalUpdateNotes = document.getElementById('modal-update-notes-body');
  const modalUpdateProgressWrap = document.getElementById('modal-update-progress-wrap');
  const modalUpdateProgressBar = document.getElementById('modal-update-progress-bar');
  const modalUpdateProgressMsg = document.getElementById('modal-update-progress-msg');
  const modalUpdateProgressPct = document.getElementById('modal-update-progress-pct');
  const btnModalUpdateNow = document.getElementById('btn-modal-update-now');
  const btnModalUpdateLater = document.getElementById('btn-modal-update-later');

  const btnSettingsCheckUpdate = document.getElementById('btn-settings-check-update');
  const btnSettingsInstallUpdate = document.getElementById('btn-settings-install-update');
  const updaterStatusText = document.getElementById('updater-status-text');
  const updaterIndicatorDot = document.getElementById('updater-indicator-dot');
  const updaterProgressContainer = document.getElementById('updater-progress-container');
  const updaterProgressFill = document.getElementById('updater-progress-fill');
  const updaterProgressPercent = document.getElementById('updater-progress-percent');
  const updaterProgressLabel = document.getElementById('updater-progress-label');
  const updaterAvailableBox = document.getElementById('updater-available-box');
  const updaterAvailableTitle = document.getElementById('updater-available-title');
  const updaterReleaseNotesBox = document.getElementById('updater-release-notes-box');
  const cfgAutoCheckUpdate = document.getElementById('cfg-auto-check-update');

  let activeUpdateInfo = null;
  let updatePollInterval = null;

  async function checkForAppUpdates(isManual = false) {
    if (isManual && btnSettingsCheckUpdate) {
      btnSettingsCheckUpdate.disabled = true;
      btnSettingsCheckUpdate.innerHTML = `<span class="spinner" style="display:inline-block; width:12px; height:12px; border:2px solid #38bdf8; border-top-color:transparent; border-radius:50%; animation:spin 0.6s linear infinite; vertical-align:middle; margin-right:4px;"></span> Checking...`;
    }
    if (updaterStatusText) {
      updaterStatusText.textContent = 'Checking GitHub Releases for newer version...';
    }

    try {
      const res = await fetch(`/api/update/check?force=${isManual ? 'true' : 'false'}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      activeUpdateInfo = data;

      if (modalUpdateCurrVer) modalUpdateCurrVer.textContent = data.current_version || 'v2.0.0';
      const curVerPill = document.getElementById('updater-current-ver-pill');
      if (curVerPill && data.current_version) curVerPill.textContent = `${data.current_version} Pro`;

      if (data.update_available) {
        if (updaterIndicatorDot) updaterIndicatorDot.style.background = '#38bdf8';
        if (updaterStatusText) {
          updaterStatusText.innerHTML = `<b style="color: #38bdf8;">Update Available:</b> ${data.latest_version} is ready for installation.`;
        }
        if (updaterAvailableBox) {
          updaterAvailableBox.style.display = 'flex';
          if (updaterAvailableTitle) updaterAvailableTitle.textContent = `🎉 New Version Ready: ${data.latest_version}`;
          if (updaterReleaseNotesBox) updaterReleaseNotesBox.textContent = data.release_notes || 'Continuous performance improvements and bug fixes.';
        }

        if (modalUpdateLatestVer) modalUpdateLatestVer.textContent = data.latest_version || 'Latest';
        if (modalUpdateNotes) modalUpdateNotes.textContent = data.release_notes || 'Official release containing security updates, download acceleration improvements, and fixes.';

        if (modalUpdate) {
          modalUpdate.classList.add('open');
        }
      } else {
        if (updaterIndicatorDot) updaterIndicatorDot.style.background = '#10b981';
        if (updaterStatusText) {
          updaterStatusText.textContent = `Waterfall is up to date (${data.current_version || 'v2.0.0'}).`;
        }
        if (updaterAvailableBox) updaterAvailableBox.style.display = 'none';

        if (isManual) {
          alert(`You are running the latest version of Waterfall (${data.current_version || 'v2.0.0'}). No updates needed!`);
        }
      }
    } catch (err) {
      if (updaterStatusText) {
        updaterStatusText.textContent = `Update check failed: ${err.message}`;
      }
      if (isManual) {
        alert('Could not check for updates. Please check your internet connection or try again later.');
      }
    } finally {
      if (isManual && btnSettingsCheckUpdate) {
        btnSettingsCheckUpdate.disabled = false;
        btnSettingsCheckUpdate.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg> <span>Check for Updates</span>`;
      }
    }
  }

  async function executeDownloadAndApplyUpdate() {
    if (btnModalUpdateNow) {
      btnModalUpdateNow.disabled = true;
      btnModalUpdateNow.textContent = 'Downloading...';
    }
    if (btnSettingsInstallUpdate) {
      btnSettingsInstallUpdate.disabled = true;
      btnSettingsInstallUpdate.textContent = 'Downloading...';
    }
    if (modalUpdateProgressWrap) modalUpdateProgressWrap.style.display = 'flex';
    if (updaterProgressContainer) updaterProgressContainer.style.display = 'flex';

    try {
      const startRes = await fetch('/api/update/download', { method: 'POST' });
      if (!startRes.ok) {
        const errJson = await startRes.json().catch(() => ({}));
        throw new Error(errJson.error || 'Failed to start download');
      }

      if (updatePollInterval) clearInterval(updatePollInterval);
      updatePollInterval = setInterval(async () => {
        try {
          const progRes = await fetch('/api/update/progress');
          if (!progRes.ok) return;
          const prog = await progRes.json();
          const pct = Math.min(100, Math.max(0, Math.round(prog.progress || 0)));

          if (modalUpdateProgressBar) modalUpdateProgressBar.style.width = `${pct}%`;
          if (modalUpdateProgressPct) modalUpdateProgressPct.textContent = `${pct}%`;
          if (updaterProgressFill) updaterProgressFill.style.width = `${pct}%`;
          if (updaterProgressPercent) updaterProgressPercent.textContent = `${pct}%`;

          if (!prog.is_downloading && pct >= 100) {
            clearInterval(updatePollInterval);
            updatePollInterval = null;

            if (modalUpdateProgressMsg) modalUpdateProgressMsg.textContent = 'Update downloaded! Restarting Waterfall to apply...';
            if (updaterProgressLabel) updaterProgressLabel.textContent = 'Update downloaded! Restarting Waterfall to apply...';
            if (btnModalUpdateNow) btnModalUpdateNow.textContent = 'Restarting Waterfall...';
            if (btnSettingsInstallUpdate) btnSettingsInstallUpdate.textContent = 'Restarting Waterfall...';

            // Trigger extraction & restart
            setTimeout(async () => {
              try {
                await fetch('/api/update/apply', { method: 'POST' });
              } catch (_) {}
            }, 600);
          }
        } catch (_) {}
      }, 300);
    } catch (err) {
      alert('Update failed: ' + err.message);
      if (btnModalUpdateNow) {
        btnModalUpdateNow.disabled = false;
        btnModalUpdateNow.textContent = 'Update & Restart Now';
      }
      if (btnSettingsInstallUpdate) {
        btnSettingsInstallUpdate.disabled = false;
        btnSettingsInstallUpdate.textContent = 'Download & Apply Update';
      }
    }
  }

  if (btnSettingsCheckUpdate) {
    btnSettingsCheckUpdate.addEventListener('click', () => checkForAppUpdates(true));
  }
  if (btnSettingsInstallUpdate) {
    btnSettingsInstallUpdate.addEventListener('click', () => executeDownloadAndApplyUpdate());
  }
  if (btnModalUpdateNow) {
    btnModalUpdateNow.addEventListener('click', () => executeDownloadAndApplyUpdate());
  }
  if (btnModalUpdateLater && modalUpdate) {
    btnModalUpdateLater.addEventListener('click', () => {
      modalUpdate.classList.remove('open');
    });
  }

  // Automatic silent check 4 seconds after app starts
  setTimeout(() => {
    try {
      const autoCheckDisabled = localStorage.getItem('waterfall_auto_update_disabled');
      if (!autoCheckDisabled) {
        checkForAppUpdates(false);
      }
    } catch (_) {}
  }, 4000);

  // Post-Download Script Engine: Clickable Placeholder Token Pills
  document.querySelectorAll('.script-placeholder-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      const token = pill.dataset.token;
      const argsInput = document.getElementById('cfg-script-args');
      if (argsInput && token) {
        const cur = argsInput.value.trim();
        argsInput.value = cur ? `${cur} ${token}` : token;
        argsInput.focus();
      }
    });
  });

  // Post-Download Script Engine: Test Run Button & Live Console
  const btnTestScript = document.getElementById('btn-test-script');
  const scriptTestConsole = document.getElementById('script-test-console');
  const scriptTestStatus = document.getElementById('script-test-status');
  const scriptTestBody = document.getElementById('script-test-body');

  if (btnTestScript) {
    btnTestScript.addEventListener('click', async () => {
      const scriptPath = document.getElementById('cfg-script-path')?.value.trim() || '';
      const customCompiler = document.getElementById('cfg-script-compiler')?.value.trim() || '';
      const scriptType = document.getElementById('cfg-script-type')?.value || 'auto';
      const scriptArgs = document.getElementById('cfg-script-args')?.value || '"%FILE%"';
      const condition = document.getElementById('cfg-script-condition')?.value || 'all';

      if (!scriptPath && !customCompiler) {
        alert('Please specify a Script File Path or Custom Compiler Executable to test.');
        return;
      }

      btnTestScript.disabled = true;
      btnTestScript.innerHTML = '<span>Testing Script...</span>';
      if (scriptTestConsole) scriptTestConsole.classList.add('active');
      if (scriptTestStatus) {
        scriptTestStatus.textContent = 'RUNNING';
        scriptTestStatus.style.color = '#388bfd';
      }
      if (scriptTestBody) scriptTestBody.textContent = 'Spawning test process with simulated download parameters...\n';

      try {
        const testPayload = {
          postDownloadScriptEnabled: true,
          postDownloadScriptType: scriptType,
          postDownloadScriptPath: scriptPath,
          postDownloadCustomCompiler: customCompiler,
          postDownloadArguments: scriptArgs,
          postDownloadRunCondition: condition
        };

        const res = await fetch('/api/settings/test-script', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(testPayload)
        });

        const data = await res.json();
        if (scriptTestStatus) {
          if (data.success) {
            scriptTestStatus.textContent = 'SUCCESS (Exit Code: 0)';
            scriptTestStatus.style.color = '#2ea043';
          } else {
            scriptTestStatus.textContent = `FAILED (Exit Code: ${data.code ?? -1})`;
            scriptTestStatus.style.color = '#f85149';
          }
        }

        let out = '';
        if (data.stdout) out += `[STDOUT]:\n${data.stdout}\n\n`;
        if (data.stderr) out += `[STDERR]:\n${data.stderr}\n\n`;
        if (data.error) out += `[ERROR]:\n${data.error}\n\n`;
        if (!out) out = `Process finished with return code ${data.code}. (No output streamed)`;

        if (scriptTestBody) scriptTestBody.textContent = out.trim();
      } catch (err) {
        if (scriptTestStatus) {
          scriptTestStatus.textContent = 'ERROR';
          scriptTestStatus.style.color = '#f85149';
        }
        if (scriptTestBody) scriptTestBody.textContent = 'Fetch error: ' + err.message;
      } finally {
        btnTestScript.disabled = false;
        btnTestScript.innerHTML = `
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
          <span>Test Run Script Now</span>
        `;
      }
    });
  }

  if (btnSubmitUpdateUrl) {
    btnSubmitUpdateUrl.addEventListener('click', async () => {
      if (!currentUpdatingTaskId) return;
      const newUrl = (inputNewUrl ? inputNewUrl.value : '').trim();
      if (!newUrl || !newUrl.startsWith('http')) {
        alert('Please enter a valid HTTP or HTTPS download URL.');
        return;
      }

      btnSubmitUpdateUrl.disabled = true;
      btnSubmitUpdateUrl.textContent = 'Updating & Resuming...';

      try {
        const res = await fetch(`/api/downloads/${currentUpdatingTaskId}/update-url`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: newUrl })
        });
        const data = await res.json();
        if (!res.ok || data.error) {
          throw new Error(data.error || 'Failed to update URL');
        }

        if (modalUpdateUrl) modalUpdateUrl.classList.remove('open');
        switchView('downloads');
        renderDownloads();
      } catch (err) {
        alert('Could not update download link: ' + err.message);
      } finally {
        btnSubmitUpdateUrl.disabled = false;
        btnSubmitUpdateUrl.textContent = '🔄 Update & Resume';
      }
    });
  }

  // Live toggle for show-top-filter-bar in settings modal
  const cfgShowTopFilterBar = document.getElementById('cfg-show-top-filter-bar');
  if (cfgShowTopFilterBar) {
    cfgShowTopFilterBar.addEventListener('change', () => {
      updateFilterTabsBarVisibility(cfgShowTopFilterBar.checked);
    });
  }

  // Universal Website Crawler & Extractor Engine Integration
  async function refreshCrawlerEngineInfo() {
    const badge = document.getElementById('crawler-engine-badge');
    try {
      const res = await fetch('/api/crawler/info');
      if (!res.ok) return;
      const data = await res.json();
      if (badge && data.version) {
        badge.textContent = `yt-dlp ${data.version}`;
      }
    } catch (_) {}
  }

  const btnUpdateCrawler = document.getElementById('btn-update-crawler');
  if (btnUpdateCrawler) {
    btnUpdateCrawler.addEventListener('click', async () => {
      const status = document.getElementById('crawler-update-status');
      const badge = document.getElementById('crawler-engine-badge');
      btnUpdateCrawler.disabled = true;
      if (status) {
        status.textContent = 'Checking GitHub releases & updating extractors...';
        status.style.color = 'var(--accent-cyan)';
      }
      try {
        const res = await fetch('/api/crawler/update', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          if (status) {
            status.textContent = data.message || 'Crawler engine is up to date!';
            status.style.color = '#3fb950';
          }
          if (badge && data.version) {
            badge.textContent = `yt-dlp ${data.version}`;
          }
        } else {
          if (status) {
            status.textContent = data.error || 'Update failed.';
            status.style.color = '#f85149';
          }
        }
      } catch (err) {
        if (status) {
          status.textContent = 'Update error: ' + err.message;
          status.style.color = '#f85149';
        }
      } finally {
        btnUpdateCrawler.disabled = false;
      }
    });
  }

  // ==========================================================================
  // Resizable Data Grid Columns Engine (Main Downloads Queue)
  // ==========================================================================
  const DEFAULT_COL_WIDTHS = {
    select: 36,
    name: 270,
    size: 95,
    status: 105,
    progress: 175,
    speed: 95,
    finish: 165,
    hoster: 90,
    actions: 145
  };

  const MIN_COL_WIDTHS = {
    select: 36,
    name: 120,
    size: 65,
    status: 80,
    progress: 110,
    speed: 70,
    finish: 95,
    hoster: 65,
    actions: 110
  };

  function applyColumnWidths(widths) {
    const table = document.getElementById('downloads-table');
    const cols = document.querySelectorAll('#downloads-colgroup col');
    if (!cols.length) return;
    let total = 0;
    cols.forEach(col => {
      const k = col.dataset.col;
      if (k) {
        const w = Math.max(MIN_COL_WIDTHS[k] || 36, widths[k] || DEFAULT_COL_WIDTHS[k] || 80);
        col.style.width = w + 'px';
        const th = document.querySelector(`.downloads-table th[data-col="${k}"]`);
        if (th) th.style.width = w + 'px';
        total += w;
      }
    });
    if (table) {
      table.style.minWidth = total + 'px';
    }
  }

  function loadColumnWidths() {
    let saved = null;
    try {
      const raw = localStorage.getItem('waterfall_col_widths');
      if (raw) saved = JSON.parse(raw);
    } catch (_) {}
    applyColumnWidths(saved && typeof saved === 'object' ? { ...DEFAULT_COL_WIDTHS, ...saved } : DEFAULT_COL_WIDTHS);
  }

  function initTableColumnResizing() {
    const table = document.getElementById('downloads-table');
    const handles = document.querySelectorAll('.downloads-table .col-resize-handle');
    if (!table || !handles.length) return;

    loadColumnWidths();

    handles.forEach(handle => {
      handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();

        const colKey = handle.dataset.col;
        if (!colKey) return;

        const th = handle.closest('th');
        const col = document.querySelector(`#downloads-colgroup col[data-col="${colKey}"]`);
        if (!th || !col) return;

        const startX = e.clientX;
        const startWidth = th.getBoundingClientRect().width;
        const minW = MIN_COL_WIDTHS[colKey] || 50;

        document.body.classList.add('resizing-columns');
        handle.classList.add('resizing');

        function onMouseMove(moveEvent) {
          const delta = moveEvent.clientX - startX;
          const newW = Math.max(minW, Math.round(startWidth + delta));
          col.style.width = newW + 'px';
          th.style.width = newW + 'px';

          // Recalculate table minWidth
          const cols = document.querySelectorAll('#downloads-colgroup col');
          let total = 0;
          cols.forEach(c => {
            total += parseInt(c.style.width, 10) || Math.round(c.getBoundingClientRect().width);
          });
          table.style.minWidth = total + 'px';
        }

        function onMouseUp() {
          document.body.classList.remove('resizing-columns');
          handle.classList.remove('resizing');
          window.removeEventListener('mousemove', onMouseMove);
          window.removeEventListener('mouseup', onMouseUp);

          // Save to localStorage
          const widths = {};
          document.querySelectorAll('#downloads-colgroup col').forEach(c => {
            const k = c.dataset.col;
            if (k) {
              widths[k] = parseInt(c.style.width, 10) || Math.round(c.getBoundingClientRect().width);
            }
          });
          try {
            localStorage.setItem('waterfall_col_widths', JSON.stringify(widths));
          } catch (_) {}
        }

        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
      });

      // Double-click to reset column to default width
      handle.addEventListener('dblclick', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const colKey = handle.dataset.col;
        if (colKey && DEFAULT_COL_WIDTHS[colKey]) {
          try {
            let saved = {};
            const raw = localStorage.getItem('waterfall_col_widths');
            if (raw) saved = JSON.parse(raw);
            saved[colKey] = DEFAULT_COL_WIDTHS[colKey];
            localStorage.setItem('waterfall_col_widths', JSON.stringify(saved));
          } catch (_) {}
          loadColumnWidths();
        }
      });
    });
  }

  // --- Quit / Exit Application Options Modal ---
  const modalQuitOptions = document.getElementById('modal-quit-options');
  const btnQuitToTray = document.getElementById('btn-quit-to-tray');
  const btnQuitExit = document.getElementById('btn-quit-exit');
  const btnQuitCancel = document.getElementById('btn-quit-cancel');
  const btnQuitCancelX = document.getElementById('btn-quit-cancel-x');
  const quitRememberChoice = document.getElementById('quit-remember-choice');
  const quitStatusText = document.getElementById('quit-status-text');
  const quitStatusBanner = document.getElementById('quit-status-banner');
  const cfgShowConsole = document.getElementById('cfg-show-console');

  if (cfgShowConsole) {
    cfgShowConsole.addEventListener('change', () => {
      fetch('/api/system/console', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ show: cfgShowConsole.checked })
      }).catch(() => {});
    });
  }

  window.showQuitOptionsModal = function() {
    const cfg = window.appState && window.appState.config ? window.appState.config : {};
    const savedAction = cfg.closeAction || cfg.close_action || localStorage.getItem('waterfall_close_action') || 'ask';

    if (savedAction === 'tray') {
      if (window.waterfallDesktop && typeof window.waterfallDesktop.minimizeToTray === 'function') {
        window.waterfallDesktop.minimizeToTray();
      } else {
        fetch('/api/system/minimize-tray', { method: 'POST' }).catch(() => {});
      }
      return;
    }

    if (savedAction === 'exit') {
      if (window.waterfallDesktop && typeof window.waterfallDesktop.exitApp === 'function') {
        window.waterfallDesktop.exitApp();
      } else {
        fetch('/api/system/exit', { method: 'POST' }).catch(() => {});
      }
      return;
    }

    const activeCount = (window.appState && Array.isArray(window.appState.tasks))
      ? window.appState.tasks.filter(t => t.status === 'downloading' || t.status === 'extracting' || t.status === 'assembling').length
      : 0;

    if (quitStatusText) {
      if (activeCount > 0) {
        quitStatusText.textContent = `${activeCount} download${activeCount > 1 ? 's are' : ' is'} currently active. Minimizing to tray keeps ${activeCount > 1 ? 'them' : 'it'} downloading in the background.`;
        if (quitStatusBanner) quitStatusBanner.style.borderColor = 'rgba(56, 189, 248, 0.4)';
      } else {
        quitStatusText.textContent = 'All downloads are currently idle or finished.';
        if (quitStatusBanner) quitStatusBanner.style.borderColor = 'rgba(255, 255, 255, 0.1)';
      }
    }

    if (modalQuitOptions) {
      modalQuitOptions.classList.add('active');
    }
  };

  function hideQuitOptionsModal() {
    if (modalQuitOptions) {
      modalQuitOptions.classList.remove('active');
    }
  }

  if (btnQuitToTray) {
    btnQuitToTray.addEventListener('click', () => {
      if (quitRememberChoice && quitRememberChoice.checked) {
        try { localStorage.setItem('waterfall_close_action', 'tray'); } catch (_) {}
        fetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ close_action: 'tray' })
        }).catch(() => {});
        if (window.appState && window.appState.config) {
          window.appState.config.closeAction = 'tray';
          window.appState.config.close_action = 'tray';
        }
      }
      hideQuitOptionsModal();
      if (window.waterfallDesktop && typeof window.waterfallDesktop.minimizeToTray === 'function') {
        window.waterfallDesktop.minimizeToTray();
      } else {
        fetch('/api/system/minimize-tray', { method: 'POST' }).catch(() => {});
      }
    });
  }

  if (btnQuitExit) {
    btnQuitExit.addEventListener('click', () => {
      if (quitRememberChoice && quitRememberChoice.checked) {
        try { localStorage.setItem('waterfall_close_action', 'exit'); } catch (_) {}
        fetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ close_action: 'exit' })
        }).catch(() => {});
        if (window.appState && window.appState.config) {
          window.appState.config.closeAction = 'exit';
          window.appState.config.close_action = 'exit';
        }
      }
      hideQuitOptionsModal();
      if (window.waterfallDesktop && typeof window.waterfallDesktop.exitApp === 'function') {
        window.waterfallDesktop.exitApp();
      } else {
        fetch('/api/system/exit', { method: 'POST' }).catch(() => {});
      }
    });
  }

  if (btnQuitCancel) btnQuitCancel.addEventListener('click', hideQuitOptionsModal);
  if (btnQuitCancelX) btnQuitCancelX.addEventListener('click', hideQuitOptionsModal);

  // Initialize table resizers, column sorting & initial filter tabs bar visibility
  initTableColumnResizing();
  initTableColumnSorting();
  updateSortControlsUI();
  updateFilterTabsBarVisibility(Boolean(window.appState.config && window.appState.config.showTopFilterBar));
});
