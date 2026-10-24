/**
 * IDM Iconic Multi-Segment Download Inspector & File Allocation Block Matrix
 * Enhanced with Multipart Package Micro-Manager
 */
class SegmentVisualizer {
  constructor() {
    this.modal = document.getElementById('modal-segment-inspector');
    this.currentTaskId = null;
    this.currentGroupKey = null;

    // Elements
    this.filenameEl = document.getElementById('insp-filename');
    this.urlEl = document.getElementById('insp-url');
    this.totalSizeEl = document.getElementById('insp-total-size');
    this.downloadedSizeEl = document.getElementById('insp-downloaded-size');
    this.speedEl = document.getElementById('insp-speed');
    this.etaEl = document.getElementById('insp-eta');
    this.percentEl = document.getElementById('insp-percent');
    this.progressFillEl = document.getElementById('insp-progress-fill');
    this.connCountEl = document.getElementById('insp-conn-count');
    this.segmentsListEl = document.getElementById('insp-segments-list');
    this.matrixGridEl = document.getElementById('insp-matrix-grid');
    this.btnTogglePause = document.getElementById('insp-btn-toggle-pause');
    this.btnOpenFolder = document.getElementById('insp-btn-open-folder');

    // Micro-Manager Elements
    this.microBox = document.getElementById('insp-micromanager-box');
    this.microCount = document.getElementById('insp-mp-count');
    this.microParts = document.getElementById('insp-mp-parts-container');
    this.microStatus = document.getElementById('insp-mp-extract-status');
    this.btnMpPauseAll = document.getElementById('insp-mp-btn-pause-all');
    this.btnMpResumeAll = document.getElementById('insp-mp-btn-resume-all');
    this.btnMpExtractNow = document.getElementById('insp-mp-btn-extract-now');

    this.bindEvents();
    this.initMatrix();
  }

  initMatrix() {
    if (!this.matrixGridEl) return;
    let html = '';
    for (let i = 0; i < 50; i++) {
      html += `<div class="matrix-cell" id="matrix-cell-${i}"></div>`;
    }
    this.matrixGridEl.innerHTML = html;
  }

