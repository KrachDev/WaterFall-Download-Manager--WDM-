const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('=== Running Storage & Data Loss Prevention Tests ===\n');

const projectRoot = path.resolve(__dirname, '..');

// 1. Test basic loading and saving
const dm = require(path.join(projectRoot, 'src', 'backend', 'downloadManager'));
const initialTasks = dm.getAllTasks();
console.log(`[Test 1] Initial loaded tasks count: ${initialTasks.length}`);
assert(initialTasks.length === 82, `Expected 82 tasks, got ${initialTasks.length}`);

// 2. Trigger saveState(true) and verify .bak was created
dm.saveState(true);
const stateFile = path.resolve(projectRoot, 'downloads.json');
const bakFile = path.resolve(projectRoot, 'downloads.json.bak');
assert(fs.existsSync(stateFile), 'downloads.json must exist');
assert(fs.existsSync(bakFile), 'downloads.json.bak must exist');
console.log('[Test 2] downloads.json and downloads.json.bak confirmed on disk.');

// 3. Test corruption recovery: simulate corrupted downloads.json
const originalContent = fs.readFileSync(stateFile, 'utf-8');
fs.writeFileSync(stateFile, '{ corrupted JSON content: !!!', 'utf-8');

const { safeReadJson } = require(path.join(projectRoot, 'src', 'backend', 'storagePaths'));
const recovered = safeReadJson(stateFile, []);
console.log(`[Test 3] Recovered items from corrupted primary file: ${recovered ? recovered.length : 0}`);
assert(Array.isArray(recovered) && recovered.length === 82, `Expected 82 recovered tasks, got ${recovered.length}`);

// 4. Test empty array overwrite block guard
const { safeWriteJsonSync } = require(path.join(projectRoot, 'src', 'backend', 'storagePaths'));
// Restore valid content first
fs.writeFileSync(stateFile, originalContent, 'utf-8');
const blocked = safeWriteJsonSync(stateFile, [], { allowEmpty: false });
assert(blocked === false, 'Empty array write without allowEmpty must be BLOCKED');
const afterBlockContent = fs.readFileSync(stateFile, 'utf-8');
assert(JSON.parse(afterBlockContent).length === 82, 'Primary state must remain intact when blocked');
console.log('[Test 4] Safety guard successfully blocked empty overwrite on populated data.');

// 5. Test intentional clearing with allowEmpty: true
const tempTestFile = path.resolve(projectRoot, 'scratch', 'scratch_test_clear.json');
fs.writeFileSync(tempTestFile, originalContent, 'utf-8');
const allowed = safeWriteJsonSync(tempTestFile, [], { allowEmpty: true });
assert(allowed === true, 'Explicit clear with allowEmpty: true must succeed');
assert(fs.readFileSync(tempTestFile, 'utf-8').trim() === '[]', 'Temp test file cleared');
fs.unlinkSync(tempTestFile);
if (fs.existsSync(`${tempTestFile}.bak`)) fs.unlinkSync(`${tempTestFile}.bak`);
console.log('[Test 5] Explicit clear test passed.');

console.log('\n>>> ALL 5 STORAGE & RESILIENCE TESTS PASSED PERFECTLY! <<<');
process.exit(0);
