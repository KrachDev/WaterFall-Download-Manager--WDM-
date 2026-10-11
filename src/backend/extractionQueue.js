const { EventEmitter } = require('events');
const path = require('path');
const fs = require('fs');
const { unpackArchive, isArchiveFile } = require('./archiveUnpacker');
const { getConfig, saveConfig } = require('./config');

class ExtractionQueue extends EventEmitter {
  constructor() {
    super();
    this.jobs = new Map(); // id -> job
    this.activeJobs = new Map(); // id -> job
    this._isProcessing = false;
  }

  getMaxConcurrent() {
    const cfg = getConfig();
    return Math.max(1, cfg.maxConcurrentExtractions || 1);
  }

  /**
   * Enqueues an archive extraction job.
   *
   * @param {object} options
   *   - taskId: string
   *   - groupKey: string (optional, for multipart groups)
   *   - archivePath: string
   *   - outDir: string (optional)
   *   - password: string (optional)
   *   - deleteArchiveAfter: boolean
   *   - allPartPaths: string[] (optional multipart parts)
   *   - onProgress: function (optional)
   */
  enqueue(options) {
    if (!options || !options.archivePath) {
      throw new Error('archivePath is required for extraction');
    }

    const id = options.id || options.taskId || options.groupKey || path.basename(options.archivePath);

    // If job is already pending or extracting, return existing
    const existing = this.jobs.get(id);
    if (existing) {
      if (existing.status === 'extract_queued' || existing.status === 'extracting') {
        return existing;
      }
      if (existing.status === 'extract_password_required' && options.password) {
        existing.password = options.password;
        existing.status = 'extract_queued';
        this.emit('jobUpdated', existing);
        this.processQueue();
        return existing;
      }
    }

    const cfg = getConfig();
    const configDelete = cfg.deleteArchiveAfterExtract === true;
    const deleteAfter = options.deleteArchiveAfter !== undefined ? Boolean(options.deleteArchiveAfter) : configDelete;

    const job = {
      id,
      taskId: options.taskId || null,
      groupKey: options.groupKey || null,
      archivePath: options.archivePath,
      name: path.basename(options.archivePath),
      outDir: options.outDir || null,
      password: options.password || '',
      deleteArchiveAfter: deleteAfter,
      allPartPaths: Array.isArray(options.allPartPaths) ? options.allPartPaths : [options.archivePath],
      status: 'extract_queued',
      addedAt: Date.now(),
      startedAt: null,
      completedAt: null,
      durationMs: 0,
      error: null,
      passwordRequired: false
    };

    this.jobs.set(id, job);
    this.emit('jobEnqueued', job);
    this.emit('jobUpdated', job);

    // Run queue in next tick
    setImmediate(() => this.processQueue());
    return job;
  }

  processQueue() {
    if (this._isProcessing) return;
    this._isProcessing = true;

    try {
      const maxConcurrent = this.getMaxConcurrent();

      while (this.activeJobs.size < maxConcurrent) {
        // Find next queued job in FIFO order
        const nextJob = Array.from(this.jobs.values()).find(j => j.status === 'extract_queued');
        if (!nextJob) break;

        this.startExtraction(nextJob);
      }
    } finally {
      this._isProcessing = false;
    }
  }

