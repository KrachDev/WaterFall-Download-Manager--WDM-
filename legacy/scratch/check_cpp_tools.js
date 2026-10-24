const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const tools = ['cl.exe', 'cmake.exe', 'ninja.exe', 'g++.exe', 'clang++.exe', 'rustc.exe', 'cargo.exe', 'msbuild.exe'];

for (const t of tools) {
  try {
    const out = execSync(`where.exe ${t}`, { stdio: ['pipe', 'pipe', 'ignore'], encoding: 'utf8' }).trim();
    console.log(`FOUND ${t}: ${out.split(/\r?\n/)[0]}`);
  } catch (_) {
    console.log(`MISSING ${t}`);
  }
}

// Check Visual Studio installations
const vsWherePath = 'C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe';
if (fs.existsSync(vsWherePath)) {
  try {
    const vsInfo = execSync(`"${vsWherePath}" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`, { encoding: 'utf8' }).trim();
    console.log('Visual Studio C++ installation path:', vsInfo);
  } catch (e) {
    console.log('vswhere check note:', e.message);
  }
}
