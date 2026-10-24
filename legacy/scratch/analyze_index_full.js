const fs = require('fs');

const indexHtml = fs.readFileSync('src/frontend/index.html', 'utf8');

const buttons = [...indexHtml.matchAll(/<button[^>]*id=["']([^"']+)["'][^>]*>(.*?)<\/button>/gis)].map(m => ({
  id: m[1],
  text: m[2].replace(/<[^>]+>/g, '').trim(),
  title: (m[0].match(/title=["']([^"']+)["']/) || [])[1] || ''
}));

console.log('INDEX BUTTONS (' + buttons.length + '):');
buttons.forEach(b => {
  console.log(`- [${b.id}] text: "${b.text}" title: "${b.title}"`);
});

const modals = [...indexHtml.matchAll(/<div[^>]*class=["'][^"']*(?:modal|overlay|drawer|popup|menu|dialog)[^"']*["'][^>]*id=["']([^"']+)["']/gi)].map(m => m[1]);
console.log('\nMODALS / OVERLAYS / MENUS:');
console.log(modals);

const sections = [...indexHtml.matchAll(/<(?:section|aside|main|header|div)[^>]*id=["']([^"']*(?:view|section|panel|container|table|tree|tab)[^"']*)["']/gi)].map(m => m[1]);
console.log('\nSECTIONS & PANELS:');
console.log([...new Set(sections)]);
