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
  const filterTabsBar = document.getElementById('filter-tabs-bar');

  // Desktop Context Menu
  const contextMenu = document.getElementById('context-menu');
  let contextTask = null;

  // Power Actions
  const btnPowerMenu = document.getElementById('btn-power-menu');
  const powerDropdownMenu = document.getElementById('power-dropdown-menu');
  const powerStatusLabel = document.getElementById('power-status-label');

  // Playlist Elements
  const ytPlaylistCard = document.getElementById('yt-playlist-card');
  const ytPlaylistTitle = document.getElementById('yt-playlist-title');
  const ytPlaylistCount = document.getElementById('yt-playlist-count');
  const ytPlaylistItems = document.getElementById('yt-playlist-items');
  const ytPlaylistFormatSelector = document.getElementById('yt-playlist-format-selector');

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
  btnToggleGrabber.addEventListener('click', () => switchView('grabber'));

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

  // Render Downloads Table
  function renderDownloads() {
    const tasks = window.appState.tasks;
    const filter = window.appState.activeFilter;
    const category = window.appState.activeCategory;
    const search = window.appState.searchQuery;

    const filtered = tasks.filter(t => {
      if (category && t.category !== category) return false;

      if (filter === 'downloading' && t.status !== 'downloading' && t.status !== 'assembling') return false;
      if (filter === 'paused' && t.status !== 'paused' && t.status !== 'queued') return false;
      if (filter === 'completed' && t.status !== 'completed') return false;
      if (filter === 'error' && t.status !== 'error' && t.status !== 'canceled') return false;

      if (search) {
        const matchName = t.name && t.name.toLowerCase().includes(search);
        const matchHost = t.hoster && t.hoster.toLowerCase().includes(search);
        const matchPack = t.packageName && t.packageName.toLowerCase().includes(search);
        if (!matchName && !matchHost && !matchPack) return false;
      }

      return true;
    });

    // Sort by date of added descending: latest added downloads appear on top
    filtered.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));

    if (filtered.length === 0) {
      tableBody.innerHTML = '';
      emptyState.style.display = 'flex';
      return;
    }

    emptyState.style.display = 'none';

    let html = '';
    for (const t of filtered) {
      const percent = (t.totalBytes > 0)
        ? Math.min(100, Math.floor((t.downloadedBytes / t.totalBytes) * 100))
        : (t.status === 'completed' ? 100 : 0);

      const badge = getTypeBadge(t);
      const isDl = t.status === 'downloading';
      const isDone = t.status === 'completed';
      const isSelected = selectedTaskIds.has(t.id);

      let extractionBadge = '';
      if (t.extractStatus === 'extracted') {
        extractionBadge = `<span class="badge-extracted" data-path="${(t.extractedPath || '').replace(/"/g, '&quot;')}" title="Extracted to folder (Click to open)">📦 Extracted</span>`;
      } else if (t.extractStatus === 'extracting') {
        extractionBadge = `<span class="badge-extracting" title="Unpacking archive in background...">📦 Extracting...</span>`;
      }

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

      html += `
        <tr data-id="${t.id}" class="download-row ${isSelected ? 'row-selected' : ''}">
          <td><input type="checkbox" class="task-checkbox" data-id="${t.id}" ${isSelected ? 'checked' : ''}></td>
          <td>
            <div class="file-block">
              ${appIconHtml}
              <div class="file-details">
                <div style="display: flex; align-items: center; gap: 6px; min-width: 0; overflow: hidden;">
                  <span class="file-title" style="flex: 1; min-width: 0;" title="${t.name}" onclick="window.segmentVisualizer.open('${t.id}')">${t.name}</span>
                  ${extractionBadge}
                  ${t.singleStream ? '<span class="badge-single-stream" style="font-size: 0.65rem; background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3); border-radius: 3px; padding: 1px 5px; white-space: nowrap;" title="Whole File Mode (Single Stream - 1 Socket, No Chunks)">📦 Whole File</span>' : (t.downloadEngineMode === 'inPlace' ? '<span class="badge-inplace" style="font-size: 0.65rem; background: rgba(16, 185, 129, 0.12); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.25); border-radius: 3px; padding: 1px 5px; white-space: nowrap;" title="In-Place Direct Writing (Zero Lag, Instant Completion)">⚡ Direct</span>' : '')}
                  <span class="row-app-handler-label" id="row-app-label-${t.id}" style="${cachedAppInfo && cachedAppInfo.appName ? 'display:inline-block;' : 'display:none;'}" title="Default Handler">
                    ${cachedAppInfo && cachedAppInfo.appName ? `Opens with ${cachedAppInfo.appName}` : ''}
                  </span>
                </div>
                <div class="file-subtext">${t.packageName ? `[${t.packageName}] • ` : ''}${t.savePath || ''}</div>
              </div>
            </div>
          </td>
          <td><span style="font-family: var(--font-mono); font-weight: 600;">${formatBytes(t.totalBytes)}</span></td>
          <td>
            <span class="state-tag ${t.status}">
              ${t.status}
            </span>
          </td>
          <td class="progress-col">
            <div class="meter-track">
              <div class="meter-fill ${isDl ? 'active' : ''} ${isDone ? 'complete' : ''} ${t.status === 'paused' ? 'paused' : ''}" style="width: ${percent}%;"></div>
            </div>
            <div class="meter-stat">${percent}% • ${formatBytes(t.downloadedBytes)}</div>
          </td>
          <td>
            <span style="font-family: var(--font-mono); font-weight: 600; color: ${isDl ? '#3fb950' : 'var(--text-muted)'};">
              ${isDl ? formatSpeed(t.speed) : '--'}
            </span>
          </td>
          <td title="${isDl ? formatETADuration(t.eta) : ''}">
            <span style="font-family: var(--font-mono); color: var(--text-muted); font-size: 0.72rem; white-space: nowrap;">
              ${isDl ? formatETA(t.eta) : (isDone ? 'Completed' : '--')}
            </span>
          </td>
          <td><span class="hoster-chip">${t.hoster || 'Direct'}</span></td>
          <td style="text-align: right;">
            <div class="row-actions">
              ${isDone
                ? `<button class="icon-btn btn-open-file" data-path="${t.savePath}" title="Open File in default application">
                     <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                   </button>`
                : ''
              }
              ${t.status === 'downloading'
                ? `<button class="icon-btn btn-pause" data-id="${t.id}" title="Pause">
                     <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>
                   </button>`
                : (t.status !== 'completed'
                  ? `<button class="icon-btn btn-resume" data-id="${t.id}" title="Resume">
                       <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                     </button>`
                  : '')
              }
              ${t.status === 'error' || t.status === 'paused'
                ? `<button class="icon-btn btn-update-url" data-id="${t.id}" title="Refresh / Update Download URL & Resume">
                     <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
                   </button>`
                : ''
              }
              ${((t.isMedia || /\.(mp4|mkv|webm|avi|mov|mp3|m4a|flac|wav|ogg|opus)$/i.test(t.name || '')) && (t.status === 'downloading' || t.status === 'completed' || t.status === 'paused'))
                ? `<button class="icon-btn btn-watch-stream" data-id="${t.id}" title="Watch Media Stream Live (Buffer playback while downloading)" style="color: #38bdf8;">
                     <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                   </button>`
                : ''
              }
              <button class="icon-btn btn-inspect" onclick="window.segmentVisualizer.open('${t.id}')" title="Inspect IDM Segments & Allocation Map">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
              </button>
              <button class="icon-btn btn-folder" data-path="${(t.savePath || '').replace(/"/g, '&quot;')}" title="Open Folder">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
              </button>
              <button class="icon-btn btn-del" data-id="${t.id}" title="Delete">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>
            </div>
          </td>
        </tr>
      `;
    }

    tableBody.innerHTML = html;
    updateBatchBar();
    bindTableActions(filtered);
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

  function bindTableActions(currentFilteredTasks = []) {
    // Checkbox selection
    tableBody.querySelectorAll('.task-checkbox').forEach(cb => {
      cb.onchange = (e) => {
        const id = cb.dataset.id;
        if (cb.checked) {
          selectedTaskIds.add(id);
        } else {
          selectedTaskIds.delete(id);
        }
        updateBatchBar();
        const row = cb.closest('tr');
        if (row) row.classList.toggle('row-selected', cb.checked);
      };
    });

    // Extracted folder badges
    tableBody.querySelectorAll('.badge-extracted').forEach(badge => {
      badge.onclick = (e) => {
        e.stopPropagation();
        const folder = badge.dataset.path;
        if (folder) {
          openFolder(folder);
        }
      };
    });

    // Right-Click Context Menu for Table Rows
    tableBody.querySelectorAll('.download-row').forEach(row => {
      row.oncontextmenu = (e) => {
        e.preventDefault();
        const task = window.appState.tasks.find(t => t.id === row.dataset.id);
        if (task) {
          openContextMenu(e.clientX, e.clientY, task);
        }
      };

      // Double-click to open file if completed or open inspector
      row.ondblclick = () => {
        const task = window.appState.tasks.find(t => t.id === row.dataset.id);
        if (task) {
          if (task.status === 'completed' && task.savePath) {
            openFile(task.savePath);
          } else {
            window.segmentVisualizer.open(task.id);
          }
        }
      };
    });

    tableBody.querySelectorAll('.btn-open-file').forEach(btn => {
      btn.onclick = () => {
        openFile(btn.dataset.path);
      };
    });

    tableBody.querySelectorAll('.btn-pause').forEach(btn => {
      btn.onclick = () => fetch(`/api/downloads/${btn.dataset.id}/pause`, { method: 'POST' });
    });

    tableBody.querySelectorAll('.btn-resume').forEach(btn => {
      btn.onclick = () => fetch(`/api/downloads/${btn.dataset.id}/resume`, { method: 'POST' });
    });

    tableBody.querySelectorAll('.btn-del').forEach(btn => {
      btn.onclick = () => {
        if (confirm('Delete this download from the list?')) {
          fetch(`/api/downloads/${btn.dataset.id}?deleteFile=false`, { method: 'DELETE' });
        }
      };
    });

    tableBody.querySelectorAll('.btn-folder').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const p = btn.dataset.path;
        if (p) openFolder(p);
      };
    });

    tableBody.querySelectorAll('.btn-update-url').forEach(btn => {
      btn.onclick = () => {
        const task = window.appState.tasks.find(t => t.id === btn.dataset.id);
        if (task) openUpdateUrlModal(task);
      };
    });

    tableBody.querySelectorAll('.btn-watch-stream').forEach(btn => {
      btn.onclick = () => {
        const task = window.appState.tasks.find(t => t.id === btn.dataset.id);
        if (task) openMediaPlayer(task);
      };
    });
  }

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
    btnBatchDelete.onclick = async () => {
      if (selectedTaskIds.size === 0) return;
      const count = selectedTaskIds.size;
      const deleteDisk = confirm(`Delete ${count} selected tasks?\n\nClick OK to also remove downloaded files from disk, or Cancel to just remove from list.`);
      await fetch('/api/downloads/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', ids: Array.from(selectedTaskIds), deleteFiles: deleteDisk })
      });
      selectedTaskIds.clear();
      updateBatchBar();
      if (checkSelectAllDownloads) checkSelectAllDownloads.checked = false;
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
    const itemExtract = document.getElementById('ctx-extract-archive');
    if (itemExtract) {
      const isArchive = task.name && (task.name.endsWith('.zip') || task.name.endsWith('.rar') || task.name.endsWith('.7z') || task.name.endsWith('.tar.gz'));
      itemExtract.style.display = (isArchive && task.status === 'completed') ? 'flex' : 'none';
    }

    const itemUpdateLink = document.getElementById('ctx-update-link');
    if (itemUpdateLink) {
      itemUpdateLink.style.display = (task.status === 'completed') ? 'none' : 'flex';
    }

    const itemPauseResume = document.getElementById('ctx-pause-resume');
    if (itemPauseResume) {
      itemPauseResume.textContent = (task.status === 'downloading') ? '⏸️ Pause Download' : '▶️ Resume Download';
      itemPauseResume.style.display = (task.status === 'completed') ? 'none' : 'flex';
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

  const ctxExtractArchive = document.getElementById('ctx-extract-archive');
  if (ctxExtractArchive) {
    ctxExtractArchive.onclick = async () => {
      if (contextTask) {
        const id = contextTask.id;
        hideContextMenu();
        const res = await fetch(`/api/downloads/${id}/extract`, { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          alert(`Archive successfully unpacked to:\n${data.outDir}`);
        } else {
          alert(`Extraction failed: ${data.error || 'Unknown error'}`);
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

  const ctxDelete = document.getElementById('ctx-delete');
  if (ctxDelete) {
    ctxDelete.onclick = () => {
      if (contextTask) {
        const id = contextTask.id;
        hideContextMenu();
        const deleteDisk = confirm('Also delete downloaded file from disk?');
        fetch(`/api/downloads/${id}?deleteFile=${deleteDisk}`, { method: 'DELETE' });
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

  // Update Tick
  window.addEventListener('state:tick', () => {
    globalSpeedDisplay.textContent = formatSpeed(window.appState.globalSpeed);
    updateBadges();

    if (window.appState.activeView === 'downloads') {
      for (const t of window.appState.tasks) {
        const row = tableBody.querySelector(`tr[data-id="${t.id}"]`);
        if (!row) continue;

        const percent = (t.totalBytes > 0)
          ? Math.min(100, Math.floor((t.downloadedBytes / t.totalBytes) * 100))
          : (t.status === 'completed' ? 100 : 0);

        const fill = row.querySelector('.meter-fill');
        const stat = row.querySelector('.meter-stat');
        const speedTd = row.children[5].querySelector('span');
        const etaTd = row.children[6].querySelector('span');

        if (fill) fill.style.width = percent + '%';
        if (stat) stat.textContent = `${percent}% • ${formatBytes(t.downloadedBytes)}`;
        if (speedTd) {
          speedTd.textContent = (t.status === 'downloading') ? formatSpeed(t.speed) : '--';
          speedTd.style.color = (t.status === 'downloading') ? '#3fb950' : 'var(--text-muted)';
        }
        if (etaTd) {
          etaTd.textContent = (t.status === 'downloading')
            ? formatETA(t.eta)
            : (t.status === 'completed' ? 'Completed' : '--');
          if (row.children[6]) {
            row.children[6].title = (t.status === 'downloading')
              ? formatETADuration(t.eta)
              : '';
          }
        }
      }
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

    // Check if running in Electron
    if (desktop && desktop.getAppIcon) {
      try {
        const res = await desktop.getAppIcon(filePath, ext);
        if (res && res.icon) return res;
      } catch (_) {}
    }

    // Call Waterfall backend
    try {
      const q = new URLSearchParams();
      if (filePath) q.set('path', filePath);
      if (ext) q.set('ext', ext);
      const res = await fetch(`/api/app-icon?${q.toString()}`);
      if (res.ok) {
        return await res.json();
      }
    } catch (_) {}

    return null;
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
        <button class="toast-btn-dismiss">Dismiss</button>
      </div>

      <div class="toast-timer-bar" style="animation-duration: 14s;"></div>
    `;

    const btnOpen = toast.querySelector('.toast-btn-open');
    const btnFolder = toast.querySelector('.toast-btn-folder');
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

  window.addEventListener('task:completed', (e) => {
    showCompletionNotification(e.detail);
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

    badgeAll.textContent = tasks.length;
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

    // Filter Tabs Count Badges
    const tabCountAll = document.getElementById('tab-count-all');
    const tabCountDone = document.getElementById('tab-count-done');
    const tabCountDownloading = document.getElementById('tab-count-downloading');
    const tabCountPaused = document.getElementById('tab-count-paused');
    const tabCountCanceled = document.getElementById('tab-count-canceled');
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
  btnOpenYouTube.addEventListener('click', () => {
    modalYouTubeConverter.classList.add('open');
    ytInputUrl.focus();
  });

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

        if (ytPlaylistItems) ytPlaylistItems.innerHTML = tracksHtml;
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

    const autoStart = ytCheckAutoStart.checked;

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
      ytBtnDownload.textContent = 'Adding Playlist...';

      await fetch('/api/media/batch-add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entries: selectedEntries,
          format: selectedPlaylistFormat,
          packageName: currentYtMeta.title || 'YouTube Playlist',
          autoStart
        })
      });
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

      await fetch('/api/downloads', {
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

    grabberStagedList.querySelectorAll('.staged-checkbox').forEach(cb => {
      cb.onchange = () => {
        const item = window.appState.staged.find(i => i.id === cb.dataset.id);
        if (item) item.selected = cb.checked;
        renderGrabber();
      };
    });

    grabberStagedList.querySelectorAll('.btn-delete-staged').forEach(btn => {
      btn.onclick = () => {
        fetch(`/api/linkgrabber/${btn.dataset.id}`, { method: 'DELETE' });
      };
    });
  }

  // IDM Quick Actions
  btnResumeAll.addEventListener('click', () => fetch('/api/downloads/resume-all', { method: 'POST' }));
  btnPauseAll.addEventListener('click', () => fetch('/api/downloads/pause-all', { method: 'POST' }));
  btnClearCompleted.addEventListener('click', () => fetch('/api/downloads/clear-completed', { method: 'POST' }));

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

      try {
        const probeRes = await fetch('/api/downloads/probe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url })
        });

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
        openIdmConfirmation(probeData);
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
  // IDM Download Confirmation Window & Performance Predictor
  // ==========================================================================
  const modalIdmConfirm = document.getElementById('modal-idm-confirm');
  let currentConfirmData = null;

  function openIdmConfirmation(probeData) {
    currentConfirmData = probeData;
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

    const cfg = window.appState.config || {};
    if (scriptCheck) scriptCheck.checked = !!cfg.postDownloadScriptEnabled;
    if (scriptDetails) scriptDetails.style.display = cfg.postDownloadScriptEnabled ? 'block' : 'none';
    if (scriptPathEl) scriptPathEl.value = cfg.postDownloadScriptPath || '';
    if (scriptTypeEl) scriptTypeEl.value = cfg.postDownloadScriptType || 'auto';
    if (scriptArgsEl) scriptArgsEl.value = cfg.postDownloadArguments || '"%FILE%"';

    closeAllModals();
    modalIdmConfirm.classList.add('open');
    if (nameEl) setTimeout(() => nameEl.focus(), 60);
  }

  window.addEventListener('download:confirm', (e) => {
    if (window.waterfallDesktop && window.waterfallDesktop.focusWindow) {
      window.waterfallDesktop.focusWindow();
    }
    if (e.detail) {
      openIdmConfirmation(e.detail);
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
          confirmed: true
        })
      });

      if (!res.ok) throw new Error(await res.text());
      const task = await res.json();

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

  // Speed Limiter Modal
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

  window.addEventListener('state:init', () => {
    if (window.appState.config && window.appState.config.themeAccent) {
      applyThemeAccent(window.appState.config.themeAccent);
    }
  });

  window.addEventListener('state:config', () => {
    if (window.appState.config && window.appState.config.themeAccent) {
      applyThemeAccent(window.appState.config.themeAccent);
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
    if (document.getElementById('cfg-show-confirm')) document.getElementById('cfg-show-confirm').checked = cfg.showDownloadConfirmation !== false;
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
      showDownloadConfirmation: document.getElementById('cfg-show-confirm')?.checked,
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
      applyThemeAccent(themeAccent);
      modalSettings.classList.remove('open');
    } catch (err) {
      alert('Failed to save settings: ' + err.message);
    } finally {
      btnSaveSettings.disabled = false;
      btnSaveSettings.textContent = 'Save Settings';
    }
  });

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
});
