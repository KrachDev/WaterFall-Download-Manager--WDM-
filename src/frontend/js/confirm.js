// Waterfall — Standalone Download File Info Controller

(function() {
  'use strict';

  let currentProbeData = null;

  const isHttp = window.location.protocol.startsWith('http');
  const apiBase = isHttp ? '' : 'http://localhost:4567';
  const wsBase = isHttp
    ? `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`
    : 'ws://localhost:4567';

  // DOM Elements
  const urlEl = document.getElementById('confirm-url');
  const serverEl = document.getElementById('confirm-server');
  const filenameEl = document.getElementById('confirm-filename');
  const categoryBadge = document.getElementById('confirm-category-badge');
  const sizeEl = document.getElementById('confirm-size');
  const resumableEl = document.getElementById('confirm-resumable');
  const etaEl = document.getElementById('confirm-eta');
  const avgSpeedEl = document.getElementById('confirm-avg-speed');
  const folderEl = document.getElementById('confirm-folder');
  const btnBrowseFolder = document.getElementById('btn-browse-folder');
  const engineModeEl = document.getElementById('confirm-engine-mode');
  const mediaBox = document.getElementById('confirm-media-box');
  const mediaFormatEl = document.getElementById('confirm-media-format');
  const mediaThumbImg = document.getElementById('media-thumb-img');
  const mediaVideoTitle = document.getElementById('media-video-title');
  const mediaVideoAuthor = document.getElementById('media-video-author');
  const btnWatchNow = document.getElementById('btn-watch-now');
  const extractBox = document.getElementById('confirm-extract-box');
  const checkExtract = document.getElementById('confirm-enable-extract');
  const extractDetails = document.getElementById('confirm-extract-details');
  const inputExtractPwd = document.getElementById('confirm-archive-password');
  const btnTogglePwd = document.getElementById('btn-toggle-pwd');
  const checkDeleteArchive = document.getElementById('confirm-delete-archive');
  const checkScript = document.getElementById('confirm-enable-script');
  const scriptTypeEl = document.getElementById('confirm-script-type');
  const scriptPathEl = document.getElementById('confirm-script-path');
  const scriptArgsEl = document.getElementById('confirm-script-args');
  const scriptDetails = document.getElementById('confirm-script-details');

  // Duplicate Alert Elements
  const dupBanner = document.getElementById('duplicate-alert-banner');
  const dupIcon = document.getElementById('dup-alert-icon');
  const dupText = document.getElementById('dup-alert-text');
  const dupActions = document.getElementById('dup-alert-actions');

  // Footer Buttons
  const btnCancel = document.getElementById('btn-action-cancel');
  const btnLater = document.getElementById('btn-action-later');
  const btnStart = document.getElementById('btn-action-start');
  const btnCloseWindow = document.getElementById('btn-close-window');
  const btnPinConfirm = document.getElementById('btn-pin-confirm');
  const confirmOpenWhenDone = document.getElementById('confirm-open-when-done');

  // Format Helpers
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

  function formatETADuration(seconds) {
    if (!seconds || seconds <= 0 || !isFinite(seconds)) return '';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}h ${m}m remaining`;
    if (m > 0) return `${m}m ${s}s remaining`;
    return `${s}s remaining`;
  }

  function closeThisWindow() {
    if (window.waterfallDesktop && window.waterfallDesktop.closeConfirmWindow) {
      window.waterfallDesktop.closeConfirmWindow();
    } else if (window.__TAURI__ && window.__TAURI__.window) {
      window.__TAURI__.window.getCurrentWindow().close().catch(() => window.close());
    } else {
      window.close();
    }
  }

  // Populate data into form
  function applyProbeData(data) {
    if (!data) return;
    currentProbeData = data;

    if (urlEl) urlEl.value = data.url || '';
    if (serverEl) serverEl.textContent = data.server ? `Server: ${data.server}` : '';
    let rawFn = data.filename || 'download';
    try { rawFn = decodeURIComponent(rawFn); } catch (_) {}
    if (filenameEl) filenameEl.value = rawFn;

    const cat = data.category || 'General';
    if (categoryBadge) {
      categoryBadge.textContent = cat;
      categoryBadge.className = 'type-badge badge-' + cat.toLowerCase();
    }

    const totalBytes = data.totalBytes || 0;
    if (sizeEl) {
      sizeEl.textContent = totalBytes > 0 ? formatBytes(totalBytes) : (data.formattedSize || 'Unknown / Stream');
    }

    const sc = data.statusCode || data.status_code || 0;
    if (resumableEl) {
      if (sc >= 400) {
        if (sc === 403) {
          resumableEl.textContent = '⚠️ HTTP 403 (Host Forbidden / Cloudflare protection: Session login required)';
        } else if (sc === 401) {
          resumableEl.textContent = '⚠️ HTTP 401 (Host Unauthorized: Login required)';
        } else if (sc === 404) {
          resumableEl.textContent = '⚠️ HTTP 404 (File not found on remote server)';
        } else {
          resumableEl.textContent = `⚠️ HTTP ${sc} (Remote server error)`;
        }
        resumableEl.style.color = '#ef4444';
      } else {
        resumableEl.textContent = data.acceptRanges ? '✓ Resumable (Range byte headers supported)' : '⚠️ Single Stream / Direct';
        resumableEl.style.color = data.acceptRanges ? '#3fb950' : '#d29922';
      }
    }

    const avgSpeed = data.avgSpeed || 10 * 1024 * 1024;
    const historyCount = data.historyCount || 0;
    const estSec = data.estimatedTimeSec || (totalBytes > 0 ? Math.ceil(totalBytes / avgSpeed) : 0);

    if (etaEl) {
      etaEl.textContent = (estSec > 0)
        ? `${formatETA(estSec)} (${formatETADuration(estSec)})`
        : (totalBytes > 0 ? '< 1s' : 'Dynamic Stream');
    }
    if (avgSpeedEl) {
      const spdFormatted = data.formattedAvgSpeed || formatSpeed(avgSpeed);
      avgSpeedEl.textContent = historyCount > 0
        ? `Based on ${spdFormatted} (Avg of last ${historyCount} downloads)`
        : `Based on ${spdFormatted} (Default baseline)`;
    }

    if (folderEl) {
      folderEl.value = data.defaultSaveDir || 'C:\\Users\\Default\\Downloads';
    }

    // Media card
    const isMedia = Boolean(data.isMedia || /\.(mp4|mkv|webm|avi|mov|mp3|m4a|flac|wav|ogg|opus)$/i.test(data.filename || '') || (data.url && (data.url.includes('youtube.com') || data.url.includes('youtu.be'))));
    if (mediaBox) {
      mediaBox.style.display = isMedia ? 'flex' : 'none';
      if (isMedia) {
        if (mediaThumbImg) {
          mediaThumbImg.src = data.mediaThumbnail || data.thumbnail || 'assets/logo.png';
          mediaThumbImg.onerror = () => { mediaThumbImg.src = 'assets/logo.png'; };
        }
        if (mediaVideoTitle) mediaVideoTitle.textContent = data.mediaTitle || data.title || data.filename || 'Media Stream';
        if (mediaVideoAuthor) mediaVideoAuthor.textContent = data.mediaAuthor || data.uploader ? `Channel: ${data.mediaAuthor || data.uploader}` : 'YouTube Video';
        if (categoryBadge) {
          categoryBadge.textContent = 'Video';
          categoryBadge.className = 'type-badge badge-video';
        }
      }
    }

    if (mediaFormatEl) {
      mediaFormatEl.onchange = () => {
        const val = mediaFormatEl.value;
        const curName = filenameEl.value.trim();
        const baseName = curName.replace(/\.[^/.]+$/, '');
        if (val.startsWith('audio')) {
          const ext = val.includes('flac') ? 'flac' : (val.includes('m4a') ? 'm4a' : 'mp3');
          filenameEl.value = `${baseName}.${ext}`;
          if (categoryBadge) {
            categoryBadge.textContent = 'Audio';
            categoryBadge.className = 'type-badge badge-audio';
          }
        } else {
          filenameEl.value = `${baseName}.mp4`;
          if (categoryBadge) {
            categoryBadge.textContent = 'Video';
            categoryBadge.className = 'type-badge badge-video';
          }
        }
      };
    }

    if (engineModeEl) {
      if (data.acceptRanges === false || totalBytes <= 0 || isMedia) {
        engineModeEl.value = 'singleStream';
      } else {
        engineModeEl.value = data.initialModeVal || 'inPlace-8';
      }
    }

    // Archive card
    const isArchive = Boolean(data.isArchive || /\.(zip|rar|7z|tar\.gz|tar\.bz2|tar|tgz|001|r00|r01|part1\.rar|part\d+\.rar)$/i.test(data.filename || ''));
    if (extractBox) {
      extractBox.style.display = isArchive ? 'block' : 'none';
    }

    function resolveExtractedDir(savePath) {
      if (!savePath || typeof savePath !== 'string') return null;
      const parts = savePath.replace(/\\/g, '/').split('/');
      const fname = parts.pop() || '';
      const dir = parts.join('\\');
      const extMatch = fname.match(/\.(zip|rar|7z|tar\.gz|tar\.bz2|tar|tgz|bz2|xz|iso|part\d+\.rar|part\d+|001|r00|r01)$/i);
      const baseName = extMatch ? fname.slice(0, extMatch.index).trim() : fname;
      if (dir && baseName) {
        return `${dir}\\${baseName}`;
      }
      return null;
    }

    // Duplicate detection alert
    if (dupBanner && data.existingMatch) {
      const match = data.existingMatch;
      dupBanner.style.display = 'flex';
      if (match.isDone) {
        dupBanner.style.background = 'rgba(63, 185, 80, 0.12)';
        dupBanner.style.border = '1px solid rgba(63, 185, 80, 0.35)';
        dupBanner.style.color = '#7ee787';
        if (dupIcon) dupIcon.textContent = '✓';
        if (dupText) dupText.textContent = `File already completed on disk: "${match.name}"`;
        if (dupActions) {
          const extractedPath = match.extractedPath || (match.isArchive || isArchive ? resolveExtractedDir(match.savePath) : null);
          dupActions.innerHTML = `
            <button type="button" class="tool-btn" id="btn-dup-open" style="padding: 3px 10px; font-size: 0.72rem;">Open File</button>
            <button type="button" class="tool-btn" id="btn-dup-folder" style="padding: 3px 10px; font-size: 0.72rem;">Show in Folder</button>
            <button type="button" class="tool-btn" id="btn-dup-copy-done" style="padding: 3px 10px; font-size: 0.72rem; background: rgba(56, 189, 248, 0.15); border-color: rgba(56, 189, 248, 0.4); color: #38bdf8;">Download as (1)</button>
            ${extractedPath ? `
            <button type="button" class="tool-btn" id="btn-dup-extracted" style="padding: 3px 10px; font-size: 0.72rem; background: rgba(168, 85, 247, 0.2); border: 1px solid rgba(168, 85, 247, 0.45); color: #d8b4fe;" title="Open Extracted Directory (${extractedPath})">Open Extracted Folder</button>
            ` : ''}
          `;
          const btnCopyDone = document.getElementById('btn-dup-copy-done');
          if (btnCopyDone) {
            btnCopyDone.onclick = () => {
              const cur = filenameEl ? filenameEl.value.trim() : rawFn;
              const dot = cur.lastIndexOf('.');
              const base = dot !== -1 ? cur.substring(0, dot) : cur;
              const ext = dot !== -1 ? cur.substring(dot) : '';
              if (filenameEl) filenameEl.value = `${base} (1)${ext}`;
              dupBanner.style.display = 'none';
              currentProbeData.allowDuplicate = true;
            };
          }
          document.getElementById('btn-dup-open').onclick = () => {
            fetch(`${apiBase}/api/open-file`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ filePath: match.savePath })
            });
          };
          document.getElementById('btn-dup-folder').onclick = () => {
            fetch(`${apiBase}/api/open-folder`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ filePath: match.savePath })
            });
          };
          const btnExtracted = document.getElementById('btn-dup-extracted');
          if (btnExtracted && extractedPath) {
            btnExtracted.onclick = () => {
              if (window.waterfallDesktop && window.waterfallDesktop.openFolder) {
                window.waterfallDesktop.openFolder(extractedPath);
              } else {
                fetch(`${apiBase}/api/open-folder`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ filePath: extractedPath })
                });
              }
            };
          }
        }
      } else {
        dupBanner.style.background = 'rgba(56, 189, 248, 0.12)';
        dupBanner.style.border = '1px solid rgba(56, 189, 248, 0.35)';
        dupBanner.style.color = '#79c0ff';
        if (dupIcon) dupIcon.textContent = '🔄';
        const stName = (match.status || 'paused').toUpperCase();
        if (dupText) dupText.textContent = `Download already present in queue (${stName}, ${match.percent}% completed)`;
        if (dupActions) {
          dupActions.innerHTML = `
            <button type="button" class="tool-btn primary" id="btn-dup-update" style="padding: 3px 12px; font-size: 0.72rem; background: #238636; border-color: #2ea043; color: #fff; font-weight: 700;">
              🔄 Update Link & Resume (${match.percent}%)
            </button>
            <button type="button" class="tool-btn" id="btn-dup-copy-active" style="padding: 3px 10px; font-size: 0.72rem; background: rgba(56, 189, 248, 0.15); border-color: rgba(56, 189, 248, 0.4); color: #38bdf8;">
              Download as (1)
            </button>
          `;
          const btnCopyActive = document.getElementById('btn-dup-copy-active');
          if (btnCopyActive) {
            btnCopyActive.onclick = () => {
              const cur = filenameEl ? filenameEl.value.trim() : rawFn;
              const dot = cur.lastIndexOf('.');
              const base = dot !== -1 ? cur.substring(0, dot) : cur;
              const ext = dot !== -1 ? cur.substring(dot) : '';
              if (filenameEl) filenameEl.value = `${base} (1)${ext}`;
              dupBanner.style.display = 'none';
              currentProbeData.allowDuplicate = true;
            };
          }
          document.getElementById('btn-dup-update').onclick = async () => {
            try {
              await fetch(`${apiBase}/api/downloads/${match.id}/update-url`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: data.url })
              });
              closeThisWindow();
            } catch (err) {
              alert('Failed to update URL: ' + err.message);
            }
          };
        }
      }
    } else if (dupBanner) {
      dupBanner.style.display = 'none';
    }
  }

  // Submit download task
  async function submitDownload(autoStart = true, watchNow = false) {
    if (!currentProbeData) return;

    const url = currentProbeData.url;
    const filename = filenameEl ? filenameEl.value.trim() : (currentProbeData.filename || 'download');
    const saveDir = folderEl ? folderEl.value.trim() : currentProbeData.defaultSaveDir;
    const modeVal = engineModeEl ? engineModeEl.value : 'inPlace-8';

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
    if (checkScript && checkScript.checked) {
      customScript = {
        enabled: true,
        type: scriptTypeEl ? scriptTypeEl.value : 'auto',
        path: scriptPathEl ? scriptPathEl.value.trim() : '',
        args: scriptArgsEl ? scriptArgsEl.value.trim() : '"%FILE%"'
      };
    } else {
      customScript = { enabled: false };
    }

    const autoExtract = Boolean(checkExtract && checkExtract.checked);
    const archivePassword = inputExtractPwd ? inputExtractPwd.value.trim() : '';
    const deleteAfterExtract = Boolean(checkDeleteArchive && checkDeleteArchive.checked);

    const isMedia = Boolean(currentProbeData.isMedia || (mediaBox && mediaBox.style.display !== 'none'));
    let mediaOptions = null;
    if (isMedia) {
      const val = mediaFormatEl ? mediaFormatEl.value : 'video-1080';
      if (val.startsWith('audio')) {
        const ext = val.includes('flac') ? 'flac' : (val.includes('m4a') ? 'm4a' : 'mp3');
        mediaOptions = {
          mediaType: 'audio',
          audioFormat: ext,
          audioQuality: val.includes('192') ? '192k' : '0'
        };
      } else {
        const q = val === 'video-720' ? '720' : (val === 'video-best' ? 'best' : '1080');
        mediaOptions = {
          mediaType: 'video',
          videoQuality: q
        };
      }
    }

    btnStart.disabled = true;
    btnStart.textContent = 'Queueing...';

    try {
      const res = await fetch(`${apiBase}/api/downloads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          filename,
          size: currentProbeData.totalBytes || 0,
          totalBytes: currentProbeData.totalBytes || 0,
          referrer: currentProbeData.referrer || undefined,
          cookies: currentProbeData.cookies || undefined,
          userAgent: currentProbeData.userAgent || undefined,
          saveDir,
          autoStart,
          downloadEngineMode,
          singleStream,
          segments,
          customScript,
          isMedia,
          mediaOptions,
          autoExtract,
          archivePassword,
          deleteAfterExtract,
          openWhenFinished: Boolean(confirmOpenWhenDone && confirmOpenWhenDone.checked),
          onCompleteAction: (confirmOpenWhenDone && confirmOpenWhenDone.checked) ? 'openFile' : 'none',
          allowDuplicate: Boolean(currentProbeData.allowDuplicate),
          confirmed: true
        })
      });

      if (!res.ok) throw new Error(await res.text());
      const task = await res.json();
      const actualTaskId = (task && task.id) ? task.id : task;
      if (actualTaskId) {
        sessionStorage.setItem('waterfall_progress_opened_' + actualTaskId, String(Date.now()));
        try { localStorage.setItem('waterfall_progress_opened_' + actualTaskId, String(Date.now())); } catch (_) {}
      }

      if (autoStart) {
        if (window.waterfallDesktop && typeof window.waterfallDesktop.openProgressWindow === 'function') {
          window.waterfallDesktop.openProgressWindow(actualTaskId);
        } else {
          fetch(`${apiBase}/api/window/open-progress`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ taskId: actualTaskId, id: actualTaskId, topmost: false })
          }).catch(() => {});
        }
      }

      closeThisWindow();
    } catch (err) {
      btnStart.disabled = false;
      btnStart.textContent = 'Start Download Now';
      alert('Could not start download: ' + err.message);
    }
  }

  // Pin / Always on Top Window Control
  let isConfirmTop = true;
  function updateConfirmPinUI(pinned) {
    isConfirmTop = pinned;
    if (!btnPinConfirm) return;
    if (pinned) {
      btnPinConfirm.innerHTML = '📌 Top';
      btnPinConfirm.style.color = '#38bdf8';
      btnPinConfirm.style.borderColor = 'rgba(56, 189, 248, 0.4)';
      btnPinConfirm.style.background = 'rgba(56, 189, 248, 0.15)';
      btnPinConfirm.title = 'Always on Top (Top Window): ON';
    } else {
      btnPinConfirm.innerHTML = '📍 Normal';
      btnPinConfirm.style.color = '#94a3b8';
      btnPinConfirm.style.borderColor = '#1e293b';
      btnPinConfirm.style.background = '';
      btnPinConfirm.title = 'Always on Top (Top Window): OFF';
    }
  }

  if (btnPinConfirm) {
    btnPinConfirm.addEventListener('click', () => {
      const nextState = !isConfirmTop;
      updateConfirmPinUI(nextState);
      if (window.waterfallDesktop && typeof window.waterfallDesktop.setAlwaysOnTop === 'function') {
        window.waterfallDesktop.setAlwaysOnTop(nextState);
      }
      fetch(`${apiBase}/api/window/set-topmost`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'confirm', topmost: nextState, bringToFront: nextState })
      }).catch(() => {});
    });
  }

  // Pin / Always on Top Control
  let isConfirmPinned = true;
  function updateConfirmPinUI(pinned) {
    isConfirmPinned = Boolean(pinned);
    if (!btnPinConfirm) return;
    if (pinned) {
      btnPinConfirm.innerHTML = '📌 Top';
      btnPinConfirm.style.color = '#38bdf8';
      btnPinConfirm.style.borderColor = 'rgba(56, 189, 248, 0.4)';
      btnPinConfirm.style.background = 'rgba(56, 189, 248, 0.15)';
      btnPinConfirm.title = 'Always on Top (Top Window): ON (Click to unpin)';
    } else {
      btnPinConfirm.innerHTML = '📍 Normal';
      btnPinConfirm.style.color = '#94a3b8';
      btnPinConfirm.style.borderColor = '#334155';
      btnPinConfirm.style.background = 'rgba(15, 23, 42, 0.6)';
      btnPinConfirm.title = 'Always on Top (Top Window): OFF (Click to pin)';
    }
  }

  if (btnPinConfirm) {
    btnPinConfirm.onclick = () => {
      const next = !isConfirmPinned;
      updateConfirmPinUI(next);
      if (window.waterfallDesktop && typeof window.waterfallDesktop.setAlwaysOnTop === 'function') {
        try { window.waterfallDesktop.setAlwaysOnTop(next); } catch (_) {}
      }
      fetch(`${apiBase}/api/window/set-topmost`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'confirm', topmost: next, bringToFront: next })
      }).catch(() => {});
    };
  }

  // Ensure confirm window is topmost upon initialization
  fetch(`${apiBase}/api/window/set-topmost`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'confirm', topmost: true, bringToFront: true })
  }).catch(() => {});

  if (window.waterfallDesktop) {
    if (typeof window.waterfallDesktop.setAlwaysOnTop === 'function') {
      try { window.waterfallDesktop.setAlwaysOnTop(true); } catch (_) {}
    }
    if (typeof window.waterfallDesktop.forceTop === 'function') {
      try { window.waterfallDesktop.forceTop(); } catch (_) {}
    }
  }

  // Event Listeners
  if (btnStart) btnStart.onclick = () => submitDownload(true);
  if (btnLater) btnLater.onclick = () => submitDownload(false);
  if (btnCancel) btnCancel.onclick = closeThisWindow;
  if (btnCloseWindow) btnCloseWindow.onclick = closeThisWindow;
  if (btnWatchNow) btnWatchNow.onclick = () => submitDownload(true, true);

  // Keyboard Shortcuts: Enter starts download, Esc cancels
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeThisWindow();
    } else if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
      submitDownload(true);
    }
  });

  // Extraction options toggle
  if (checkExtract && extractDetails) {
    checkExtract.onchange = () => {
      extractDetails.style.display = checkExtract.checked ? 'flex' : 'none';
    };
  }

  // Password toggle
  if (btnTogglePwd && inputExtractPwd) {
    btnTogglePwd.onclick = () => {
      inputExtractPwd.type = inputExtractPwd.type === 'password' ? 'text' : 'password';
    };
  }

  // Browse folder
  if (btnBrowseFolder) {
    btnBrowseFolder.onclick = async () => {
      const currentPath = folderEl ? folderEl.value.trim() : '';
      if (window.waterfallDesktop && window.waterfallDesktop.selectFolder) {
        const chosen = await window.waterfallDesktop.selectFolder(currentPath);
        if (chosen && folderEl) folderEl.value = chosen;
      } else {
        try {
          const res = await fetch(`${apiBase}/api/browse-folder`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ defaultPath: currentPath })
          });
          const data = await res.json();
          if (data && data.success && data.folder && folderEl) {
            folderEl.value = data.folder;
          }
        } catch (_) {}
      }
    };
  }

  // Quick chips
  const chipDownloads = document.getElementById('chip-downloads');
  const chipDesktop = document.getElementById('chip-desktop');
  const chipCategory = document.getElementById('chip-category');

  if (chipDownloads) {
    chipDownloads.onclick = () => {
      fetch(`${apiBase}/api/config`)
        .then(r => r.json())
        .then(cfg => { if (cfg && cfg.downloadDir && folderEl) folderEl.value = cfg.downloadDir; })
        .catch(() => {});
    };
  }
  if (chipDesktop) {
    chipDesktop.onclick = () => {
      if (folderEl) {
        const base = folderEl.value || '';
        const home = base.split('\\Downloads')[0] || base.split('/Downloads')[0] || '';
        if (home) folderEl.value = `${home}\\Desktop`;
      }
    };
  }
  if (chipCategory) {
    chipCategory.onclick = () => {
      if (currentProbeData && currentProbeData.defaultSaveDir && folderEl) {
        folderEl.value = currentProbeData.defaultSaveDir;
      }
    };
  }

  // Keyboard escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeThisWindow();
    if (e.key === 'Enter' && e.ctrlKey) submitDownload(true);
  });

  // Load initial data through all possible discovery channels:
  // 1. Electron IPC event
  if (window.waterfallDesktop && window.waterfallDesktop.onConfirmData) {
    window.waterfallDesktop.onConfirmData((data) => {
      applyProbeData(data);
    });
  }

  // 2. localStorage
  try {
    const cached = localStorage.getItem('waterfall_confirm_data');
    if (cached) {
      applyProbeData(JSON.parse(cached));
    }
  } catch (_) {}

  // 3. REST API pending-confirm fetch
  fetch(`${apiBase}/api/downloads/pending-confirm`)
    .then(r => r.json())
    .then(data => {
      if (data && data.url) {
        applyProbeData(data);
      }
    })
    .catch(() => {});

  // 4. URL Query params
  const params = new URLSearchParams(window.location.search);
  if (params.has('url')) {
    applyProbeData({
      url: params.get('url'),
      filename: params.get('filename') || 'download',
      totalBytes: parseInt(params.get('size'), 10) || 0,
      category: params.get('category') || 'General'
    });
  }

  // 5. Connect WebSocket for live updates
  try {
    const ws = new WebSocket(`${wsBase}/ws`);
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'showDownloadConfirmation' && msg.probeData) {
          applyProbeData(msg.probeData);
        }
      } catch (_) {}
    };
  } catch (_) {}

})();
