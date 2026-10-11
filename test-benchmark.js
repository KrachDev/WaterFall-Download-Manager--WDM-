/**
 * Waterfall Core Performance Benchmark Suite
 * Measures:
 * 1. Chunked Multi-Segment Download & Assembly Throughput (MB/s)
 * 2. SHA-256 Checksum Hashing Memory & Speed (Buffer vs Stream)
 * 3. LinkGrabber Regex Parsing & Categorization Throughput (URLs/sec)
 * 4. Parallel vs Serial URL Probing Concurrency Speed
 * 5. State Serialization & Broadcast Latency
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ChunkDownloader = require('./src/backend/chunkDownloader');
const { linkGrabber, getCategoryFromFilename } = require('./src/backend/linkGrabber');
const { isArchiveFile } = require('./src/backend/archiveUnpacker');

const BENCHMARK_DIR = path.join(__dirname, 'bench_temp');
if (!fs.existsSync(BENCHMARK_DIR)) fs.mkdirSync(BENCHMARK_DIR, { recursive: true });

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return (bytes / Math.pow(k, i)).toFixed(2) + ' ' + sizes[i];
}

// 1. Create a High-Speed Local Benchmark HTTP Server with Range Support
function createMockServer(fileSizeBytes) {
  return new Promise((resolve) => {
    // Generate deterministic test payload chunk (64KB repeated)
    const testPattern = Buffer.alloc(64 * 1024, 0x42);

    const server = http.createServer((req, res) => {
      const range = req.headers.range;
      if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : (fileSizeBytes - 1);
        const chunkLen = (end - start) + 1;

        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${fileSizeBytes}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunkLen,
          'Content-Type': 'application/octet-stream',
          'Last-Modified': new Date().toUTCString()
        });

        let sent = 0;
        function sendMore() {
          while (sent < chunkLen) {
            const toSend = Math.min(testPattern.length, chunkLen - sent);
            sent += toSend;
            const ok = res.write(testPattern.subarray(0, toSend));
            if (!ok) {
              res.once('drain', sendMore);
              return;
            }
          }
          res.end();
        }
        sendMore();
      } else {
        res.writeHead(200, {
          'Content-Length': fileSizeBytes,
          'Accept-Ranges': 'bytes',
          'Content-Type': 'application/octet-stream',
          'Last-Modified': new Date().toUTCString()
        });
        let sent = 0;
        function sendAll() {
          while (sent < fileSizeBytes) {
            const toSend = Math.min(testPattern.length, fileSizeBytes - sent);
            sent += toSend;
            const ok = res.write(testPattern.subarray(0, toSend));
            if (!ok) {
              res.once('drain', sendAll);
              return;
            }
          }
          res.end();
        }
        sendAll();
      }
    });

    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({ server, port, url: `http://127.0.0.1:${port}/bench-data.bin` });
    });
  });
}

async function runBenchmark() {
  console.log('\n============================================================');
  console.log('       WATERFALL CORE BENCHMARK & PROFILING SUITE          ');
  console.log('============================================================\n');

  const initialMemory = process.memoryUsage();
  console.log(`Initial RSS: ${formatBytes(initialMemory.rss)} | Heap Used: ${formatBytes(initialMemory.heapUsed)}`);

  // --- BENCHMARK 1: LinkGrabber Categorization Throughput ---
  console.log('\n--- 1. LinkGrabber Categorization & URL Extraction ---');
  const dummyExtensions = ['zip', 'rar', 'mp4', 'mkv', 'mp3', 'flac', 'pdf', 'docx', 'exe', 'iso', 'png', 'jpg'];
  const testUrls = [];
  for (let i = 0; i < 2000; i++) {
    const ext = dummyExtensions[i % dummyExtensions.length];
    testUrls.push(`https://cdn.example.com/files/archive_package_v${i}_sample.${ext}`);
  }
  const bigTextBlob = testUrls.join('\n');

  const tStartExtract = process.hrtime.bigint();
  const extracted = linkGrabber.extractUrls(bigTextBlob);
  const tEndExtract = process.hrtime.bigint();
  const extractTimeMs = Number(tEndExtract - tStartExtract) / 1e6;
  console.log(`URL Regex Extraction: ${extracted.length} URLs extracted in ${extractTimeMs.toFixed(2)} ms (${Math.round((extracted.length / extractTimeMs) * 1000)} URLs/sec)`);

  const tStartCat = process.hrtime.bigint();
  let categorizedCount = 0;
  for (const u of extracted) {
    const cat = getCategoryFromFilename(u);
    if (cat) categorizedCount++;
  }
  const tEndCat = process.hrtime.bigint();
  const catTimeMs = Number(tEndCat - tStartCat) / 1e6;
  console.log(`Category Lookup: ${categorizedCount} items classified in ${catTimeMs.toFixed(2)} ms (${Math.round((categorizedCount / catTimeMs) * 1000)} items/sec)`);

  // --- BENCHMARK 2: SHA-256 Hashing Performance (Buffer vs Stream) ---
  console.log('\n--- 2. Checksum (SHA-256) Hashing & Memory Impact ---');
  const hashTestFile = path.join(BENCHMARK_DIR, 'hash_test_40mb.bin');
  const hashSize = 40 * 1024 * 1024; // 40 MB
  const dummyBuffer = Buffer.alloc(hashSize, 0x5a);
  fs.writeFileSync(hashTestFile, dummyBuffer);

  // Method A: Whole buffer readFileSync
  const memBeforeA = process.memoryUsage().heapUsed;
  const tStartHashA = process.hrtime.bigint();
  const hashA = crypto.createHash('sha256').update(fs.readFileSync(hashTestFile)).digest('hex');
  const tEndHashA = process.hrtime.bigint();
  const memAfterA = process.memoryUsage().heapUsed;
  const timeHashAMs = Number(tEndHashA - tStartHashA) / 1e6;
  const memDeltaA = Math.max(0, memAfterA - memBeforeA);
  console.log(`Method A (readFileSync):   ${timeHashAMs.toFixed(2)} ms | Peak Heap Delta: ~${formatBytes(memDeltaA)} | Throughput: ${(hashSize / (1024 * 1024) / (timeHashAMs / 1000)).toFixed(2)} MB/s`);

  // Method B: Streaming chunks
  const memBeforeB = process.memoryUsage().heapUsed;
  const tStartHashB = process.hrtime.bigint();
  const hashB = await new Promise((res, rej) => {
    const h = crypto.createHash('sha256');
    const stream = fs.createReadStream(hashTestFile, { highWaterMark: 1024 * 1024 });
    stream.on('data', chunk => h.update(chunk));
    stream.on('end', () => res(h.digest('hex')));
    stream.on('error', rej);
  });
  const tEndHashB = process.hrtime.bigint();
  const memAfterB = process.memoryUsage().heapUsed;
  const timeHashBMs = Number(tEndHashB - tStartHashB) / 1e6;
  const memDeltaB = Math.max(0, memAfterB - memBeforeB);
  console.log(`Method B (Stream 1MB):     ${timeHashBMs.toFixed(2)} ms | Peak Heap Delta: ~${formatBytes(memDeltaB)} | Throughput: ${(hashSize / (1024 * 1024) / (timeHashBMs / 1000)).toFixed(2)} MB/s`);
  console.log(`Checksum Matched: ${hashA === hashB ? 'YES' : 'NO'}`);

  // --- BENCHMARK 3: Multi-Segment Parallel Download Throughput ---
  console.log('\n--- 3. Multi-Segment Parallel Download & Assembly Throughput ---');
  const payloadSize = 30 * 1024 * 1024; // 30 MB
  const { server, url: serverUrl } = await createMockServer(payloadSize);

  // Test 3a: 1 Segment (Single Connection)
  const task1 = {
    id: 'bench_1seg',
    savePath: path.join(BENCHMARK_DIR, 'out_1seg.bin'),
    url: serverUrl,
    directUrl: serverUrl,
    totalBytes: payloadSize,
    acceptRanges: true,
    status: 'queued'
  };
  const dl1 = new ChunkDownloader(task1, { segments: 1, tempDir: BENCHMARK_DIR });
  const tStartDl1 = process.hrtime.bigint();
  await dl1.start();
  const tEndDl1 = process.hrtime.bigint();
  const timeDl1Ms = Number(tEndDl1 - tStartDl1) / 1e6;
  const speed1 = (payloadSize / (1024 * 1024)) / (timeDl1Ms / 1000);
  console.log(`1 Connection (Standard):  ${timeDl1Ms.toFixed(2)} ms | Speed: ${speed1.toFixed(2)} MB/s`);

  // Test 3b: 8 Segments (IDM Recommended Parallel Mode)
  const task8 = {
    id: 'bench_8seg',
    savePath: path.join(BENCHMARK_DIR, 'out_8seg.bin'),
    url: serverUrl,
    directUrl: serverUrl,
    totalBytes: payloadSize,
    acceptRanges: true,
    status: 'queued'
  };
  const dl8 = new ChunkDownloader(task8, { segments: 8, tempDir: BENCHMARK_DIR });
  const tStartDl8 = process.hrtime.bigint();
  await dl8.start();
  const tEndDl8 = process.hrtime.bigint();
  const timeDl8Ms = Number(tEndDl8 - tStartDl8) / 1e6;
  const speed8 = (payloadSize / (1024 * 1024)) / (timeDl8Ms / 1000);
  console.log(`8 Connections (IDM Mode): ${timeDl8Ms.toFixed(2)} ms | Speed: ${speed8.toFixed(2)} MB/s`);

  // Test 3c: 16 Segments (Max Acceleration Mode)
  const task16 = {
    id: 'bench_16seg',
    savePath: path.join(BENCHMARK_DIR, 'out_16seg.bin'),
    url: serverUrl,
    directUrl: serverUrl,
    totalBytes: payloadSize,
    acceptRanges: true,
    status: 'queued'
  };
  const dl16 = new ChunkDownloader(task16, { segments: 16, tempDir: BENCHMARK_DIR });
  const tStartDl16 = process.hrtime.bigint();
  await dl16.start();
  const tEndDl16 = process.hrtime.bigint();
  const timeDl16Ms = Number(tEndDl16 - tStartDl16) / 1e6;
  const speed16 = (payloadSize / (1024 * 1024)) / (timeDl16Ms / 1000);
  console.log(`16 Connections (Aggressive): ${timeDl16Ms.toFixed(2)} ms | Speed: ${speed16.toFixed(2)} MB/s`);

  // --- BENCHMARK 4: State Serialization (Task Queue JSON Serialization) ---
  console.log('\n--- 4. Task State Serialization & WebSocket Tick Performance ---');
  const dummyTasks = [];
  for (let i = 0; i < 200; i++) {
    dummyTasks.push({
      id: `task_${i}`,
      name: `Ultra_High_Definition_Video_Package_${i}.mp4`,
      status: i % 2 === 0 ? 'downloading' : 'completed',
      downloadedBytes: 1048576 * i,
      totalBytes: 1048576 * 200,
      speed: 1048576 * 5,
      eta: 45,
      segments: Array.from({ length: 8 }, (_, s) => ({
        id: s,
        startByte: s * 100000,
        endByte: (s + 1) * 100000 - 1,
        downloadedBytes: 50000,
        totalBytes: 100000,
        status: 'downloading',
        speed: 1024 * 500
      }))
    });
  }

  const tStartJson = process.hrtime.bigint();
  const jsonIterations = 1000;
  for (let i = 0; i < jsonIterations; i++) {
    const serialized = JSON.stringify(dummyTasks);
  }
  const tEndJson = process.hrtime.bigint();
  const jsonTimeMs = Number(tEndJson - tStartJson) / 1e6;
  console.log(`Serialized 200 tasks x 1,000 times: ${jsonTimeMs.toFixed(2)} ms (${(jsonTimeMs / jsonIterations).toFixed(3)} ms per tick)`);

  // Clean up
  server.close();
  try {
    fs.rmSync(BENCHMARK_DIR, { recursive: true, force: true });
  } catch (_) {}

  console.log('\n============================================================');
  console.log('       BENCHMARK RUN COMPLETED                             ');
  console.log('============================================================\n');
}

runBenchmark().catch(console.error);
