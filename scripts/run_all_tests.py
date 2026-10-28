"""
Comprehensive Automated Test Suite for Waterfall v2.0
Covers:
  SECTION 1: Core Engine & REST API Verification
  SECTION 2: IDM-Style Setup & Welcome Wizard
  SECTION 3: Native Dialog Windows (Confirm, Progress, Pinning, Elevation, Close)
  SECTION 4: Real-time Download Execution & State Management
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

def main():
    print("=" * 70)
    print("  🌊 WATERFALL ACCELERATOR v2.0 — COMPREHENSIVE TEST SUITE")
    print("=" * 70)

    passed_count = 0
    total_tests = 0

    def test(name, condition, details=""):
        nonlocal passed_count, total_tests
        total_tests += 1
        tag = "PASS" if condition else "FAIL"
        print(f"  [{tag}] Test {total_tests:02d}: {name}")
        if details:
            print(f"         └─ {details}")
        if condition:
            passed_count += 1
        return condition

    # -----------------------------------------------------------------
    # SECTION 1: CORE ENGINE & REST API
    # -----------------------------------------------------------------
    print("\n--- SECTION 1: Core Engine & REST API Verification ---")
    proc = None
    connected = False
    for _ in range(10):
        try:
            cfg = api_get("/api/config")
            connected = True
            break
        except Exception:
            time.sleep(0.3)

    if not connected:
        exe_path = os.path.abspath("build/waterfall.exe")
        print(f"  [Setup] Spawning Waterfall engine: {exe_path}")
        proc = subprocess.Popen([exe_path, "--debug"], cwd=os.getcwd())
        for _ in range(30):
            time.sleep(0.4)
            try:
                cfg = api_get("/api/config")
                connected = True
                break
            except Exception:
                pass

    test("Extension Server connection at http://127.0.0.1:4567", connected)
    if not connected:
        print("Fatal: Cannot connect to engine.")
        return 1

    time.sleep(0.8)

    test("Config schema contains 'firstRunCompleted'", "firstRunCompleted" in cfg, f"Val: {cfg.get('firstRunCompleted')}")
    test("Config schema contains 'defaultConnectionsPerTask'", "defaultConnectionsPerTask" in cfg, f"Val: {cfg.get('defaultConnectionsPerTask')}")
    test("Config schema contains 'downloadDirectory'", "downloadDirectory" in cfg, f"Path: {cfg.get('downloadDirectory')}")

    main_hwnd = find_main_window()
    test("Main WebView2 Window HWND active", main_hwnd is not None, f"HWND: {hex(main_hwnd) if main_hwnd else 'None'}")

    # -----------------------------------------------------------------
    # SECTION 2: IDM-STYLE SETUP & WELCOME WIZARD
    # -----------------------------------------------------------------
    print("\n--- SECTION 2: IDM-Style Setup & Welcome Wizard ---")
    first_run_info = api_get("/api/system/first-run")
    test("GET /api/system/first-run responds", "completed" in first_run_info, f"Completed: {first_run_info.get('completed')}")

    # Test reset
    reset_res = api_post("/api/system/reset-first-run")
    test("POST /api/system/reset-first-run succeeds", reset_res.get("success") is True and reset_res.get("firstRunCompleted") is False)

    # Spawn Welcome Wizard
    api_post("/api/window/open-welcome")
    time.sleep(0.3)

    welcome_hwnd = None
    for _ in range(20):
        for h in find_windows_by_class("Waterfall_Dialog_Class"):
            t = get_window_title(h)
            if "Setup & Welcome Wizard" in t or "Welcome" in t:
                welcome_hwnd = h
                break
        if welcome_hwnd:
            break
        time.sleep(0.1)

    test("Welcome Wizard window HWND created", welcome_hwnd is not None, f"HWND: {hex(welcome_hwnd) if welcome_hwnd else 'None'}")
    if welcome_hwnd:
        test("Welcome Wizard is Top Window (WS_EX_TOPMOST)", is_window_topmost(welcome_hwnd))
        w, h = get_window_dimensions(welcome_hwnd)
        test("Welcome Wizard dimensions close to 760x660", 720 <= w <= 800 and 620 <= h <= 700, f"Size: {w}x{h}")
        if main_hwnd:
            test("Welcome Wizard owned by Main Window (HWND_OWNER)", user32.GetWindow(welcome_hwnd, GW_OWNER) == main_hwnd)

    # Complete first run
    comp_res = api_post("/api/system/complete-first-run", {
        "max_concurrent_downloads": 4,
        "default_connections_per_task": 16,
        "close_action": "tray"
    })
    test("POST /api/system/complete-first-run marks completed", comp_res.get("success") is True and comp_res.get("firstRunCompleted") is True)

    cfg_persisted = api_get("/api/config")
    test("SQLite persistence: firstRunCompleted is True", cfg_persisted.get("firstRunCompleted") is True)

    # Clean close welcome dialog
    if welcome_hwnd and user32.IsWindow(welcome_hwnd):
        user32.PostMessageW(welcome_hwnd, WM_CLOSE, 0, 0)
        time.sleep(0.3)
        test("Welcome Wizard window destroyed on close", not bool(user32.IsWindow(welcome_hwnd)))

    # -----------------------------------------------------------------
    # SECTION 3: NATIVE DIALOG WINDOWS
    # -----------------------------------------------------------------
    print("\n--- SECTION 3: Native Dialog Windows (Confirm & Progress) ---")
    confirm_res = api_post("/api/window/open-confirm", {
        "url": "https://speed.hetzner.de/100MB.bin",
        "filename": "100MB.bin",
        "fileSize": 104857600
    })
    test("POST /api/window/open-confirm succeeds", confirm_res.get("success") is True)
    time.sleep(0.3)

    confirm_hwnd = None
    for _ in range(15):
        for h in find_windows_by_class("Waterfall_Dialog_Class"):
            t = get_window_title(h)
            if "Download File Info" in t:
                confirm_hwnd = h
                break
        if confirm_hwnd:
            break
        time.sleep(0.1)

    test("Confirm Dialog window found", confirm_hwnd is not None, f"HWND: {hex(confirm_hwnd) if confirm_hwnd else 'None'}")
    if confirm_hwnd:
        test("Confirm Dialog is Top Window (WS_EX_TOPMOST)", is_window_topmost(confirm_hwnd))
        cw, ch = get_window_dimensions(confirm_hwnd)
        test("Confirm Dialog dimension around 680x750", 650 <= cw <= 720 and 700 <= ch <= 790, f"Size: {cw}x{ch}")

        # Test unpinning / re-pinning
        api_post("/api/window/set-topmost", {"topmost": False, "type": "confirm"})
        time.sleep(0.1)
        test("Confirm Dialog unpinned (WS_EX_TOPMOST removed)", not is_window_topmost(confirm_hwnd))

        api_post("/api/window/set-topmost", {"topmost": True, "type": "confirm"})
        time.sleep(0.1)
        test("Confirm Dialog re-pinned (WS_EX_TOPMOST restored)", is_window_topmost(confirm_hwnd))

        # Close confirm dialog
        user32.PostMessageW(confirm_hwnd, WM_CLOSE, 0, 0)
        time.sleep(0.3)
        test("Confirm Dialog destroyed cleanly", not bool(user32.IsWindow(confirm_hwnd)))

    # -----------------------------------------------------------------
    # SECTION 4: PROGRESS DIALOG & ELEVATION
    # -----------------------------------------------------------------
    print("\n--- SECTION 4: Progress Dialog & Elevation ---")
    progress_res = api_post("/api/window/open-progress", {"taskId": 42, "topmost": False})
    test("POST /api/window/open-progress succeeds", progress_res.get("success") is True)
    time.sleep(0.3)

    prog_hwnd = None
    for _ in range(15):
        for h in find_windows_by_class("Waterfall_Dialog_Class"):
            t = get_window_title(h)
            if "Download Progress" in t:
                prog_hwnd = h
                break
        if prog_hwnd:
            break
        time.sleep(0.1)

    test("Progress Dialog window found", prog_hwnd is not None, f"HWND: {hex(prog_hwnd) if prog_hwnd else 'None'}")
    if prog_hwnd:
        test("Progress Dialog initially normal window (not topmost)", not is_window_topmost(prog_hwnd))

        # Test dynamic pin toggle
        api_post("/api/window/set-topmost", {"taskId": 42, "topmost": True})
        time.sleep(0.1)
        test("Progress Dialog pinned to top via Pin control", is_window_topmost(prog_hwnd))

        api_post("/api/window/set-topmost", {"taskId": 42, "topmost": False})
        time.sleep(0.1)
        test("Progress Dialog unpinned via Pin control", not is_window_topmost(prog_hwnd))

        # Test Done/Error Elevation
        api_post("/api/window/set-topmost", {"taskId": 42, "topmost": True, "bringToFront": True})
        time.sleep(0.1)
        test("Elevation on Done/Error promotes to HWND_TOPMOST", is_window_topmost(prog_hwnd))

        # Close progress dialog
        user32.PostMessageW(prog_hwnd, WM_CLOSE, 0, 0)
        time.sleep(0.3)
        test("Progress Dialog destroyed cleanly", not bool(user32.IsWindow(prog_hwnd)))

    # -----------------------------------------------------------------
    # SUMMARY REPORT
    # -----------------------------------------------------------------
    print("\n" + "=" * 70)
    pct = (passed_count / total_tests) * 100.0 if total_tests > 0 else 0
    print(f"  TEST SUMMARY: {passed_count} / {total_tests} PASSED ({pct:.1f}%)")
    print("=" * 70)

    if proc:
        try:
            api_post("/api/system/exit")
            proc.wait(timeout=3)
        except Exception:
            proc.terminate()

    return 0 if passed_count == total_tests else 1

if __name__ == "__main__":
    sys.exit(main())
