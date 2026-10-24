const fs = require('fs');
const path = require('path');

const candidates = [
  'C:\\Program Files\\Git\\cmd\\git.exe',
  'C:\\Program Files\\Git\\bin\\git.exe',
  'C:\\Program Files (x86)\\Git\\cmd\\git.exe',
  'C:\\Program Files (x86)\\Git\\bin\\git.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Git', 'cmd', 'git.exe'),
  path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Git', 'bin', 'git.exe'),
  path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Links', 'git.exe'),
  path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Git', 'cmd', 'git.exe'),
  'C:\\Git\\cmd\\git.exe',
  'C:\\Git\\bin\\git.exe'
];

let found = null;
for (const p of candidates) {
  if (p && fs.existsSync(p)) {
    console.log('FOUND GIT AT:', p);
    found = p;
    break;
  }
}

if (!found) {
  // Let's check PATH
  console.log('PATH is:', process.env.PATH);
}
