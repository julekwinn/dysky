//! What the window can ask of the Rust side: the drives, a scan with live progress, and questions about the
//! last scan. Every command is async, so a long answer never freezes the window.

use crate::scan::{self, Progress};
use crate::tree::{Found, Hit, Tree, View};
use crate::{drives, win};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::atomic::Ordering::Relaxed;
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};
use tauri::ipc::Channel;
use tauri::State;

/// The last finished scan, and the progress of the running one.
#[derive(Default)]
pub struct Scans {
    tree: RwLock<Option<Tree>>,
    progress: RwLock<Arc<Progress>>,
}

/// What a running scan tells the window a few times a second.
#[derive(Serialize, Clone)]
pub struct Tick {
    files: u64,
    bytes: u64,
    path: String,
    /// top-level folders finished since the last tick
    parts: Vec<Part>,
}

#[derive(Serialize, Clone)]
pub struct Part {
    name: String,
    size: u64,
}

#[derive(Serialize)]
pub struct Done {
    files: u64,
    /// folders that could not be read
    denied: u64,
    secs: f64,
    root: View,
}

/// The error a cancelled scan ends with; the window knows it and stays quiet.
const CANCELLED: &str = "cancelled";

fn ask<T>(state: &Scans, question: impl FnOnce(&Tree) -> Option<T>) -> Result<T, String> {
    let guard = state.tree.read().map_err(|e| e.to_string())?;
    let tree = guard.as_ref().ok_or("Nothing has been scanned yet")?;
    question(tree).ok_or_else(|| "That item is gone; scan again".into())
}

/// The window's backdrop: "mica" on Windows 11, where the page lets it show through, "none" elsewhere.
#[tauri::command]
pub fn material() -> &'static str {
    if win::has_mica() {
        "mica"
    } else {
        "none"
    }
}

#[tauri::command]
pub async fn drives() -> Vec<drives::Drive> {
    drives::list()
}

#[tauri::command]
pub async fn scan(state: State<'_, Scans>, path: String, all: bool, on_tick: Channel<Tick>) -> Result<Done, String> {
    // The new scan's counters go in first, so a Cancel pressed from now on stops this scan and no other.
    let progress = Arc::new(Progress::default());
    *state.progress.write().map_err(|e| e.to_string())? = progress.clone();
    let started = Instant::now();

    let p = progress.clone();
    let built = tauri::async_runtime::spawn_blocking(move || {
        let mut path = PathBuf::from(path);
        if path.is_file() {
            path.pop(); // a dropped file means its folder
        }
        if let Err(e) = std::fs::read_dir(&path) {
            return Err(match e.kind() {
                std::io::ErrorKind::PermissionDenied => "Dysky isn't allowed to look inside that folder".to_string(),
                _ => "That folder can't be opened".to_string(),
            });
        }
        // Tell the window how far along we are a few times a second, finished top-level folders included.
        let ticker = {
            let p = p.clone();
            std::thread::spawn(move || loop {
                let done = p.done.load(Relaxed);
                let path = p.current.lock().map(|c| c.clone()).unwrap_or_default();
                let parts = p.parts.lock().map(|mut q| q.drain(..).map(|(name, size)| Part { name, size }).collect()).unwrap_or_default();
                let tick = Tick { files: p.files.load(Relaxed), bytes: p.bytes.load(Relaxed), path, parts };
                if on_tick.send(tick).is_err() || done {
                    break;
                }
                std::thread::sleep(Duration::from_millis(120));
            })
        };
        let node = scan::scan(&path, &p);
        p.done.store(true, Relaxed);
        let _ = ticker.join();
        if p.cancel.load(Relaxed) {
            return Err(CANCELLED.to_string());
        }
        Ok(Tree::new(node))
    })
    .await
    .map_err(|e| e.to_string())??;

    let root = built.view(0, 3, all).ok_or("Empty scan")?;
    *state.tree.write().map_err(|e| e.to_string())? = Some(built);
    Ok(Done { files: progress.files.load(Relaxed), denied: progress.denied.load(Relaxed), secs: started.elapsed().as_secs_f64(), root })
}

#[tauri::command]
pub async fn cancel_scan(state: State<'_, Scans>) -> Result<(), String> {
    state.progress.read().map_err(|e| e.to_string())?.cancel.store(true, Relaxed);
    Ok(())
}

#[tauri::command]
pub async fn view(state: State<'_, Scans>, id: u32, depth: u8, all: bool) -> Result<View, String> {
    ask(&state, |t| t.view(id, depth.min(3), all))
}

#[tauri::command]
pub async fn largest(state: State<'_, Scans>, cur: u32, all: bool) -> Result<Vec<Hit>, String> {
    ask(&state, |t| Some(t.largest(cur, all, 20)))
}

#[tauri::command]
pub async fn search(state: State<'_, Scans>, query: String, cur: u32, all: bool) -> Result<Found, String> {
    ask(&state, |t| Some(t.search(&query, cur, all, 40)))
}

#[tauri::command]
pub async fn trail(state: State<'_, Scans>, id: u32, all: bool) -> Result<Vec<View>, String> {
    ask(&state, |t| Some(t.trail(id, all)))
}

#[tauri::command]
pub async fn path(state: State<'_, Scans>, id: u32) -> Result<String, String> {
    ask(&state, |t| t.path(id)).map(|p| p.to_string_lossy().into_owned())
}

/// Opens File Explorer with the item selected. Only paths from the scan are used, never one from the window.
#[tauri::command]
pub async fn reveal(state: State<'_, Scans>, id: u32) -> Result<(), String> {
    let path = ask(&state, |t| t.path(id))?;
    win::reveal(&path)
}
