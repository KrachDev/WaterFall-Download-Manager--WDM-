const http = require('http');
const fs = require('fs');
const path = require('path');
const ChunkDownloader = require('../src/backend/chunkDownloader');
const { getCrawlerInfo } = require('../src/backend/crawlerEngine');

async function getJson(apiPath) {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:4567${apiPath}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve(data);
        }
      });
    }).on('error', reject);
  });
}

async function runTests() {
  console.log('--- Test 1: Testing Crawler Info API ---');
  try {
    const crawlerInfo = await getJson('/api/crawler/info');
    console.log('Crawler Info response:', {
      success: crawlerInfo.success,
      version: crawlerInfo.version,
      hasYtDlp: crawlerInfo.hasYtDlp,
      sourcesCount: crawlerInfo.sources ? crawlerInfo.sources.length : 0
    });
    if (!crawlerInfo.version) {
      throw new Error('Crawler info returned unexpected payload');
    }
    console.log(' Crawler Info API passed!');
  } catch (err) {
    console.error(' Crawler Info API failed:', err.message);
  }

  console.log('\n--- Test 2: Testing Crawler Engine probe ---');
  try {
    const info = await getCrawlerInfo();
    console.log('Detected version:', info.version);
    console.log('Curated Sources count:', info.sources.length);
    console.log('Sources list:', info.sources.map(s => s.name).join(' | '));
    console.log(' Crawler Engine test passed!');
  } catch (err) {
    console.error(' Crawler Engine test failed:', err.message);
  }

  console.log('\n--- Test 3: Testing Resume Logic & Sidecar Metadata File ---');
  try {
    const testDir = path.join(__dirname, 'test_output');
    if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });

    const testFile = path.join(testDir, 'resume_test_file.bin');
    const partFile = `${testFile}.part`;
    const metaFile = `${testFile}.part.meta.json`;

    // Clean up past runs
    if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
    if (fs.existsSync(partFile)) fs.unlinkSync(partFile);
    if (fs.existsSync(metaFile)) fs.unlinkSync(metaFile);

    const dummyTask = {
      id: 'test-resume-123',
      url: 'https://example.com/test.iso',
      name: 'resume_test_file.bin',
      savePath: testFile,
      totalBytes: 1024 * 1024 * 10, // 10MB
      supportsResume: true,
      connections: 2,
      segments: [
        { id: 0, startByte: 0, endByte: 5242879, downloadedBytes: 1048576, totalBytes: 5242880 },
        { id: 1, startByte: 5242880, endByte: 10485759, downloadedBytes: 2097152, totalBytes: 5242880 }
      ]
    };

    const downloader = new ChunkDownloader(dummyTask);
    
    // Save metadata
    downloader.saveMetaFile();
    const actualMetaFile = downloader.metaFilePath;
    console.log('Saved state metadata. Checking file exists at', actualMetaFile, ':', fs.existsSync(actualMetaFile));
    if (!fs.existsSync(actualMetaFile)) {
      throw new Error('.meta.json file was not created');
    }

    const savedMeta = JSON.parse(fs.readFileSync(actualMetaFile, 'utf8'));
    console.log('Meta contents verified:', {
      id: savedMeta.id,
      totalBytes: savedMeta.totalBytes,
      segments: savedMeta.segments.length,
      seg0Downloaded: savedMeta.segments[0].downloadedBytes
    });

    // Test loadMetaFile
    const dummyTask2 = {
      id: 'test-resume-123',
      url: 'https://example.com/test.iso',
      name: 'resume_test_file.bin',
      savePath: testFile,
      totalBytes: 0,
      segments: []
    };
    const downloader2 = new ChunkDownloader(dummyTask2);
    const loaded = downloader2.loadMetaFile();
    console.log('Loaded state successfully:', !!loaded);
    console.log('Restored segments in meta:', loaded.segments);

    if (loaded.segments.length !== 2 || loaded.segments[0].downloadedBytes !== 1048576) {
      throw new Error('Segment downloaded bytes not correctly restored from sidecar file');
    }

    // Clean up
    if (fs.existsSync(metaFile)) fs.unlinkSync(metaFile);
    console.log(' Resume sidecar metadata test passed!');
  } catch (err) {
    console.error(' Resume test failed:', err.message);
  }

  console.log('\n--- All tests completed! ---');
}

runTests().catch(console.error);
