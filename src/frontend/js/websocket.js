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
    this.connect();
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
        const failedTask = window.appState.tasks.find(t => t.id === msg.task.id);
        if (failedTask) {
          Object.assign(failedTask, msg.task);
          if (msg.error) failedTask.error = msg.error;
        }
        window.dispatchEvent(new CustomEvent('state:change'));
        window.dispatchEvent(new CustomEvent('task:failed', { detail: { task: msg.task, error: msg.error } }));
        break;

      case 'taskDeleted':
        window.appState.tasks = window.appState.tasks.filter(t => t.id !== msg.id);
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

      case 'configUpdated':
        window.appState.config = msg.config || {};
        window.dispatchEvent(new CustomEvent('state:config'));
        break;
    }
  }
}

window.wsClient = new WSClient();