  bindEvents() {
    if (this.btnTogglePause) {
      this.btnTogglePause.addEventListener('click', () => {
        if (!this.currentTaskId) return;
        const task = window.appState.tasks.find(t => t.id === this.currentTaskId);
        if (!task) return;
        if (task.status === 'downloading') {
          fetch(`/api/downloads/${this.currentTaskId}/pause`, { method: 'POST' });
        } else {
          fetch(`/api/downloads/${this.currentTaskId}/resume`, { method: 'POST' });
        }
      });
    }

    if (this.btnOpenFolder) {
      this.btnOpenFolder.addEventListener('click', () => {
        if (!this.currentTaskId) return;
        const task = window.appState.tasks.find(t => t.id === this.currentTaskId);
        if (task && task.savePath) {
          const desktop = window.waterfallDesktop || window.hydraDesktop;
          if (desktop && desktop.openFolder) {
            desktop.openFolder(task.savePath);
          } else {
            fetch('/api/open-folder', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ filePath: task.savePath })
            });
          }
        }
      });
    }

    // Micro-Manager Group Action Listeners
    if (this.btnMpPauseAll) {
      this.btnMpPauseAll.addEventListener('click', () => {
        if (!this.currentGroupKey) return;
        const siblings = window.appState.tasks.filter(t => t.multipart && t.multipart.groupKey === this.currentGroupKey);
        fetch('/api/downloads/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'pause', ids: siblings.map(s => s.id) })
        });
      });
    }

    if (this.btnMpResumeAll) {
      this.btnMpResumeAll.addEventListener('click', () => {
        if (!this.currentGroupKey) return;
        const siblings = window.appState.tasks.filter(t => t.multipart && t.multipart.groupKey === this.currentGroupKey);
        fetch('/api/downloads/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'resume', ids: siblings.map(s => s.id) })
        });
      });
    }

    if (this.btnMpExtractNow) {
      this.btnMpExtractNow.addEventListener('click', () => {
        if (this.currentGroupKey) {
          fetch(`/api/downloads/group/${encodeURIComponent(this.currentGroupKey)}/force-download`, { method: 'POST' });
        } else if (this.currentTaskId) {
          fetch(`/api/downloads/${this.currentTaskId}/extract`, { method: 'POST' })
            .then(r => r.json())
            .then(res => {
              if (res.passwordRequired) {
                window.dispatchEvent(new CustomEvent('extract:password-required', { detail: { taskId: this.currentTaskId, name: this.filenameEl?.textContent } }));
              }
            });
        }
      });
    }

    // Modal Close Buttons
    if (this.modal) {
      this.modal.querySelectorAll('.modal-close-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          this.close();
        });
      });

      this.modal.addEventListener('click', (e) => {
        if (e.target === this.modal) {
          this.close();
        }
      });
    }

    document.addEventListener('keydown', (e) => {
      if ((e.key === 'Escape' || e.key === 'Esc') && this.isOpen()) {
        this.close();
      }
    });
  }

  open(taskId) {
    this.currentTaskId = taskId;
    const task = window.appState.tasks.find(t => t.id === taskId);
    if (task && task.multipart && task.multipart.isMultipart) {
      this.currentGroupKey = task.multipart.groupKey;
    } else {
      this.currentGroupKey = null;
    }
    this.update();
    if (this.modal) this.modal.classList.add('open');
  }

  openGroup(groupKey) {
    this.currentGroupKey = groupKey;
    const siblings = window.appState.tasks.filter(t => t.multipart && t.multipart.groupKey === groupKey);
    if (siblings.length > 0) {
      this.currentTaskId = siblings[0].id;
    }
    this.update();
    if (this.modal) this.modal.classList.add('open');
  }

  close() {
    this.currentTaskId = null;
    this.currentGroupKey = null;
    if (this.modal) this.modal.classList.remove('open');
  }

  isOpen() {
    return this.modal && this.modal.classList.contains('open');
  }

  formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    if (!bytes) return 'Unknown';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  formatSpeed(bytes) {
    if (!bytes || bytes === 0) return '0.0 KB/s';
    if (bytes >= 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB/s';
    if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB/s';
    return (bytes / 1024).toFixed(1) + ' KB/s';
  }

  formatETADuration(seconds) {
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

  formatETA(seconds) {
    if (!seconds || seconds <= 0 || !isFinite(seconds)) return '--';
    const target = new Date(Date.now() + seconds * 1000);
    let hours = target.getHours();
    const minutes = target.getMinutes();
    const ampm = hours >= 12 ? 'pm' : 'am';
    hours = hours % 12;
    hours = hours ? hours : 12;
    const timeStr = (minutes === 0)
      ? `${hours} ${ampm}`
      : `${hours}:${minutes < 10 ? '0' + minutes : minutes} ${ampm}`;

    const nowMidnight = new Date().setHours(0, 0, 0, 0);
    const targetMidnight = new Date(target).setHours(0, 0, 0, 0);
    const dayDiff = Math.round((targetMidnight - nowMidnight) / (1000 * 60 * 60 * 24));
    const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const weekday = weekdays[target.getDay()];

    if (dayDiff === 0) return `Today at ${timeStr}`;
    if (dayDiff === 1) return `Tomorrow at ${timeStr}`;
    if (dayDiff <= 7) return `In ${dayDiff} days (${weekday}) at ${timeStr}`;
    return `${target.toLocaleDateString()} at ${timeStr}`;
  }

  update() {
    if (!this.currentTaskId || !this.isOpen()) return;

    const task = window.appState.tasks.find(t => t.id === this.currentTaskId);
    if (!task) {
      this.close();
      return;
    }

    this.filenameEl.textContent = task.name;
    this.urlEl.textContent = task.url;
    this.totalSizeEl.textContent = this.formatBytes(task.totalBytes);
    this.downloadedSizeEl.textContent = this.formatBytes(task.downloadedBytes);
    this.speedEl.textContent = this.formatSpeed(task.speed);
    this.etaEl.textContent = (task.status === 'downloading')
      ? this.formatETA(task.eta)
      : (task.status === 'completed' ? 'Completed' : '--');
    this.etaEl.title = (task.status === 'downloading') ? this.formatETADuration(task.eta) : '';

    const percent = (task.totalBytes > 0)
      ? Math.min(100, Math.floor((task.downloadedBytes / task.totalBytes) * 100))
      : (task.status === 'completed' ? 100 : 0);

    this.percentEl.textContent = percent + '%';
    this.progressFillEl.style.width = percent + '%';

    if (this.btnTogglePause) {
      this.btnTogglePause.textContent = (task.status === 'downloading') ? 'Pause Download' : 'Resume Download';
    }

    // Micro-Manager Rendering
    const groupKey = this.currentGroupKey || (task.multipart && task.multipart.isMultipart ? task.multipart.groupKey : null);
    if (groupKey && this.microBox) {
      const siblings = window.appState.tasks.filter(t => t.multipart && t.multipart.groupKey === groupKey);
      if (siblings.length > 1) {
        this.microBox.style.display = 'block';
        if (this.microCount) this.microCount.textContent = `${siblings.length} Parts`;

        const allDone = siblings.every(s => s.status === 'completed');
        if (this.microStatus) {
          if (allDone) {
            const hasExtracted = siblings.some(s => s.extractStatus === 'extracted');
            const isExtracting = siblings.some(s => s.extractStatus === 'extracting');
            const isPwdReq = siblings.some(s => s.extractStatus === 'extract_password_required');
            if (isPwdReq) this.microStatus.innerHTML = '<span style="color:#e3b341; font-weight:700;">🔑 Password Required to Extract</span>';
            else if (hasExtracted) this.microStatus.innerHTML = '<span style="color:#3fb950; font-weight:600;">✓ Extracted into single folder</span>';
            else if (isExtracting) this.microStatus.innerHTML = '<span style="color:#38bdf8;">⏳ Extracting unified archive...</span>';
            else this.microStatus.textContent = 'All parts downloaded! Ready to extract';
          } else {
            const remaining = siblings.filter(s => s.status !== 'completed').length;
            this.microStatus.textContent = `Downloading (${siblings.length - remaining}/${siblings.length} complete • Waiting for ${remaining} more parts)`;
          }
        }

        // Render individual micro-manager items
        if (this.microParts) {
          let microHtml = '';
          siblings.sort((a, b) => (a.multipart?.partNumber || 1) - (b.multipart?.partNumber || 1));
          for (const s of siblings) {
            const sPct = s.totalBytes > 0 ? Math.min(100, Math.floor((s.downloadedBytes / s.totalBytes) * 100)) : (s.status === 'completed' ? 100 : 0);
            const isCurrent = s.id === this.currentTaskId;
            microHtml += `
              <div class="micromanager-item ${isCurrent ? 'selected' : ''}" style="${isCurrent ? 'border-color: #38bdf8; background: rgba(56,189,248,0.08);' : ''}">
                <div style="display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0;">
                  <span style="font-family: var(--font-mono); font-size: 0.70rem; color: #38bdf8; font-weight: 700; width: 44px;">Part ${s.multipart?.partNumber || '?'}</span>
                  <span style="flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer;" title="${s.name}" onclick="window.segmentVisualizer.open('${s.id}')">${s.name}</span>
                </div>
                <div style="display: flex; align-items: center; gap: 10px;">
                  <span style="font-family: var(--font-mono); font-size: 0.70rem; color: var(--text-muted);">${this.formatBytes(s.downloadedBytes)} / ${this.formatBytes(s.totalBytes)}</span>
                  <span class="state-tag ${s.status}" style="font-size: 0.65rem; padding: 1px 5px;">${s.status}</span>
                  ${s.status === 'downloading'
                    ? `<button class="icon-btn" onclick="fetch('/api/downloads/${s.id}/pause', {method:'POST'})" title="Pause">⏸</button>`
                    : (s.status !== 'completed' ? `<button class="icon-btn" onclick="fetch('/api/downloads/${s.id}/resume', {method:'POST'})" title="Resume">▶</button>` : '')
                  }
                </div>
              </div>
            `;
          }
          this.microParts.innerHTML = microHtml;
        }
      } else {
        this.microBox.style.display = 'none';
      }
    } else if (this.microBox) {
      this.microBox.style.display = 'none';
    }

    // Update IDM Allocation Block Matrix
    const filledCells = Math.floor((percent / 100) * 50);
    for (let i = 0; i < 50; i++) {
      const cell = document.getElementById(`matrix-cell-${i}`);
      if (cell) {
        if (i < filledCells) {
          cell.className = 'matrix-cell filled';
        } else if (i === filledCells && task.status === 'downloading') {
          cell.className = 'matrix-cell active';
        } else {
          cell.className = 'matrix-cell';
        }
      }
    }

    const segments = task.segments || [];
    this.connCountEl.textContent = segments.length > 0 ? segments.length : '1';

    let html = '';
    if (segments.length > 0) {
      segments.forEach((seg, index) => {
        const segPercent = (seg.totalBytes > 0)
          ? Math.min(100, Math.floor((seg.downloadedBytes / seg.totalBytes) * 100))
          : (seg.status === 'completed' ? 100 : 0);

        const isActive = seg.status === 'downloading';
        const isComplete = seg.status === 'completed';

        html += `
          <div class="segment-strip">
            <div class="segment-meta-row">
              <span class="segment-id-tag">
                <svg width="8" height="8" viewBox="0 0 24 24" fill="${isActive ? '#3fb950' : '#8b949e'}"><circle cx="12" cy="12" r="10"></circle></svg>
                Channel #${index + 1}
              </span>
              <span class="segment-byte-range">
                ${this.formatBytes(seg.downloadedBytes)} / ${this.formatBytes(seg.totalBytes)} (${segPercent}%)
              </span>
              <span class="segment-speed-tag">
                ${isActive ? this.formatSpeed(seg.speed) : (isComplete ? '100% Done' : seg.status)}
              </span>
            </div>
            <div class="segment-bar-track">
              <div class="segment-bar-fill ${isActive ? 'active' : ''} ${isComplete ? 'completed' : ''}" style="width: ${segPercent}%;"></div>
            </div>
          </div>
        `;
      });
    } else {
      const isDl = task.status === 'downloading';
      html = `
        <div class="segment-strip">
          <div class="segment-meta-row">
            <span class="segment-id-tag">
              <svg width="8" height="8" viewBox="0 0 24 24" fill="${isDl ? '#3fb950' : '#8b949e'}"><circle cx="12" cy="12" r="10"></circle></svg>
              Stream Channel #1 (${task.hoster})
            </span>
            <span class="segment-byte-range">${this.formatBytes(task.downloadedBytes)} / ${this.formatBytes(task.totalBytes)} (${percent}%)</span>
            <span class="segment-speed-tag">${isDl ? this.formatSpeed(task.speed) : task.status}</span>
          </div>
          <div class="segment-bar-track">
            <div class="segment-bar-fill ${isDl ? 'active' : ''} ${task.status === 'completed' ? 'completed' : ''}" style="width: ${percent}%;"></div>
          </div>
        </div>
      `;
    }

    this.segmentsListEl.innerHTML = html;
  }
}

window.segmentVisualizer = new SegmentVisualizer();
