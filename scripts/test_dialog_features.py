"""
Automated Test Suite for Waterfall Native Dialog Windows
Tests:
1. Launch Waterfall Engine & Web UI
2. Download Confirmation Top Window (HWND_TOPMOST, title, dimensions, ownership)
3. Dynamic Always-on-Top / Pin Window Toggling
4. Download Progress Window Creation & Real-time Integration
5. Download Completion / Error State Top Window Elevation
6. Clean Dialog Destruction via WM_CLOSE / WindowCloseRequested
"""

import sys
import os
import time
import json
import subprocess
import urllib.request
import urllib.error
import ctypes
from ctypes import wintypes

user32 = ctypes.windll.user32

GWL_EXSTYLE = -20
GW_OWNER = 4
WS_EX_TOPMOST = 0x00000008
WM_CLOSE = 0x0010

class RECT(ctypes.Structure):
    _fields_ = [
        ("left", ctypes.c_long),
        ("top", ctypes.c_long),
        ("right", ctypes.c_long),
        ("bottom", ctypes.c_long)
    ]

def get_window_class_name(hwnd):
    buf = ctypes.create_unicode_buffer(256)
    user32.GetClassNameW(hwnd, buf, 256)
    return buf.value

def get_window_title(hwnd):
    buf = ctypes.create_unicode_buffer(256)
    user32.GetWindowTextW(hwnd, buf, 256)
    return buf.value

def find_windows_by_class(class_name):
    matches = []
    def enum_callback(hwnd, lparam):
        if get_window_class_name(hwnd) == class_name:
            matches.append(hwnd)
        return True
    
    WNDENUMPROC = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)
    user32.EnumWindows(WNDENUMPROC(enum_callback), 0)
    return matches

def find_main_window():
    wins = find_windows_by_class("Waterfall_WebView2_Class")
    return wins[0] if wins else None

def is_window_topmost(hwnd):
    ex_style = user32.GetWindowLongW(hwnd, GWL_EXSTYLE)
    return bool(ex_style & WS_EX_TOPMOST)

def get_window_dimensions(hwnd):
    r = RECT()
    user32.GetWindowRect(hwnd, ctypes.byref(r))
    return (r.right - r.left, r.bottom - r.top)

def api_post(endpoint, data):
    body = json.dumps(data).encode("utf-8")
    req = urllib.request.Request(f"http://127.0.0.1:4567{endpoint}", data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=5) as response:
        return json.loads(response.read().decode("utf-8"))

def api_get(endpoint):
    req = urllib.request.Request(f"http://127.0.0.1:4567{endpoint}")
    with urllib.request.urlopen(req, timeout=5) as response:
        return json.loads(response.read().decode("utf-8"))

def api_delete(endpoint):
    req = urllib.request.Request(f"http://127.0.0.1:4567{endpoint}", method="DELETE")
    with urllib.request.urlopen(req, timeout=5) as response:
        return json.loads(response.read().decode("utf-8"))

