/**
 * Waterfall Advanced Naming Retrieval & Parsing Engine
 * Implements RFC 6266/5987/2183 Content-Disposition parsing, URL query extraction,
 * MIME type deduction, recursive percent-decoding, and Windows filesystem sanitization.
 */

const path = require('path');

const MIME_EXTENSION_MAP = {
  // Archives & Compressed
  'application/zip': '.zip',
  'application/x-zip-compressed': '.zip',
  'application/x-rar-compressed': '.rar',
  'application/vnd.rar': '.rar',
  'application/x-7z-compressed': '.7z',
  'application/x-tar': '.tar',
  'application/gzip': '.tar.gz',
  'application/x-gzip': '.gz',
  'application/x-bzip2': '.bz2',
  'application/x-xz': '.xz',
  'application/x-iso9660-image': '.iso',

  // Executables & Installers
  'application/x-msdownload': '.exe',
  'application/x-msdos-program': '.exe',
  'application/vnd.microsoft.portable-executable': '.exe',
  'application/x-msi': '.msi',
  'application/x-apple-diskimage': '.dmg',
  'application/x-debian-package': '.deb',
  'application/x-redhat-package-manager': '.rpm',
  'application/vnd.android.package-archive': '.apk',

  // Video
  'video/mp4': '.mp4',
  'video/x-matroska': '.mkv',
  'video/webm': '.webm',
  'video/x-msvideo': '.avi',
  'video/quicktime': '.mov',
  'video/x-flv': '.flv',
  'video/mpeg': '.mpeg',

  // Audio
  'audio/mpeg': '.mp3',
  'audio/mp3': '.mp3',
  'audio/flac': '.flac',
  'audio/x-flac': '.flac',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/aac': '.aac',
  'audio/ogg': '.ogg',
  'audio/opus': '.opus',
  'audio/mp4': '.m4a',
  'audio/x-m4a': '.m4a',

  // Documents
  'application/pdf': '.pdf',
  'application/epub+zip': '.epub',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.ms-powerpoint': '.ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'text/plain': '.txt',
  'text/markdown': '.md',

  // Images
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/svg+xml': '.svg',
  'image/x-icon': '.ico'
};

const GENERIC_EXTENSIONS = new Set([
  '.php', '.aspx', '.asp', '.jsp', '.html', '.htm',
  '.cgi', '.do', '.action', '.ashx', '.axd', '.pl', '.py'
]);

const GENERIC_NAMES = new Set([
  'download', 'download.php', 'get', 'file', 'index', 'index.php',
  'api', 'stream', 'media', 'attachment', 'attachment.php', 'default',
  'files', 'content', 'load', 'blob', 'raw', 'view'
]);

/**
 * Deep percent-decode string up to 3 passes to unwrap double-encoded strings
 * (e.g. %2520 -> %20 -> ' ', %5BSuperPSX.com%5D -> [SuperPSX.com])
 */
function deepDecode(str) {
  if (!str) return '';
  let prev = str;
  for (let i = 0; i < 3; i++) {
    try {
      const decoded = decodeURIComponent(prev);
      if (decoded === prev) break;
      prev = decoded;
    } catch (_) {
      break;
    }
  }
  return prev;
}

/**
 * Clean illegal Windows filesystem characters & trailing spaces/dots
 */
