const fs = require('fs');
const path = require('path');
const os = require('os');
const { EventEmitter } = require('events');

const WINDOWS_TEMP_DIR = path.join(os.tmpdir(), 'Waterfall');
const METADATA_DIR = path.join(WINDOWS_TEMP_DIR, 'metadata');
const CHUNK_TEMP_DIR = path.join(WINDOWS_TEMP_DIR, 'chunks');

class ChunkDownloader extends EventEmitter {
  constructor(task, options = {}) {
    super();
    this.task = task; // download task object
    this.options = options;
    this.singleStream = Boolean(options.singleStream || (options.segments === 1) || (task.singleStream === true) || (task.segmentsCount === 1));
    this.engineMode = this.singleStream ? 'singleStream' : (options.engineMode || task.downloadEngineMode || 'inPlace');
    this.numSegments = this.singleStream ? 1 : (options.segments || task.segmentsCount || 8);
    this.targetPath = task.savePath;
    this.partFilePath = this.targetPath + '.part';
    // Isolated in Windows Temp directory so user's download folder is never cluttered
    this.metaFilePath = path.join(METADATA_DIR, `${this.task.id}.meta.json`);
    this.legacyMetaFilePath = this.partFilePath + '.meta.json';
    this.tempDir = options.tempDir || CHUNK_TEMP_DIR;
    this.fd = null;
    this.isPaused = false;
    this.isCancelled = false;
    this.controllers = [];
    this.segmentStreams = [];
    this.activeFlushes = new Map(); // segmentId -> async flushFn
    this.lastTickTime = Date.now();
    this.lastTickBytes = 0;
  }

  setSpeedLimit(bytesPerSec) {
    this.options.speedLimitBytesPerSec = bytesPerSec;
    if (this.task) {
      this.task.speedLimitBytesPerSec = bytesPerSec;
      this.task.speedLimitEnabled = bytesPerSec > 0;
    }
  }

  saveMetaFile() {
    if (this.engineMode === 'legacyTemp') return;
    try {
      if (!fs.existsSync(METADATA_DIR)) {
        fs.mkdirSync(METADATA_DIR, { recursive: true });
      }
      const meta = {
        id: this.task.id,
        url: this.task.url,
        directUrl: this.task.directUrl,
        totalBytes: this.task.totalBytes,
        acceptRanges: this.task.acceptRanges,
        engineMode: this.engineMode,
        segmentsCount: this.task.segments ? this.task.segments.length : 1,
        segments: this.task.segments ? this.task.segments.map(s => ({
          id: s.id,
          startByte: s.startByte,
          endByte: s.endByte,
          totalBytes: s.totalBytes,
          downloadedBytes: s.downloadedBytes || 0,
          status: s.status || 'pending'
        })) : [],
        lastModified: this.task.lastModified,
        savedAt: Date.now()
      };
      fs.writeFileSync(this.metaFilePath, JSON.stringify(meta, null, 2), 'utf-8');
      if (fs.existsSync(this.legacyMetaFilePath)) {
        try { fs.unlinkSync(this.legacyMetaFilePath); } catch (_) {}
      }
    } catch (_) {}
  }

  loadMetaFile() {
    try {
      if (this.metaFilePath && fs.existsSync(this.metaFilePath)) {
        const raw = fs.readFileSync(this.metaFilePath, 'utf-8');
        return JSON.parse(raw);
      }
      if (this.legacyMetaFilePath && fs.existsSync(this.legacyMetaFilePath)) {
        const raw = fs.readFileSync(this.legacyMetaFilePath, 'utf-8');
        return JSON.parse(raw);
      }
    } catch (_) {}
    return null;
  }

