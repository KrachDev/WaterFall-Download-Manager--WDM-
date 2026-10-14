(function () {
  const urlParams = new URLSearchParams(window.location.search);
  let currentTaskId = urlParams.get('taskId') || null;
  let currentTask = null;
  let isCompletedState = false;
  let startTime = Date.now();

  const titlebarMode = document.getElementById('titlebar-mode');
  const titlebarFilename = document.getElementById('titlebar-filename');
  const btnWinMinimize = document.getElementById('btn-win-minimize');
  const btnWinHide = document.getElementById('btn-win-hide');
  const btnWinClose = document.getElementById('btn-win-close');

  const progressView = document.getElementById('progress-view');
  const finishView = document.getElementById('finish-view');
  const footerControls = document.getElementById('dlg-footer-controls');

  const fileIcon = document.getElementById('file-icon');
  const dlgFileName = document.getElementById('dlg-file-name');
  const dlgFileUrl = document.getElementById('dlg-file-url');
  const dlgStatus = document.getElementById('dlg-status');
  const statusDot = document.getElementById('status-dot');
  const dlgPercent = document.getElementById('dlg-percent');
  const dlgBarFill = document.getElementById('dlg-bar-fill');
  const dlgSegmentsBar = document.getElementById('dlg-segments-bar');

  const dlgSize = document.getElementById('dlg-size');
  const dlgSpeed = document.getElementById('dlg-speed');
  const dlgDownloaded = document.getElementById('dlg-downloaded');
  const dlgEta = document.getElementById('dlg-eta');
  const dlgResumable = document.getElementById('dlg-resumable');
  const dlgThreads = document.getElementById('dlg-threads');

  const btnPauseResume = document.getElementById('btn-pause-resume');
  const btnCancel = document.getElementById('btn-cancel');
  const btnHideBg = document.getElementById('btn-hide-bg');

  const finishFileName = document.getElementById('finish-file-name');
  const finishFileSize = document.getElementById('finish-file-size');
  const finishAvgSpeed = document.getElementById('finish-avg-speed');
  const finishSavePath = document.getElementById('finish-save-path');
  const btnFinishOpen = document.getElementById('btn-finish-open');
  const btnFinishFolder = document.getElementById('btn-finish-folder');
  const btnFinishClose = document.getElementById('btn-finish-close');

  function getFileExtensionIcon(name = '') {
    const ext = (name.split('.').pop() || '').toLowerCase();
    if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return '📦';
    if (['mp4', 'mkv', 'webm', 'avi', 'mov', 'flv'].includes(ext)) return '🎬';
    if (['mp3', 'm4a', 'flac', 'wav', 'ogg'].includes(ext)) return '🎵';
    if (['exe', 'msi', 'bin', 'iso'].includes(ext)) return '⚙️';
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) return '🖼️';
    if (['pdf', 'docx', 'xlsx', 'txt'].includes(ext)) return '📄';
    return '📁';
  }

  function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
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

  function formatETA(seconds) {
    if (!seconds || seconds <= 0 || !isFinite(seconds)) return '--:--:--';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const pad = n => String(n).padStart(2, '0');
    return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  }

  function closeWindow() {
    if (window.waterfallDesktop && window.waterfallDesktop.close) {
      window.waterfallDesktop.close();
    } else {
      window.close();
    }
  }

  function minimizeWindow() {
    if (window.waterfallDesktop && window.waterfallDesktop.minimize) {
      window.waterfallDesktop.minimize();
    }
  }

  function applyTaskData(task) {
    if (!task) return;
    currentTask = task;
    if (!currentTaskId) currentTaskId = task.id;

    const name = task.name || task.filename || 'download';
    document.title = `Waterfall — Downloading: ${name}`;
    if (titlebarFilename) titlebarFilename.textContent = name;
    dlgFileName.textContent = name;
    dlgFileName.title = name;
    if (fileIcon) fileIcon.textContent = getFileExtensionIcon(name);

    if (task.url && dlgFileUrl) {
      dlgFileUrl.textContent = task.url;
      dlgFileUrl.title = task.url;
    }

    if (task.totalBytes > 0) {
      dlgSize.textContent = formatBytes(task.totalBytes);
    } else if (task.formattedSize) {
      dlgSize.textContent = task.formattedSize;
    } else {
      dlgSize.textContent = 'Unknown / Stream';
    }

    if (task.acceptRanges !== undefined) {
      dlgResumable.textContent = task.acceptRanges ? 'Yes' : 'No';
      dlgResumable.className = 'stat-val ' + (task.acceptRanges ? 'resumable-yes' : 'resumable-no');
    }

    const segCount = task.segmentsCount || (task.segments && task.segments.length) || 8;
    dlgThreads.textContent = `${segCount} Segments`;

    // Check completion
    if (task.status === 'completed' && !isCompletedState) {
      showCompletionView(task);
      return;
    }

    updateProgressMetrics(task);
  }

  function updateProgressMetrics(data) {
    if (isCompletedState) return;

    const downloaded = data.downloadedBytes || 0;
    const total = data.totalBytes || 0;
    const speed = data.speed || 0;
    const eta = data.eta || 0;
    const status = data.status || 'downloading';

    let pct = 0;
    if (total > 0) {
      pct = Math.min(100, Math.max(0, (downloaded / total) * 100));
    } else if (data.progress !== undefined) {
      pct = Math.min(100, Math.max(0, data.progress));
    }

    dlgPercent.textContent = pct.toFixed(1) + '%';
    dlgBarFill.style.width = pct.toFixed(1) + '%';

    dlgSpeed.textContent = formatSpeed(speed);
    dlgDownloaded.textContent = `${formatBytes(downloaded)} of ${total > 0 ? formatBytes(total) : '--'}`;
    dlgEta.textContent = formatETA(eta);

    // Update status dot & text
    if (status === 'paused') {
      dlgStatus.textContent = 'Paused';
      statusDot.style.background = '#f59e0b';
      statusDot.style.boxShadow = '0 0 8px #f59e0b';
      btnPauseResume.innerHTML = `<svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"></path></svg> Resume`;
    } else if (status === 'assembling') {
      dlgStatus.textContent = 'Assembling file parts...';
      statusDot.style.background = '#38bdf8';
    } else if (status === 'extracting') {
      dlgStatus.textContent = 'Extracting archive...';
      statusDot.style.background = '#a855f7';
    } else {
      dlgStatus.textContent = 'Downloading...';
      statusDot.style.background = '#10b981';
      statusDot.style.boxShadow = '0 0 8px #10b981';
      btnPauseResume.innerHTML = `<svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 9v6m4-6v6"></path></svg> Pause`;
    }

    // Segment visualizer update
    if (Array.isArray(data.segments) && data.segments.length > 0) {
      renderSegments(data.segments);
    }
  }

  function renderSegments(segments) {
    if (!dlgSegmentsBar) return;
    const chunkEls = dlgSegmentsBar.querySelectorAll('.segment-chunk');
    segments.forEach((seg, idx) => {
      if (chunkEls[idx]) {
        const fillEl = chunkEls[idx].querySelector('.segment-chunk-fill');
        if (fillEl) {
          const segTotal = (seg.end - seg.start) || 1;
          const segDownloaded = seg.downloaded || 0;
          const segPct = Math.min(100, Math.max(0, (segDownloaded / segTotal) * 100));
          fillEl.style.width = segPct + '%';
        }
      }
    });
  }

  function showCompletionView(task) {
    isCompletedState = true;
    const name = task.name || task.filename || 'Downloaded File';
    document.title = `Waterfall — Complete: ${name}`;
    if (titlebarMode) titlebarMode.textContent = 'Complete —';
    if (titlebarFilename) titlebarFilename.textContent = name;

    progressView.style.display = 'none';
    footerControls.style.display = 'none';
    finishView.style.display = 'flex';

    finishFileName.textContent = name;
    finishFileName.title = name;

    const total = task.totalBytes || task.downloadedBytes || 0;
    finishFileSize.textContent = formatBytes(total);

    const durationSec = Math.max(1, Math.round((Date.now() - startTime) / 1000));
    const avgSpd = total > 0 ? formatSpeed(total / durationSec) : '--';
    finishAvgSpeed.textContent = `${avgSpd} (Downloaded in ${durationSec}s)`;

    const savePath = task.savePath || task.finalPath || task.path || 'Downloads';
    finishSavePath.textContent = savePath;
    finishSavePath.title = savePath;

    // Action buttons
    btnFinishOpen.onclick = async () => {
      if (window.waterfallDesktop && window.waterfallDesktop.openFile) {
        await window.waterfallDesktop.openFile(savePath);
      } else {
        fetch('/api/open-file', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filePath: savePath })
        }).catch(() => {});
      }
      closeWindow();
    };

    btnFinishFolder.onclick = async () => {
      if (window.waterfallDesktop && window.waterfallDesktop.openFolder) {
        await window.waterfallDesktop.openFolder(savePath);
      } else {
        fetch('/api/open-folder', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filePath: savePath })
        }).catch(() => {});
      }
    };

    btnFinishClose.onclick = closeWindow;
  }

  // Window control buttons
  if (btnWinMinimize) btnWinMinimize.onclick = minimizeWindow;
  if (btnWinHide) btnWinHide.onclick = closeWindow; // Close progress dialog, download continues in background
  if (btnWinClose) btnWinClose.onclick = closeWindow;
  if (btnHideBg) btnHideBg.onclick = closeWindow;

  // Pause / Resume
  if (btnPauseResume) {
    btnPauseResume.onclick = async () => {
      if (!currentTaskId) return;
      const isPaused = currentTask && currentTask.status === 'paused';
      const action = isPaused ? 'resume' : 'pause';
      try {
        await fetch(`/api/downloads/${currentTaskId}/${action}`, { method: 'POST' });
        if (currentTask) currentTask.status = isPaused ? 'downloading' : 'paused';
      } catch (err) {
        console.warn('Failed to toggle pause/resume:', err);
      }
    };
  }

  // Cancel
  if (btnCancel) {
    btnCancel.onclick = async () => {
      if (!currentTaskId) return;
      if (confirm('Cancel and remove this download?')) {
        try {
          await fetch(`/api/downloads/${currentTaskId}`, { method: 'DELETE' });
        } catch (_) {}
        closeWindow();
      }
    };
  }

  // Initial task fetch if taskId is in query
  async function initTask() {
    if (!currentTaskId) return;
    try {
      const res = await fetch('/api/downloads');
      const all = await res.json();
      const match = all.find(t => t.id === currentTaskId);
      if (match) applyTaskData(match);
    } catch (_) {}
  }

  // IPC desktop listeners (Zero latency when running inside Electron shell)
  if (window.waterfallDesktop) {
    if (typeof window.waterfallDesktop.onProgressData === 'function') {
      window.waterfallDesktop.onProgressData((data) => {
        applyTaskData(data);
      });
    }

    if (typeof window.waterfallDesktop.onProgressTick === 'function') {
      window.waterfallDesktop.onProgressTick((data) => {
        if (!currentTaskId || data.id === currentTaskId) {
          updateProgressMetrics(data);
        }
      });
    }

    if (typeof window.waterfallDesktop.onTaskCompleted === 'function') {
      window.waterfallDesktop.onTaskCompleted((task) => {
        if (!currentTaskId || task.id === currentTaskId) {
          showCompletionView(task);
        }
      });
    }
  }

  // WebSocket Live Updates Connection
  function setupWebSocket() {
    const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProto}//${location.hostname || 'localhost'}:${location.port || '4567'}`;
    let socket;

    try {
      socket = new WebSocket(wsUrl);
      socket.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'tick' && Array.isArray(msg.tasks)) {
            const match = msg.tasks.find(t => t.id === currentTaskId);
            if (match) updateProgressMetrics(match);
          } else if (msg.type === 'taskCompleted' && msg.task) {
            if (msg.task.id === currentTaskId) showCompletionView(msg.task);
          } else if (msg.type === 'taskUpdated' && msg.task) {
            if (msg.task.id === currentTaskId) applyTaskData(msg.task);
          }
        } catch (_) {}
      };
      socket.onclose = () => {
        setTimeout(setupWebSocket, 2000);
      };
    } catch (_) {}
  }

  initTask();
  setupWebSocket();
})();
