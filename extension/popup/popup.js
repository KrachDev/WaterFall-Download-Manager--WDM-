/**
 * Hydra Download Suite — Popup Controller
 * Coordinates batch link grabbing, media sniffer, direct URL converter, and settings.
 */

document.addEventListener('DOMContentLoaded', async () => {
  // Elements
  const statusPill = document.getElementById('status-pill');
  const statusText = document.getElementById('status-text');
  const btnRefreshStatus = document.getElementById('btn-refresh-status');
  const btnOpenOptions = document.getElementById('btn-open-options');
  const linkFullOptions = document.getElementById('link-full-options');
  const popupToast = document.getElementById('popup-toast');

  // Nav tabs
  const navTabs = document.querySelectorAll('.nav-tab');
  const tabPanes = document.querySelectorAll('.tab-pane');
  const grabberBadge = document.getElementById('grabber-count');
  const mediaBadge = document.getElementById('media-count');

  // Grabber elements
  const linksContainer = document.getElementById('links-list');
  const linkSearchInput = document.getElementById('link-search');
  const btnSelectAll = document.getElementById('btn-select-all');
  const btnDeselectAll = document.getElementById('btn-deselect-all');
  const packageNameInput = document.getElementById('package-name');
  const grabberAutostart = document.getElementById('grabber-autostart');
  const btnSendSelected = document.getElementById('btn-send-selected');
  const btnStageSelected = document.getElementById('btn-stage-selected');
  const btnSendLabel = document.getElementById('btn-send-label');
  const filterChips = document.querySelectorAll('.chip');

  // Count elements
  const countAll = document.getElementById('count-all');
  const countVideo = document.getElementById('count-video');
  const countAudio = document.getElementById('count-audio');
  const countArchive = document.getElementById('count-archive');
  const countDocument = document.getElementById('count-document');
  const countImage = document.getElementById('count-image');

  // Media Sniffer elements
  const mediaListContainer = document.getElementById('media-list');
  const btnDownloadAllMedia = document.getElementById('btn-download-all-media');

  // Direct Add elements
  const directUrlsTextarea = document.getElementById('direct-urls');
  const directFormatSelect = document.getElementById('direct-format');
  const directPackageInput = document.getElementById('direct-package');
  const directPasswordInput = document.getElementById('direct-password');
  const directAutostart = document.getElementById('direct-autostart');
  const btnSendDirect = document.getElementById('btn-send-direct');

  // Settings elements
  const settingHydraHost = document.getElementById('setting-hydra-host');
  const btnTestConnection = document.getElementById('btn-test-connection');
  const settingIntercept = document.getElementById('setting-intercept');
  const settingVideoPanel = document.getElementById('setting-video-panel');
  const settingVideoPos = document.getElementById('setting-video-pos');
  const settingAutostart = document.getElementById('setting-autostart');
  const btnSaveSettings = document.getElementById('btn-save-settings');

  // State
  let activeTab = null;
  let allHarvestedLinks = [];
  let currentFilter = 'all';
  let searchQuery = '';
  let selectedUrls = new Set();
  let capturedMediaStreams = [];

  // 1. Get active tab
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTab = tabs[0];
  if (activeTab && activeTab.title) {
    packageNameInput.value = activeTab.title.slice(0, 50);
    directPackageInput.value = activeTab.title.slice(0, 50);
  }

  // 2. Tab Navigation
  navTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetId = tab.getAttribute('data-tab');
      navTabs.forEach(t => t.classList.remove('active'));
      tabPanes.forEach(p => p.classList.remove('active'));

      tab.classList.add('active');
      const targetPane = document.getElementById(targetId);
      if (targetPane) targetPane.classList.add('active');

      if (targetId === 'tab-media') loadCapturedMedia();
    });
  });

  // 3. Status Checking
  async function checkStatus() {
    statusText.textContent = 'Probing Waterfall...';
    const dot = statusPill.querySelector('.status-dot');
    dot.className = 'status-dot status-checking';

    try {
      const res = await chrome.runtime.sendMessage({ action: 'CHECK_STATUS' });
      if (res && res.connected) {
        dot.className = 'status-dot status-online';
        statusText.textContent = `Waterfall Online (${res.latency || 0}ms)`;
      } else {
        dot.className = 'status-dot status-offline';
        statusText.textContent = 'Waterfall Offline';
      }
    } catch {
      dot.className = 'status-dot status-offline';
      statusText.textContent = 'Cannot connect';
    }
  }

  btnRefreshStatus.addEventListener('click', checkStatus);
  checkStatus();

  // Settings shortcuts
  const openOptions = () => chrome.runtime.openOptionsPage();
  btnOpenOptions.addEventListener('click', openOptions);
  if (linkFullOptions) linkFullOptions.addEventListener('click', (e) => { e.preventDefault(); openOptions(); });

  // 4. Link Harvesting from Content Script
  async function harvestLinks() {
    if (!activeTab || !activeTab.id) {
      linksContainer.innerHTML = '<div class="empty-state"><p>Cannot access active tab.</p></div>';
      return;
    }

    try {
      const response = await chrome.tabs.sendMessage(activeTab.id, { action: 'HARVEST_PAGE_LINKS' });
      if (response && Array.isArray(response.links)) {
        processLinks(response.links);
      } else {
        linksContainer.innerHTML = '<div class="empty-state"><p>No links found on this page.</p></div>';
      }
    } catch {
      // Content script may not be loaded yet or restricted page
      linksContainer.innerHTML = `
        <div class="empty-state">
          <p>Page could not be scanned.<br><small>Reload the tab or check chrome:// URL restrictions.</small></p>
        </div>
      `;
    }
  }

  function processLinks(rawUrls) {
    const unique = Array.from(new Set(rawUrls));
    allHarvestedLinks = unique.map(url => {
      const clean = url.split('?')[0].split('#')[0];
      const filename = clean.split('/').pop() || url;
      const ext = ('.' + filename.split('.').pop()).toLowerCase();
      const cat = categorizeExtension(ext);
      return { url, filename, ext, category: cat };
    });

    // Default select downloadable categories
    selectedUrls.clear();
    allHarvestedLinks.forEach(item => {
      if (item.category !== 'other' && item.category !== 'image') {
        selectedUrls.add(item.url);
      }
    });

    updateCounters();
    renderLinks();
  }

  function categorizeExtension(ext) {
    const videoExts = ['.mp4', '.mkv', '.webm', '.avi', '.mov', '.flv', '.m4v', '.ts', '.m3u8', '.mpd'];
    const audioExts = ['.mp3', '.flac', '.wav', '.aac', '.m4a', '.ogg', '.opus', '.wma'];
    const archiveExts = ['.zip', '.rar', '.7z', '.tar', '.gz', '.iso', '.bz2', '.xz', '.cab'];
    const docExts = ['.pdf', '.epub', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.csv'];
    const imgExts = ['.png', '.jpg', '.jpeg', '.webp', '.svg', '.gif', '.bmp', '.ico'];

    if (videoExts.includes(ext)) return 'video';
    if (audioExts.includes(ext)) return 'audio';
    if (archiveExts.includes(ext)) return 'archive';
    if (docExts.includes(ext)) return 'document';
    if (imgExts.includes(ext)) return 'image';
    return 'other';
  }

  function updateCounters() {
    let video = 0, audio = 0, archive = 0, doc = 0, img = 0;
    allHarvestedLinks.forEach(item => {
      if (item.category === 'video') video++;
      else if (item.category === 'audio') audio++;
      else if (item.category === 'archive') archive++;
      else if (item.category === 'document') doc++;
      else if (item.category === 'image') img++;
    });

    countAll.textContent = allHarvestedLinks.length;
    countVideo.textContent = video;
    countAudio.textContent = audio;
    countArchive.textContent = archive;
    countDocument.textContent = doc;
    countImage.textContent = img;
    grabberBadge.textContent = allHarvestedLinks.length;
  }

  function renderLinks() {
    const filtered = allHarvestedLinks.filter(item => {
      const matchCat = currentFilter === 'all' || item.category === currentFilter;
      const matchSearch = !searchQuery || item.url.toLowerCase().includes(searchQuery.toLowerCase()) || item.filename.toLowerCase().includes(searchQuery.toLowerCase());
      return matchCat && matchSearch;
    });

    if (filtered.length === 0) {
      linksContainer.innerHTML = '<div class="empty-state"><p>No links match the filter.</p></div>';
      updateSendButton();
      return;
    }

    linksContainer.innerHTML = '';
    filtered.forEach(item => {
      const row = document.createElement('div');
      row.className = 'link-row';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'link-checkbox';
      cb.checked = selectedUrls.has(item.url);
      cb.addEventListener('change', () => {
        if (cb.checked) selectedUrls.add(item.url);
        else selectedUrls.delete(item.url);
        updateSendButton();
      });

      const info = document.createElement('div');
      info.className = 'link-info';

      const name = document.createElement('div');
      name.className = 'link-name';
      name.textContent = item.filename;
      name.title = item.url;

      const urlText = document.createElement('div');
      urlText.className = 'link-url';
      urlText.textContent = item.url;

      info.appendChild(name);
      info.appendChild(urlText);

      const tag = document.createElement('span');
      tag.className = `link-tag tag-${item.category}`;
      tag.textContent = item.category;

      row.appendChild(cb);
      row.appendChild(info);
      row.appendChild(tag);
      linksContainer.appendChild(row);
    });

    updateSendButton();
  }

  function updateSendButton() {
    const count = selectedUrls.size;
    btnSendLabel.textContent = `Download Selected (${count})`;
    btnSendSelected.disabled = count === 0;
    btnStageSelected.disabled = count === 0;
  }

  // Filter Chips Click
  filterChips.forEach(chip => {
    chip.addEventListener('click', () => {
      filterChips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      currentFilter = chip.getAttribute('data-filter');
      renderLinks();
    });
  });

  // Search input
  linkSearchInput.addEventListener('input', (e) => {
    searchQuery = e.target.value.trim();
    renderLinks();
  });

  // Select all / Deselect
  btnSelectAll.addEventListener('click', () => {
    allHarvestedLinks.forEach(i => selectedUrls.add(i.url));
    renderLinks();
  });

  btnDeselectAll.addEventListener('click', () => {
    selectedUrls.clear();
    renderLinks();
  });

  // Send Selected to Hydra
  btnSendSelected.addEventListener('click', async () => {
    await dispatchBatch(true);
  });

  btnStageSelected.addEventListener('click', async () => {
    await dispatchBatch(false);
  });

  async function dispatchBatch(autostart) {
    const urls = Array.from(selectedUrls);
    if (urls.length === 0) return;

    btnSendSelected.disabled = true;
    showToast(`Sending ${urls.length} item(s) to Waterfall...`);

    const pkg = packageNameInput.value.trim() || (activeTab && activeTab.title) || 'Browser Downloads';

    const res = await chrome.runtime.sendMessage({
      action: 'SEND_TO_HYDRA',
      data: {
        urls,
        packageName: pkg,
        source: activeTab ? activeTab.url : '',
        autostartOverride: autostart
      }
    });

    btnSendSelected.disabled = false;
    if (res && res.success) {
      showToast(autostart ? `⚡ Started ${urls.length} downloads in Waterfall!` : `📥 Added ${urls.length} items to Waterfall LinkGrabber!`);
    } else {
      showToast(`Error: ${(res && res.error) || 'Failed to dispatch'}`);
    }
  }

  function getCleanPageTitle(title) {
    return (title || 'Media')
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
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
      .replace(/[.\s]+$/, '')
      .trim() || ('Media_' + Date.now());
  }

  // 5. Media Sniffer Tab
  async function loadCapturedMedia() {
    if (!activeTab || !activeTab.id) return;

    const res = await chrome.runtime.sendMessage({
      action: 'GET_TAB_MEDIA',
      tabId: activeTab.id
    });

    capturedMediaStreams = (res && res.media) || [];
    mediaBadge.textContent = capturedMediaStreams.length;

    if (capturedMediaStreams.length === 0) {
      mediaListContainer.innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" class="empty-icon"><path d="M18 3v2h-2V3H8v2H6V3H4v18h2v-2h2v2h8v-2h2v2h2V3h-2zM8 17H6v-2h2v2zm0-4H6v-2h2v2zm0-4H6V7h2v2zm10 8h-2v-2h2v2zm0-4h-2v-2h2v2zm0-4h-2V7h2v2z"/></svg>
          <p>No video or audio streams sniffed yet.<br>Play a video or media player on this page!</p>
        </div>
      `;
      btnDownloadAllMedia.disabled = true;
      return;
    }

    btnDownloadAllMedia.disabled = false;
    mediaListContainer.innerHTML = '';

    const pageTitle = getCleanPageTitle(activeTab ? activeTab.title : 'Media');

    capturedMediaStreams.forEach((stream, idx) => {
      const item = document.createElement('div');
      item.className = 'media-item';

      const details = document.createElement('div');
      details.className = 'media-details';

      const streamTitle = capturedMediaStreams.length > 1 ? `${pageTitle} #${idx + 1}` : pageTitle;
      const ext = (stream.contentType && stream.contentType.includes('webm')) ? 'webm' : 'mp4';
      const cleanFilename = `${streamTitle}.${ext}`;

      const title = document.createElement('div');
      title.className = 'media-title';
      title.textContent = streamTitle;
      title.title = stream.url;

      const meta = document.createElement('div');
      meta.className = 'media-meta';
      meta.textContent = `${stream.contentType} • ${stream.formattedSize}`;

      details.appendChild(title);
      details.appendChild(meta);

      const actionsRow = document.createElement('div');
      actionsRow.className = 'media-actions-row';

      // 1. Download Video
      const dlBtn = document.createElement('button');
      dlBtn.className = 'btn-secondary';
      dlBtn.textContent = '⚡ Download';
      dlBtn.addEventListener('click', async () => {
        showToast('Sending stream to Waterfall...');
        await chrome.runtime.sendMessage({
          action: 'SEND_TO_HYDRA',
          data: {
            urls: [stream.url],
            filename: cleanFilename,
            packageName: streamTitle,
            source: activeTab ? activeTab.url : ''
          }
        });
        showToast(`⚡ Dispatched "${cleanFilename}" to Waterfall!`);
      });

      // 2. MP3 Converter
      const mp3Btn = document.createElement('button');
      mp3Btn.className = 'btn-secondary';
      mp3Btn.textContent = '🎵 MP3';
      mp3Btn.title = 'Convert stream to 320k MP3 via Waterfall';
      mp3Btn.addEventListener('click', async () => {
        showToast('Converting to MP3 via Waterfall...');
        await chrome.runtime.sendMessage({
          action: 'SEND_TO_HYDRA',
          data: {
            urls: [stream.url],
            filename: `${streamTitle}.mp3`,
            packageName: streamTitle,
            source: activeTab ? activeTab.url : '',
            isMedia: true,
            mediaOptions: { mediaType: 'audio', audioFormat: 'mp3', audioQuality: '0' }
          }
        });
        showToast(`🎵 Dispatched "${streamTitle}.mp3" to Waterfall!`);
      });

      actionsRow.appendChild(dlBtn);
      actionsRow.appendChild(mp3Btn);

      item.appendChild(details);
      item.appendChild(actionsRow);
      mediaListContainer.appendChild(item);
    });
  }

  btnDownloadAllMedia.addEventListener('click', async () => {
    if (capturedMediaStreams.length === 0) return;
    const urls = capturedMediaStreams.map(s => s.url);
    showToast(`Sending ${urls.length} media streams to Waterfall...`);
    await chrome.runtime.sendMessage({
      action: 'SEND_TO_HYDRA',
      data: {
        urls,
        packageName: `${getCleanPageTitle(activeTab ? activeTab.title : 'Page')} (Captured Media)`,
        source: activeTab ? activeTab.url : ''
      }
    });
    showToast(`⚡ Dispatched ${urls.length} streams to Waterfall!`);
  });

  // 6. Direct Add Tab
  btnSendDirect.addEventListener('click', async () => {
    const raw = directUrlsTextarea.value.trim();
    if (!raw) {
      showToast('Please enter at least one URL');
      return;
    }

    const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) return;

    const preset = directFormatSelect.value;
    const isMedia = preset !== 'default';
    let mediaOptions = null;

    if (preset === 'mp3-320') mediaOptions = { mediaType: 'audio', audioFormat: 'mp3', audioQuality: '0' };
    else if (preset === 'mp3-192') mediaOptions = { mediaType: 'audio', audioFormat: 'mp3', audioQuality: '192k' };
    else if (preset === 'flac-lossless') mediaOptions = { mediaType: 'audio', audioFormat: 'flac', audioQuality: '0' };
    else if (preset === 'mp4-1080') mediaOptions = { mediaType: 'video', videoQuality: '1080' };
    else if (preset === 'mp4-720') mediaOptions = { mediaType: 'video', videoQuality: '720' };

    btnSendDirect.disabled = true;
    showToast(`Dispatching ${lines.length} link(s)...`);

    const res = await chrome.runtime.sendMessage({
      action: 'SEND_TO_HYDRA',
      data: {
        urls: lines,
        packageName: directPackageInput.value.trim() || 'Direct Links',
        isMedia,
        mediaOptions,
        autostartOverride: directAutostart.checked
      }
    });

    btnSendDirect.disabled = false;
    if (res && res.success) {
      directUrlsTextarea.value = '';
      showToast(isMedia ? '🎵 Sent to Waterfall Media Converter!' : '⚡ Successfully dispatched to Waterfall!');
    } else {
      showToast(`Error: ${(res && res.error) || 'Could not connect'}`);
    }
  });

  // 7. Settings Tab
  async function loadSettings() {
    const s = await chrome.runtime.sendMessage({ action: 'GET_SETTINGS' });
    if (s) {
      settingHydraHost.value = s.hydraHost || 'http://127.0.0.1:4567';
      settingIntercept.checked = !!s.interceptDownloads;
      settingVideoPanel.checked = !!s.enableVideoPanel;
      settingVideoPos.value = s.videoPanelPosition || 'top-right';
      settingAutostart.checked = !!s.autostart;
    }
  }
  loadSettings();

  btnSaveSettings.addEventListener('click', async () => {
    await chrome.runtime.sendMessage({
      action: 'SAVE_SETTINGS',
      settings: {
        hydraHost: settingHydraHost.value.trim(),
        interceptDownloads: settingIntercept.checked,
        enableVideoPanel: settingVideoPanel.checked,
        videoPanelPosition: settingVideoPos.value,
        autostart: settingAutostart.checked
      }
    });
    showToast('Settings saved!');
    checkStatus();
  });

  btnTestConnection.addEventListener('click', async () => {
    btnTestConnection.textContent = 'Testing...';
    const res = await chrome.runtime.sendMessage({
      action: 'CHECK_STATUS',
      host: settingHydraHost.value.trim()
    });
    btnTestConnection.textContent = 'Test Connection';
    if (res && res.connected) {
      showToast(`Connected! Latency: ${res.latency}ms`);
    } else {
      showToast(`Connection failed: ${res.error || 'Check port'}`);
    }
  });

  // Toast helper
  function showToast(msg) {
    popupToast.textContent = msg;
    popupToast.style.display = 'block';
    setTimeout(() => {
      popupToast.style.display = 'none';
    }, 2800);
  }

  // Initial trigger
  harvestLinks();
});