  async start() {
    this.isPaused = false;
    this.isCancelled = false;

    // Ensure target directories exist
    fs.mkdirSync(path.dirname(this.targetPath), { recursive: true });
    fs.mkdirSync(this.tempDir, { recursive: true });

    // Guard: If the final target file already exists and is complete on disk, avoid redownloading!
    if (this.targetPath && fs.existsSync(this.targetPath)) {
      try {
        const targetStat = fs.statSync(this.targetPath);
        if (this.task.totalBytes > 0 && targetStat.size >= this.task.totalBytes) {
          console.log(`[Waterfall] File already fully downloaded on disk: ${this.targetPath}`);
          this.task.status = 'completed';
          this.task.downloadedBytes = this.task.totalBytes;
          this.task.speed = 0;
          this.task.eta = 0;
          this.emit('update', this.task);
          this.emit('complete', this.task);
          return;
        }
      } catch (_) {}
    }

    // If totalBytes was unknown, probe range header to discover Content-Length & Accept-Ranges
    if ((!this.task.totalBytes || this.task.totalBytes === 0) && (!this.task.segments || this.task.segments.length <= 1)) {
      try {
        const probeRes = await fetch(this.task.directUrl || this.task.url, {
          method: 'GET',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) WaterfallDL/2.0',
            'Range': 'bytes=0-0',
            ...(this.task.downloadHeaders || {})
          }
        });
        if (probeRes.ok || probeRes.status === 206) {
          const cr = probeRes.headers.get('content-range');
          if (cr) {
            const m = cr.match(/\/(\d+)$/);
            if (m) {
              this.task.totalBytes = parseInt(m[1], 10);
              this.task.acceptRanges = true;
            }
          } else if (probeRes.headers.has('content-length')) {
            const cl = parseInt(probeRes.headers.get('content-length'), 10);
            if (cl > 1) {
              this.task.totalBytes = cl;
              if (probeRes.headers.get('accept-ranges') === 'bytes') {
                this.task.acceptRanges = true;
              }
            }
          }
        }
      } catch (_) {}
    }

    const totalBytes = this.task.totalBytes;
    const acceptRanges = this.task.acceptRanges;
    const useInPlace = (this.engineMode !== 'legacyTemp');

    if (useInPlace) {
      // In-Place Direct Writing Engine (Zero-Assembly)
      const partDir = path.dirname(this.partFilePath);
      if (!fs.existsSync(partDir)) {
        try { fs.mkdirSync(partDir, { recursive: true }); } catch (_) {}
      }
      const partExists = fs.existsSync(this.partFilePath);
      this.fd = fs.openSync(this.partFilePath, partExists ? 'r+' : 'w+');

      // Pre-allocate sparse clusters if file size is known to eliminate fragmentation
      if (totalBytes > 0) {
        try { fs.ftruncateSync(this.fd, totalBytes); } catch (_) {}
      }

      // Check for persisted sidecar metadata
      const savedMeta = this.loadMetaFile();
      if (savedMeta && Array.isArray(savedMeta.segments) && savedMeta.segments.length > 0) {
        if (!this.task.segments || this.task.segments.length === 0) {
          this.task.segments = savedMeta.segments;
          if (savedMeta.totalBytes > 0 && (!this.task.totalBytes || this.task.totalBytes === 0)) {
            this.task.totalBytes = savedMeta.totalBytes;
          }
        }
      }

      const hasDummySegment = this.task.segments && this.task.segments.length === 1 && this.task.segments[0].totalBytes === 0 && totalBytes > 0;
      if (!this.task.segments || this.task.segments.length === 0 || hasDummySegment) {
        if (this.singleStream || !acceptRanges || totalBytes <= 256 * 1024) {
          // Single-stream / Whole file mode
          this.task.segments = [{
            id: 0,
            startByte: 0,
            endByte: totalBytes > 0 ? totalBytes - 1 : 0,
            totalBytes: totalBytes > 0 ? totalBytes : 0,
            downloadedBytes: this.task.downloadedBytes || 0,
            status: 'pending',
            speed: 0
          }];
        } else {
          // Multi-segment in-place
          this.task.segments = this.calculateSegments(totalBytes, this.numSegments);
        }
      } else {
        // Segments already exist (e.g. resumed from pause)
        this.task.downloadedBytes = this.task.segments.reduce((acc, s) => acc + (s.downloadedBytes || 0), 0);
      }
      this.saveMetaFile();
    } else {
      // Legacy Staged Merging Engine (Temp Files)
      const hasDummySegment = this.task.segments && this.task.segments.length === 1 && this.task.segments[0].totalBytes === 0 && totalBytes > 0;
      if (!this.task.segments || this.task.segments.length === 0 || hasDummySegment) {
        const part0 = this.getPartFilePath(0);
        let part0Size = 0;
        if (fs.existsSync(part0)) {
          try { part0Size = fs.statSync(part0).size; } catch (_) {}
        }

        if (part0Size > 0) {
          this.task.segments = [{
            id: 0,
            startByte: 0,
            endByte: totalBytes > 0 ? totalBytes - 1 : 0,
            totalBytes: totalBytes > 0 ? totalBytes : 0,
            downloadedBytes: part0Size,
            status: (totalBytes > 0 && part0Size >= totalBytes) ? 'completed' : 'pending',
            speed: 0
          }];
          this.task.downloadedBytes = part0Size;
        } else if (acceptRanges && totalBytes > 256 * 1024) {
          this.task.segments = this.calculateSegments(totalBytes, this.numSegments);
          this.task.downloadedBytes = 0;
        } else {
          this.task.segments = [{
            id: 0,
            startByte: 0,
            endByte: totalBytes > 0 ? totalBytes - 1 : 0,
            totalBytes: totalBytes > 0 ? totalBytes : 0,
            downloadedBytes: 0,
            status: 'pending',
            speed: 0
          }];
          this.task.downloadedBytes = 0;
        }
      } else {
        let totalOnDisk = 0;
        for (const seg of this.task.segments) {
          const partFile = this.getPartFilePath(seg.id);
          if (fs.existsSync(partFile)) {
            try {
              const sz = fs.statSync(partFile).size;
              seg.downloadedBytes = sz;
              if (seg.totalBytes > 0 && sz >= seg.totalBytes) {
                seg.status = 'completed';
              } else if (seg.status === 'completed' && sz < seg.totalBytes) {
                seg.status = 'pending';
              }
            } catch (_) {
              seg.downloadedBytes = 0;
            }
          } else {
            seg.downloadedBytes = 0;
            if (seg.status === 'completed') seg.status = 'pending';
          }
          totalOnDisk += (seg.downloadedBytes || 0);
        }
        this.task.downloadedBytes = totalOnDisk;
      }
    }

    this.task.status = 'downloading';
    this.emit('update', this.task);

    // Launch all unfinished segments in parallel
    const promises = this.task.segments.map(seg => this.downloadSegment(seg));

    try {
      await Promise.all(promises);

      if (this.isPaused || this.isCancelled) {
        return;
      }

      // Finalize file
      if (useInPlace) {
        // Zero-assembly instant atomic completion (0 ms)
        await this.finalizeFile();
      } else {
        // Legacy file merge
        await this.assembleFile();
      }

      this.task.status = 'completed';
      this.task.downloadedBytes = this.task.totalBytes;
      this.task.speed = 0;
      this.task.eta = 0;
      this.emit('complete', this.task);
    } catch (err) {
      if (!this.isPaused && !this.isCancelled) {
        console.error(`Task ${this.task.id} failed:`, err);
        this.task.status = 'error';
        this.task.error = err.message;
        this.emit('error', err);
      }
    } finally {
      if (this.fd !== null) {
        try { fs.closeSync(this.fd); } catch (_) {}
        this.fd = null;
      }
    }
  }

  calculateSegments(totalBytes, numSegments) {
    const segments = [];
    const chunkSize = Math.floor(totalBytes / numSegments);

    for (let i = 0; i < numSegments; i++) {
      const startByte = i * chunkSize;
      const endByte = (i === numSegments - 1) ? (totalBytes - 1) : ((i + 1) * chunkSize - 1);
      segments.push({
        id: i,
        startByte,
        endByte,
        totalBytes: endByte - startByte + 1,
        downloadedBytes: 0,
        status: 'pending',
        speed: 0
      });
    }

    return segments;
  }

  getPartFilePath(segmentId) {
    return path.join(this.tempDir, `${this.task.id}_seg_${segmentId}.part`);
  }

  async downloadSegment(segment) {
    if (segment.status === 'completed') return;

    const useInPlace = (this.engineMode !== 'legacyTemp');
    const partFile = useInPlace ? this.partFilePath : this.getPartFilePath(segment.id);

    // Check if we already have partial downloaded data on disk (legacy mode)
    if (!useInPlace && fs.existsSync(partFile)) {
      const stats = fs.statSync(partFile);
      segment.downloadedBytes = stats.size;
      if (segment.totalBytes > 0 && segment.downloadedBytes >= segment.totalBytes) {
        segment.status = 'completed';
        return;
      }
    }

    const maxRetries = 5;
    let retryAttempt = 0;

    while (retryAttempt <= maxRetries && !this.isPaused && !this.isCancelled) {
      const currentOffset = segment.startByte + (segment.downloadedBytes || 0);
      if (segment.totalBytes > 0 && currentOffset > segment.endByte) {
        segment.status = 'completed';
        return;
      }

      const controller = new AbortController();
      this.controllers.push(controller);

      const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) WaterfallDL/2.0',
        'Accept-Encoding': 'identity',
        ...(this.task.downloadHeaders || {})
      };

      if (this.task.acceptRanges && segment.totalBytes > 0) {
        headers['Range'] = `bytes=${currentOffset}-${segment.endByte}`;
      } else if (this.task.acceptRanges && segment.downloadedBytes > 0) {
        headers['Range'] = `bytes=${segment.downloadedBytes}-`;
      }

      segment.status = 'downloading';
      let legacyStream = null;

      // Coalescing buffer state for this attempt
      let pendingChunks = [];
      let pendingLength = 0;
      const FLUSH_THRESHOLD = 256 * 1024; // 256 KB chunk batching
      let segmentWriteCursor = currentOffset;

      const flushPendingBuffers = async () => {
        if (pendingLength === 0 || this.fd === null) return;
        const chunkToWrite = (pendingChunks.length === 1)
          ? pendingChunks[0]
          : Buffer.concat(pendingChunks, pendingLength);

        const writeAt = segmentWriteCursor;
        const bytesCount = pendingLength;
        segmentWriteCursor += bytesCount;
        pendingChunks = [];
        pendingLength = 0;

        await new Promise((resolve, reject) => {
          fs.write(this.fd, chunkToWrite, 0, chunkToWrite.length, writeAt, (err) => {
            if (err) return reject(err);
            resolve();
          });
        });

        // Exact verified downloaded bytes on disk
        segment.downloadedBytes = Math.max(0, segmentWriteCursor - segment.startByte);
      };

      // Register active flusher for safe asynchronous pause
      if (useInPlace) {
        this.activeFlushes.set(segment.id, flushPendingBuffers);
      }

      try {
        const res = await fetch(this.task.directUrl || this.task.url, {
          method: 'GET',
          headers,
          signal: controller.signal
        });

        // Detect expired link
        if (res.status === 401 || res.status === 403 || res.status === 404 || res.status === 410) {
          const errText = `HTTP ${res.status} (Download link expired)`;
          this.emit('linkExpired', { task: this.task, segmentId: segment.id, status: res.status });
          throw new Error(errText);
        }

        if (res.status === 416) {
          // Range Not Satisfiable: Segment may already be finished or remote size changed
          if (segment.totalBytes > 0 && segment.downloadedBytes >= segment.totalBytes) {
            segment.status = 'completed';
            return;
          }
          console.warn(`[Waterfall] Received 416 for segment ${segment.id}; resetting segment from 0`);
          segment.downloadedBytes = 0;
          segmentWriteCursor = segment.startByte;
        } else if (!res.ok) {
          throw new Error(`HTTP Error ${res.status} ${res.statusText}`);
        }

        // If server returned 200 OK instead of 206 Partial Content, Range is unsupported
        if (res.status === 200) {
          if (segment.id > 0) {
            this.task.acceptRanges = false;
            segment.status = 'completed';
            segment.totalBytes = 0;
            segment.downloadedBytes = 0;
            return;
          } else if (segment.id === 0 && segment.downloadedBytes > 0) {
            console.log(`[Waterfall] Server sent 200 OK without Range support. Restarting segment 0 from byte 0.`);
            segment.downloadedBytes = 0;
            segmentWriteCursor = 0;
          }
        }

        if (res.headers.has('last-modified')) {
          this.task.lastModified = res.headers.get('last-modified');
        }

        // If single stream and totalBytes was unknown, learn it now
        if (this.task.totalBytes === 0 && res.headers.has('content-length')) {
          this.task.totalBytes = parseInt(res.headers.get('content-length'), 10);
          segment.totalBytes = this.task.totalBytes;
          segment.endByte = this.task.totalBytes - 1;
        }

        if (!useInPlace) {
          const streamBuffer = this.options.bufferSize || (1024 * 1024);
          legacyStream = fs.createWriteStream(partFile, {
            flags: (res.status === 206 && segment.downloadedBytes > 0) ? 'a' : 'w',
            highWaterMark: streamBuffer
          });
          this.segmentStreams.push(legacyStream);
        }

        const reader = res.body.getReader();
        let lastSegTime = Date.now();
        let lastSegBytes = segment.downloadedBytes;
        const speedLimitPerSec = this.options.speedLimitBytesPerSec || 0;

        while (true) {
          if (this.isPaused || this.isCancelled) break;

          const { done, value } = await reader.read();
          if (done) break;

          if (value && value.length > 0) {
            let chunkBuf = Buffer.isBuffer(value) ? value : Buffer.from(value);
            if (segment.totalBytes > 0) {
              const needed = segment.totalBytes - segment.downloadedBytes;
              if (needed <= 0) break;
              if (chunkBuf.length > needed) {
                chunkBuf = chunkBuf.subarray(0, needed);
              }
            }

            if (useInPlace && this.fd !== null) {
              pendingChunks.push(chunkBuf);
              pendingLength += chunkBuf.length;

              if (pendingLength >= FLUSH_THRESHOLD) {
                await flushPendingBuffers();
              }
            } else if (legacyStream) {
              legacyStream.write(chunkBuf);
              segment.downloadedBytes += chunkBuf.length;
            }

            // Sync overall downloaded bytes accurately
            this.task.downloadedBytes = this.task.segments.reduce((acc, s) => acc + (s.downloadedBytes || 0), 0);

            // Bandwidth / Speed Limiter Throttling (dynamic real-time check)
            const activeLimit = (this.task && this.task.speedLimitEnabled && this.task.speedLimitBytesPerSec > 0)
              ? this.task.speedLimitBytesPerSec
              : (this.options.speedLimitBytesPerSec || 0);

            if (activeLimit > 0) {
              const numSegs = Math.max(1, this.task.segments ? this.task.segments.length : 1);
              const segCap = Math.max(8192, Math.floor(activeLimit / numSegs));
              const sleepMs = (chunkBuf.length / segCap) * 1000;
              if (sleepMs > 5) {
                await new Promise(r => setTimeout(r, Math.min(150, Math.floor(sleepMs))));
              }
            }

            if (segment.totalBytes > 0 && segment.downloadedBytes >= segment.totalBytes) {
              break;
            }

            // Calculate speed per segment and sync exact global bytes
            const now = Date.now();
            const timeDiff = (now - lastSegTime) / 1000;
            if (timeDiff >= 0.3) {
              const bytesDiff = segment.downloadedBytes - lastSegBytes;
              segment.speed = Math.floor(bytesDiff / timeDiff);
              lastSegTime = now;
              lastSegBytes = segment.downloadedBytes;
              this.task.downloadedBytes = this.task.segments.reduce((acc, s) => acc + s.downloadedBytes, 0);
            }
          }
        }

        // Flush any remaining accumulated bytes before completing segment
        if (useInPlace && pendingLength > 0) {
          await flushPendingBuffers();
        }

        if (legacyStream) legacyStream.end();

        if (this.isPaused || this.isCancelled) {
          segment.status = this.isCancelled ? 'cancelled' : 'paused';
          segment.speed = 0;
          return;
        }

        segment.status = 'completed';
        segment.speed = 0;
        this.task.downloadedBytes = this.task.segments.reduce((acc, s) => acc + s.downloadedBytes, 0);
        this.saveMetaFile();
        return; // Success! Exit retry loop cleanly.

      } catch (err) {
        if (useInPlace && pendingLength > 0 && this.fd !== null) {
          try { await flushPendingBuffers(); } catch (_) {}
        }
        if (legacyStream) legacyStream.end();

        if (controller.signal.aborted || this.isPaused) {
          segment.status = 'paused';
          segment.speed = 0;
          return;
        }

        // Check if error is retryable network drop
        const isNetworkDrop = /timeout|econnreset|etimedout|epipe|network|socket hang up|fetch failed/i.test(err.message || '');
        if (isNetworkDrop && retryAttempt < maxRetries && !this.isPaused && !this.isCancelled) {
          retryAttempt++;
          const backoffDelay = Math.min(5000, 1000 * retryAttempt);
          console.warn(`[Waterfall] Segment ${segment.id} socket dropped (${err.message}). Auto-reconnecting in ${backoffDelay}ms (Attempt ${retryAttempt}/${maxRetries})...`);
          await new Promise(r => setTimeout(r, backoffDelay));
          continue; // Re-attempt loop with updated offset
        }

        segment.status = 'error';
        segment.speed = 0;
        throw err;
      } finally {
        if (useInPlace) {
          this.activeFlushes.delete(segment.id);
        }
      }
    }
  }

  async finalizeFile() {
    this.task.status = 'completing';
    this.emit('update', this.task);

    if (this.fd !== null) {
      try { fs.closeSync(this.fd); } catch (_) {}
      this.fd = null;
    }

    // Atomic instant rename - zero disk copy!
    if (fs.existsSync(this.partFilePath)) {
      if (fs.existsSync(this.targetPath)) {
        try { fs.unlinkSync(this.targetPath); } catch (_) {}
      }
      fs.renameSync(this.partFilePath, this.targetPath);
    }

    // Clean up sidecar meta file
    try {
      if (fs.existsSync(this.metaFilePath)) fs.unlinkSync(this.metaFilePath);
    } catch (_) {}
    try {
      if (this.legacyMetaFilePath && fs.existsSync(this.legacyMetaFilePath)) fs.unlinkSync(this.legacyMetaFilePath);
    } catch (_) {}

    // Preserve remote server Last-Modified timestamp
    if (this.task.lastModified) {
      try {
        const mdate = new Date(this.task.lastModified);
        if (!isNaN(mdate.getTime())) {
          fs.utimesSync(this.targetPath, mdate, mdate);
        }
      } catch (_) {}
    }
  }

  async assembleFile() {
    this.task.status = 'assembling';
    this.emit('update', this.task);

    const streamBuffer = this.options.bufferSize || (1024 * 1024);
    const outStream = fs.createWriteStream(this.targetPath, {
      flags: 'w',
      highWaterMark: streamBuffer
    });

    for (const seg of this.task.segments) {
      const partFile = this.getPartFilePath(seg.id);
      if (fs.existsSync(partFile)) {
        await new Promise((resolve, reject) => {
          const inStream = fs.createReadStream(partFile, { highWaterMark: streamBuffer });
          inStream.on('error', reject);
          inStream.on('end', async () => {
            try { await fs.promises.unlink(partFile); } catch (_) {}
            resolve();
          });
          inStream.pipe(outStream, { end: false });
        });
      }
    }

    await new Promise(resolve => outStream.end(resolve));

    if (this.task.lastModified) {
      try {
        const mdate = new Date(this.task.lastModified);
        if (!isNaN(mdate.getTime())) {
          fs.utimesSync(this.targetPath, mdate, mdate);
        }
      } catch (_) {}
    }
  }

  async pause() {
    this.isPaused = true;
    this.task.status = 'paused';
    this.task.speed = 0;
    this.task.eta = 0;

    // 1. Abort network controllers first so streams stop receiving
    for (const ctrl of this.controllers) {
      try { ctrl.abort(); } catch (_) {}
    }
    this.controllers = [];

    // 2. Safely flush all pending buffers to disk before closing descriptor
    const flushPromises = [];
    for (const flushFn of this.activeFlushes.values()) {
      if (typeof flushFn === 'function') {
        flushPromises.push(flushFn().catch(() => {}));
      }
    }
    if (flushPromises.length > 0) {
      await Promise.all(flushPromises);
    }

    // 3. Persist exact segment state to sidecar meta file
    this.saveMetaFile();

    // 4. Safely close file descriptor
    if (this.fd !== null) {
      try { fs.closeSync(this.fd); } catch (_) {}
      this.fd = null;
    }

    // 5. Update segment statuses
    for (const seg of (this.task.segments || [])) {
      if (seg.status === 'downloading') {
        seg.status = 'paused';
        seg.speed = 0;
      }
    }

    this.emit('update', this.task);
  }

  cancel() {
    this.isCancelled = true;
    this.pause().catch(() => {});

    if (this.fd !== null) {
      try { fs.closeSync(this.fd); } catch (_) {}
      this.fd = null;
    }

    try {
      if (fs.existsSync(this.partFilePath)) fs.unlinkSync(this.partFilePath);
    } catch (_) {}

    try {
      if (fs.existsSync(this.metaFilePath)) fs.unlinkSync(this.metaFilePath);
    } catch (_) {}
    try {
      if (this.legacyMetaFilePath && fs.existsSync(this.legacyMetaFilePath)) fs.unlinkSync(this.legacyMetaFilePath);
    } catch (_) {}

    this.cleanupParts();
    try {
      if (fs.existsSync(this.targetPath)) fs.unlinkSync(this.targetPath);
    } catch (_) {}
  }

  cleanupParts() {
    if (!this.task.segments) return;
    for (const seg of this.task.segments) {
      const partFile = this.getPartFilePath(seg.id);
      try {
        if (fs.existsSync(partFile)) fs.unlinkSync(partFile);
      } catch (_) {}
    }
  }
}

module.exports = ChunkDownloader;
