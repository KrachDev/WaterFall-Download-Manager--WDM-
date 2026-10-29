/**
 * Real-time WebSocket connection bridge
 */
window.appState = {
  tasks: [],
  staged: [],
  config: {},
  globalSpeed: 0,
  activeFilter: 'all',
  activeCategory: null,
  activeView: 'downloads', // 'downloads' | 'grabber'
  searchQuery: ''
};

class WSClient {
  constructor() {
    this.ws = null;
    this.reconnectTimer = null;
    this.pollTimer = null;
    this.initFromApi();
    this.startPollingFallback();
    this.connect();
  }

  async initFromApi() {
    try {
      const res = await fetch('/api/init');
      if (res.ok) {
        const data = await res.json();
        this.handleMessage({ type: 'init', ...data });
      }
    } catch (_) {}
  }

  startPollingFallback() {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(async () => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
      try {
        const res = await fetch('/api/downloads');
        if (res.ok) {
          const tasks = await res.json();
          const prevTasks = window.appState.tasks || [];

          let structureChanged = false;
          if (prevTasks.length !== tasks.length) {
            structureChanged = true;
          }

          // Detect new tasks and state changes during polling fallback
          if (prevTasks.length > 0 && Array.isArray(tasks)) {
            for (const t of tasks) {
              const prev = prevTasks.find(p => String(p.id) === String(t.id));
              if (!prev) {
                structureChanged = true;
                window.dispatchEvent(new CustomEvent('task:created', { detail: t }));
              } else {
                if (prev.status !== t.status) {
                  structureChanged = true;
                }
                if (prev.status !== 'completed' && t.status === 'completed') {
                  window.dispatchEvent(new CustomEvent('task:completed', { detail: t }));
                } else if (prev.status !== 'failed' && prev.status !== 'error' && (t.status === 'failed' || t.status === 'error')) {
                  if (t.status === 'paused' || t.error === 'Download paused' || (t.statusText && t.statusText.toLowerCase() === 'paused')) {
                    // Pausing is not a task failure
                  } else {
                    window.dispatchEvent(new CustomEvent('task:failed', { detail: t }));
                  }
                }
              }
            }
          } else if (prevTasks.length === 0 && tasks.length > 0) {
            structureChanged = true;
          }

          window.appState.tasks = tasks;
          let globalSpeed = 0;
          for (const t of tasks) {
            if (t.speed_bps) globalSpeed += t.speed_bps;
            else if (t.speed) globalSpeed += t.speed;
          }
          window.appState.globalSpeed = globalSpeed;
          this.handleMessage({ type: 'tick', tasks, globalSpeed });

          // ONLY trigger full DOM destruction (renderDownloads) if list structure or task statuses changed!
          if (structureChanged) {
            window.dispatchEvent(new CustomEvent('state:change'));
          }
        }
      } catch (_) {}
    }, 400);
  }

  connect() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log('⚡ Connected to WaterfallDL engine via WebSocket');
      if (this.reconnectTimer) {
        clearInterval(this.reconnectTimer);
        this.reconnectTimer = null;
      }
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.handleMessage(data);
      } catch (e) {
        console.error('Failed to parse WS message:', e);
      }
    };

    this.ws.onclose = () => {
      console.warn('WebSocket disconnected, reconnecting in 2s...');
      if (!this.reconnectTimer) {
        this.reconnectTimer = setTimeout(() => this.connect(), 2000);
      }
    };

    this.ws.onerror = (err) => {
      console.error('WebSocket error:', err);
    };
  }

  handleMessage(msg) {
    switch (msg.type) {
      case 'init':
        window.appState.tasks = msg.tasks || [];
        window.appState.staged = msg.staged || [];
        window.appState.config = msg.config || {};
        window.appState.globalSpeed = msg.globalSpeed || 0;
        window.dispatchEvent(new CustomEvent('state:init'));
        break;

      case 'tick':
        window.appState.globalSpeed = msg.globalSpeed || 0;
        
        // Update task dynamic metrics
        if (msg.tasks) {
          for (const update of msg.tasks) {
            const task = window.appState.tasks.find(t => t.id === update.id);
            if (task) {
              task.downloadedBytes = update.downloadedBytes;
              task.totalBytes = update.totalBytes;
              task.speed = update.speed;
              task.eta = update.eta;
              task.status = update.status;
              task.segments = update.segments;
              if (update.extractStatus !== undefined) task.extractStatus = update.extractStatus;
              if (update.extractProgress !== undefined) task.extractProgress = update.extractProgress;
              if (update.extractedPath !== undefined) task.extractedPath = update.extractedPath;
            }
          }
        }

        // Forward to speed graph
        if (window.speedGraph) {
          window.speedGraph.update(msg.globalSpeed);
        }

        // Update IDM chunk inspector if open
        if (window.segmentVisualizer && window.segmentVisualizer.isOpen()) {
          window.segmentVisualizer.update();
        }

        window.dispatchEvent(new CustomEvent('state:tick', { detail: msg }));
        break;

      case 'taskCreated':
        window.appState.tasks.unshift(msg.task);
        window.dispatchEvent(new CustomEvent('state:change'));
        window.dispatchEvent(new CustomEvent('task:created', { detail: msg.task }));
        break;

      case 'taskUpdated':
        const idx = window.appState.tasks.findIndex(t => t.id === msg.task.id);
        if (idx !== -1) {
          window.appState.tasks[idx] = msg.task;
        } else {
          window.appState.tasks.push(msg.task);
        }
        window.dispatchEvent(new CustomEvent('state:change'));
        break;

      case 'taskCompleted':
        const completedTask = window.appState.tasks.find(t => t.id === msg.task.id);
        if (completedTask) {
          Object.assign(completedTask, msg.task);
        }
        window.dispatchEvent(new CustomEvent('state:change'));
        window.dispatchEvent(new CustomEvent('task:completed', { detail: msg.task }));
        break;

      case 'taskFailed':
        if (msg.error === 'Download paused' || (msg.task && msg.task.status === 'paused')) {
          break;
        }
        const failedTask = window.appState.tasks.find(t => t.id === msg.task.id);
        if (failedTask) {
          Object.assign(failedTask, msg.task);
          if (msg.error) failedTask.error = msg.error;
        }
        window.dispatchEvent(new CustomEvent('state:change'));
        window.dispatchEvent(new CustomEvent('task:failed', { detail: { task: msg.task, error: msg.error } }));
        break;

      case 'taskDeleted':
        window.appState.tasks = window.appState.tasks.filter(t => t.id !== msg.id && String(t.id) !== String(msg.id));
        window.dispatchEvent(new CustomEvent('state:change'));
        break;

      case 'showDownloadConfirmation':
        window.dispatchEvent(new CustomEvent('download:confirm', { detail: msg.probeData }));
        break;

      case 'batchUpdated':
        fetch('/api/downloads')
          .then(r => r.json())
          .then(tasks => {
            window.appState.tasks = tasks;
            window.dispatchEvent(new CustomEvent('state:change'));
          });
        break;

      case 'linkgrabberUpdated':
        window.appState.staged = msg.staged || [];
        window.dispatchEvent(new CustomEvent('state:grabber'));
        break;

      case 'crawler_progress':
        if (msg.staged) {
          window.appState.staged = msg.staged;
          window.dispatchEvent(new CustomEvent('state:grabber'));
        }
        window.dispatchEvent(new CustomEvent('crawler:progress', { detail: msg.progress }));
        break;

      case 'extractPasswordRequired':
        window.dispatchEvent(new CustomEvent('extract:password-required', { detail: msg.data }));
        break;

      case 'queueReordered':
        if (msg.queueOrder && Array.isArray(msg.queueOrder)) {
          const orderMap = new Map();
          msg.queueOrder.forEach((id, idx) => orderMap.set(id, idx));
          window.appState.tasks.sort((a, b) => {
            const idxA = orderMap.has(a.id) ? orderMap.get(a.id) : 999999;
            const idxB = orderMap.has(b.id) ? orderMap.get(b.id) : 999999;
            return idxA - idxB;
          });
          window.dispatchEvent(new CustomEvent('state:change'));
        }
        break;

      case 'extractionJobUpdated':
        window.dispatchEvent(new CustomEvent('extract:job-updated', { detail: msg.job }));
        break;

      case 'configUpdated':
        window.appState.config = msg.config || {};
        window.dispatchEvent(new CustomEvent('state:config'));
        break;
    }
  }
}

window.wsClient = new WSClient();