  async startExtraction(job) {
    this.activeJobs.set(job.id, job);
    job.status = 'extracting';
    job.startedAt = Date.now();
    job.error = null;
    job.passwordRequired = false;

    this.emit('jobStarted', job);
    this.emit('jobUpdated', job);

    console.log(`[Waterfall Unpacker Queue] Starting extraction for "${job.name}" (Active extractions: ${this.activeJobs.size}/${this.getMaxConcurrent()})`);

    const cfg = getConfig();
    const passwordsToTry = [];
    if (job.password) passwordsToTry.push(job.password);
    if (Array.isArray(cfg.archivePasswords)) {
      for (const p of cfg.archivePasswords) {
        if (p && !passwordsToTry.includes(p)) passwordsToTry.push(p);
      }
    }
    // Try empty password as baseline
    if (!passwordsToTry.includes('')) passwordsToTry.push('');

    let finalResult = null;
    let successfulPassword = null;

    for (const pwd of passwordsToTry) {
      try {
        finalResult = await unpackArchive(job.archivePath, {
          outDir: job.outDir,
          password: pwd,
          deleteArchiveAfter: job.deleteArchiveAfter,
          allPartPaths: job.allPartPaths
        });

        if (finalResult.success) {
          successfulPassword = pwd;
          break;
        }

        // If not a password error, don't keep retrying other passwords
        if (!finalResult.passwordRequired) {
          break;
        }
      } catch (err) {
        finalResult = {
          success: false,
          error: err.message,
          passwordRequired: Boolean(err.isPasswordRequired)
        };
        if (!finalResult.passwordRequired) break;
      }
    }

    this.activeJobs.delete(job.id);
    job.completedAt = Date.now();
    job.durationMs = job.completedAt - job.startedAt;

    if (finalResult && finalResult.success) {
      job.status = 'extracted';
      job.outDir = finalResult.outDir;
      job.password = successfulPassword || job.password;
      console.log(`[Waterfall Unpacker Queue] Successfully extracted "${job.name}" in ${(job.durationMs / 1000).toFixed(1)}s -> ${finalResult.outDir}`);
      this.emit('jobCompleted', job);
      this.emit('jobUpdated', job);
    } else if (finalResult && finalResult.passwordRequired) {
      job.status = 'extract_password_required';
      job.passwordRequired = true;
      job.error = 'Password required or incorrect.';
      console.warn(`[Waterfall Unpacker Queue] Password required for "${job.name}"`);
      this.emit('passwordRequired', job);
      this.emit('jobUpdated', job);
    } else {
      job.status = 'extract_failed';
      job.error = (finalResult && finalResult.error) ? finalResult.error : 'Extraction failed';
      console.error(`[Waterfall Unpacker Queue] Failed to extract "${job.name}":`, job.error);
      this.emit('jobFailed', job);
      this.emit('jobUpdated', job);
    }

    // Continue processing remaining jobs in queue
    setImmediate(() => this.processQueue());
  }

  submitPassword(jobIdOrTaskId, password, remember = false) {
    if (!jobIdOrTaskId) return null;
    const cleanPwd = String(password || '').trim();

    let job = this.jobs.get(jobIdOrTaskId);
    if (!job) {
      job = Array.from(this.jobs.values()).find(j => j.taskId === jobIdOrTaskId || j.groupKey === jobIdOrTaskId);
    }

    if (!job) return null;

    job.password = cleanPwd;
    job.status = 'extract_queued';
    job.passwordRequired = false;
    job.error = null;

    if (remember && cleanPwd) {
      const cfg = getConfig();
      const existingPwds = Array.isArray(cfg.archivePasswords) ? [...cfg.archivePasswords] : [];
      if (!existingPwds.includes(cleanPwd)) {
        existingPwds.push(cleanPwd);
        saveConfig({ archivePasswords: existingPwds });
      }
    }

    this.emit('jobUpdated', job);
    this.processQueue();
    return job;
  }

  cancel(jobIdOrTaskId) {
    let job = this.jobs.get(jobIdOrTaskId);
    if (!job) {
      job = Array.from(this.jobs.values()).find(j => j.taskId === jobIdOrTaskId || j.groupKey === jobIdOrTaskId);
    }
    if (!job) return false;

    if (this.activeJobs.has(job.id)) {
      this.activeJobs.delete(job.id);
    }
    job.status = 'extract_canceled';
    this.jobs.delete(job.id);
    this.emit('jobUpdated', job);
    this.processQueue();
    return true;
  }

  getJob(jobIdOrTaskId) {
    if (!jobIdOrTaskId) return null;
    let job = this.jobs.get(jobIdOrTaskId);
    if (!job) {
      job = Array.from(this.jobs.values()).find(j => j.taskId === jobIdOrTaskId || j.groupKey === jobIdOrTaskId);
    }
    return job || null;
  }

  getAllJobs() {
    return Array.from(this.jobs.values());
  }

  getActiveCount() {
    return this.activeJobs.size;
  }
}

const extractionQueue = new ExtractionQueue();
module.exports = extractionQueue;
