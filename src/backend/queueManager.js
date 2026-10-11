const { EventEmitter } = require('events');
const { getConfig } = require('./config');

class QueueManager extends EventEmitter {
  constructor() {
    super();
    this.isPaused = false;
    this.retryTimers = new Map(); // taskId -> timeout
  }

  getHostKey(url) {
    if (!url) return 'generic';
    try {
      const u = new URL(url);
      return u.hostname.toLowerCase();
    } catch (_) {
      return 'generic';
    }
  }

  /**
   * Sorts queued tasks by priority (high > normal > low),
   * multipart sequential order, and queue position.
   */
  getSortedQueuedTasks(tasksMap, queueOrder = []) {
    const queuedTasks = Array.from(tasksMap.values()).filter(t => t.status === 'queued');
    if (queuedTasks.length === 0) return [];

    const orderIndexMap = new Map();
    queueOrder.forEach((id, idx) => orderIndexMap.set(id, idx));

    const priorityWeight = {
      'high': 3,
      'normal': 2,
      'low': 1
    };

    return queuedTasks.sort((a, b) => {
      // 1. Priority level
      const pA = priorityWeight[a.priority] || 2;
      const pB = priorityWeight[b.priority] || 2;
      if (pA !== pB) return pB - pA;

      // 2. Multipart group sequencing (keep parts of same group contiguous and ordered by partNumber)
      if (a.multipart && b.multipart && a.multipart.groupKey && a.multipart.groupKey === b.multipart.groupKey) {
        return (a.multipart.partNumber || 1) - (b.multipart.partNumber || 1);
      }

      // 3. User-defined queue order
      const idxA = orderIndexMap.has(a.id) ? orderIndexMap.get(a.id) : 999999;
      const idxB = orderIndexMap.has(b.id) ? orderIndexMap.get(b.id) : 999999;
      if (idxA !== idxB) return idxA - idxB;

      // 4. Added timestamp ascending
      return (a.addedAt || 0) - (b.addedAt || 0);
    });
  }

  /**
   * Evaluates the next tasks to download respecting max concurrent downloads
   * and per-host connection limits.
   */
  scheduleNext(tasksMap, activeDownloaders, queueOrder = []) {
    if (this.isPaused) return [];

    const config = getConfig();
    const maxActive = Math.max(1, config.maxConcurrentDownloads || 3);
    const maxPerHost = Math.max(1, config.maxConcurrentPerHost || 2);

    let currentActive = 0;
    const activeHostsCount = new Map();

    for (const [id] of activeDownloaders.entries()) {
      const task = tasksMap.get(id);
      if (task && (task.status === 'downloading' || task.status === 'assembling')) {
        currentActive++;
        const host = this.getHostKey(task.directUrl || task.url);
        activeHostsCount.set(host, (activeHostsCount.get(host) || 0) + 1);
      }
    }

    if (currentActive >= maxActive) {
      return [];
    }

    const availableSlots = maxActive - currentActive;
    const sortedQueued = this.getSortedQueuedTasks(tasksMap, queueOrder);
    const toStart = [];

    for (const task of sortedQueued) {
      if (toStart.length >= availableSlots) break;

      const host = this.getHostKey(task.directUrl || task.url);
      const hostCurrent = activeHostsCount.get(host) || 0;

      // Skip if this host already reached its limit (allows other hosts in queue to download!)
      if (hostCurrent >= maxPerHost) {
        continue;
      }

      toStart.push(task);
      activeHostsCount.set(host, hostCurrent + 1);
    }

    return toStart;
  }

  /**
   * Schedules an automatic retry with exponential backoff on transient network failures.
   */
  scheduleAutoRetry(task, errorMsg, onRetryCallback) {
    if (!task) return false;

    const config = getConfig();
    const maxRetries = task.maxRetries || config.maxRetries || 5;
    const currentRetries = task.retryCount || 0;

    // Clear any existing retry timer for this task
    this.clearRetryTimer(task.id);

    if (currentRetries >= maxRetries) {
      task.status = 'error';
      task.error = `Download failed after ${maxRetries} retry attempts: ${errorMsg}`;
      task.retrying = false;
      task.retryInSec = 0;
      return false;
    }

    const nextRetry = currentRetries + 1;
    task.retryCount = nextRetry;
    task.retrying = true;

    const baseDelay = config.retryDelaySec || 3;
    const delaySec = Math.min(60, baseDelay * Math.pow(1.5, nextRetry - 1));
    task.retryInSec = Math.round(delaySec);
    task.status = 'retrying';
    task.error = `Connection lost: ${errorMsg}. Retrying (${nextRetry}/${maxRetries}) in ${task.retryInSec}s...`;

    console.log(`[Waterfall Queue] Task "${task.name}" failed (${errorMsg}). Scheduling retry ${nextRetry}/${maxRetries} in ${task.retryInSec}s`);

    const timer = setTimeout(() => {
      this.retryTimers.delete(task.id);
      task.retrying = false;
      task.retryInSec = 0;
      task.status = 'queued';
      if (typeof onRetryCallback === 'function') {
        onRetryCallback(task);
      }
    }, Math.round(delaySec * 1000));

    this.retryTimers.set(task.id, timer);
    return true;
  }

  clearRetryTimer(taskId) {
    if (this.retryTimers.has(taskId)) {
      clearTimeout(this.retryTimers.get(taskId));
      this.retryTimers.delete(taskId);
    }
  }

  pauseQueue() {
    this.isPaused = true;
    this.emit('queuePaused');
  }

  resumeQueue() {
    this.isPaused = false;
    this.emit('queueResumed');
  }
}

const queueManager = new QueueManager();
module.exports = queueManager;
