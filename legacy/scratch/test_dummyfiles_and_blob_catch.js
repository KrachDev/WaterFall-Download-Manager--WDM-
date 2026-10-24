const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');

console.log('Testing DummyFiles & Blob Download Catching System...');

// 1. Test dummyFileGenerator
const { createDummyZip, createDummyFileBuffer, parseSizeString } = require('../src/backend/dummyFileGenerator');

assert.strictEqual(parseSizeString('10mb'), 10 * 1024 * 1024);
assert.strictEqual(parseSizeString('100mb'), 100 * 1024 * 1024);
assert.strictEqual(parseSizeString('1gb'), 1024 * 1024 * 1024);
assert.strictEqual(parseSizeString('500kb'), 500 * 1024);
assert.strictEqual(parseSizeString('1024b'), 1024);
console.log('✓ parseSizeString verified for all unit formats');

const testZipSize = 1024 * 1024; // 1 MB
const zipBuf = createDummyZip(testZipSize);
assert.strictEqual(zipBuf.length, testZipSize, 'createDummyZip length must match');
assert.strictEqual(zipBuf.subarray(0, 4).toString('utf8'), 'PK\x03\x04', 'ZIP header magic must match');
console.log('✓ createDummyZip generated 1 MB valid ZIP buffer');

const testPdfSize = 50000;
const pdfBuf = createDummyFileBuffer('pdf', testPdfSize);
assert.strictEqual(pdfBuf.length, testPdfSize);
assert(pdfBuf.toString('utf8', 0, 8).startsWith('%PDF-'), 'PDF header magic must match');
console.log('✓ createDummyFileBuffer generated valid PDF dummy');

// 2. Test dummyfiles hoster
const hosterManager = require('../src/backend/hosters');
async function testHoster() {
  const zipHosterRes = await hosterManager.resolve('https://dummyfiles.com/dummy-zip/100mb/');
  assert(zipHosterRes, 'dummyfiles hoster should resolve');
  assert.strictEqual(zipHosterRes.filename, 'dummy_100mb.zip');
  assert.strictEqual(zipHosterRes.size, 100 * 1024 * 1024);
  assert(zipHosterRes.directUrl.includes('/api/dummy-generator'), 'directUrl should point to dummy-generator');
  console.log('✓ dummyfiles hoster resolved https://dummyfiles.com/dummy-zip/100mb/ to dummy_100mb.zip (100 MB)');

  const pdfHosterRes = await hosterManager.resolve('https://dummyfiles.com/dummy-pdf/10mb/');
  assert(pdfHosterRes, 'dummyfiles hoster should resolve pdf');
  assert.strictEqual(pdfHosterRes.filename, 'dummy_10mb.pdf');
  assert.strictEqual(pdfHosterRes.size, 10 * 1024 * 1024);
  console.log('✓ dummyfiles hoster resolved https://dummyfiles.com/dummy-pdf/10mb/ to dummy_10mb.pdf (10 MB)');

  const downloadPageRes = await hosterManager.resolve('https://dummyfiles.com/download/');
  assert(downloadPageRes, 'dummyfiles hoster should resolve /download/');
  console.log('✓ dummyfiles hoster resolved https://dummyfiles.com/download/');
}

// 3. Test importCompletedDownload in downloadManager
const downloadManager = require('../src/backend/downloadManager');
const dummyTempFile = path.join(__dirname, 'test_imported_sample.zip');
fs.writeFileSync(dummyTempFile, zipBuf);

const importedTask = downloadManager.importCompletedDownload({
  filePath: dummyTempFile,
  filename: 'test_imported_sample.zip',
  sourceUrl: 'https://dummyfiles.com/download/',
  autoExtract: false // don't auto extract in unit test
});

assert(importedTask, 'importedTask must be created');
assert.strictEqual(importedTask.status, 'completed');
assert.strictEqual(importedTask.totalBytes, testZipSize);
assert.strictEqual(importedTask.savePath, dummyTempFile);
assert.strictEqual(importedTask.isArchive, true);
console.log('✓ downloadManager.importCompletedDownload successfully created and finalized task:', importedTask.id);

try { fs.unlinkSync(dummyTempFile); } catch (_) {}

// 4. Test background.js and content.js
const bgJs = fs.readFileSync(path.join(__dirname, '..', 'extension', 'background.js'), 'utf8');
assert(bgJs.includes('pendingBlobDownloads'), 'background.js must track pendingBlobDownloads');
assert(bgJs.includes('/api/downloads/import-completed'), 'background.js must post to /api/downloads/import-completed');
assert(bgJs.includes("REGISTER_BLOB_INTENT"), 'background.js must handle REGISTER_BLOB_INTENT');

const contentJs = fs.readFileSync(path.join(__dirname, '..', 'extension', 'content', 'content.js'), 'utf8');
assert(contentJs.includes("REGISTER_BLOB_INTENT"), 'content.js must register REGISTER_BLOB_INTENT on download clicks');

testHoster().then(() => {
  console.log('\n>>> ALL DUMMYFILES & BLOB CATCHING TESTS PASSED SUCCESSFULLY!');
}).catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
