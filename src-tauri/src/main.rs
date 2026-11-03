//! Dysky: see what takes up the space on your drives. A read-only disk space viewer for Windows.
//!
//! `scan` walks a drive in parallel, `tree` keeps the result as one flat list and answers the window's
//! questions, `commands` is the bridge to the window, `drives` and `win` talk to Windows.

// Keeps a console window from opening next to the app in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod drives;
mod scan;
mod tree;
mod win;

use tauri::utils::config::WindowEffectsConfig;
use tauri::window::Effect;
use tauri::Manager;

fn main() {
    report_crashes();
    win::quiet_drive_errors();
    // Folder chains thousands of levels deep exist (copy loops of "Application Data"); the walk recurses
    // once per level, so its threads get more than the default 2 MiB of stack.
    let _ = rayon::ThreadPoolBuilder::new().stack_size(32 << 20).build_global();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(commands::Scans::default())
        .setup(|app| {
            // Windows 11 draws its Mica backdrop behind the see-through window; elsewhere the page paints its own.
            if let (true, Some(window)) = (win::has_mica(), app.get_webview_window("main")) {
                let mica = WindowEffectsConfig { effects: vec![Effect::Mica], ..Default::default() };
                let _ = window.set_effects(mica);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::material,
            commands::drives,
            commands::scan,
            commands::cancel_scan,
            commands::view,
            commands::largest,
            commands::search,
            commands::trail,
            commands::path,
            commands::reveal,
        ])
        .run(tauri::generate_context!());
    if let Err(e) = app {
        win::alert("Dysky could not start", &e.to_string());
        std::process::exit(1);
    }
}

/// Release builds have no console, so a crash would just close the window: say what happened instead, and
/// keep the details in %LOCALAPPDATA%\com.youlius.dysky\crash.log for a bug report.
fn report_crashes() {
    std::panic::set_hook(Box::new(|info| {
        let details = format!("Dysky {} crashed: {info}\n", env!("CARGO_PKG_VERSION"));
        let log = std::env::var_os("LOCALAPPDATA").map(|dir| std::path::PathBuf::from(dir).join("com.youlius.dysky").join("crash.log"));
        let saved = log.as_ref().is_some_and(|log| {
            log.parent().is_some_and(|dir| std::fs::create_dir_all(dir).is_ok())
                && std::fs::OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(log)
                    .and_then(|mut f| std::io::Write::write_all(&mut f, details.as_bytes()))
                    .is_ok()
        });
        let where_ = match (saved, &log) {
            (true, Some(log)) => format!("\n\nThe details are in {}.", log.display()),
            _ => String::new(),
        };
        win::alert("Dysky stopped", &format!("Something went wrong and Dysky has to close.\n\n{info}{where_}"));
    }));
}
