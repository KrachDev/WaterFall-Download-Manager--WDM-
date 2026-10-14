/**
 * Waterfall Download Suite — Content Script
 * In-Player Morphing Video Badge, Link Harvester, Alt-Key Bypass Hook, and In-Page Toasts.
 */

(() => {
  if (window.__WATERFALL_EXTENSION_INITIALIZED__ || window.__HYDRA_EXTENSION_INITIALIZED__) return;
  window.__WATERFALL_EXTENSION_INITIALIZED__ = true;
  window.__HYDRA_EXTENSION_INITIALIZED__ = true;

  let activeVideoElement = null;
  let panelRoot = null;
  let dropdownOpen = false;
  let sniffedMediaList = [];
  let hidePanelTimeout = null;

  let currentSettings = {
    enableVideoPanel: true,
    videoPanelPosition: 'top-right',
    videoPanelTrigger: 'hover',
    interceptDownloads: true,
    bypassKey: 'both'
  };

  function syncSettings() {
    chrome.runtime.sendMessage({ action: 'GET_SETTINGS' }, (settings) => {
      if (chrome.runtime.lastError || !settings) return;
      currentSettings = { ...currentSettings, ...settings };
      applySettingsUpdate();
    });
  }
  syncSettings();

  function applySettingsUpdate() {
    if (!currentSettings.enableVideoPanel && panelRoot) {
      closePanelCompletely();
    }
  }

  // Waterfall Icon SVG
  const HYDRA_ICON = `
    <svg viewBox="0 0 24 24" class="hydra-svg-icon">
      <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
    </svg>
  `;

  const MUSIC_ICON = `
    <svg viewBox="0 0 24 24" class="hydra-svg-icon" style="fill:#10b981;">
      <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
    </svg>
  `;

  const SUCCESS_ICON = `
    <svg viewBox="0 0 24 24" fill="#10b981" class="hydra-toast-icon">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
    </svg>
  `;

  const ERROR_ICON = `
    <svg viewBox="0 0 24 24" fill="#f43f5e" class="hydra-toast-icon">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
    </svg>
  `;

  const INFO_ICON = `
    <svg viewBox="0 0 24 24" fill="#00f2fe" class="hydra-toast-icon">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>
    </svg>
  `;

  function createPanelRoot() {
    if (panelRoot) return panelRoot;

    panelRoot = document.createElement('div');
    panelRoot.id = 'hydra-video-panel-root';
    panelRoot.style.display = 'none';
    panelRoot.style.opacity = '0';

    panelRoot.innerHTML = `
      <div class="hydra-panel-pill" id="hydra-trigger-pill">
        <div class="hydra-pill-main" id="hydra-trigger-btn" title="Download with Waterfall Engine">
          ${HYDRA_ICON}
          <span class="hydra-pill-label">Waterfall Video</span>
          <span class="hydra-panel-badge" id="hydra-media-count">1</span>
        </div>
        <button class="hydra-pill-dismiss" id="hydra-btn-dismiss" title="Dismiss for this video">&times;</button>
      </div>
      <div class="hydra-panel-dropdown" id="hydra-dropdown" style="display: none;">
        <div class="hydra-dropdown-header">
          <div class="hydra-dropdown-header-title">
            ${HYDRA_ICON}
            <span>Detected Streams</span>
          </div>
          <button class="hydra-dropdown-close" id="hydra-close-dropdown" title="Close Panel">&times;</button>
        </div>
        <div class="hydra-stream-list" id="hydra-streams"></div>
        <div class="hydra-dropdown-footer">
          <button class="hydra-crawler-btn" id="hydra-crawl-page-btn" title="Send full page URL to Waterfall Engine">
            ${HYDRA_ICON}
            <span>Send Page to Waterfall LinkGrabber</span>
          </button>
          <button class="hydra-dismiss-video-link" id="hydra-dismiss-video-link">
            Don't show on this video again
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(panelRoot);

    const triggerBtn = panelRoot.querySelector('#hydra-trigger-btn');
    const dropdown = panelRoot.querySelector('#hydra-dropdown');
    const closeBtn = panelRoot.querySelector('#hydra-close-dropdown');
    const dismissPillBtn = panelRoot.querySelector('#hydra-btn-dismiss');
    const dismissLinkBtn = panelRoot.querySelector('#hydra-dismiss-video-link');
    const crawlBtn = panelRoot.querySelector('#hydra-crawl-page-btn');

    triggerBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdownOpen = !dropdownOpen;
      dropdown.style.display = dropdownOpen ? 'flex' : 'none';
      if (dropdownOpen) {
        populateStreamList();
        if (hidePanelTimeout) clearTimeout(hidePanelTimeout);
      } else {
        scheduleHidePanel();
      }
    });

    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closePanelCompletely();
    });

    dismissPillBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      dismissActiveVideo();
    });

    dismissLinkBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      dismissActiveVideo();
    });

    crawlBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const pageTitle = getMediaPageTitle(activeVideoElement);
      await sendUrlToHydra({
        url: window.location.href,
        packageName: pageTitle,
        filename: `${pageTitle}.mp4`
      });
      closePanelCompletely();
    });

    panelRoot.addEventListener('mouseenter', () => {
      if (hidePanelTimeout) clearTimeout(hidePanelTimeout);
      panelRoot.style.opacity = '1';
    });

    panelRoot.addEventListener('mouseleave', () => {
      scheduleHidePanel();
    });

    document.addEventListener('click', (e) => {
      if (dropdownOpen && !panelRoot.contains(e.target)) {
        dropdownOpen = false;
        dropdown.style.display = 'none';
        scheduleHidePanel();
      }
    });

    return panelRoot;
  }

  function closePanelCompletely() {
    dropdownOpen = false;
    if (hidePanelTimeout) clearTimeout(hidePanelTimeout);
    if (!panelRoot) return;

    panelRoot.style.opacity = '0';
    setTimeout(() => {
      if (!dropdownOpen && panelRoot && panelRoot.style.opacity === '0') {
        panelRoot.style.display = 'none';
        const dd = panelRoot.querySelector('#hydra-dropdown');
        if (dd) dd.style.display = 'none';
      }
    }, 200);
  }

  function dismissActiveVideo() {
    if (activeVideoElement) {
      activeVideoElement.__hydra_dismissed__ = true;
    }
    closePanelCompletely();
    showToast('Video Badge Dismissed', 'Hidden for this video. You can still download via the Waterfall browser icon.', 'info');
  }

  function attachToVideo(videoEl) {
    if (!currentSettings.enableVideoPanel) return;
    if (!videoEl || !document.body.contains(videoEl)) return;
    if (videoEl.__hydra_dismissed__) return;

    const rect = videoEl.getBoundingClientRect();
    if (rect.width < 220 || rect.height < 140) return;

    const style = window.getComputedStyle(videoEl);
    if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) < 0.1) return;

    activeVideoElement = videoEl;
    createPanelRoot();

    const scrollX = window.scrollX || window.pageXOffset;
    const scrollY = window.scrollY || window.pageYOffset;

    const pos = currentSettings.videoPanelPosition || 'top-right';
    let top = scrollY + rect.top + 12;
    let left = scrollX + rect.right - 148;

    if (pos === 'top-left') {
      left = scrollX + rect.left + 12;
    } else if (pos === 'bottom-right') {
      top = scrollY + rect.bottom - 48;
      left = scrollX + rect.right - 148;
    } else if (pos === 'bottom-left') {
      top = scrollY + rect.bottom - 48;
      left = scrollX + rect.left + 12;
    }

    panelRoot.style.top = `${Math.max(scrollY + 6, top)}px`;
    panelRoot.style.left = `${Math.max(scrollX + 6, left)}px`;
    panelRoot.style.display = 'block';

    requestAnimationFrame(() => {
      if (panelRoot) panelRoot.style.opacity = '1';
    });

    updateBadgeCount();
  }

  function scheduleHidePanel() {
    if (dropdownOpen) return;
    if (hidePanelTimeout) clearTimeout(hidePanelTimeout);
    hidePanelTimeout = setTimeout(() => {
      if (!dropdownOpen && panelRoot && !panelRoot.matches(':hover')) {
        panelRoot.style.opacity = '0';
        setTimeout(() => {
          if (!dropdownOpen && panelRoot && panelRoot.style.opacity === '0') {
            panelRoot.style.display = 'none';
          }
        }, 220);
      }
    }, 2400);
  }

  function updateBadgeCount() {
    if (!panelRoot) return;
    const countEl = panelRoot.querySelector('#hydra-media-count');
    const available = getAvailableStreams();
    if (countEl) countEl.textContent = Math.max(1, available.length);
  }

  function getMediaPageTitle(videoEl) {
    let title = '';
    const host = window.location.hostname.toLowerCase();

    // 1. YouTube specific selectors
    if (host.includes('youtube.com') || host.includes('youtu.be')) {
      const ytTitleEl = document.querySelector('h1.ytd-watch-metadata yt-formatted-string') ||
                         document.querySelector('#above-the-fold h1 yt-formatted-string') ||
                         document.querySelector('ytd-watch-metadata #title h1') ||
                         document.querySelector('h1.title yt-formatted-string') ||
                         document.querySelector('yt-formatted-string.ytd-video-primary-info-renderer');
      if (ytTitleEl && ytTitleEl.textContent.trim()) {
        title = ytTitleEl.textContent.trim();
      }
    }

    // 2. OpenGraph / Twitter meta tags (Vimeo, Twitter/X, TikTok, News sites, etc.)
    if (!title) {
      const og = document.querySelector('meta[property="og:title"]');
      if (og && og.content && og.content.trim()) title = og.content.trim();
    }
    if (!title) {
      const tw = document.querySelector('meta[name="twitter:title"]');
      if (tw && tw.content && tw.content.trim()) title = tw.content.trim();
    }
    if (!title) {
      const metaTitle = document.querySelector('meta[name="title"]');
      if (metaTitle && metaTitle.content && metaTitle.content.trim()) title = metaTitle.content.trim();
    }

    // 3. Nearest semantic video title in DOM
    if (!title && videoEl) {
      const parent = videoEl.closest('article, section, main, .video-player, .player-container, [data-testid="tweetText"]');
      if (parent) {
        const heading = parent.querySelector('h1, h2, h3, [data-testid="tweetText"]');
        if (heading && heading.textContent.trim()) {
          title = heading.textContent.trim();
        }
      }
      if (!title) {
        title = videoEl.getAttribute('title') || videoEl.getAttribute('aria-label') || '';
      }
    }

    // 4. Document title fallback
    if (!title && document.title) {
      title = document.title;
    }

    // Strip common website branding suffixes (like IDM)
    title = (title || '')
      .replace(/\s*[-–|•]\s*YouTube\s*$/i, '')
      .replace(/\s*[-–|•]\s*Twitch\s*$/i, '')
      .replace(/\s*[-–|•]\s*Vimeo\s*$/i, '')
      .replace(/\s*[-–|•]\s*TikTok\s*$/i, '')
      .replace(/\s*[-–|•]\s*Dailymotion\s*$/i, '')
      .replace(/\s*[-–|•]\s*Bilibili\s*$/i, '')
      .replace(/\s*[-–|•]\s*SoundCloud\s*$/i, '')
      .replace(/\s*[-–|•]\s*Twitter\s*$/i, '')
      .replace(/\s*\/ X\s*$/i, '')
      .replace(/\s*[-–|•]\s*Facebook\s*$/i, '')
      .replace(/\s*:\s*Reddit\s*$/i, '')
      .replace(/[\r\n\t]+/g, ' ')
      .trim();

    // Sanitize illegal filesystem characters for Windows
    title = title.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/\s+/g, ' ').trim();
    title = title.replace(/[.\s]+$/, '');

    return title || ('Video_' + Date.now());
  }

  function getAvailableStreams() {
    const list = [];
    const seenUrls = new Set();
    const mediaTitle = getMediaPageTitle(activeVideoElement);
    const host = window.location.hostname.toLowerCase();
    const isYouTube = host.includes('youtube.com') || host.includes('youtu.be');

    // On YouTube: Provide clean merged Full HD video and MP3 audio presets via yt-dlp
    if (isYouTube) {
      seenUrls.add(window.location.href);
      list.push({
        title: `${mediaTitle} (1080p Full HD)`,
        url: window.location.href,
        filename: `${mediaTitle}.mp4`,
        isMedia: true,
        mediaOptions: { mediaType: 'video', videoQuality: '1080' },
        type: 'YouTube Video (1080p Full HD)',
        size: '1080p'
      });
      list.push({
        title: `${mediaTitle} (720p HD)`,
        url: window.location.href,
        filename: `${mediaTitle}.mp4`,
        isMedia: true,
        mediaOptions: { mediaType: 'video', videoQuality: '720' },
        type: 'YouTube Video (720p HD)',
        size: '720p'
      });
      list.push({
        title: `${mediaTitle} (Best / 4K)`,
        url: window.location.href,
        filename: `${mediaTitle}.mp4`,
        isMedia: true,
        mediaOptions: { mediaType: 'video', videoQuality: 'best' },
        type: 'YouTube Video (Best Available)',
        size: 'Best Quality'
      });
      return list; // On YouTube, skip all raw googlevideo chunks
    }

    // 1. Direct src (Non-YouTube sites)
    if (activeVideoElement && activeVideoElement.src && !activeVideoElement.src.startsWith('blob:')) {
      seenUrls.add(activeVideoElement.src);
      const ext = activeVideoElement.src.includes('.webm') ? 'webm' : 'mp4';
      list.push({
        title: mediaTitle,
        url: activeVideoElement.src,
        filename: `${mediaTitle}.${ext}`,
        type: 'Direct Video Stream',
        size: 'Direct Source'
      });
    }

    // 2. Child <source>
    if (activeVideoElement) {
      const sources = activeVideoElement.querySelectorAll('source');
      sources.forEach((s, idx) => {
        if (s.src && !seenUrls.has(s.src) && !s.src.startsWith('blob:')) {
          seenUrls.add(s.src);
          const ext = s.type && s.type.includes('webm') ? 'webm' : 'mp4';
          const subTitle = sources.length > 1 ? `${mediaTitle} (Quality #${idx + 1})` : mediaTitle;
          list.push({
            title: subTitle,
            url: s.src,
            filename: `${subTitle}.${ext}`,
            type: s.type || 'Video',
            size: 'Direct Source'
          });
        }
      });
    }

    // 3. Network sniffed items
    sniffedMediaList.forEach((m, idx) => {
      if (!seenUrls.has(m.url)) {
        seenUrls.add(m.url);
        const ext = m.contentType && m.contentType.includes('webm') ? 'webm' : 'mp4';
        const streamTitle = sniffedMediaList.length > 1 ? `${mediaTitle} (Stream #${idx + 1})` : mediaTitle;
        list.push({
          title: streamTitle,
          url: m.url,
          filename: `${streamTitle}.${ext}`,
          type: m.contentType || 'Media',
          size: m.formattedSize || 'Stream'
        });
      }
    });

    // 4. Fallback page itself
    if (list.length === 0) {
      list.push({
        title: mediaTitle,
        url: window.location.href,
        filename: `${mediaTitle}.mp4`,
        isMedia: isYouTube,
        type: isYouTube ? 'YouTube Video' : 'Page Media',
        size: 'Auto-Detect'
      });
    }

    return list;
  }

  function populateStreamList() {
    if (!panelRoot) return;
    const container = panelRoot.querySelector('#hydra-streams');
    if (!container) return;

    container.innerHTML = '';
    const streams = getAvailableStreams();

    streams.forEach((stream) => {
      const item = document.createElement('div');
      item.className = 'hydra-stream-item';

      const info = document.createElement('div');
      info.className = 'hydra-stream-info';

      const title = document.createElement('div');
      title.className = 'hydra-stream-title';
      title.textContent = stream.title;

      const meta = document.createElement('div');
      meta.className = 'hydra-stream-meta';
      meta.textContent = `${stream.type} • ${stream.size}`;

      info.appendChild(title);
      info.appendChild(meta);

      const actions = document.createElement('div');
      actions.className = 'hydra-stream-actions';

      // 1. Download Video
      const dlBtn = document.createElement('button');
      dlBtn.className = 'hydra-action-btn';
      dlBtn.textContent = '⚡ Download';
      dlBtn.title = 'Download via Waterfall multi-chunk engine';
      dlBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await sendUrlToHydra({
          url: stream.url,
          filename: stream.filename,
          packageName: stream.title,
          isMedia: !!stream.isMedia,
          mediaOptions: stream.mediaOptions || (stream.isMedia ? { mediaType: 'video', videoQuality: '1080' } : null)
        });
        closePanelCompletely();
      });

      // 2. Convert to MP3
      const mp3Btn = document.createElement('button');
      mp3Btn.className = 'hydra-action-btn secondary';
      mp3Btn.textContent = '🎵 MP3';
      mp3Btn.title = 'Convert to MP3 (320 kbps) with Waterfall';
      mp3Btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const baseName = (stream.filename || stream.title).replace(/\.[^/.]+$/, '');
        await sendUrlToHydra({
          url: stream.url,
          filename: `${baseName}.mp3`,
          packageName: stream.title,
          isMedia: true,
          mediaOptions: {
            mediaType: 'audio',
            audioFormat: 'mp3',
            audioQuality: '0'
          }
        });
        closePanelCompletely();
      });

      actions.appendChild(dlBtn);
      actions.appendChild(mp3Btn);

      item.appendChild(info);
      item.appendChild(actions);
      container.appendChild(item);
    });
  }

  async function sendUrlToHydra(options = {}) {
    const url = typeof options === 'string' ? options : options.url;
    const fallbackTitle = getMediaPageTitle(activeVideoElement);
    const packageName = options.packageName || fallbackTitle;
    const filename = options.filename || `${packageName}.mp4`;
    const mediaOptions = options.mediaOptions || null;
    const isMedia = options.isMedia !== undefined ? options.isMedia : false;

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'SEND_TO_HYDRA',
        data: {
          urls: [url],
          filename,
          packageName,
          source: window.location.href,
          isMedia,
          mediaOptions
        }
      });

      if (response && response.success) {
        showToast('Sent to Waterfall!', `Downloading "${filename}" with Waterfall Engine`, 'success');
      } else {
        showToast('Waterfall Notice', (response && response.error) || 'Failed to dispatch to Waterfall Engine', 'error');
      }
    } catch (err) {
      showToast('Connection Failed', 'Ensure Waterfall is running on port 4567', 'error');
    }
  }

  // Hover detection on videos
  function setupVideoListeners(video) {
    if (video.__hydra_bound__) return;
    video.__hydra_bound__ = true;

    video.addEventListener('mouseenter', () => attachToVideo(video));
    video.addEventListener('mousemove', () => attachToVideo(video));
    video.addEventListener('mouseleave', () => scheduleHidePanel());
  }

  function scanForVideos() {
    document.querySelectorAll('video').forEach(setupVideoListeners);
  }

  scanForVideos();
  const observer = new MutationObserver(() => scanForVideos());
  observer.observe(document.body || document.documentElement, { childList: true, subtree: true });

  // Listen for sniffed media updates from background worker
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'MEDIA_DETECTED') {
      if (Array.isArray(msg.allMedia)) sniffedMediaList = msg.allMedia;
      else if (msg.media) sniffedMediaList.unshift(msg.media);
      updateBadgeCount();
      if (dropdownOpen) populateStreamList();
    } else if (msg.action === 'SETTINGS_UPDATED') {
      currentSettings = { ...currentSettings, ...msg.settings };
      applySettingsUpdate();
    } else if (msg.action === 'HARVEST_PAGE_LINKS') {
      const links = harvestPageLinks();
      sendResponse({ links });
    }
  });

  // Collect page links for LinkGrabber
  function harvestPageLinks() {
    const list = new Set();
    document.querySelectorAll('a[href]').forEach(a => {
      const h = a.href;
      if (h && (h.startsWith('http://') || h.startsWith('https://') || h.startsWith('magnet:?'))) {
        list.add(h);
      }
    });
    document.querySelectorAll('img[src], video[src], audio[src], source[src]').forEach(el => {
      const s = el.src;
      if (s && (s.startsWith('http://') || s.startsWith('https://'))) {
        list.add(s);
      }
    });
    return Array.from(list);
  }

  // Ctrl / Alt Key Bypass Hook: allow normal browser download when holding Ctrl or Alt
  function isBypassKeyTriggered(e) {
    const keyMode = currentSettings.bypassKey || 'both';
    const isCtrl = !!(e.ctrlKey || e.metaKey);
    const isAlt = !!e.altKey;

    if (keyMode === 'ctrl') return isCtrl;
    if (keyMode === 'alt') return isAlt;
    return isCtrl || isAlt; // 'both' or default
  }

  function handleBypassTrigger(e) {
    if (isBypassKeyTriggered(e)) {
      const keyName = (e.ctrlKey || e.metaKey) ? (e.metaKey ? 'Cmd' : 'Ctrl') : 'Alt';
      const anchor = e.target && e.target.closest ? e.target.closest('a[href]') : null;
      const clickedUrl = anchor ? anchor.href : null;

      chrome.runtime.sendMessage({
        action: 'REGISTER_BYPASS_URL',
        url: clickedUrl,
        pageUrl: window.location.href,
        key: keyName
      }).catch(() => {});

      showToast(`${keyName} Key Bypass`, 'Forcing native browser download instead of Waterfall.', 'info');
    }
  }

  document.addEventListener('click', handleBypassTrigger, true);
  document.addEventListener('auxclick', handleBypassTrigger, true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && isBypassKeyTriggered(e)) {
      handleBypassTrigger(e);
    }
  }, true);

  // In-Page Toast Display
  function showToast(title, message, type = 'info') {
    let container = document.getElementById('hydra-toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'hydra-toast-container';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = 'hydra-toast';

    let iconSvg = INFO_ICON;
    if (type === 'success') iconSvg = SUCCESS_ICON;
    else if (type === 'error') iconSvg = ERROR_ICON;

    toast.innerHTML = `
      ${iconSvg}
      <div class="hydra-toast-content">
        <div class="hydra-toast-title">${title}</div>
        <div class="hydra-toast-msg">${message}</div>
      </div>
    `;

    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px) scale(0.95)';
      toast.style.transition = 'all 0.2s ease';
      setTimeout(() => toast.remove(), 220);
    }, 4200);
  }
})();
