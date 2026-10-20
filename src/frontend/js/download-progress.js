(function () {
  const urlParams = new URLSearchParams(window.location.search);
  let currentTaskId = urlParams.get('taskId') || null;
  let currentTask = null;
  let isCompletedState = false;
  let startTime = Date.now();
  let hasUserChangedLimiter = false;

  const isHttp = window.location.protocol.startsWith('http');
  const apiBase = isHttp ? '' : 'http://localhost:4567';
  const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsHost = (isHttp && window.location.hostname) ? window.location.hostname : 'localhost';
  const wsPort = (isHttp && window.location.port) ? window.location.port : '4567';
  const wsUrl = `${wsProto}//${wsHost}:${wsPort}/ws`;

  // --- Top File Banner Elements ---
  const fileIcon = document.getElementById('file-icon');
  const dlgFileName = document.getElementById('dlg-file-name');
  const dlgFileUrl = document.getElementById('dlg-file-url');
  const btnCopyUrl = document.getElementById('btn-copy-url');

  // --- Tabs Navigation ---
  const tabButtons = document.querySelectorAll('.dlg-tab-btn');
  const tabPanes = document.querySelectorAll('.tab-pane');
  const tabLimiterBadge = document.getElementById('tab-limiter-badge');

  // --- Progress Tab Elements ---
  const dlgStatus = document.getElementById('dlg-status');
  const statusDot = document.getElementById('status-dot');
  const dlgPercent = document.getElementById('dlg-percent');
  const dlgBarFill = document.getElementById('dlg-bar-fill');
  const dlgSegmentsBar = document.getElementById('dlg-segments-bar');
  const btnStreamNow = document.getElementById('btn-stream-now');

  const dlgSize = document.getElementById('dlg-size');
  const dlgSpeed = document.getElementById('dlg-speed');
  const dlgDownloaded = document.getElementById('dlg-downloaded');
  const dlgEta = document.getElementById('dlg-eta');
  const dlgResumable = document.getElementById('dlg-resumable');
  const dlgThreads = document.getElementById('dlg-threads');

  // --- Speed Limiter Tab Elements ---
  const limiterEnable = document.getElementById('limiter-enable');
  const limiterSlider = document.getElementById('limiter-slider');
  const limiterInputVal = document.getElementById('limiter-input-val');
  const limiterUnitVal = document.getElementById('limiter-unit-val');
  const limiterStatusLabel = document.getElementById('limiter-status-label');
  const btnApplyLimiter = document.getElementById('btn-apply-limiter');
  const presetChips = document.querySelectorAll('.preset-chip');

  // --- Options & Script Tab Elements ---
  const optCompleteAction = document.getElementById('opt-complete-action');
  const optTriggerPercent = document.getElementById('opt-trigger-percent');
  const optEnableScript = document.getElementById('opt-enable-script');
  const optScriptBox = document.getElementById('opt-script-box');
  const optScriptType = document.getElementById('opt-script-type');
  const optScriptPath = document.getElementById('opt-script-path');
  const btnBrowseScript = document.getElementById('btn-browse-script');
  const optScriptArgs = document.getElementById('opt-script-args');
  const helperChips = document.querySelectorAll('.helper-chip');

  // --- Extraction Tab Elements ---
  const optEnableExtract = document.getElementById('opt-enable-extract');
  const optExtractPassword = document.getElementById('opt-extract-password');
  const btnExtractTogglePwd = document.getElementById('btn-extract-toggle-pwd');
  const optDeleteArchive = document.getElementById('opt-delete-archive');
  const optExtractDirLabel = document.getElementById('opt-extract-dir-label');

  // --- Finish View Elements ---
  const finishView = document.getElementById('finish-view');
  const finishFileName = document.getElementById('finish-file-name');
  const finishFileSize = document.getElementById('finish-file-size');
  const finishAvgSpeed = document.getElementById('finish-avg-speed');
  const finishSavePath = document.getElementById('finish-save-path');
  const finishExtractSection = document.getElementById('finish-extract-section');
  const finishExtractTitle = document.getElementById('finish-extract-title');
  const finishExtractPct = document.getElementById('finish-extract-pct');
  const finishExtractFill = document.getElementById('finish-extract-fill');
  const finishExtractDest = document.getElementById('finish-extract-dest');
  const btnFinishOpen = document.getElementById('btn-finish-open');
  const btnFinishFolder = document.getElementById('btn-finish-folder');
  const btnFinishExtractedFolder = document.getElementById('btn-finish-extracted-folder');
  const btnFinishClose = document.getElementById('btn-finish-close');

  // --- Footer Controls ---
  const footerControls = document.getElementById('dlg-footer-controls');
  const btnPauseResume = document.getElementById('btn-pause-resume');
  const btnCancel = document.getElementById('btn-cancel');
  const btnSaveOptions = document.getElementById('btn-save-options');
  const saveStatusMsg = document.getElementById('save-status-msg');
  const btnHideBg = document.getElementById('btn-hide-bg');

  function isArchiveFilename(name = '') {
    return /\.(zip|rar|7z|tar\.gz|tar\.bz2|tar|tgz|bz2|xz|iso|part\d+\.rar|part\d+|001|r00|r01)$/i.test(name);
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

  function getFileExtensionIcon(name = '') {
    const ext = (name.split('.').pop() || '').toLowerCase();
    if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'iso'].includes(ext)) return '📦';
    if (['mp4', 'mkv', 'webm', 'avi', 'mov', 'flv', 'wmv'].includes(ext)) return '🎬';
    if (['mp3', 'm4a', 'flac', 'wav', 'ogg', 'opus', 'aac'].includes(ext)) return '🎵';
    if (['exe', 'msi', 'bin', 'dll'].includes(ext)) return '⚙️';
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) return '🖼️';
    if (['pdf', 'docx', 'xlsx', 'txt', 'epub'].includes(ext)) return '📄';
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
    } else if (window.__TAURI__ && window.__TAURI__.window) {
      window.__TAURI__.window.getCurrentWindow().close().catch(() => window.close());
    } else {
      window.close();
    }
  }

  // --- Tab Switching Logic ---
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTabId = btn.getAttribute('data-tab');
      tabButtons.forEach(b => b.classList.remove('active'));
      tabPanes.forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      const targetPane = document.getElementById(targetTabId);
      if (targetPane) targetPane.classList.add('active');
    });
  });

  // --- Copy URL Action ---
  if (btnCopyUrl) {
    btnCopyUrl.addEventListener('click', async () => {
      const urlToCopy = (currentTask && currentTask.url) ? currentTask.url : (dlgFileUrl ? dlgFileUrl.textContent : '');
      if (urlToCopy) {
        try {
          await navigator.clipboard.writeText(urlToCopy);
          const origText = btnCopyUrl.innerHTML;
          btnCopyUrl.innerHTML = '✓ Copied!';
          btnCopyUrl.style.color = '#10b981';
          setTimeout(() => {
            btnCopyUrl.innerHTML = origText;
            btnCopyUrl.style.color = '';
          }, 1500);
        } catch (_) {}
      }
    });
  }

  // --- Stream Preview Action ---
  if (btnStreamNow) {
    btnStreamNow.addEventListener('click', () => {
      if (!currentTaskId) return;
      const streamUrl = `${apiBase}/api/downloads/${currentTaskId}/stream`;
      if (window.waterfallDesktop && window.waterfallDesktop.openExternal) {
        window.waterfallDesktop.openExternal(streamUrl);
      } else {
        window.open(streamUrl, '_blank');
      }
    });
  }

  // --- Speed Limiter Logic ---
  function getSelectedLimitBytes() {
    if (!limiterEnable.checked) return 0;
    const num = parseFloat(limiterInputVal.value) || 0;
    const unit = limiterUnitVal.value;
    if (num <= 0) return 0;
    const kb = (unit === 'MB') ? (num * 1024) : num;
    return Math.round(kb * 1024);
  }

  function syncLimiterUiFromKb(kb, markActivePreset = true) {
    const isUnlimited = (kb <= 0);
    limiterSlider.value = isUnlimited ? 0 : Math.min(51200, Math.max(64, kb));

    if (isUnlimited) {
      limiterStatusLabel.textContent = 'Unlimited';
      limiterStatusLabel.style.color = '#94a3b8';
    } else if (kb >= 1024) {
      limiterStatusLabel.textContent = `${(kb / 1024).toFixed(1)} MB/s`;
      limiterStatusLabel.style.color = 'var(--accent-cyan)';
    } else {
      limiterStatusLabel.textContent = `${Math.round(kb)} KB/s`;
      limiterStatusLabel.style.color = 'var(--accent-cyan)';
    }

    if (kb >= 1024) {
      limiterInputVal.value = parseFloat((kb / 1024).toFixed(1));
      limiterUnitVal.value = 'MB';
    } else {
      limiterInputVal.value = Math.round(kb);
      limiterUnitVal.value = 'KB';
    }

    if (markActivePreset) {
      presetChips.forEach(chip => {
        const chipKb = parseInt(chip.getAttribute('data-kb'), 10);
        chip.classList.toggle('active', chipKb === kb);
      });
    }
  }

  if (limiterEnable) {
    limiterEnable.addEventListener('change', () => {
      hasUserChangedLimiter = true;
      const isEnabled = limiterEnable.checked;
      if (tabLimiterBadge) tabLimiterBadge.style.display = isEnabled ? 'inline-block' : 'none';
      if (!isEnabled) {
        limiterStatusLabel.textContent = 'Disabled (Unlimited)';
        limiterStatusLabel.style.color = '#94a3b8';
      } else {
        const kb = parseInt(limiterSlider.value, 10) || 2048;
        syncLimiterUiFromKb(kb);
      }
    });
  }

  if (limiterSlider) {
    limiterSlider.addEventListener('input', () => {
      hasUserChangedLimiter = true;
      limiterEnable.checked = true;
      if (tabLimiterBadge) tabLimiterBadge.style.display = 'inline-block';
      const kb = parseInt(limiterSlider.value, 10);
      syncLimiterUiFromKb(kb);
    });
  }

  if (limiterInputVal) {
    limiterInputVal.addEventListener('input', () => {
      hasUserChangedLimiter = true;
      limiterEnable.checked = true;
      if (tabLimiterBadge) tabLimiterBadge.style.display = 'inline-block';
      const val = parseFloat(limiterInputVal.value) || 0;
      const unit = limiterUnitVal.value;
      const kb = (unit === 'MB') ? (val * 1024) : val;
      syncLimiterUiFromKb(kb, false);
    });
  }

  if (limiterUnitVal) {
    limiterUnitVal.addEventListener('change', () => {
      hasUserChangedLimiter = true;
      const val = parseFloat(limiterInputVal.value) || 0;
      const unit = limiterUnitVal.value;
      const kb = (unit === 'MB') ? (val * 1024) : val;
      syncLimiterUiFromKb(kb, false);
    });
  }

  presetChips.forEach(chip => {
    chip.addEventListener('click', async () => {
      hasUserChangedLimiter = true;
      const kb = parseInt(chip.getAttribute('data-kb'), 10);
      if (kb === 0) {
        limiterEnable.checked = false;
        if (tabLimiterBadge) tabLimiterBadge.style.display = 'none';
        syncLimiterUiFromKb(0);
      } else {
        limiterEnable.checked = true;
        if (tabLimiterBadge) tabLimiterBadge.style.display = 'inline-block';
        syncLimiterUiFromKb(kb);
      }

      // Immediately apply to running task
      if (currentTaskId) {
        const speedLimitBytesPerSec = (kb > 0 && limiterEnable.checked) ? (kb * 1024) : 0;
        try {
          await fetch(`${apiBase}/api/downloads/${currentTaskId}/speed-limit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ speedLimitBytesPerSec })
          });
          flashSaveFeedback();
        } catch (_) {}
      }
    });
  });

  if (btnApplyLimiter) {
    btnApplyLimiter.addEventListener('click', async () => {
      if (!currentTaskId) return;
      const bytes = getSelectedLimitBytes();
      try {
        await fetch(`${apiBase}/api/downloads/${currentTaskId}/speed-limit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ speedLimitBytesPerSec: bytes })
        });
        flashSaveFeedback();
      } catch (err) {
        console.warn('Failed to apply limiter:', err);
      }
    });
  }

  // --- Options & Script Wiring ---
  if (optEnableScript) {
    optEnableScript.addEventListener('change', () => {
      if (optScriptBox) {
        optScriptBox.style.display = optEnableScript.checked ? 'flex' : 'none';
      }
    });
  }

  helperChips.forEach(chip => {
    chip.addEventListener('click', () => {
      const pill = chip.getAttribute('data-pill');
      if (pill && optScriptArgs) {
        optScriptArgs.value = (optScriptArgs.value ? optScriptArgs.value + ' ' : '') + pill;
        optScriptArgs.focus();
      }
    });
  });

  if (btnBrowseScript) {
    btnBrowseScript.addEventListener('click', async () => {
      if (window.waterfallDesktop && typeof window.waterfallDesktop.selectFile === 'function') {
        const filePath = await window.waterfallDesktop.selectFile({
          title: 'Select Post-Download Script or Executable',
          filters: [
            { name: 'Scripts (*.ps1, *.bat, *.cmd, *.py, *.js)', extensions: ['ps1', 'bat', 'cmd', 'py', 'js'] },
            { name: 'Executables (*.exe)', extensions: ['exe'] },
            { name: 'All Files (*.*)', extensions: ['*'] }
          ]
        });
        if (filePath && optScriptPath) {
          optScriptPath.value = filePath;
          const ext = filePath.split('.').pop().toLowerCase();
          if (ext === 'ps1') optScriptType.value = 'powershell';
          else if (ext === 'bat' || ext === 'cmd') optScriptType.value = 'batch';
          else if (ext === 'py') optScriptType.value = 'python';
          else if (ext === 'js') optScriptType.value = 'node';
          else optScriptType.value = 'custom';
        }
      } else {
        const input = prompt('Enter full path to script / executable:', optScriptPath.value || '');
        if (input !== null && optScriptPath) {
          optScriptPath.value = input.trim();
        }
      }
    });
  }

  // --- Extraction Tab Wiring ---
  if (btnExtractTogglePwd) {
    btnExtractTogglePwd.addEventListener('click', () => {
      if (!optExtractPassword) return;
      const isPwd = (optExtractPassword.type === 'password');
      optExtractPassword.type = isPwd ? 'text' : 'password';
      btnExtractTogglePwd.textContent = isPwd ? '🔒' : '👁️';
    });
  }

  // --- Save Options Action ---
  function flashSaveFeedback() {
    if (saveStatusMsg) {
      saveStatusMsg.style.display = 'inline-block';
      setTimeout(() => {
        saveStatusMsg.style.display = 'none';
      }, 2000);
    }
  }

  if (btnSaveOptions) {
    btnSaveOptions.addEventListener('click', async () => {
      if (!currentTaskId) return;
      const speedLimitBytesPerSec = getSelectedLimitBytes();
      const payload = {
        speedLimitEnabled: limiterEnable.checked && speedLimitBytesPerSec > 0,
        speedLimitBytesPerSec,
        onCompleteAction: optCompleteAction ? optCompleteAction.value : 'none',
        triggerAtPercent: optTriggerPercent ? parseInt(optTriggerPercent.value, 10) : 100,
        runScriptOnComplete: optEnableScript ? optEnableScript.checked : false,
        scriptType: optScriptType ? optScriptType.value : 'powershell',
        scriptPath: optScriptPath ? optScriptPath.value.trim() : '',
        scriptArgs: optScriptArgs ? optScriptArgs.value.trim() : '',
        autoExtract: optEnableExtract ? optEnableExtract.checked : true,
        extractPassword: optExtractPassword ? optExtractPassword.value : '',
        deleteArchiveAfterExtraction: optDeleteArchive ? optDeleteArchive.checked : false
      };

      try {
        await fetch(`${apiBase}/api/downloads/${currentTaskId}/options`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        flashSaveFeedback();
      } catch (err) {
        console.warn('Failed to save task options:', err);
      }
    });
  }

  // --- Apply Task Data into UI ---
  function applyTaskData(task) {
    if (!task) return;
    currentTask = task;
    if (!currentTaskId) currentTaskId = task.id;

    const name = task.name || task.filename || 'download';
    document.title = `Waterfall — Downloading: ${name}`;
    if (dlgFileName) {
      dlgFileName.textContent = name;
      dlgFileName.title = name;
    }
    if (fileIcon) fileIcon.textContent = getFileExtensionIcon(name);

    if (task.url && dlgFileUrl) {
      dlgFileUrl.textContent = task.url;
      dlgFileUrl.title = task.url;
    }

    if (task.totalBytes > 0) {
      if (dlgSize) dlgSize.textContent = formatBytes(task.totalBytes);
    } else if (task.formattedSize) {
      if (dlgSize) dlgSize.textContent = task.formattedSize;
    } else {
      if (dlgSize) dlgSize.textContent = 'Unknown / Stream';
    }

    if (task.acceptRanges !== undefined && dlgResumable) {
      dlgResumable.textContent = task.acceptRanges ? 'Yes' : 'No';
      dlgResumable.className = 'stat-val ' + (task.acceptRanges ? 'resumable-yes' : 'resumable-no');
    }

    const segCount = task.segmentsCount || (task.segments && task.segments.length) || 8;
    if (dlgThreads) dlgThreads.textContent = `${segCount} Segments`;

    // Populate Save Destination Label in Extraction Tab
    if (optExtractDirLabel) {
      const destDir = task.saveDir || (task.savePath ? task.savePath.substring(0, task.savePath.lastIndexOf('\\') || task.savePath.lastIndexOf('/')) : 'Downloads');
      optExtractDirLabel.textContent = destDir;
    }

    // Populate initial options from task if user hasn't overridden them in this session
    if (!hasUserChangedLimiter) {
      if (task.speedLimitBytesPerSec > 0 || task.speedLimitEnabled) {
        limiterEnable.checked = Boolean(task.speedLimitEnabled);
        if (tabLimiterBadge) tabLimiterBadge.style.display = task.speedLimitEnabled ? 'inline-block' : 'none';
        const kb = Math.round(task.speedLimitBytesPerSec / 1024);
        syncLimiterUiFromKb(kb);
      }
    }

    if (task.onCompleteAction && optCompleteAction) {
      optCompleteAction.value = task.onCompleteAction;
    }
    if (task.triggerAtPercent && optTriggerPercent) {
      optTriggerPercent.value = String(task.triggerAtPercent);
    }
    if (task.customScript) {
      if (task.customScript.enabled !== undefined && optEnableScript) {
        optEnableScript.checked = Boolean(task.customScript.enabled);
        if (optScriptBox) optScriptBox.style.display = optEnableScript.checked ? 'flex' : 'none';
      }
      if (task.customScript.type && optScriptType) optScriptType.value = task.customScript.type;
      if (task.customScript.path && optScriptPath) optScriptPath.value = task.customScript.path;
      if (task.customScript.args && optScriptArgs) optScriptArgs.value = task.customScript.args;
    }
    if (task.autoExtract !== undefined && optEnableExtract) {
      optEnableExtract.checked = Boolean(task.autoExtract);
    }
    if (task.archivePassword && optExtractPassword) {
      optExtractPassword.value = task.archivePassword;
    }
    if (task.deleteAfterExtract !== undefined && optDeleteArchive) {
      optDeleteArchive.checked = Boolean(task.deleteAfterExtract);
    }

    // Check completion state
    if (task.status === 'completed' && !isCompletedState) {
      showCompletionView(task);
      return;
    }
    if (isCompletedState) {
      updateExtractionUI(task);
      return;
    }

    updateProgressMetrics(task);
  }

  function updateExtractionUI(data) {
    if (!finishExtractSection) return;
    if (data && currentTask && currentTask !== data) {
      Object.assign(currentTask, data);
    } else if (data && !currentTask) {
      currentTask = data;
    }
    const extractStatus = data.extractStatus || (currentTask && currentTask.extractStatus) || null;
    const savePath = data.savePath || (currentTask && currentTask.savePath) || '';
    const candidatePath = savePath ? resolveExtractedDir(savePath) : null;
    const confirmedExtractedPath = data.extractedPath || (currentTask && currentTask.extractedPath) || null;
    const targetFolder = confirmedExtractedPath || candidatePath;
    const extractProgress = data.extractProgress !== undefined
      ? data.extractProgress
      : ((currentTask && currentTask.extractProgress !== undefined)
          ? currentTask.extractProgress
          : (extractStatus === 'extracted' ? 100 : 0));
    const isArchive = Boolean(
      (data.isArchive !== undefined ? data.isArchive : (currentTask && currentTask.isArchive)) ||
      isArchiveFilename(data.filename || data.name || savePath || '')
    );

    if (!isArchive) {
      finishExtractSection.style.display = 'none';
      if (btnFinishExtractedFolder) btnFinishExtractedFolder.style.display = 'none';
      return;
    }

    if (extractStatus === 'extracting') {
      finishExtractSection.style.display = 'flex';
      if (finishExtractTitle) {
        finishExtractTitle.innerHTML = `<svg width="14" height="14" class="spin-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg> Extracting Archive...`;
        finishExtractTitle.style.color = '#c084fc';
      }
      if (finishExtractPct) finishExtractPct.textContent = `${extractProgress}%`;
      if (finishExtractFill) {
        finishExtractFill.style.width = `${extractProgress}%`;
        finishExtractFill.style.background = 'linear-gradient(90deg, #9333ea, #a855f7, #c084fc)';
      }
      if (finishExtractDest) {
        finishExtractDest.textContent = targetFolder ? `Extracting to: ${targetFolder}` : 'Extracting archive in background...';
      }
      if (btnFinishExtractedFolder) {
        btnFinishExtractedFolder.style.display = 'none';
      }
    } else if (extractStatus === 'extract_queued') {
      finishExtractSection.style.display = 'flex';
      if (finishExtractTitle) {
        finishExtractTitle.innerHTML = `<svg width="14" height="14" class="spin-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg> Extraction Queued...`;
        finishExtractTitle.style.color = '#a855f7';
      }
      if (finishExtractPct) finishExtractPct.textContent = '0%';
      if (finishExtractFill) {
        finishExtractFill.style.width = '0%';
        finishExtractFill.style.background = 'linear-gradient(90deg, #9333ea, #a855f7, #c084fc)';
      }
      if (finishExtractDest) finishExtractDest.textContent = targetFolder ? `Target: ${targetFolder}` : 'Waiting in extraction queue...';
      if (btnFinishExtractedFolder) {
        btnFinishExtractedFolder.style.display = 'none';
      }
    } else if (extractStatus === 'waiting_all_parts') {
      finishExtractSection.style.display = 'flex';
      if (finishExtractTitle) {
        finishExtractTitle.innerHTML = `<svg width="14" height="14" fill="none" stroke="#38bdf8" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg> Waiting for remaining parts...`;
        finishExtractTitle.style.color = '#38bdf8';
      }
      if (finishExtractPct) finishExtractPct.textContent = '0%';
      if (finishExtractFill) {
        finishExtractFill.style.width = '0%';
        finishExtractFill.style.background = 'linear-gradient(90deg, #0284c7, #38bdf8)';
      }
      if (finishExtractDest) finishExtractDest.textContent = 'Extraction will start once all multi-part files complete';
      if (btnFinishExtractedFolder) {
        btnFinishExtractedFolder.style.display = 'none';
      }
    } else if (extractStatus === 'extracted' || (confirmedExtractedPath && extractStatus !== 'extract_failed' && extractStatus !== 'extract_password_required')) {
      finishExtractSection.style.display = 'flex';
      if (finishExtractTitle) {
        finishExtractTitle.innerHTML = `<svg width="14" height="14" fill="none" stroke="#34d399" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"></path></svg> Archive Extracted Successfully ✓`;
        finishExtractTitle.style.color = '#34d399';
      }
      if (finishExtractPct) finishExtractPct.textContent = '100%';
      if (finishExtractFill) {
        finishExtractFill.style.width = '100%';
        finishExtractFill.style.background = '#10b981';
      }
      if (finishExtractDest) {
        finishExtractDest.textContent = targetFolder ? `Extracted to: ${targetFolder}` : 'Archive extracted';
      }
      if (btnFinishExtractedFolder) {
        btnFinishExtractedFolder.style.display = 'inline-flex';
        btnFinishExtractedFolder.innerHTML = `<svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 11v6m-3-3l3-3 3 3"></path></svg> Open Extracted Folder`;
        btnFinishExtractedFolder.title = targetFolder ? `Open Extracted Directory (${targetFolder})` : 'Open Extracted Directory';
        btnFinishExtractedFolder.onclick = async () => {
          const finalTarget = (currentTask && currentTask.extractedPath) || data.extractedPath || targetFolder;
          if (!finalTarget) return;
          if (window.waterfallDesktop && window.waterfallDesktop.openFolder) {
            await window.waterfallDesktop.openFolder(finalTarget);
          } else {
            fetch(`${apiBase}/api/open-folder`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ filePath: finalTarget })
            }).catch(() => {});
          }
        };
      }
    } else if (extractStatus === 'extract_failed') {
      finishExtractSection.style.display = 'flex';
      const errMsg = data.extractError || (currentTask && currentTask.extractError) || 'Failed to unpack archive';
      if (finishExtractTitle) {
        finishExtractTitle.innerHTML = `<svg width="14" height="14" fill="none" stroke="#f85149" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg> Extraction Failed`;
        finishExtractTitle.style.color = '#f85149';
      }
      if (finishExtractPct) finishExtractPct.textContent = '!';
      if (finishExtractFill) {
        finishExtractFill.style.width = '100%';
        finishExtractFill.style.background = '#ef4444';
      }
      if (finishExtractDest) finishExtractDest.textContent = errMsg;
      if (btnFinishExtractedFolder) btnFinishExtractedFolder.style.display = 'none';
    } else if (extractStatus === 'extract_password_required') {
      finishExtractSection.style.display = 'flex';
      if (finishExtractTitle) {
        finishExtractTitle.innerHTML = `<svg width="14" height="14" fill="none" stroke="#f59e0b" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0110 0v4"></path></svg> Password Required to Extract Archive`;
        finishExtractTitle.style.color = '#f59e0b';
      }
      if (finishExtractPct) finishExtractPct.textContent = '🔒';
      if (finishExtractFill) {
        finishExtractFill.style.width = '100%';
        finishExtractFill.style.background = '#f59e0b';
      }
      if (finishExtractDest) finishExtractDest.textContent = 'Encrypted archive — enter password in main app or extraction tab';
      if (btnFinishExtractedFolder) btnFinishExtractedFolder.style.display = 'none';
    } else if (data.autoExtract !== false && (optEnableExtract ? optEnableExtract.checked : true)) {
      finishExtractSection.style.display = 'flex';
      if (finishExtractTitle) {
        finishExtractTitle.innerHTML = `<svg width="14" height="14" class="spin-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg> Extraction Queued...`;
        finishExtractTitle.style.color = '#a855f7';
      }
      if (finishExtractPct) finishExtractPct.textContent = '0%';
      if (finishExtractFill) {
        finishExtractFill.style.width = '0%';
        finishExtractFill.style.background = 'linear-gradient(90deg, #9333ea, #a855f7, #c084fc)';
      }
      if (finishExtractDest) finishExtractDest.textContent = targetFolder ? `Target: ${targetFolder}` : 'Preparing archive extraction...';
      if (btnFinishExtractedFolder) btnFinishExtractedFolder.style.display = 'none';
    } else {
      finishExtractSection.style.display = 'none';
      if (btnFinishExtractedFolder) btnFinishExtractedFolder.style.display = 'none';
    }
  }

  function updateProgressMetrics(data) {
    if (isCompletedState) {
      updateExtractionUI(data);
      return;
    }

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

    if (dlgPercent) dlgPercent.textContent = pct.toFixed(1) + '%';
    if (dlgBarFill) dlgBarFill.style.width = pct.toFixed(1) + '%';

    if (dlgSpeed) dlgSpeed.textContent = formatSpeed(speed);
    if (dlgDownloaded) dlgDownloaded.textContent = `${formatBytes(downloaded)} of ${total > 0 ? formatBytes(total) : '--'}`;
    if (dlgEta) dlgEta.textContent = formatETA(eta);

    // Update status dot & text
    if (dlgStatus && statusDot) {
      if (status === 'paused') {
        dlgStatus.textContent = 'Paused';
        statusDot.style.background = '#f59e0b';
        statusDot.style.boxShadow = '0 0 8px #f59e0b';
        if (btnPauseResume) {
          btnPauseResume.innerHTML = `<svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"></path></svg> Resume`;
        }
      } else if (status === 'queued') {
        dlgStatus.textContent = 'Queued in Waterfall...';
        statusDot.style.background = '#38bdf8';
        statusDot.style.boxShadow = '0 0 8px #38bdf8';
        if (btnPauseResume) {
          btnPauseResume.innerHTML = `<svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"></path></svg> Start Now`;
        }
      } else if (status === 'retrying') {
        dlgStatus.textContent = data.error || 'Connection dropped. Reconnecting...';
        statusDot.style.background = '#f59e0b';
        statusDot.style.boxShadow = '0 0 8px #f59e0b';
        if (btnPauseResume) {
          btnPauseResume.innerHTML = `<svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 9v6m4-6v6"></path></svg> Pause`;
        }
      } else if (status === 'error') {
        dlgStatus.textContent = `Error: ${data.error || 'Download failed'}`;
        statusDot.style.background = '#ef4444';
        statusDot.style.boxShadow = '0 0 8px #ef4444';
        if (btnPauseResume) {
          btnPauseResume.innerHTML = `<svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"></path></svg> Retry`;
        }
      } else if (status === 'assembling') {
        dlgStatus.textContent = 'Assembling file parts...';
        statusDot.style.background = '#38bdf8';
      } else if (status === 'extracting' || data.extractStatus === 'extracting') {
        const extPct = data.extractProgress !== undefined ? data.extractProgress : 0;
        dlgStatus.textContent = `Extracting archive (${extPct}%)...`;
        statusDot.style.background = '#a855f7';
        statusDot.style.boxShadow = '0 0 8px #a855f7';
        if (dlgPercent) dlgPercent.textContent = extPct + '%';
        if (dlgBarFill) {
          dlgBarFill.style.width = extPct + '%';
          dlgBarFill.style.background = 'linear-gradient(90deg, #9333ea, #a855f7, #c084fc)';
        }
      } else {
        dlgStatus.textContent = 'Downloading...';
        statusDot.style.background = '#10b981';
        statusDot.style.boxShadow = '0 0 8px #10b981';
        if (btnPauseResume) {
          btnPauseResume.innerHTML = `<svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 9v6m4-6v6"></path></svg> Pause`;
        }
      }
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
          const segTotal = (seg.endByte - seg.startByte + 1) || (seg.totalBytes) || 1;
          const segDownloaded = seg.downloadedBytes || seg.downloaded || 0;
          const segPct = Math.min(100, Math.max(0, (segDownloaded / segTotal) * 100));
          fillEl.style.width = segPct + '%';
        }
      }
    });
  }

  function showCompletionView(task) {
    if (task) currentTask = task;
    isCompletedState = true;
    const name = task.name || task.filename || 'Downloaded File';
    document.title = `Waterfall — Complete: ${name}`;

    // Auto close dialog if configured
    if (task.onCompleteAction === 'closeDialog' || (optCompleteAction && optCompleteAction.value === 'closeDialog')) {
      closeWindow();
      return;
    }

    // Switch panes to Finish View
    const tabsBar = document.getElementById('dlg-tabs-bar');
    if (tabsBar) tabsBar.style.display = 'none';
    tabPanes.forEach(p => p.style.display = 'none');
    if (footerControls) footerControls.style.display = 'none';
    if (finishView) finishView.style.display = 'flex';

    if (finishFileName) {
      finishFileName.textContent = name;
      finishFileName.title = name;
    }

    const total = task.totalBytes || task.downloadedBytes || 0;
    if (finishFileSize) finishFileSize.textContent = formatBytes(total);

    const durationSec = Math.max(1, Math.round((Date.now() - startTime) / 1000));
    const avgSpd = total > 0 ? formatSpeed(total / durationSec) : '--';
    if (finishAvgSpeed) finishAvgSpeed.textContent = `${avgSpd} (Downloaded in ${durationSec}s)`;

    const savePath = task.savePath || task.finalPath || task.path || 'Downloads';
    if (finishSavePath) {
      finishSavePath.textContent = savePath;
      finishSavePath.title = savePath;
    }

    // Extraction progress / state in finish view
    updateExtractionUI(task);

    // Action buttons in finish view
    if (btnFinishOpen) {
      btnFinishOpen.onclick = async () => {
        if (window.waterfallDesktop && window.waterfallDesktop.openFile) {
          await window.waterfallDesktop.openFile(savePath);
        } else {
          fetch(`${apiBase}/api/open-file`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filePath: savePath })
          }).catch(() => {});
        }
        closeWindow();
      };
    }

    if (btnFinishFolder) {
      btnFinishFolder.onclick = async () => {
        if (window.waterfallDesktop && window.waterfallDesktop.openFolder) {
          await window.waterfallDesktop.openFolder(savePath);
        } else {
          fetch(`${apiBase}/api/open-folder`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filePath: savePath })
          }).catch(() => {});
        }
      };
    }

    if (btnFinishExtractedFolder) {
      const candidatePath = (savePath && isArchiveFilename(savePath)) ? resolveExtractedDir(savePath) : null;
      btnFinishExtractedFolder.onclick = async () => {
        const finalTarget = (currentTask && currentTask.extractedPath) || task.extractedPath || candidatePath;
        if (!finalTarget) return;
        if (window.waterfallDesktop && window.waterfallDesktop.openFolder) {
          await window.waterfallDesktop.openFolder(finalTarget);
        } else {
          fetch(`${apiBase}/api/open-folder`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filePath: finalTarget })
          }).catch(() => {});
        }
      };
    }

    if (btnFinishClose) btnFinishClose.onclick = closeWindow;
  }

  // --- Window Control Buttons ---
  if (btnHideBg) btnHideBg.onclick = closeWindow;

  // --- Pause / Resume Toggle ---
  if (btnPauseResume) {
    btnPauseResume.onclick = async () => {
      if (!currentTaskId) return;
      const isPaused = currentTask && currentTask.status === 'paused';
      const action = isPaused ? 'resume' : 'pause';
      try {
        await fetch(`${apiBase}/api/downloads/${currentTaskId}/${action}`, { method: 'POST' });
        if (currentTask) currentTask.status = isPaused ? 'downloading' : 'paused';
      } catch (err) {
        console.warn('Failed to toggle pause/resume:', err);
      }
    };
  }

  // --- Cancel Download ---
  if (btnCancel) {
    btnCancel.onclick = async () => {
      if (!currentTaskId) return;
      if (confirm('Cancel and remove this download?')) {
        try {
          await fetch(`${apiBase}/api/downloads/${currentTaskId}`, { method: 'DELETE' });
        } catch (_) {}
        closeWindow();
      }
    };
  }

  // --- Initial Task Fetch ---
  async function initTask() {
    if (!currentTaskId) return;
    if (window.waterfallDesktop && typeof window.waterfallDesktop.getProgressData === 'function') {
      try {
        const desktopTask = await window.waterfallDesktop.getProgressData(currentTaskId);
        if (desktopTask) {
          applyTaskData(desktopTask);
          return;
        }
      } catch (_) {}
    }
    try {
      const res = await fetch(`${apiBase}/api/downloads`);
      const all = await res.json();
      const match = all.find(t => t.id === currentTaskId);
      if (match) applyTaskData(match);
    } catch (_) {}
  }

  // --- IPC Desktop Listeners ---
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

  // --- WebSocket Live Updates Connection ---
  function setupWebSocket() {
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
