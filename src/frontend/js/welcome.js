/**
 * Waterfall Accelerator — IDM-style Welcome & Setup Wizard Controller
 */

(function() {
  'use strict';

  let currentStep = 1;
  const totalSteps = 6;

  // DOM Elements
  const stepPanes = [
    document.getElementById('pane-step-1'),
    document.getElementById('pane-step-2'),
    document.getElementById('pane-step-3'),
    document.getElementById('pane-step-4'),
    document.getElementById('pane-step-5'),
    document.getElementById('pane-step-6')
  ];

  const btnNext = document.getElementById('btn-wizard-next');
  const btnBack = document.getElementById('btn-wizard-back');
  const btnSkip = document.getElementById('btn-wizard-skip');
  const btnClose = document.getElementById('btn-close-wizard');
  const btnFinish = document.getElementById('btn-wizard-finish');

  // Step 2 elements
  const inputDlDir = document.getElementById('cfg-wizard-download-dir');
  const btnBrowse = document.getElementById('btn-wizard-browse');
  const chkSmartRouting = document.getElementById('cfg-wizard-smart-routing');
  const chkAutoExtract = document.getElementById('cfg-wizard-auto-extract');

  // Step 3 elements
  const presetBalanced = document.getElementById('preset-balanced');
  const presetBroadband = document.getElementById('preset-broadband');
  const presetFiber = document.getElementById('preset-fiber');
  const rangeMaxDl = document.getElementById('range-wizard-max-dl');
  const rangeConns = document.getElementById('range-wizard-conns');
  const valMaxDl = document.getElementById('val-wizard-max-dl');
  const valConns = document.getElementById('val-wizard-conns');

  // Step 4 elements
  const btnOpenExtFolder = document.getElementById('btn-wizard-open-ext-folder');
  const btnTestCompanion = document.getElementById('btn-wizard-test-companion');
  const serverStatusBadge = document.getElementById('wizard-server-status');

  // Step 5 elements
  const chkStartWindows = document.getElementById('cfg-wizard-start-windows');
  const chkTrayClose = document.getElementById('cfg-wizard-tray-close');
  const chkShowConfirm = document.getElementById('cfg-wizard-show-confirm');
  const chkAlertDone = document.getElementById('cfg-wizard-alert-done');

  // Step 6 elements
  const sumDir = document.getElementById('sum-wizard-dir');
  const sumProfile = document.getElementById('sum-wizard-profile');
  const sumMaxDl = document.getElementById('sum-wizard-max-dl');
  const sumClose = document.getElementById('sum-wizard-close');
  const sumStartup = document.getElementById('sum-wizard-startup');

  // Current config cache
  let loadedConfig = {
    download_directory: '',
    max_concurrent_downloads: 3,
    default_connections_per_task: 16,
    auto_extract_archives: true,
    close_action: 'tray',
    start_with_windows: false
  };

  // 1. Initialize & Fetch Existing Config
  async function initWizard() {
    try {
      const res = await fetch('/api/settings');
      if (res.ok) {
        const data = await res.json();
        loadedConfig = { ...loadedConfig, ...data };
      }
    } catch (e) {
      console.warn('Could not load current settings:', e);
    }

    // Populate Initial UI values
    if (inputDlDir) {
      inputDlDir.value = loadedConfig.download_directory || 'C:\\Downloads';
    }
    if (chkAutoExtract) {
      chkAutoExtract.checked = !!loadedConfig.auto_extract_archives;
    }
    if (chkTrayClose) {
      chkTrayClose.checked = (loadedConfig.close_action === 'tray');
    }
    if (chkStartWindows) {
      chkStartWindows.checked = !!loadedConfig.start_with_windows;
    }

    if (rangeMaxDl && valMaxDl) {
      rangeMaxDl.value = loadedConfig.max_concurrent_downloads || 3;
      valMaxDl.textContent = rangeMaxDl.value;
    }

    if (rangeConns && valConns) {
      rangeConns.value = loadedConfig.default_connections_per_task || 16;
      valConns.textContent = rangeConns.value;
    }

    selectPresetByValues(parseInt(rangeConns.value), parseInt(rangeMaxDl.value));
    updateSummary();
  }

  // 2. Preset Selection Helper
  function selectPreset(preset) {
    [presetBalanced, presetBroadband, presetFiber].forEach(p => p && p.classList.remove('selected'));

    if (preset === 'balanced') {
      if (presetBalanced) presetBalanced.classList.add('selected');
      if (rangeConns) rangeConns.value = 8;
      if (rangeMaxDl) rangeMaxDl.value = 2;
    } else if (preset === 'fiber') {
      if (presetFiber) presetFiber.classList.add('selected');
      if (rangeConns) rangeConns.value = 32;
      if (rangeMaxDl) rangeMaxDl.value = 5;
    } else { // broadband (default)
      if (presetBroadband) presetBroadband.classList.add('selected');
      if (rangeConns) rangeConns.value = 16;
      if (rangeMaxDl) rangeMaxDl.value = 3;
    }

    if (valConns) valConns.textContent = rangeConns.value;
    if (valMaxDl) valMaxDl.textContent = rangeMaxDl.value;
    updateSummary();
  }

  function selectPresetByValues(conns, maxDl) {
    [presetBalanced, presetBroadband, presetFiber].forEach(p => p && p.classList.remove('selected'));
    if (conns <= 8) {
      if (presetBalanced) presetBalanced.classList.add('selected');
    } else if (conns >= 32) {
      if (presetFiber) presetFiber.classList.add('selected');
    } else {
      if (presetBroadband) presetBroadband.classList.add('selected');
    }
  }

  // Preset Card Click Handlers
  if (presetBalanced) presetBalanced.addEventListener('click', () => selectPreset('balanced'));
  if (presetBroadband) presetBroadband.addEventListener('click', () => selectPreset('broadband'));
  if (presetFiber) presetFiber.addEventListener('click', () => selectPreset('fiber'));

  // Slider Change Handlers
  if (rangeMaxDl) {
    rangeMaxDl.addEventListener('input', () => {
      if (valMaxDl) valMaxDl.textContent = rangeMaxDl.value;
      selectPresetByValues(parseInt(rangeConns.value), parseInt(rangeMaxDl.value));
      updateSummary();
    });
  }

  if (rangeConns) {
    rangeConns.addEventListener('input', () => {
      if (valConns) valConns.textContent = rangeConns.value;
      selectPresetByValues(parseInt(rangeConns.value), parseInt(rangeMaxDl.value));
      updateSummary();
    });
  }

  // 3. Folder Picker
  if (btnBrowse) {
    btnBrowse.addEventListener('click', async () => {
      try {
        const res = await fetch('/api/browse-folder', { method: 'POST' });
        if (res.ok) {
          const data = await res.json();
          if (data && data.path && inputDlDir) {
            inputDlDir.value = data.path;
            updateSummary();
          }
        }
      } catch (err) {
        console.error('Failed to browse folder:', err);
      }
    });
  }

  // 4. Companion Extension Actions
  if (btnOpenExtFolder) {
    btnOpenExtFolder.addEventListener('click', async () => {
      try {
        await fetch('/api/open-folder', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: 'src/extension' })
        });
      } catch (e) {
        console.error(e);
      }
    });
  }

  if (btnTestCompanion) {
    btnTestCompanion.addEventListener('click', async () => {
      btnTestCompanion.textContent = 'Testing...';
      try {
        const res = await fetch('/api/system/first-run');
        if (res.ok) {
          btnTestCompanion.innerHTML = '✓ Bridge Connected!';
          btnTestCompanion.style.color = '#34d399';
          setTimeout(() => {
            btnTestCompanion.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg> Test Bridge Connection';
            btnTestCompanion.style.color = '';
          }, 3000);
        }
      } catch (e) {
        btnTestCompanion.textContent = 'Connection Error';
        btnTestCompanion.style.color = '#f87171';
      }
    });
  }

  // 5. Update Final Review Summary
  function updateSummary() {
    if (sumDir) sumDir.textContent = (inputDlDir && inputDlDir.value) ? inputDlDir.value : 'Default';
    
    const conns = rangeConns ? parseInt(rangeConns.value) : 16;
    let profName = 'High-Speed';
    if (conns <= 8) profName = 'Standard';
    else if (conns >= 32) profName = 'Ultra Fiber';
    
    if (sumProfile) sumProfile.textContent = `${profName} (${conns} connections/file)`;
    if (sumMaxDl) sumMaxDl.textContent = `${rangeMaxDl ? rangeMaxDl.value : 3} concurrent tasks`;
    if (sumClose) sumClose.textContent = (chkTrayClose && chkTrayClose.checked) ? 'Minimize to System Tray' : 'Prompt on Close';
    if (sumStartup) sumStartup.textContent = (chkStartWindows && chkStartWindows.checked) ? 'Enabled (Start Minimized)' : 'Disabled';
  }

  // 6. Stepper Navigation
  function updateStepperUI() {
    for (let i = 1; i <= totalSteps; i++) {
      const navItem = document.getElementById(`step-nav-${i}`);
      const divider = document.getElementById(`divider-${i - 1}`);

      if (navItem) {
        navItem.classList.remove('active', 'completed');
        if (i === currentStep) {
          navItem.classList.add('active');
        } else if (i < currentStep) {
          navItem.classList.add('completed');
          const circle = navItem.querySelector('.step-circle');
          if (circle) circle.innerHTML = '✓';
        } else {
          const circle = navItem.querySelector('.step-circle');
          if (circle) circle.textContent = i;
        }
      }

      if (divider) {
        if (i <= currentStep) {
          divider.classList.add('filled');
        } else {
          divider.classList.remove('filled');
        }
      }

      // Pane visibility
      const pane = stepPanes[i - 1];
      if (pane) {
        if (i === currentStep) {
          pane.classList.add('active');
        } else {
          pane.classList.remove('active');
        }
      }
    }

    // Button states
    if (btnBack) {
      btnBack.disabled = (currentStep === 1);
    }

    if (btnNext) {
      if (currentStep === totalSteps) {
        btnNext.style.display = 'none';
      } else {
        btnNext.style.display = 'inline-flex';
        btnNext.innerHTML = `Next Step <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg>`;
      }
    }

    if (currentStep === totalSteps) {
      updateSummary();
    }
  }

  function goToStep(step) {
    if (step < 1 || step > totalSteps) return;
    currentStep = step;
    updateStepperUI();
  }

  // Stepper Header Click Navigation (allow jumping to previously visited or next step)
  for (let i = 1; i <= totalSteps; i++) {
    const navItem = document.getElementById(`step-nav-${i}`);
    if (navItem) {
      navItem.addEventListener('click', () => {
        goToStep(i);
      });
    }
  }

  if (btnNext) {
    btnNext.addEventListener('click', () => {
      if (currentStep < totalSteps) {
        goToStep(currentStep + 1);
      }
    });
  }

  if (btnBack) {
    btnBack.addEventListener('click', () => {
      if (currentStep > 1) {
        goToStep(currentStep - 1);
      }
    });
  }

  // 7. Save & Finish Wizard
  async function completeAndCloseWizard(isSkipped = false) {
    const payload = {
      download_directory: (inputDlDir && inputDlDir.value) ? inputDlDir.value : loadedConfig.download_directory,
      max_concurrent_downloads: rangeMaxDl ? parseInt(rangeMaxDl.value) : 3,
      default_connections_per_task: rangeConns ? parseInt(rangeConns.value) : 16,
      auto_extract_archives: chkAutoExtract ? chkAutoExtract.checked : true,
      close_action: (chkTrayClose && chkTrayClose.checked) ? 'tray' : 'ask',
      start_with_windows: chkStartWindows ? chkStartWindows.checked : false
    };

    try {
      if (window.waterfallDesktop && typeof window.waterfallDesktop.completeFirstRun === 'function') {
        await window.waterfallDesktop.completeFirstRun(payload);
      } else {
        await fetch('/api/system/complete-first-run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      }
    } catch (err) {
      console.warn('Failed to post complete-first-run:', err);
    }

    // Close window
    setTimeout(() => {
      if (window.waterfallDesktop && typeof window.waterfallDesktop.close === 'function') {
        window.waterfallDesktop.close();
      } else {
        window.close();
      }
    }, 150);
  }

  if (btnFinish) {
    btnFinish.addEventListener('click', () => completeAndCloseWizard(false));
  }

  if (btnSkip) {
    btnSkip.addEventListener('click', () => completeAndCloseWizard(true));
  }

  if (btnClose) {
    btnClose.addEventListener('click', () => completeAndCloseWizard(true));
  }

  // Start initialization
  initWizard();
})();

