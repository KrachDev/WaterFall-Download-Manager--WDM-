const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const APP_NAME = 'Waterfall';

function getOsFolders() {
  const home = os.homedir();
  return {
    home,
    music: path.join(home, 'Music'),
    videos: path.join(home, 'Videos'),
    documents: path.join(home, 'Documents'),
    pictures: path.join(home, 'Pictures'),
    downloads: path.join(home, 'Downloads')
  };
}

const EXTENSION_MAP = {
  // 1. Music & Audio -> OS Music folder
  audio: {
    library: 'music',
    subfolderName: `${APP_NAME} Music`,
    category: 'Audio',
    extensions: ['.mp3', '.flac', '.m4a', '.wav', '.aac', '.ogg', '.opus', '.alac', '.wma', '.aiff', '.mid', '.midi']
  },
  // 2. Videos -> OS Videos folder
  video: {
    library: 'videos',
    subfolderName: `${APP_NAME} Videos`,
    category: 'Video',
    extensions: ['.mp4', '.mkv', '.avi', '.webm', '.mov', '.wmv', '.flv', '.m4v', '.ts', '.3gp', '.vob', '.ogv']
  },
  // 3. Documents -> OS Documents folder
  document: {
    library: 'documents',
    subfolderName: `${APP_NAME} Documents`,
    category: 'Documents',
    extensions: ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.epub', '.odt', '.rtf', '.csv', '.cbz', '.cbr', '.md']
  },
  // 4. Pictures -> OS Pictures folder
  picture: {
    library: 'pictures',
    subfolderName: `${APP_NAME} Pictures`,
    category: 'Pictures',
    extensions: ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.bmp', '.tiff', '.ico', '.psd', '.ai', '.raw', '.heic']
  },
  // 5. Compressed (Archives) -> OS Downloads folder
  archive: {
    library: 'downloads',
    subfolderName: `${APP_NAME} Compressed`,
    category: 'Compressed',
    extensions: ['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz', '.iso', '.pkg', '.part', '.z', '.cab', '.lzma']
  },
  // 6. Programs & Executables -> OS Downloads folder
  program: {
    library: 'downloads',
    subfolderName: `${APP_NAME} Programs`,
    category: 'Programs',
    extensions: ['.exe', '.msi', '.apk', '.bin', '.dmg', '.appimage', '.deb', '.rpm', '.bat', '.cmd', '.sh', '.vbs', '.jar']
  }
};

function detectFileType(filename, options = {}) {
  if (options.isMedia) {
    if (options.mediaType === 'audio') return EXTENSION_MAP.audio;
    if (options.mediaType === 'video') return EXTENSION_MAP.video;
  }

  const ext = path.extname(filename).toLowerCase();
  for (const type of Object.values(EXTENSION_MAP)) {
    if (type.extensions.includes(ext)) {
      return type;
    }
  }

  // Unrecognized -> OS Downloads / Hydra Other
  return {
    library: 'downloads',
    subfolderName: `${APP_NAME} Other`,
    category: 'Uncategorized',
    extensions: []
  };
}

/**
 * Resolves the destination directory and file path using standard OS folders:
 * Music -> %USERPROFILE%\Music\Hydra Music
 * Videos -> %USERPROFILE%\Videos\Hydra Videos
 * Documents -> %USERPROFILE%\Documents\Hydra Documents
 * Pictures -> %USERPROFILE%\Pictures\Hydra Pictures
 * Archives -> %USERPROFILE%\Downloads\Hydra Compressed
 * Programs -> %USERPROFILE%\Downloads\Hydra Programs
 * Other -> %USERPROFILE%\Downloads\Hydra Other
 */
