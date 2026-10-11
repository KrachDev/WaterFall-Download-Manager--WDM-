/**
 * Waterfall Download Suite — Options & Configuration Script
 */

document.addEventListener('DOMContentLoaded', async () => {
  // Elements
  const optHydraHost = document.getElementById('opt-hydra-host');
  const optJdFallback = document.getElementById('opt-jd-fallback');
  const optEnableVideo = document.getElementById('opt-enable-video-panel');
  const optVideoPos = document.getElementById('opt-video-position');
  const optIntercept = document.getElementById('opt-intercept');
  const optBypassKey = document.getElementById('opt-bypass-key');
  const optInterceptExts = document.getElementById('opt-intercept-extensions');
  const optDefaultAudio = document.getElementById('opt-default-audio');
  const optDefaultVideo = document.getElementById('opt-default-video');
  const optAutostart = document.getElementById('opt-autostart');
  const optNotifications = document.getElementById('opt-notifications');
  const btnSaveAll = document.getElementById('btn-save-all');
  const saveToast = document.getElementById('save-toast');

  // Diagnostics elements
  const diagBulb = document.getElementById('diag-bulb');
  const diagStatusTitle = document.getElementById('diag-status-title');
  const diagStatusDesc = document.getElementById('diag-status-desc');
  const btnQuickPing = document.getElementById('btn-quick-ping');
  const testUrlInput = document.getElementById('test-url-input');
  const btnSendTestLink = document.getElementById('btn-send-test-link');
  const testResultBox = document.getElementById('test-result-box');

  // Sidebar navigation smooth scrolling
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      navItems.forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      const targetId = item.getAttribute('data-target');
      const targetEl = document.getElementById(targetId);
      if (targetEl) {
        targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

  // Load current settings
  const settings = await chrome.runtime.sendMessage({ action: 'GET_SETTINGS' });
  if (settings) {
    optHydraHost.value = settings.hydraHost || 'http://127.0.0.1:4567';
    if (optJdFallback) optJdFallback.value = settings.jdFallbackHost || 'http://127.0.0.1:9666';
    optEnableVideo.checked = !!settings.enableVideoPanel;
    optVideoPos.value = settings.videoPanelPosition || 'top-right';
    optIntercept.checked = !!settings.interceptDownloads;
    if (optBypassKey) optBypassKey.value = settings.bypassKey || 'both';
    if (settings.interceptExtensions && Array.isArray(settings.interceptExtensions)) {
      optInterceptExts.value = settings.interceptExtensions.join(', ');
    }
    if (optDefaultAudio) optDefaultAudio.value = settings.defaultAudioFormat || 'mp3-320';
    if (optDefaultVideo) optDefaultVideo.value = settings.defaultVideoQuality || '1080';
    optAutostart.checked = !!settings.autostart;
    optNotifications.checked = !!settings.showDesktopNotifications;
  }

  // Diagnostic Ping
  async function runPing() {
    diagBulb.className = 'status-bulb';
    diagStatusTitle.textContent = 'Probing Waterfall Engine...';
    diagStatusDesc.textContent = 'Contacting ' + optHydraHost.value.trim();

    try {
      const res = await chrome.runtime.sendMessage({
        action: 'CHECK_STATUS',
        host: optHydraHost.value.trim()
      });

      if (res && res.connected) {
        diagBulb.className = 'status-bulb online';
        diagStatusTitle.textContent = 'Connected & Active';
        diagStatusDesc.textContent = `Response latency: ${res.latency}ms | Local Engine on port 4567 ready.`;
      } else {
        diagBulb.className = 'status-bulb offline';
        diagStatusTitle.textContent = 'Disconnected / Offline';
        diagStatusDesc.textContent = `Could not reach ${optHydraHost.value.trim()} (${(res && res.error) || 'Port unreachable'}).`;
      }
    } catch (err) {
      diagBulb.className = 'status-bulb offline';
      diagStatusTitle.textContent = 'Connection Error';
      diagStatusDesc.textContent = err.message;
    }
  }

  btnQuickPing.addEventListener('click', runPing);
  runPing();

  // Test Download Dispatcher
  btnSendTestLink.addEventListener('click', async () => {
    const url = testUrlInput.value.trim();
    if (!url) return;

    btnSendTestLink.disabled = true;
    testResultBox.style.display = 'block';
    testResultBox.textContent = `Dispatching test link to ${optHydraHost.value.trim()}...`;

    try {
      const res = await chrome.runtime.sendMessage({
        action: 'SEND_TO_HYDRA',
        data: {
          urls: [url],
          packageName: 'Waterfall Self-Test Package',
          source: 'Waterfall Extension Options'
        }
      });

      if (res && res.success) {
        testResultBox.textContent = `✔ SUCCESS: Link successfully received by Waterfall Engine!\nPackage: ${res.package}\nItems: ${res.count}`;
        testResultBox.style.color = '#10b981';
      } else {
        testResultBox.textContent = `✖ ERROR: Waterfall responded with error:\n${(res && res.error) || 'Unknown error'}`;
        testResultBox.style.color = '#f43f5e';
      }
    } catch (err) {
      testResultBox.textContent = `✖ FAILED: ${err.message}`;
      testResultBox.style.color = '#f43f5e';
    } finally {
      btnSendTestLink.disabled = false;
    }
  });

  // Save All Changes
  btnSaveAll.addEventListener('click', async () => {
    const exts = optInterceptExts.value
      .split(',')
      .map(e => e.trim().toLowerCase())
      .filter(e => e.length > 0)
      .map(e => e.startsWith('.') ? e : '.' + e);

    const newSettings = {
      hydraHost: optHydraHost.value.trim(),
      jdFallbackHost: optJdFallback ? optJdFallback.value.trim() : 'http://127.0.0.1:9666',
      enableVideoPanel: optEnableVideo.checked,
      videoPanelPosition: optVideoPos.value,
      interceptDownloads: optIntercept.checked,
      bypassKey: optBypassKey ? optBypassKey.value : 'both',
      interceptExtensions: exts,
      defaultAudioFormat: optDefaultAudio ? optDefaultAudio.value : 'mp3-320',
      defaultVideoQuality: optDefaultVideo ? optDefaultVideo.value : '1080',
      autostart: optAutostart.checked,
      showDesktopNotifications: optNotifications.checked
    };

    await chrome.runtime.sendMessage({
      action: 'SAVE_SETTINGS',
      settings: newSettings
    });

    saveToast.style.display = 'block';
    setTimeout(() => {
      saveToast.style.display = 'none';
    }, 2800);

    runPing();
  });
});
