import sys

def patch_webview_ui():
    with open('src/ui/WebViewUiManager.cpp', 'r', encoding='utf-8') as f:
        content = f.read()

    norm = content.replace('\r\n', '\n')

    # 1. Update s_bridge_script to remove redundant window.open calls
    old_bridge = """static const wchar_t* s_bridge_script = 
    L"window.waterfallDesktop = {"
    L"  openConfirmWindow: function(data) {"
    L"    fetch('/api/window/open-confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data || {}) }).catch(function(){});"
    L"    try { window.open('/confirm.html', 'waterfall_confirm_window', 'width=680,height=750'); } catch(e){}"
    L"  },"
    L"  openWelcomeWindow: function() {"
    L"    fetch('/api/window/open-welcome', { method: 'POST' }).catch(function(){});"
    L"    try { window.open('/welcome.html', 'waterfall_welcome_window', 'width=760,height=660'); } catch(e){}"
    L"  },"
    L"  completeFirstRun: function(data) {"
    L"    return fetch('/api/system/complete-first-run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data || {}) });"
    L"  },"
    L"  openProgressWindow: function(taskId) {"
    L"    var id = (typeof taskId === 'object' && taskId !== null) ? (taskId.id || 0) : (taskId || 0);"
    L"    fetch('/api/window/open-progress', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: id, topmost: false }) }).catch(function(){});"
    L"    try { window.open('/download-progress.html?taskId=' + encodeURIComponent(id), 'progress_' + id, 'width=660,height=600'); } catch(e){}"
    L"  },\""""

    new_bridge = """static const wchar_t* s_bridge_script = 
    L"window.waterfallDesktop = {"
    L"  openConfirmWindow: function(data) {"
    L"    fetch('/api/window/open-confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data || {}) }).catch(function(){});"
    L"  },"
    L"  openWelcomeWindow: function() {"
    L"    fetch('/api/window/open-welcome', { method: 'POST' }).catch(function(){});"
    L"  },"
    L"  completeFirstRun: function(data) {"
    L"    return fetch('/api/system/complete-first-run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data || {}) });"
    L"  },"
    L"  openProgressWindow: function(taskId) {"
    L"    var id = (typeof taskId === 'object' && taskId !== null) ? (taskId.id || 0) : (taskId || 0);"
    L"    fetch('/api/window/open-progress', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: id, topmost: false }) }).catch(function(){});"
    L"  },\""""

    if old_bridge in norm:
        norm = norm.replace(old_bridge, new_bridge)
        print("Updated s_bridge_script successfully!")
    else:
        print("Warning: old_bridge not found")

    # 2. In OpenDialogWindowInternal, prevent main application window from elevating
    old_existing = """    if (existing_hwnd) {
        ShowWindow(existing_hwnd, SW_RESTORE);
        if (is_topmost) {
            SetWindowPos(existing_hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
        }
        SetForegroundWindow(existing_hwnd);
        BringWindowToTop(existing_hwnd);
        return existing_hwnd;
    }"""

    new_existing = """    HWND prevFg = GetForegroundWindow();
    bool mainWasForeground = (prevFg != nullptr && (prevFg == hwnd_ || IsChild(hwnd_, prevFg)));

    if (existing_hwnd) {
        ShowWindow(existing_hwnd, SW_RESTORE);
        if (is_topmost) {
            SetWindowPos(existing_hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
        }
        SetForegroundWindow(existing_hwnd);
        BringWindowToTop(existing_hwnd);

        if (!mainWasForeground && hwnd_ && IsWindow(hwnd_) && !IsIconic(hwnd_)) {
            if (prevFg && IsWindow(prevFg)) {
                SetWindowPos(hwnd_, prevFg, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
            } else {
                SetWindowPos(hwnd_, HWND_BOTTOM, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
            }
        }
        return existing_hwnd;
    }"""

    if old_existing in norm:
        norm = norm.replace(old_existing, new_existing)
        print("Updated existing_hwnd activation check!")
    else:
        print("Warning: old_existing not found")

    old_show = """    ShowWindow(dlgHwnd, SW_SHOW);
    UpdateWindow(dlgHwnd);

    if (is_topmost) {
        SetWindowPos(dlgHwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
        SetForegroundWindow(dlgHwnd);
        BringWindowToTop(dlgHwnd);
    }"""

    new_show = """    ShowWindow(dlgHwnd, SW_SHOW);
    UpdateWindow(dlgHwnd);

    if (is_topmost) {
        SetWindowPos(dlgHwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
        SetForegroundWindow(dlgHwnd);
        BringWindowToTop(dlgHwnd);
    } else {
        SetForegroundWindow(dlgHwnd);
    }

    // Keep main application window from jumping over the user's active browser window (Chrome, Edge, etc.)
    if (!mainWasForeground && hwnd_ && IsWindow(hwnd_) && !IsIconic(hwnd_)) {
        if (prevFg && IsWindow(prevFg)) {
            SetWindowPos(hwnd_, prevFg, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
        } else {
            SetWindowPos(hwnd_, HWND_BOTTOM, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
        }
    }"""

    if old_show in norm:
        norm = norm.replace(old_show, new_show)
        print("Updated dlgHwnd show logic!")
    else:
        print("Warning: old_show not found")

    old_ctl = """                controller->put_Bounds(bounds);
                controller->put_IsVisible(TRUE);"""

    new_ctl = """                controller->put_Bounds(bounds);
                controller->put_IsVisible(TRUE);

                if (!mainWasForeground && hwnd_ && IsWindow(hwnd_) && !IsIconic(hwnd_)) {
                    if (prevFg && IsWindow(prevFg)) {
                        SetWindowPos(hwnd_, prevFg, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
                    } else {
                        SetWindowPos(hwnd_, HWND_BOTTOM, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
                    }
                }"""

    if old_ctl in norm:
        norm = norm.replace(old_ctl, new_ctl)
        print("Updated controller bounds & visibility!")
    else:
        print("Warning: old_ctl not found")

    with open('src/ui/WebViewUiManager.cpp', 'w', encoding='utf-8', newline='\r\n') as f:
        f.write(norm)
    print("WebViewUiManager.cpp patch complete!")

if __name__ == '__main__':
    patch_webview_ui()

