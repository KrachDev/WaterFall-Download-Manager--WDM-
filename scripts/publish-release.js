/**
 * Waterfall GitHub Release Publisher
 * Automatically publishes releases and uploads distribution assets to GitHub.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

const REPO_OWNER = 'KrachDev';
const REPO_NAME = 'WaterFall-Download-Manager--WDM-';
const TAG_NAME = 'v1.1.0';
const RELEASE_NAME = 'Waterfall v1.1.0 — Dual Engine (WebView2 & Electron)';

function getGitHubToken() {
  if (process.env.GITHUB_TOKEN && process.env.GITHUB_TOKEN.trim()) {
    return process.env.GITHUB_TOKEN.trim();
  }
  if (process.env.GH_TOKEN && process.env.GH_TOKEN.trim()) {
    return process.env.GH_TOKEN.trim();
  }

  // Retrieve token from Git Credential Manager
  try {
    const gitDir = 'C:\\Program Files\\Git\\cmd';
    const env = { ...process.env, PATH: `${gitDir};${process.env.PATH || ''}` };
    const output = execSync(
      'printf "protocol=https\\nhost=github.com\\n\\n" | "C:\\Program Files\\Git\\mingw64\\bin\\git-credential-manager.exe" get',
      { env, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }
    );
    const passMatch = output.match(/password=([^\r\n]+)/);
    if (passMatch && passMatch[1]) {
      return passMatch[1].trim();
    }
  } catch (err) {
    console.warn('[Release] Could not retrieve token from GCM:', err.message);
  }

  throw new Error('No GitHub token found. Please set GITHUB_TOKEN or authenticate git.');
}

async function requestGithub(endpoint, options = {}, body = null) {
  const token = getGitHubToken();
  const url = endpoint.startsWith('http') ? endpoint : `https://api.github.com${endpoint}`;

  const headers = {
    'User-Agent': 'Waterfall-Release-Publisher',
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github.v3+json',
    ...(options.headers || {})
  };

  const fetchOptions = {
    method: options.method || 'GET',
    headers
  };

  if (body) {
    fetchOptions.body = body;
  }

  const res = await fetch(url, fetchOptions);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (_) {
    json = text;
  }

  if (!res.ok) {
    const err = new Error(`GitHub API Error (${res.status} ${res.statusText}): ${typeof json === 'object' ? JSON.stringify(json) : json}`);
    err.status = res.status;
    err.response = json;
    throw err;
  }

  return json;
}

async function uploadReleaseAsset(uploadUrlTemplate, filePath) {
  const token = getGitHubToken();
  const fileName = path.basename(filePath);
  const fileStat = fs.statSync(filePath);
  const fileSizeMb = (fileStat.size / (1024 * 1024)).toFixed(2);

  // upload_url is in format: https://uploads.github.com/repos/.../releases/123/assets{?name,label}
  const cleanUploadUrl = uploadUrlTemplate.replace(/\{\?name,label\}$/, '');
  const targetUrl = `${cleanUploadUrl}?name=${encodeURIComponent(fileName)}`;

  console.log(`[Release] Uploading ${fileName} (${fileSizeMb} MB)...`);

  const fileStream = fs.createReadStream(filePath);

  return new Promise((resolve, reject) => {
    const u = new URL(targetUrl);
    const req = https.request({
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port || 443,
      path: `${u.pathname}${u.search}`,
      method: 'POST',
      headers: {
        'User-Agent': 'Waterfall-Release-Publisher',
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/zip',
        'Content-Length': fileStat.size,
        'Accept': 'application/vnd.github.v3+json'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          console.log(`[Release] Successfully uploaded: ${fileName}`);
          resolve(JSON.parse(data));
        } else {
          reject(new Error(`Failed to upload ${fileName} (${res.statusCode}): ${data}`));
        }
      });
    });

    req.on('error', reject);
    fileStream.pipe(req);
  });
}

async function main() {
  console.log('=======================================================');
  console.log(` Preparing GitHub Release: ${TAG_NAME}`);
  console.log('=======================================================');

  const releaseNotes = `## Waterfall v1.1.0 — Dual Engine Release

### What's New:
- **Dual Desktop Architecture Choices**:
  - **WebView2 Edition** (\`Waterfall-v1.1.0-WebView2-windows-x64.zip\`):
    - Ultra-lightweight (~9.6 MB download, ~16 MB uncompressed).
    - Extremely low RAM usage (< 70 MB) using Windows' native Edge WebView2 runtime.
    - Full glassmorphic HTML5/CSS3 frontend, Click'n'Load bridge, and multi-threaded engine.
  - **Electron Edition** (\`Waterfall-v1.1.0-Electron-windows-x64.zip\`):
    - Completely self-contained with bundled Chromium and Node.js.
    - Inspector window pooling (drops RAM overhead by eliminating duplicate renderer processes).
    - Background window DOM throttling & idle WebSocket tick suppression.
- **Unified Global Data Storage**:
  - All builds now seamlessly share settings, download history, and resume states located globally in \`%APPDATA%\\Waterfall\`.
- **Windows Temp & Metadata Isolation**:
  - Temporary download chunks are isolated in \`%TEMP%\\Waterfall\\temp\`.
  - Companion \`.meta.json\` metadata files are stored in \`%TEMP%\\Waterfall\\metadata\`, preventing download folder clutter.
- **Companion Browser Extension**:
  - Version 1.1.0 companion extension with instant video grabber, Click'n'Load, FlashGot, and multi-stream download capture.`;

  // 1. Check if release tag already exists on GitHub
  let release = null;
  try {
    release = await requestGithub(`/repos/${REPO_OWNER}/${REPO_NAME}/releases/tags/${TAG_NAME}`);
    console.log(`[Release] Found existing release for ${TAG_NAME} (ID: ${release.id})`);
  } catch (err) {
    if (err.status !== 404) throw err;
  }

  // 2. Create release if not found
  if (!release) {
    console.log(`[Release] Creating new GitHub release for tag ${TAG_NAME}...`);
    release = await requestGithub(`/repos/${REPO_OWNER}/${REPO_NAME}/releases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, JSON.stringify({
      tag_name: TAG_NAME,
      target_commitish: 'main',
      name: RELEASE_NAME,
      body: releaseNotes,
      draft: false,
      prerelease: false
    }));
    console.log(`[Release] Release created successfully (ID: ${release.id})`);
  }

  // 3. Collect distribution assets
  const distDir = path.resolve(__dirname, '..', 'dist');
  const targetAssets = [
    path.join(distDir, 'Waterfall-v1.1.0-WebView2-windows-x64.zip'),
    path.join(distDir, 'Waterfall-v1.1.0-Electron-windows-x64.zip'),
    path.join(distDir, 'waterfall-companion-extension-v1.1.0.zip')
  ];

  // 4. Upload assets
  for (const assetPath of targetAssets) {
    if (!fs.existsSync(assetPath)) {
      console.warn(`[Release] Warning: Asset file does not exist: ${assetPath}`);
      continue;
    }

    const fileName = path.basename(assetPath);

    // If asset already exists in release, delete old one first
    const existingAsset = (release.assets || []).find(a => a.name === fileName);
    if (existingAsset) {
      console.log(`[Release] Asset ${fileName} already exists on GitHub. Deleting old asset (ID: ${existingAsset.id})...`);
      try {
        await requestGithub(`/repos/${REPO_OWNER}/${REPO_NAME}/releases/assets/${existingAsset.id}`, {
          method: 'DELETE'
        });
      } catch (delErr) {
        console.warn(`[Release] Warning deleting old asset:`, delErr.message);
      }
    }

    await uploadReleaseAsset(release.upload_url, assetPath);
  }

  console.log('=======================================================');
  console.log(` RELEASE COMPLETE: ${release.html_url}`);
  console.log('=======================================================');
}

main().catch(err => {
  console.error('[Release] Release failed:', err);
  process.exit(1);
});
