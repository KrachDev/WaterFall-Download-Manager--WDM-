use std::net::TcpStream;
use std::path::PathBuf;
use std::process::Command;
use std::time::Duration;
use tauri::{
  menu::{MenuBuilder, MenuItemBuilder},
  tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
  AppHandle, Manager, WebviewUrl, WebviewWindowBuilder,
};

fn is_server_running() -> bool {
  TcpStream::connect_timeout(
    &"127.0.0.1:4567".parse().unwrap(),
    Duration::from_millis(400),
  )
  .is_ok()
}

fn ensure_backend_running() {
  if is_server_running() {
    return;
  }

  // Look for server.js in current dir, parent dirs, or relative to exe
  let mut candidates = vec![
    PathBuf::from("server.js"),
    PathBuf::from("../server.js"),
    PathBuf::from("../../server.js"),
    PathBuf::from("../../../server.js"),
  ];

  if let Ok(exe) = std::env::current_exe() {
    if let Some(dir) = exe.parent() {
      candidates.push(dir.join("server.js"));
      candidates.push(dir.join("../server.js"));
      candidates.push(dir.join("../../server.js"));
      candidates.push(dir.join("../../../server.js"));
    }
  }

  let mut server_path = None;
  for c in &candidates {
    if c.exists() {
      server_path = Some(c.clone());
      break;
    }
  }

  if let Some(target) = server_path {
    let mut cmd = Command::new("node");
    cmd.arg(&target);

    if let Some(parent) = target.parent() {
      if parent.as_os_str().len() > 0 {
        cmd.current_dir(parent);
      }
    }

    #[cfg(target_os = "windows")]
    {
      use std::os::windows::process::CommandExt;
      const CREATE_NO_WINDOW: u32 = 0x08000000;
      cmd.creation_flags(CREATE_NO_WINDOW);
    }

    if let Ok(_) = cmd.spawn() {
      // Wait up to 5 seconds for daemon to respond
      for _ in 0..25 {
        std::thread::sleep(Duration::from_millis(200));
        if is_server_running() {
          break;
        }
      }
    }
  }
}

#[tauri::command]
fn open_confirm_window(app: AppHandle) -> Result<(), String> {
  if let Some(win) = app.get_webview_window("confirm") {
    let _ = win.show();
    let _ = win.set_focus();
    return Ok(());
  }

  let url_str = "http://localhost:4567/confirm.html";
  if let Ok(url) = url_str.parse() {
    let _win = WebviewWindowBuilder::new(&app, "confirm", WebviewUrl::External(url))
      .title("Waterfall — Download File Info")
      .inner_size(680.0, 720.0)
      .min_inner_size(580.0, 500.0)
      .always_on_top(true)
      .resizable(true)
      .build()
      .map_err(|e| e.to_string())?;
  }

  Ok(())
}

#[tauri::command]
fn open_progress_window(app: AppHandle, task_id: String) -> Result<(), String> {
  let clean_id = task_id.replace('-', "_");
  let win_label = format!("progress_{}", clean_id);
  if let Some(win) = app.get_webview_window(&win_label) {
    let _ = win.show();
    let _ = win.set_focus();
    return Ok(());
  }

  let url_str = format!("http://localhost:4567/download-progress.html?taskId={}", task_id);
  if let Ok(url) = url_str.parse() {
    let _win = WebviewWindowBuilder::new(&app, win_label, WebviewUrl::External(url))
      .title("Waterfall — Download Progress")
      .inner_size(640.0, 560.0)
      .min_inner_size(540.0, 460.0)
      .resizable(true)
      .build()
      .map_err(|e| e.to_string())?;
  }

  Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  // Ensure the Waterfall backend daemon is alive before showing UI
  ensure_backend_running();

  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![open_confirm_window, open_progress_window])
    .setup(|app| {
      // Build Tray Menu
      let open_item = MenuItemBuilder::with_id("open", "🚀 Open Waterfall").build(app)?;
      let resume_item = MenuItemBuilder::with_id("resume", "▶️ Resume All Downloads").build(app)?;
      let pause_item = MenuItemBuilder::with_id("pause", "⏸️ Pause All Downloads").build(app)?;
      let downloads_item = MenuItemBuilder::with_id("downloads", "📂 Open Downloads Folder").build(app)?;
      let exit_item = MenuItemBuilder::with_id("exit", "❌ Exit Waterfall").build(app)?;

      let menu = MenuBuilder::new(app)
        .item(&open_item)
        .separator()
        .item(&resume_item)
        .item(&pause_item)
        .separator()
        .item(&downloads_item)
        .separator()
        .item(&exit_item)
        .build()?;

      // Create Tray Icon
      let _tray = TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("Waterfall — IDM & JDownloader Suite")
        .menu(&menu)
        .on_menu_event(|app, event| {
          match event.id.as_ref() {
            "open" => {
              if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
              }
            }
            "resume" => {
              std::thread::spawn(|| {
                let _ = Command::new("node")
                  .args(["-e", "require('http').request('http://localhost:4567/api/downloads/resume-all', {method:'POST'}).end()"])
                  .spawn();
              });
            }
            "pause" => {
              std::thread::spawn(|| {
                let _ = Command::new("node")
                  .args(["-e", "require('http').request('http://localhost:4567/api/downloads/pause-all', {method:'POST'}).end()"])
                  .spawn();
              });
            }
            "downloads" => {
              if let Some(home) = dirs_fallback() {
                let dl = home.join("Downloads");
                #[cfg(target_os = "windows")]
                let _ = Command::new("explorer").arg(dl).spawn();
              }
            }
            "exit" => {
              app.exit(0);
            }
            _ => {}
          }
        })
        .on_tray_icon_event(|tray, event| {
          if let TrayIconEvent::Click {
            button: MouseButton::Left,
            button_state: MouseButtonState::Up,
            ..
          } = event
          {
            let app = tray.app_handle();
            if let Some(window) = app.get_webview_window("main") {
              let _ = window.show();
              let _ = window.set_focus();
            }
          }
        })
        .build(app)?;

      Ok(())
    })
    .on_window_event(|window, event| {
      if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        // Hide to tray on close
        api.prevent_close();
        let _ = window.hide();
      }
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

fn dirs_fallback() -> Option<PathBuf> {
  std::env::var_os("USERPROFILE")
    .map(PathBuf::from)
    .or_else(|| std::env::var_os("HOME").map(PathBuf::from))
}
