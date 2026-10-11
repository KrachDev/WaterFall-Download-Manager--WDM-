const path = require('path');
const VIDEO_EXTS = /\.(mp4|mkv|avi|mov|wmv|flv|webm|m4v|ts|m2ts|vob|ogv|3gp|mpg|mpeg|m2v|divx|asf|rm|rmvb|f4v)$/i;

function isVideoFilename(filename) {
  if (!filename) return false;
  return VIDEO_EXTS.test(filename.trim());
}

/**
 * Recognizes and parses multipart archive filenames and groups them cleanly.
 * NOTE: Videos and standalone media files are NEVER grouped as multipart archives!
 * Examples handled:
 * - movie.part1.rar, movie.part2.rar
 * - archive.part01.rar, archive.part02.rar
 * - game.7z.001, game.7z.002
 * - package.zip.001, package.zip.002
 * - backup.z01, backup.z02, backup.zip
 * - data.r00, data.r01, data.rar
 */
function parseMultipartInfo(filename, packageName = '') {
  if (!filename || typeof filename !== 'string') {
    return { isMultipart: false, groupKey: null, partNumber: 1, isRootPart: false, format: null };
  }

  const clean = filename.trim();

  // Guard: Videos and standalone media files can NEVER be multipart archive parts!
  if (isVideoFilename(clean)) {
    return {
      isMultipart: false,
      groupKey: null,
      baseName: clean,
      partNumber: 1,
      isRootPart: false,
      format: null
    };
  }

  const lower = clean.toLowerCase();

  // 1. .part(\d+).rar OR .part(\d+)
  const partRarMatch = clean.match(/^(.*?)(?:[._\-\s]+part|part)(\d+)(\.rar|\.zip|\.7z|\.tar|\.iso)?$/i);
  if (partRarMatch) {
    const ext = (partRarMatch[3] || '').toLowerCase();
    // Guard against non-archive extensions
    if (ext && !/^\.(rar|zip|7z|tar|iso|gz|bz2|xz)$/i.test(ext)) {
      return { isMultipart: false, groupKey: null, baseName: clean, partNumber: 1, isRootPart: false, format: null };
    }
    const base = partRarMatch[1].replace(/[._\-\s]+$/, '').trim();
    const partNum = parseInt(partRarMatch[2], 10);
    const groupKey = generateGroupKey(base || packageName || clean);
    return {
      isMultipart: true,
      groupKey,
      baseName: base || packageName || groupKey,
      partNumber: partNum,
      isRootPart: (partNum === 1),
      format: ext.replace('.', '') || 'rar'
    };
  }

  // 2. .7z.(\d{3,}) or .zip.(\d{3,})
  const numExtMatch = clean.match(/^(.*?)\.(7z|zip|rar|tar)\.(\d{3,})$/i);
  if (numExtMatch) {
    const base = numExtMatch[1].trim();
    const fmt = numExtMatch[2].toLowerCase();
    const partNum = parseInt(numExtMatch[3], 10);
    const groupKey = generateGroupKey(base || packageName || clean);
    return {
      isMultipart: true,
      groupKey,
      baseName: base || packageName || groupKey,
      partNumber: partNum,
      isRootPart: (partNum === 1),
      format: fmt
    };
  }

  // 3. .z01, .z02 ... or .zip (companion to .z01)
  const zMatch = clean.match(/^(.*?)\.z(\d{2,})$/i);
  if (zMatch) {
    const base = zMatch[1].trim();
    const partNum = parseInt(zMatch[2], 10);
    const groupKey = generateGroupKey(base || packageName || clean);
    return {
      isMultipart: true,
      groupKey,
      baseName: base || packageName || groupKey,
      partNumber: partNum,
      isRootPart: false, // The .zip is usually the root header in span zip
      format: 'zip'
    };
  }

  // 4. .r00, .r01 ... (companion to old-style .rar)
  const rMatch = clean.match(/^(.*?)\.r(\d{2,})$/i);
  if (rMatch) {
    const base = rMatch[1].trim();
    const partNum = parseInt(rMatch[2], 10) + 1; // r00 is usually part 2, .rar is part 1
    const groupKey = generateGroupKey(base || packageName || clean);
    return {
      isMultipart: true,
      groupKey,
      baseName: base || packageName || groupKey,
      partNumber: partNum,
      isRootPart: false,
      format: 'rar'
    };
  }

  // 5. If packageName is provided and tasks share package with numbered files
  if (packageName && packageName.length > 2) {
    const numInFileMatch = clean.match(/(\d+)(?:\.[^.]+)?$/);
    if (numInFileMatch) {
      const partNum = parseInt(numInFileMatch[1], 10);
      const groupKey = generateGroupKey(packageName);
      return {
        isMultipart: true,
        groupKey,
        baseName: packageName,
        partNumber: partNum,
        isRootPart: (partNum === 1),
        format: path.extname(clean).replace('.', '') || 'archive'
      };
    }
  }

  return {
    isMultipart: false,
    groupKey: null,
    baseName: clean,
    partNumber: 1,
    isRootPart: false,
    format: null
  };
}

function generateGroupKey(name) {
  if (!name) return 'group_archive';
  return name
    .toLowerCase()
    .replace(/[._\-\s]+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .trim();
}

/**
 * Finds the designated root/first archive part from an array of file paths.
 */
function findRootArchivePart(paths = []) {
  if (!paths || paths.length === 0) return null;
  if (paths.length === 1) return paths[0];

  // 1. Look for part1 or part01
  const part1 = paths.find(p => /\.part0*1(\.rar)?$/i.test(p));
  if (part1) return part1;

  // 2. Look for .001
  const dot001 = paths.find(p => /\.(001|\d+\.001)$/i.test(p));
  if (dot001) return dot001;

  // 3. Look for .rar (in old-style .rar / .r00 / .r01 sets)
  const rarRoot = paths.find(p => /\.rar$/i.test(p) && !/\.part\d+\.rar$/i.test(p));
  if (rarRoot) return rarRoot;

  // 4. Look for .zip (in split .zip / .z01 sets)
  const zipRoot = paths.find(p => /\.zip$/i.test(p));
  if (zipRoot) return zipRoot;

  // Fallback: sort by natural part number (handles holes like parts 3, 5, 7 -> picks lowest part 3)
  const sorted = [...paths].sort((a, b) => {
    const matchA = a.match(/part0*(\d+)/i) || a.match(/\.(\d{3,})$/);
    const matchB = b.match(/part0*(\d+)/i) || b.match(/\.(\d{3,})$/);
    const numA = matchA ? parseInt(matchA[1], 10) : 999999;
    const numB = matchB ? parseInt(matchB[1], 10) : 999999;
    if (numA !== numB) return numA - numB;
    return a.localeCompare(b);
  });
  return sorted[0];
}

module.exports = {
  parseMultipartInfo,
  generateGroupKey,
  findRootArchivePart,
  isVideoFilename
};