function sanitizeFilename(name) {
  if (!name) return '';
  let clean = deepDecode(name.trim());

  // Replace query strings or hash leftovers if attached
  clean = clean.split(/[?#]/)[0].trim();

  // Replace Windows illegal characters: <>:"/\|?* and control codes
  clean = clean.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');

  // Collapse multiple underscores or spaces
  clean = clean.replace(/\s+/g, ' ').replace(/_+/g, '_').trim();

  // Strip trailing dots and spaces (NTFS invalid)
  clean = clean.replace(/[. ]+$/, '');

  // Truncate to maximum 230 characters to leave room for extensions
  if (clean.length > 230) {
    const ext = path.extname(clean);
    clean = clean.substring(0, 230 - ext.length) + ext;
  }

  return clean;
}

/**
 * Parse RFC 6266 / RFC 5987 / RFC 2183 Content-Disposition header
 */
function parseContentDisposition(header) {
  if (!header || typeof header !== 'string') return '';

  // 1. Check for filename*=UTF-8''encoded_name (RFC 5987)
  const starMatch = header.match(/filename\*=(?:[A-Za-z0-9_-]+'')?([^;\r\n]+)/i);
  if (starMatch && starMatch[1]) {
    let raw = starMatch[1].trim().replace(/^["']|["']$/g, '');
    let decoded = deepDecode(raw);
    if (decoded && decoded.length > 0) {
      return sanitizeFilename(decoded);
    }
  }

  // 2. Check for filename="quoted" or filename=unquoted
  const normMatch = header.match(/filename\s*=\s*(?:"([^"]+)"|'([^']+)'|([^;\s\r\n]+))/i);
  if (normMatch) {
    const raw = normMatch[1] || normMatch[2] || normMatch[3];
    if (raw) {
      let decoded = deepDecode(raw.trim());
      if (decoded && decoded.length > 0) {
        return sanitizeFilename(decoded);
      }
    }
  }

  return '';
}

/**
 * Extract filename hints from URL query parameters
 */
function extractFilenameFromQuery(urlObj) {
  if (!urlObj || !urlObj.searchParams) return '';

  const candidates = [
    'filename', 'file_name', 'file', 'fileName', 'name',
    'attachment', 'response-content-disposition', 'r_filename',
    'title', 'doc', 'f'
  ];

  for (const key of candidates) {
    const val = urlObj.searchParams.get(key);
    if (val && typeof val === 'string' && val.trim().length > 2) {
      if (val.toLowerCase().includes('filename=')) {
        const parsed = parseContentDisposition(val);
        if (parsed) return parsed;
      }
      const cleaned = sanitizeFilename(val);
      const ext = path.extname(cleaned).toLowerCase();
      if (ext && ext.length >= 2 && !GENERIC_EXTENSIONS.has(ext)) {
        return cleaned;
      }
    }
  }

  return '';
}

/**
 * Extract filename from URL pathname
 */
function extractFilenameFromPathname(urlStr) {
  if (!urlStr) return '';
  try {
    const u = new URL(urlStr);

    const queryName = extractFilenameFromQuery(u);
    if (queryName) return queryName;

    const segments = u.pathname.split('/').filter(s => s && s.trim().length > 0);
    if (segments.length === 0) return '';

    for (let i = segments.length - 1; i >= 0; i--) {
      const seg = segments[i].trim();
      const decoded = deepDecode(seg);
      const sanitized = sanitizeFilename(decoded);
      const baseNameWithoutExt = sanitized.replace(/\.[^/.]+$/, '').toLowerCase();
      const ext = path.extname(sanitized).toLowerCase();

      if (!sanitized || GENERIC_NAMES.has(baseNameWithoutExt)) continue;

      if (ext && ext.length >= 2 && !GENERIC_EXTENSIONS.has(ext)) {
        return sanitized;
      }
    }

    const lastSeg = sanitizeFilename(deepDecode(segments[segments.length - 1]));
    const baseName = lastSeg.replace(/\.[^/.]+$/, '').toLowerCase();
    if (lastSeg && !GENERIC_NAMES.has(baseName)) {
      return lastSeg;
    }
  } catch (_) {}

  return '';
}

/**
 * Get recommended file extension from Content-Type MIME header
 */
function getExtensionFromMime(contentType) {
  if (!contentType) return '';
  const cleanMime = contentType.split(';')[0].trim().toLowerCase();
  return MIME_EXTENSION_MAP[cleanMime] || '';
}

/**
 * Master Filename Resolution Function
 */
function resolveBestFilename({
  explicitFilename = '',
  contentDisposition = '',
  finalUrl = '',
  initialUrl = '',
  contentType = '',
  packageName = '',
  isMedia = false
} = {}) {
  let resolved = '';

  // 1. Explicit filename
  if (explicitFilename && typeof explicitFilename === 'string') {
    const sanitized = sanitizeFilename(explicitFilename);
    const baseName = sanitized.replace(/\.[^/.]+$/, '').toLowerCase();
    if (sanitized && !GENERIC_NAMES.has(baseName)) {
      resolved = sanitized;
    }
  }

  // 2. Content-Disposition header
  if (!resolved && contentDisposition) {
    const fromCd = parseContentDisposition(contentDisposition);
    if (fromCd && !GENERIC_NAMES.has(fromCd.toLowerCase())) {
      resolved = fromCd;
    }
  }

  // 3. Final redirected URL
  if (!resolved && finalUrl) {
    const fromFinal = extractFilenameFromPathname(finalUrl);
    if (fromFinal) resolved = fromFinal;
  }

  // 4. Initial URL
  if (!resolved && initialUrl) {
    const fromInitial = extractFilenameFromPathname(initialUrl);
    if (fromInitial) resolved = fromInitial;
  }

  // 5. Package Name hint
  if (!resolved && packageName && typeof packageName === 'string') {
    const sanitizedPkg = sanitizeFilename(packageName);
    if (sanitizedPkg && !GENERIC_NAMES.has(sanitizedPkg.toLowerCase())) {
      resolved = sanitizedPkg;
    }
  }

  // 6. Generic fallback
  if (!resolved) {
    const prefix = isMedia ? 'Media_Download' : 'download';
    resolved = `${prefix}_${Date.now()}`;
  }

  // Ensure extension
  const curExt = path.extname(resolved).toLowerCase();
  if (!curExt || GENERIC_EXTENSIONS.has(curExt) || curExt.length < 2) {
    const mimeExt = getExtensionFromMime(contentType);
    if (mimeExt) {
      if (GENERIC_EXTENSIONS.has(curExt)) {
        resolved = resolved.substring(0, resolved.length - curExt.length) + mimeExt;
      } else {
        resolved = resolved + mimeExt;
      }
    } else if (isMedia) {
      resolved = resolved + (contentType.startsWith('audio') ? '.mp3' : '.mp4');
    }
  }

  return sanitizeFilename(resolved);
}

module.exports = {
  sanitizeFilename,
  parseContentDisposition,
  extractFilenameFromPathname,
  extractFilenameFromQuery,
  getExtensionFromMime,
  resolveBestFilename,
  deepDecode
};
