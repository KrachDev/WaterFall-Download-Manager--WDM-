const fs = require('fs');

const appJs = fs.readFileSync('src/frontend/js/app.js', 'utf8');

// Find function definitions
const functionMatches = [...appJs.matchAll(/(?:async\s+)?function\s+([a-zA-Z0-9_]+)\s*\(/g)].map(m => m[1]);
console.log('Total functions in app.js:', functionMatches.length);
console.log('Functions:', JSON.stringify(functionMatches, null, 2));

// Find event listeners
const eventListeners = [...appJs.matchAll(/document\.getElementById\(['"]([^'"]+)['"]\)\.addEventListener\(['"]([^'"]+)['"]/g)].map(m => `${m[1]} -> ${m[2]}`);
console.log('\nDirect Event Listeners (' + eventListeners.length + '):');
eventListeners.forEach(e => console.log(' ', e));

// Find window/document listeners (keyboard shortcuts, resize, etc)
const globalListeners = [...appJs.matchAll(/(?:window|document)\.addEventListener\(['"]([^'"]+)['"]/g)].map(m => m[1]);
console.log('\nGlobal Listeners:', globalListeners);

// Find websocket event handlers in app.js
const wsHandlers = [...appJs.matchAll(/case\s+['"]([^'"]+)['"]\s*:/g)].map(m => m[1]);
console.log('\nWebSocket message types handled in frontend:', [...new Set(wsHandlers)]);
