"""
Automated Test Suite for Waterfall IDM-like Welcome & Setup Wizard
Tests:
1. Engine Connection & Endpoint Health
2. First-Run Config Field Presence (firstRunCompleted, startWithWindows)
3. Reset First-Run State Endpoint (/api/system/reset-first-run)
4. Spawn Welcome Dialog Window (/api/window/open-welcome)
   - Verifies HWND creation, Class (Waterfall_Dialog_Class), Title, Dimensions (~760x660)
   - Verifies WS_EX_TOPMOST attribute
   - Verifies Win32 HWND Ownership (owned by main window)
5. Complete Setup Wizard Endpoint (/api/system/complete-first-run)
   - Verifies persistence of first_run_completed in SQLite
   - Verifies custom preferences applied (conns, max downloads, close action)
6. Clean Window Destruction via WM_CLOSE
7. Re-open Welcome Wizard capability after first-run completion
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

def api_post(endpoint, data=None):
    body = json.dumps(data or {}).encode("utf-8")
    req = urllib.request.Request(f"http://127.0.0.1:4567{endpoint}", data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=5) as response:
        return json.loads(response.read().decode("utf-8"))

def api_get(endpoint):
    req = urllib.request.Request(f"http://127.0.0.1:4567{endpoint}")
    with urllib.request.urlopen(req, timeout=5) as response:
        return json.loads(response.read().decode("utf-8"))

def run_tests():
    print("=" * 65)
    print("  WATERFALL IDM-STYLE SETUP & WELCOME WIZARD AUTOMATED TESTS")
    print("=" * 65)

    passed_count = 0
    total_tests = 0

    def record_test(name, success, details=""):
        nonlocal passed_count, total_tests
        total_tests += 1
        status = "PASSED" if success else "FAILED"
        print(f"[{status}] Test {total_tests:02d}: {name}")
        if details:
            print(f"         {details}")
        if success:
            passed_count += 1
        return success

    # 1. Connect or Launch App
    proc = None
    connected = False
    for _ in range(10):
        try:
            cfg = api_get("/api/config")
            connected = True
            break
        except Exception:
            time.sleep(0.5)

    if not connected:
        exe_path = os.path.abspath("build/waterfall.exe")
        print(f"Launching Waterfall Engine: {exe_path}")
        proc = subprocess.Popen([exe_path, "--console"])
        for _ in range(25):
            time.sleep(0.4)
            try:
                cfg = api_get("/api/config")
                connected = True
                break
            except Exception:
                pass

    record_test("Engine connection on http://127.0.0.1:4567", connected)
    if not connected:
        print("FATAL: Could not connect to Waterfall.")
        return 1

    # 2. Verify Config fields
    cfg = api_get("/api/config")
    has_first_run = "firstRunCompleted" in cfg
    record_test("Config schema contains 'firstRunCompleted'", has_first_run, f"firstRunCompleted = {cfg.get('firstRunCompleted')}")
    
    has_start_win = "startWithWindows" in cfg
    record_test("Config schema contains 'startWithWindows'", has_start_win, f"startWithWindows = {cfg.get('startWithWindows')}")

    # 3. Test GET /api/system/first-run
    first_run_info = api_get("/api/system/first-run")
    record_test("GET /api/system/first-run responds", "completed" in first_run_info, f"completed = {first_run_info.get('completed')}")

    # 4. Test POST /api/system/reset-first-run
    reset_res = api_post("/api/system/reset-first-run")
    record_test("POST /api/system/reset-first-run succeeds", reset_res.get("success") is True and reset_res.get("firstRunCompleted") is False)

    first_run_after_reset = api_get("/api/system/first-run")
    record_test("State verified as not completed after reset", first_run_after_reset.get("completed") is False)

    # 5. Find main window
    main_hwnd = find_main_window()
    record_test("Main Waterfall WebView2 window found", main_hwnd is not None, f"HWND: {hex(main_hwnd) if main_hwnd else 'None'}")

    # 6. Trigger Welcome Dialog Spawning
    open_res = api_post("/api/window/open-welcome")
    record_test("POST /api/window/open-welcome succeeds", open_res.get("success") is True)

    # Wait for dialog window to appear
    welcome_hwnd = None
    for _ in range(20):
        time.sleep(0.15)
        for hwnd in find_windows_by_class("Waterfall_Dialog_Class"):
            title = get_window_title(hwnd)
            if "Setup & Welcome Wizard" in title or "Welcome" in title:
                welcome_hwnd = hwnd
                break
        if welcome_hwnd:
            break

    record_test("Welcome Wizard window HWND detected", welcome_hwnd is not None, f"HWND: {hex(welcome_hwnd) if welcome_hwnd else 'None'}")

    if welcome_hwnd:
        # 7. Verify Topmost style
        topmost = is_window_topmost(welcome_hwnd)
        record_test("Welcome Wizard has WS_EX_TOPMOST style (Top Window)", topmost)

        # 8. Verify Dimensions
        w, h = get_window_dimensions(welcome_hwnd)
        dim_ok = (720 <= w <= 800) and (620 <= h <= 700)
        record_test("Welcome Wizard dimensions close to 760x660", dim_ok, f"Actual dimensions: {w}x{h}")

        # 9. Verify Ownership
        if main_hwnd:
            owner_hwnd = user32.GetWindow(welcome_hwnd, GW_OWNER)
            record_test("Welcome Wizard owned by Main Window (HWND_OWNER)", owner_hwnd == main_hwnd, f"Owner: {hex(owner_hwnd)} vs Main: {hex(main_hwnd)}")

    # 10. Test Completing Setup Wizard (/api/system/complete-first-run)
    complete_payload = {
        "max_concurrent_downloads": 4,
        "default_connections_per_task": 32,
        "close_action": "tray"
    }
    comp_res = api_post("/api/system/complete-first-run", complete_payload)
    record_test("POST /api/system/complete-first-run succeeds", comp_res.get("success") is True and comp_res.get("firstRunCompleted") is True)

    # 11. Verify Config updated and marked complete
    cfg_updated = api_get("/api/config")
    first_run_done = cfg_updated.get("firstRunCompleted") is True
    conns_ok = cfg_updated.get("defaultConnectionsPerTask") == 32
    max_dl_ok = cfg_updated.get("maxConcurrentDownloads") == 4
    record_test("Persistence: firstRunCompleted is True in SQLite", first_run_done)
    record_test("Custom acceleration applied (32 conns, 4 max dl)", conns_ok and max_dl_ok, f"conns={cfg_updated.get('defaultConnectionsPerTask')}, max={cfg_updated.get('maxConcurrentDownloads')}")

    # 12. Close Welcome Wizard cleanly
    if welcome_hwnd and user32.IsWindow(welcome_hwnd):
        user32.PostMessageW(welcome_hwnd, WM_CLOSE, 0, 0)
        time.sleep(0.5)
        is_closed = not bool(user32.IsWindow(welcome_hwnd))
        record_test("Welcome Wizard destroyed cleanly on WM_CLOSE", is_closed)

    # 13. Test Reopening Welcome Wizard on Demand (e.g. from Options)
    reopen_res = api_post("/api/window/open-welcome")
    record_test("Re-open Welcome Wizard on demand succeeds", reopen_res.get("success") is True)

    reopen_hwnd = None
    for _ in range(15):
        time.sleep(0.15)
        for hwnd in find_windows_by_class("Waterfall_Dialog_Class"):
            title = get_window_title(hwnd)
            if "Setup & Welcome Wizard" in title or "Welcome" in title:
                reopen_hwnd = hwnd
                break
        if reopen_hwnd:
            break

    record_test("Reopened Welcome Wizard window found", reopen_hwnd is not None, f"HWND: {hex(reopen_hwnd) if reopen_hwnd else 'None'}")
    if reopen_hwnd and user32.IsWindow(reopen_hwnd):
        user32.PostMessageW(reopen_hwnd, WM_CLOSE, 0, 0)
        time.sleep(0.3)

    # Summary
    print("-" * 65)
    print(f"TEST RESULTS: {passed_count} / {total_tests} PASSED ({(passed_count/total_tests)*100:.1f}%)")
    print("=" * 65)

    if proc:
        try:
            api_post("/api/system/exit")
            proc.wait(timeout=3)
        except Exception:
            proc.terminate()

    return 0 if passed_count == total_tests else 1

if __name__ == "__main__":
    sys.exit(run_tests())

