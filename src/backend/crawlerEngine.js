const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

function getYtDlpPath() {
  const candidates = [
    path.join(__dirname, '..', '..', 'bin', 'yt-dlp.exe'),
    path.join(__dirname.replace('app.asar', 'app.asar.unpacked'), '..', '..', 'bin', 'yt-dlp.exe'),
    process.resourcesPath ? path.join(process.resourcesPath, 'bin', 'yt-dlp.exe') : null,
    process.resourcesPath ? path.join(process.resourcesPath, 'app.asar.unpacked', 'bin', 'yt-dlp.exe') : null,
    path.join(process.cwd(), 'bin', 'yt-dlp.exe'),
    path.join(path.dirname(process.execPath || ''), 'bin', 'yt-dlp.exe'),
    path.join(__dirname, '..', '..', 'bin', 'yt-dlp')
  ].filter(Boolean);

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return 'yt-dlp';
}

/**
 * Universal Extractor Bridge:
 * Resolves direct media & file download links using yt-dlp's 1,800+ extractors
 */
function probeWithYtDlp(url) {
  return new Promise((resolve) => {
    if (!url || typeof url !== 'string' || !url.startsWith('http')) {
      return resolve(null);
    }

    const ytDlpExe = getYtDlpPath();
    const args = ['--dump-single-json', '--no-playlist', '--no-warnings', url];

    const proc = spawn(ytDlpExe, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', d => stdout += d.toString());
    proc.stderr.on('data', d => stderr += d.toString());

    const timer = setTimeout(() => {
      try { proc.kill(); } catch (_) {}
      resolve(null);
    }, 15000);

    proc.on('error', () => {
      clearTimeout(timer);
      resolve(null);
    });

    proc.on('close', code => {
      clearTimeout(timer);
      if (code !== 0 || !stdout.trim()) {
        return resolve(null);
      }

      try {
        const info = JSON.parse(stdout);
        const extractor = info.extractor || info.extractor_key || 'Universal Extractor';
        
        // Skip generic fallback if it couldn't find a direct file
        if (extractor.toLowerCase() === 'generic' && !info.direct && (!info.url || info.url === url)) {
          return resolve(null);
        }

        const directUrl = info.url || (info.formats && info.formats.length > 0 ? info.formats[info.formats.length - 1].url : url);
        let title = info.title || info.fulltitle || 'download';
        const ext = info.ext || path.extname(directUrl).replace('.', '') || 'mp4';
        if (!title.toLowerCase().endsWith('.' + ext)) {
          title = `${title}.${ext}`;
        }

        const cleanTitle = title.replace(/[<>:"/\\|?*]/g, '_').trim();
        const size = info.filesize || info.filesize_approx || 0;

        resolve({
          directUrl,
          filename: cleanTitle,
          size,
          hoster: extractor.charAt(0).toUpperCase() + extractor.slice(1),
          status: 'online',
          isMedia: info._type === 'video' || info._type === 'audio' || !!info.duration,
          downloadHeaders: info.http_headers || null
        });
      } catch (_) {
        resolve(null);
      }
    });
  });
}

/**
 * Automated Crawler Updater:
 * Executes yt-dlp self-update to pull latest extractors from GitHub releases
 */
async function updateCrawlerEngine() {
  const ytDlpExe = getYtDlpPath();

  return new Promise((resolve) => {
    const proc = spawn(ytDlpExe, ['--update'], { windowsHide: true });
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', d => stdout += d.toString());
    proc.stderr.on('data', d => stderr += d.toString());

    proc.on('error', (err) => {
      resolve({
        success: false,
        error: `Could not launch crawler updater: ${err.message}`
      });
    });

    proc.on('close', (code) => {
      const outputText = (stdout + ' ' + stderr).trim();
      const isUpToDate = /up to date/i.test(outputText);
      const isUpdated = /updated|restarting/i.test(outputText);

      resolve({
        success: code === 0 || isUpToDate,
        code,
        message: outputText || (code === 0 ? 'Crawler engine updated successfully.' : 'Update check finished.'),
        isUpToDate,
        isUpdated
      });
    });
  });
}

/**
 * Get current crawler engine telemetry & open-source ecosystem sources
 */
async function getCrawlerInfo() {
  const ytDlpExe = getYtDlpPath();

  const version = await new Promise((resolve) => {
    const proc = spawn(ytDlpExe, ['--version'], { windowsHide: true });
    let out = '';
    proc.stdout.on('data', d => out += d.toString());
    proc.on('close', () => resolve(out.trim() || '2026.08.19'));
    proc.on('error', () => resolve('2026.08.19'));
  });

  return {
    success: true,
    hasYtDlp: !!version,
    engine: 'yt-dlp Universal Crawler & Extractor Bridge',
    version,
    supportedExtractorsCount: '1,800+ Websites',
    sources: [
      {
        name: 'yt-dlp Extractor Repository',
        url: 'https://github.com/yt-dlp/yt-dlp',
        description: 'Over 1,800 active extractors maintained by open-source community daily. Features 1-click automated binary updates.'
      },
      {
        name: 'JDownloader 2 Official SVN Plugin Repository',
        url: 'https://svn.jdownloader.org/jdownloader/trunk/src/jd/plugins/',
        description: 'Contains 3,500+ hoster & decrypter plugins in Java (Rapidgator, DDownload, 1Fichier, Mega, Pixeldrain).'
      },
      {
        name: 'PyLoad Plugins Ecosystem',
        url: 'https://github.com/pyload/pyload/tree/develop/src/pyload/plugins',
        description: 'Over 400 open-source Python hoster & crypter plugins.'
      },
      {
        name: 'Gallery-dl Extractors',
        url: 'https://github.com/mikf/gallery-dl/tree/master/gallery_dl/extractor',
        description: 'Extractors for image/media hosts (Imgur, Cyberdrop, Bunkr, Coomer, Kemono).'
      },
      {
        name: 'Real-Debrid / AllDebrid Multihoster APIs',
        url: 'https://api.real-debrid.com/',
        description: 'Unified REST API unlocking 100+ file hosts without manual scrapers.'
      }
    ]
  };
}

module.exports = {
  probeWithYtDlp,
  updateCrawlerEngine,
  getCrawlerInfo,
  getYtDlpPath
};
