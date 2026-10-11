/**
 * IDM Iconic Multi-Segment Download Inspector & File Allocation Block Matrix
 */
class SegmentVisualizer {
  constructor() {
    this.modal = document.getElementById('modal-segment-inspector');
    this.currentTaskId = null;

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

    // Modal Close Buttons (Header 'x' and Footer 'Close' button)
    if (this.modal) {
      this.modal.querySelectorAll('.modal-close-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          this.close();
        });
      });

      // Backdrop overlay click to close
      this.modal.addEventListener('click', (e) => {
        if (e.target === this.modal) {
          this.close();
        }
      });
    }

    // Escape key listener to close
    document.addEventListener('keydown', (e) => {
      if ((e.key === 'Escape' || e.key === 'Esc') && this.isOpen()) {
        this.close();
      }
    });
  }

  open(taskId) {
    this.currentTaskId = taskId;
    this.update();
    if (this.modal) this.modal.classList.add('open');
  }

  close() {
    this.currentTaskId = null;
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

    const now = new Date();
    const target = new Date(Date.now() + seconds * 1000);

    let hours = target.getHours();
    const minutes = target.getMinutes();
    const ampm = hours >= 12 ? 'pm' : 'am';
    hours = hours % 12;
    hours = hours ? hours : 12;
    const timeStr = (minutes === 0)
      ? `${hours} ${ampm}`
      : `${hours}:${minutes < 10 ? '0' + minutes : minutes} ${ampm}`;

    const nowMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const targetMidnight = new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime();
    const dayDiff = Math.round((targetMidnight - nowMidnight) / (1000 * 60 * 60 * 24));

    const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const weekday = weekdays[target.getDay()];

    if (dayDiff === 0) return `Today at ${timeStr}`;
    if (dayDiff === 1) return `Tomorrow at ${timeStr}`;
    if (dayDiff === 2) return `In 2 days (${weekday}) at ${timeStr}`;
    if (dayDiff >= 3 && dayDiff <= 7) return `In ${dayDiff} days (${weekday}) at ${timeStr}`;

    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `In ${dayDiff} days (${months[target.getMonth()]} ${target.getDate()}) at ${timeStr}`;
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

    // Render connection strips
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
      // Single connection or yt-dlp stream
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