function resolveDestinationPath(filename, options = {}) {
  const osFolders = getOsFolders();
  const fileType = detectFileType(filename, options);

  const baseLibraryFolder = osFolders[fileType.library] || osFolders.downloads;
  let targetFolder = path.join(baseLibraryFolder, fileType.subfolderName);

  // If a package name or playlist name is supplied, nest inside the playlist folder
  const pkg = options.packageName ? options.packageName.trim() : '';
  const isGenericPkg = !pkg || pkg.toLowerCase() === 'youtube downloads' || pkg.toLowerCase() === 'media downloads' || pkg.toLowerCase() === 'download';
  if (pkg && (!isGenericPkg || options.isPlaylist)) {
    const safePackage = pkg.replace(/[<>:"/\\|?*]/g, '_');
    targetFolder = path.join(targetFolder, safePackage);
  }

  fs.mkdirSync(targetFolder, { recursive: true });

  const safeFilename = filename.replace(/[<>:"/\\|?*]/g, '_');
  const savePath = path.join(targetFolder, safeFilename);

  return {
    folder: targetFolder,
    savePath,
    category: fileType.category,
    library: fileType.library
  };
}

async function computeFileSha256(filePath) {
  try {
    const stats = fs.statSync(filePath);
    // If small file (< 16MB), fast buffer read
    if (stats.size < 16 * 1024 * 1024) {
      return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
    }
    // For large files, stream in 2MB chunks to preserve RAM and prevent OOM
    return await new Promise((resolve) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath, { highWaterMark: 2 * 1024 * 1024 });
      stream.on('data', chunk => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', () => resolve(''));
    });
  } catch (_) {
    return '';
  }
}

/**
 * Preserves metadata:
 * 1. Sets file modification time (mtime) and access time (atime) from server Last-Modified or upload date.
 * 2. Writes metadata file (.meta.json) inside Windows Temp directory (NEVER cluttering the user's download folder).
 * 3. Removes any stray or legacy .meta.json files from the destination directory.
 */
async function preserveMetadata(filePath, metadata = {}) {
  if (!fs.existsSync(filePath)) return;

  try {
    // 1. Set file modification time from server Last-Modified
    if (metadata.lastModified) {
      const serverDate = new Date(metadata.lastModified);
      if (!isNaN(serverDate.getTime())) {
        try { fs.utimesSync(filePath, serverDate, serverDate); } catch (_) {}
      }
    }

    // 2. Compute file checksum (SHA256) memory-safely
    const sha256 = await computeFileSha256(filePath);

    // 3. Write metadata to Windows Temp folder so download directory remains clean
    const metaDir = path.join(os.tmpdir(), 'Waterfall', 'metadata');
    if (!fs.existsSync(metaDir)) {
      try { fs.mkdirSync(metaDir, { recursive: true }); } catch (_) {}
    }

    const metaKey = metadata.id || path.basename(filePath);
    const metaFilePath = path.join(metaDir, `${metaKey}.meta.json`);
    const metaData = {
      id: metadata.id || undefined,
      filename: path.basename(filePath),
      filePath: filePath,
      sourceUrl: metadata.url || '',
      directUrl: metadata.directUrl || '',
      hoster: metadata.hoster || 'Direct',
      category: metadata.category || '',
      packageName: metadata.packageName || '',
      fileSizeBytes: fs.statSync(filePath).size,
      serverLastModified: metadata.lastModified || null,
      downloadedAt: new Date().toISOString(),
      sha256: sha256 || undefined
    };

    fs.writeFileSync(metaFilePath, JSON.stringify(metaData, null, 2), 'utf-8');

    // 4. Clean up any stray or legacy .meta.json files from download folder
    const localMeta = `${filePath}.meta.json`;
    if (fs.existsSync(localMeta)) {
      try { fs.unlinkSync(localMeta); } catch (_) {}
    }
    const localPartMeta = `${filePath}.part.meta.json`;
    if (fs.existsSync(localPartMeta)) {
      try { fs.unlinkSync(localPartMeta); } catch (_) {}
    }
  } catch (err) {
    console.warn(`Failed to preserve metadata for ${filePath}:`, err.message);
  }
}

module.exports = {
  APP_NAME,
  getOsFolders,
  detectFileType,
  resolveDestinationPath,
  preserveMetadata
};