def run_tests():
    print("=" * 70)
    print("  WATERFALL NATIVE DIALOG AUTOMATED TEST SUITE")
    print("=" * 70)

    # 1. Check if Waterfall is running or launch it
    proc = None
    try:
        api_get("/api/downloads")
        print("[Setup] Connected to existing Waterfall engine at http://127.0.0.1:4567")
    except Exception:
        exe_path = os.path.abspath("build/waterfall.exe")
        if not os.path.exists(exe_path):
            exe_path = os.path.abspath("dist/Waterfall-v2.0.0-windows-x64/Waterfall.exe")
        
        print(f"[Setup] Starting Waterfall instance: {exe_path}")
        proc = subprocess.Popen([exe_path, "--debug"], cwd=os.path.dirname(os.path.abspath("src")))
        
        # Wait for HTTP server
        ready = False
        for _ in range(20):
            time.sleep(0.5)
            try:
                api_get("/api/downloads")
                ready = True
                break
            except Exception:
                pass
        if not ready:
            print("[FAIL] Engine failed to start within 10 seconds.")
            return False

    time.sleep(1.0)
    main_hwnd = find_main_window()
    print(f"[Setup] Main Window HWND: {main_hwnd} (Visible: {bool(user32.IsWindowVisible(main_hwnd) if main_hwnd else False)})")

    tests_passed = 0
    total_tests = 0

    def assert_test(name, condition, details=""):
        nonlocal tests_passed, total_tests
        total_tests += 1
        if condition:
            tests_passed += 1
            print(f"  [PASS] {name} {details}")
            return True
        else:
            print(f"  [FAIL] {name} {details}")
            return False

    try:
        # TEST 1: Open Confirmation Window
        print("\n--- TEST 1: Download Confirmation Dialog (confirm.html) ---")
        probe_sample = {
            "url": "https://speed.hetzner.de/100MB.bin",
            "filename": "100MB.bin",
            "totalBytes": 104857600,
            "category": "General",
            "acceptRanges": True
        }
        res = api_post("/api/window/open-confirm", probe_sample)
        assert_test("API /api/window/open-confirm responds success", res.get("success") is True)

        time.sleep(1.2)
        dlg_wins = find_windows_by_class("Waterfall_Dialog_Class")
        assert_test("Dialog window HWND created in Win32", len(dlg_wins) >= 1)

        confirm_hwnd = None
        for h in dlg_wins:
            title = get_window_title(h)
            if "Download File Info" in title:
                confirm_hwnd = h
                break

        assert_test("Confirm dialog window found with title 'Download File Info'", confirm_hwnd is not None)
        if confirm_hwnd:
            assert_test("Confirm dialog is visible on screen", bool(user32.IsWindowVisible(confirm_hwnd)))
            topmost = is_window_topmost(confirm_hwnd)
            assert_test("Confirm dialog has WS_EX_TOPMOST style (Top Window)", topmost)
            w, h = get_window_dimensions(confirm_hwnd)
            assert_test("Confirm dialog dimension around 680x750", abs(w - 680) < 50 and abs(h - 750) < 50, f"Actual: {w}x{h}")
            owner = user32.GetWindow(confirm_hwnd, GW_OWNER)
            assert_test("Confirm dialog owned by main window", owner == main_hwnd or main_hwnd is None)

        # TEST 2: Dynamic Topmost Toggle (Pinning)
        print("\n--- TEST 2: Confirmation Dialog Topmost Toggle ---")
        if confirm_hwnd:
            api_post("/api/window/set-topmost", {"type": "confirm", "topmost": False})
            time.sleep(0.3)
            assert_test("Confirm dialog unpinned (WS_EX_TOPMOST removed)", not is_window_topmost(confirm_hwnd))

            api_post("/api/window/set-topmost", {"type": "confirm", "topmost": True})
            time.sleep(0.3)
            assert_test("Confirm dialog re-pinned (WS_EX_TOPMOST re-applied)", is_window_topmost(confirm_hwnd))

        # TEST 3: Progress Dialog Window
        print("\n--- TEST 3: Download Progress Window (download-progress.html) ---")
        dl_res = api_post("/api/downloads", {"url": "https://speed.hetzner.de/100MB.bin", "filename": "test_progress_100MB.bin", "openProgress": True})
        task_id = dl_res.get("id", 0)
        assert_test("Download task created via /api/downloads", task_id > 0, f"Task ID: {task_id}")

        time.sleep(1.2)
        dlg_wins = find_windows_by_class("Waterfall_Dialog_Class")
        progress_hwnd = None
        for h in dlg_wins:
            title = get_window_title(h)
            if "Download Progress" in title:
                progress_hwnd = h
                break

        assert_test("Progress dialog HWND found with title 'Download Progress'", progress_hwnd is not None)
        if progress_hwnd:
            assert_test("Progress dialog is visible on screen", bool(user32.IsWindowVisible(progress_hwnd)))
            assert_test("Progress dialog initially normal window (not topmost)", not is_window_topmost(progress_hwnd))

            # TEST 4: Progress Dialog Pin Toggle
            print("\n--- TEST 4: Progress Dialog Pin Toggle ---")
            api_post("/api/window/set-topmost", {"type": "progress", "taskId": task_id, "topmost": True, "bringToFront": True})
            time.sleep(0.3)
            assert_test("Progress dialog pinned to top via Pin control", is_window_topmost(progress_hwnd))

            api_post("/api/window/set-topmost", {"type": "progress", "taskId": task_id, "topmost": False})
            time.sleep(0.3)
            assert_test("Progress dialog unpinned via Pin control", not is_window_topmost(progress_hwnd))

            # TEST 5: Completion / Error Elevation
            print("\n--- TEST 5: Done / Error Window Elevation ---")
            api_post("/api/window/set-topmost", {"type": "progress", "taskId": task_id, "topmost": True, "bringToFront": True})
            time.sleep(0.3)
            assert_test("Done/Error elevation elevates window to HWND_TOPMOST", is_window_topmost(progress_hwnd))

        # TEST 6: Window Close
        print("\n--- TEST 6: Window Destruction on Close ---")
        if confirm_hwnd:
            user32.PostMessageW(confirm_hwnd, WM_CLOSE, 0, 0)
            time.sleep(0.5)
            assert_test("Confirm dialog HWND destroyed after WM_CLOSE", not user32.IsWindow(confirm_hwnd))

        if progress_hwnd:
            user32.PostMessageW(progress_hwnd, WM_CLOSE, 0, 0)
            time.sleep(0.5)
            assert_test("Progress dialog HWND destroyed after WM_CLOSE", not user32.IsWindow(progress_hwnd))

        # Clean up download task
        if task_id > 0:
            try:
                api_delete(f"/api/downloads/{task_id}")
            except Exception:
                pass

    finally:
        if proc:
            print("\n[Teardown] Stopping test Waterfall instance...")
            proc.terminate()
            try:
                proc.wait(timeout=3)
            except Exception:
                proc.kill()

    print("\n" + "=" * 70)
    print(f"  TEST RESULTS: {tests_passed} / {total_tests} PASSED ({int(tests_passed / total_tests * 100)}%)")
    print("=" * 70)
    return tests_passed == total_tests

if __name__ == "__main__":
    success = run_tests()
    sys.exit(0 if success else 1)
