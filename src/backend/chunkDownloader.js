const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

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
    this.tempDir = options.tempDir || path.dirname(task.savePath);
    this.fd = null;
    this.isPaused = false;
    this.isCancelled = false;
    this.controllers = [];
    this.segmentStreams = [];
    this.lastTickTime = Date.now();
    this.lastTickBytes = 0;
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

    // Check if we already have partial downloaded data on disk
    if (!useInPlace && fs.existsSync(partFile)) {
      const stats = fs.statSync(partFile);
      segment.downloadedBytes = stats.size;
      if (segment.totalBytes > 0 && segment.downloadedBytes >= segment.totalBytes) {
        segment.status = 'completed';
        return;
      }
    }

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

    try {
      const res = await fetch(this.task.directUrl || this.task.url, {
        method: 'GET',
        headers,
        signal: controller.signal
      });

      if (res.status === 416) {
        if (segment.totalBytes > 0 && segment.downloadedBytes >= segment.totalBytes) {
          segment.status = 'completed';
          return;
        }
        console.warn(`[Waterfall] Received 416 for segment ${segment.id}; resetting segment from 0`);
        segment.downloadedBytes = 0;
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

      // High-performance coalescing buffer (eliminates synchronous event loop blocking)
      let pendingChunks = [];
      let pendingLength = 0;
      const FLUSH_THRESHOLD = 256 * 1024; // 256 KB chunk batching
      let segmentWriteCursor = segment.startByte + (segment.downloadedBytes || 0);

      const flushPendingBuffers = async () => {
        if (pendingLength === 0 || this.fd === null) return;
        const chunkToWrite = (pendingChunks.length === 1)
          ? pendingChunks[0]
          : Buffer.concat(pendingChunks, pendingLength);

        const writeAt = segmentWriteCursor;
        segmentWriteCursor += pendingLength;
        pendingChunks = [];
        pendingLength = 0;

        await new Promise((resolve, reject) => {
          fs.write(this.fd, chunkToWrite, 0, chunkToWrite.length, writeAt, (err) => {
            if (err) return reject(err);
            resolve();
          });
        });
      };

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
          }

          segment.downloadedBytes += chunkBuf.length;
          this.task.downloadedBytes = this.task.segments.reduce((acc, s) => acc + (s.downloadedBytes || 0), 0);

          // Bandwidth / Speed Limiter Throttling
          if (speedLimitPerSec > 0) {
            const numSegs = Math.max(1, this.task.segments ? this.task.segments.length : 1);
            const segCap = Math.max(8192, Math.floor(speedLimitPerSec / numSegs));
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

      if (!this.isPaused && !this.isCancelled) {
        segment.status = 'completed';
        segment.speed = 0;
        this.task.downloadedBytes = this.task.segments.reduce((acc, s) => acc + s.downloadedBytes, 0);
      }
    } catch (err) {
      if (legacyStream) legacyStream.end();
      if (controller.signal.aborted || this.isPaused) {
        segment.status = 'paused';
        segment.speed = 0;
        return;
      }
      segment.status = 'error';
      segment.speed = 0;
      throw err;
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

  pause() {
    this.isPaused = true;
    this.task.status = 'paused';
    this.task.speed = 0;
    this.task.eta = 0;

    if (this.fd !== null) {
      try { fs.closeSync(this.fd); } catch (_) {}
      this.fd = null;
    }

    for (const seg of (this.task.segments || [])) {
      if (seg.status === 'downloading') {
        seg.status = 'paused';
        seg.speed = 0;
      }
    }

    for (const ctrl of this.controllers) {
      try { ctrl.abort(); } catch (_) {}
    }
    this.controllers = [];
    this.emit('update', this.task);
  }

  cancel() {
    this.isCancelled = true;
    this.pause();

    if (this.fd !== null) {
      try { fs.closeSync(this.fd); } catch (_) {}
      this.fd = null;
    }

    try {
      if (fs.existsSync(this.partFilePath)) fs.unlinkSync(this.partFilePath);
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
