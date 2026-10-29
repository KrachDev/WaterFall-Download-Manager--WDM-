(function() {
  'use strict';

  // Elements
  const extPathInput = document.getElementById('ext-path-input');
  const btnOpenFolder = document.getElementById('btn-open-folder');
  const btnCopyPath = document.getElementById('btn-copy-path');
  const btnCopyExtUrl = document.getElementById('btn-copy-ext-url');
  const btnOpenBrowserExt = document.getElementById('btn-open-browser-ext');
  const btnLaunchWaterfall = document.getElementById('btn-launch-waterfall');
  const btnRetestConn = document.getElementById('btn-retest-connection');
  const statusBadge = document.getElementById('status-badge');
  const statusText = document.getElementById('status-text');
  const toastMsg = document.getElementById('toast-msg');
  const tabBtns = document.querySelectorAll('.tab-btn');
  const mockFolderTag = document.getElementById('mock-folder-tag');

  // Step 1 Dynamic Content
  const step1Title = document.getElementById('step-1-title');
  const step1Desc = document.getElementById('step-1-desc');
  const step1Tag = document.getElementById('step-1-tag');
  const step2Desc = document.getElementById('step-2-desc');
  const step3Desc = document.getElementById('step-3-desc');

  let currentBrowser = 'chrome';
  let detectedPath = '';

  const BROWSER_CONFIGS = {
    chrome: {
      name: 'Google Chrome',
      url: 'chrome://extensions',
      title: 'Open Chrome Extensions Page',
      desc: 'Open a new tab in Google Chrome and navigate to <strong style="color: #38bdf8;">chrome://extensions</strong>, or click the <strong>Extensions</strong> puzzle icon in the toolbar and choose <strong>Manage Extensions</strong>.',
      step2: 'Look at the top-right corner of the Extensions page and toggle the <strong>Developer mode</strong> switch to <strong>ON</strong>. This unlocks the ability to load unpacked extensions.',
      step3: 'A new sub-toolbar will appear on the top-left of the Extensions page. Click the button labeled <strong style="color: #38bdf8;">Load unpacked</strong>.'
    },
    edge: {
      name: 'Microsoft Edge',
      url: 'edge://extensions',
      title: 'Open Edge Extensions Page',
      desc: 'Open a new tab in Microsoft Edge and navigate to <strong style="color: #38bdf8;">edge://extensions</strong>, or click the <strong>Settings and more (...)</strong> menu -> <strong>Extensions</strong> -> <strong>Manage extensions</strong>.',
      step2: 'In the left sidebar or top banner, toggle the <strong>Developer mode</strong> switch to <strong>ON</strong>.',
      step3: 'Click the button labeled <strong style="color: #38bdf8;">Load unpacked</strong> that appears at the top of the page.'
    },
    brave: {
      name: 'Brave Browser',
      url: 'brave://extensions',
      title: 'Open Brave Extensions Page',
      desc: 'Open a new tab in Brave and navigate to <strong style="color: #38bdf8;">brave://extensions</strong>, or open the main menu (≡) -> <strong>Extensions</strong>.',
      step2: 'In the top-right corner, switch the <strong>Developer mode</strong> toggle to <strong>ON</strong>.',
      step3: 'Click the button labeled <strong style="color: #38bdf8;">Load unpacked</strong> at the top left.'
    },
    opera: {
      name: 'Opera / Vivaldi',
      url: 'opera://extensions',
      title: 'Open Extensions Page',
      desc: 'Open a new tab in Opera/Vivaldi and navigate to <strong style="color: #38bdf8;">opera://extensions</strong> (or <strong>vivaldi://extensions</strong>).',
      step2: 'In the top-right corner, enable the <strong>Developer mode</strong> toggle switch.',
      step3: 'Click <strong style="color: #38bdf8;">Load unpacked extension</strong> at the top of the page.'
    },
    firefox: {
      name: 'Mozilla Firefox',
      url: 'about:debugging#/runtime/this-firefox',
      title: 'Open Firefox Debugging Page',
      desc: 'Open a new tab in Firefox and navigate to <strong style="color: #38bdf8;">about:debugging#/runtime/this-firefox</strong>.',
      step2: 'Under the "Temporary Extensions" heading, locate the button labeled <strong>Load Temporary Add-on...</strong>',
      step3: 'Click <strong>Load Temporary Add-on...</strong> and select the <strong>manifest.json</strong> file inside the Waterfall extension folder.'
    }
  };

  function showToast(msg) {
    if (!toastMsg) return;
    toastMsg.textContent = msg;
    toastMsg.classList.add('show');
    setTimeout(() => {
      toastMsg.classList.remove('show');
    }, 2800);
  }

  function copyToClipboard(text, successMsg) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        showToast(successMsg || 'Copied to clipboard!');
      }).catch(() => {
        fallbackCopy(text, successMsg);
      });
    } else {
      fallbackCopy(text, successMsg);
    }
  }

  function fallbackCopy(text, successMsg) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      showToast(successMsg || 'Copied to clipboard!');
    } catch (e) {
      showToast('Please select and copy manually');
    }
    document.body.removeChild(ta);
  }

  // Derive file path if opened locally via file:///
  function computeLocalExtensionPath() {
    try {
      if (window.location.protocol === 'file:') {
        let p = decodeURIComponent(window.location.pathname);
        if (p.startsWith('/') && p.length > 2 && p[2] === ':') {
          p = p.substring(1);
        }
        p = p.replace(/\//g, '\\');
        // p is e.g. C:\Users\...\Programs\Waterfall\frontend\extension-guide.html
        const lastSlash = p.lastIndexOf('\\');
        if (lastSlash !== -1) {
          const dir = p.substring(0, lastSlash); // ...\frontend
          const parentSlash = dir.lastIndexOf('\\');
          if (parentSlash !== -1) {
            const rootDir = dir.substring(0, parentSlash); // ...\Waterfall
            return rootDir + '\\extension';
          }
        }
      }
    } catch (e) {}
    return 'C:\\Program Files\\Waterfall\\extension';
  }

  async function checkBridgeStatus() {
    if (statusText) statusText.textContent = 'Bridge: Checking...';
    try {
      const res = await fetch('http://127.0.0.1:4567/api/extension-info', { method: 'GET', cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (statusBadge) {
          statusBadge.className = 'status-pill online';
          statusText.textContent = 'Bridge: Active (Port ' + (data.port || 4567) + ')';
        }
        if (data.extension_path) {
          detectedPath = data.extension_path;
          extPathInput.value = detectedPath;
          if (mockFolderTag) mockFolderTag.textContent = '📁 ' + detectedPath;
        }
        return true;
      }
    } catch (e) {}

    // Fallback if bridge is not answering on localhost
    if (statusBadge) {
      statusBadge.className = 'status-pill offline';
      statusText.textContent = 'Bridge: Standby (Launch Waterfall)';
    }
    if (!detectedPath) {
      detectedPath = computeLocalExtensionPath();
      extPathInput.value = detectedPath;
      if (mockFolderTag) mockFolderTag.textContent = '📁 ' + detectedPath;
    }
    return false;
  }

  // Set browser instructions
  function setBrowser(browserKey) {
    currentBrowser = browserKey;
    const cfg = BROWSER_CONFIGS[browserKey] || BROWSER_CONFIGS.chrome;

    tabBtns.forEach(btn => {
      if (btn.getAttribute('data-browser') === browserKey) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    if (step1Title) step1Title.textContent = cfg.title;
    if (step1Desc) step1Desc.innerHTML = cfg.desc;
    if (step1Tag) step1Tag.textContent = cfg.url;
    if (step2Desc) step2Desc.innerHTML = cfg.step2;
    if (step3Desc) step3Desc.innerHTML = cfg.step3;
  }

  // Initialize Event Listeners
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const b = btn.getAttribute('data-browser');
      setBrowser(b);
    });
  });

  if (btnCopyPath) {
    btnCopyPath.addEventListener('click', () => {
      const val = extPathInput.value;
      copyToClipboard(val, 'Extension folder path copied!');
    });
  }

  if (btnOpenFolder) {
    btnOpenFolder.addEventListener('click', async () => {
      try {
        const res = await fetch('http://127.0.0.1:4567/api/open-extension-folder', { method: 'POST' });
        if (res.ok) {
          showToast('Opening extension folder in Explorer...');
          return;
        }
      } catch (e) {}
      // If server unreachable, copy path and alert user
      const val = extPathInput.value;
      copyToClipboard(val, 'Path copied! Paste into Windows Explorer to view files.');
    });
  }

  if (btnCopyExtUrl) {
    btnCopyExtUrl.addEventListener('click', () => {
      const cfg = BROWSER_CONFIGS[currentBrowser] || BROWSER_CONFIGS.chrome;
      copyToClipboard(cfg.url, 'Copied ' + cfg.url + ' to clipboard!');
    });
  }

  if (btnOpenBrowserExt) {
    btnOpenBrowserExt.addEventListener('click', () => {
      const cfg = BROWSER_CONFIGS[currentBrowser] || BROWSER_CONFIGS.chrome;
      try {
        window.open(cfg.url, '_blank');
      } catch (e) {}
      // Due to browser security blocking chrome:// navigation from pages, copy as well
      copyToClipboard(cfg.url, 'Copied ' + cfg.url + '! Paste into browser address bar.');
    });
  }

  if (btnRetestConn) {
    btnRetestConn.addEventListener('click', async () => {
      btnRetestConn.style.opacity = '0.6';
      await checkBridgeStatus();
      btnRetestConn.style.opacity = '1';
      showToast('Connection retested');
    });
  }

  if (btnLaunchWaterfall) {
    btnLaunchWaterfall.addEventListener('click', async () => {
      try {
        await fetch('http://127.0.0.1:4567/api/system/focus', { method: 'POST' });
        showToast('Waterfall window brought to front!');
      } catch (e) {
        showToast('Waterfall is starting up or please launch from Desktop shortcut.');
      }
    });
  }

  // Initial Startup
  setBrowser('chrome');
  checkBridgeStatus();

  // Periodic poll to detect when Waterfall starts
  setInterval(checkBridgeStatus, 4000);
})();
