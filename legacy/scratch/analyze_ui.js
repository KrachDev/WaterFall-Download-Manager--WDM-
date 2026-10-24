const fs = require('fs');
const path = require('path');

const indexHtml = fs.readFileSync('src/frontend/index.html', 'utf8');
const confirmHtml = fs.existsSync('src/frontend/confirm.html') ? fs.readFileSync('src/frontend/confirm.html', 'utf8') : '';
const progressHtml = fs.existsSync('src/frontend/download-progress.html') ? fs.readFileSync('src/frontend/download-progress.html', 'utf8') : '';

function extractTags(html) {
  const ids = [...html.matchAll(/id=["']([^"']+)["']/g)].map(m => m[1]);
  const buttons = [...html.matchAll(/<button[^>]*id=["']([^"']+)["'][^>]*>(.*?)<\/button>/gis)].map(m => ({
    id: m[1],
    text: m[2].replace(/<[^>]+>/g, '').trim(),
    title: (m[0].match(/title=["']([^"']+)["']/) || [])[1] || ''
  }));
  const inputs = [...html.matchAll(/<input[^>]*id=["']([^"']+)["'][^>]*>/gi)].map(m => ({
    id: m[1],
    type: (m[0].match(/type=["']([^"']+)["']/) || [])[1] || 'text',
    placeholder: (m[0].match(/placeholder=["']([^"']+)["']/) || [])[1] || ''
  }));
  const selects = [...html.matchAll(/<select[^>]*id=["']([^"']+)["'][^>]*>/gi)].map(m => m[1]);
  return { ids, buttons, inputs, selects };
}

console.log('=== INDEX.HTML ===');
const indexData = extractTags(indexHtml);
console.log('Total IDs:', indexData.ids.length);
console.log('Buttons:', JSON.stringify(indexData.buttons, null, 2));
console.log('Inputs:', JSON.stringify(indexData.inputs, null, 2));
console.log('Selects:', JSON.stringify(indexData.selects, null, 2));

console.log('=== CONFIRM.HTML ===');
const confirmData = extractTags(confirmHtml);
console.log('Confirm IDs:', confirmData.ids.length);
console.log('Confirm Buttons:', JSON.stringify(confirmData.buttons, null, 2));
console.log('Confirm Inputs:', JSON.stringify(confirmData.inputs, null, 2));

console.log('=== PROGRESS.HTML ===');
const progressData = extractTags(progressHtml);
console.log('Progress IDs:', progressData.ids.length);
console.log('Progress Buttons:', JSON.stringify(progressData.buttons, null, 2));
console.log('Progress Inputs:', JSON.stringify(progressData.inputs, null, 2));
