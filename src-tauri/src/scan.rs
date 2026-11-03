//! The scan: a parallel walk of a drive or folder into a tree of `Node`s, sized as the files sit on the disk.

use crate::win::{self, attr};
use rayon::prelude::*;
use std::collections::HashSet;
use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering::Relaxed};
use std::sync::Mutex;

/// Bits of `Node::flags`.
pub const DIR: u8 = 1;
pub const HIDDEN: u8 = 2;
/// A folder that could not be read (another user's, System Volume Information): it counts as empty.
pub const DENIED: u8 = 4;

/// Live counters a scan updates from many threads at once.
#[derive(Default)]
pub struct Progress {
    pub files: AtomicU64,
    pub bytes: AtomicU64,
    pub denied: AtomicU64,
    pub cancel: AtomicBool,
    pub done: AtomicBool,
    /// The folder being read right now, for the window to show.
    pub current: Mutex<String>,
    /// Top-level folders finished since the window last heard, as (name, size).
    pub parts: Mutex<Vec<(String, u64)>>,
}

/// What the scan builds; flattened into a `Tree` once it is complete.
pub struct Node {
    pub name: Box<str>,
    pub size: u64,
    /// The size without hidden and system items.
    pub shown: u64,
    pub flags: u8,
    pub kids: Vec<Node>,
}

impl Node {
    pub fn file(name: &str, size: u64, hidden: bool) -> Node {
        Node { name: name.into(), size, shown: size, flags: if hidden { HIDDEN } else { 0 }, kids: Vec::new() }
    }

    pub fn dir(name: &str, hidden: bool, mut kids: Vec<Node>) -> Node {
        kids.sort_unstable_by_key(|k| std::cmp::Reverse(k.size));
        let size = kids.iter().map(|k| k.size).sum();
        let shown = kids.iter().filter(|k| k.flags & HIDDEN == 0).map(|k| k.shown).sum();
        Node { name: name.into(), size, shown, flags: DIR | if hidden { HIDDEN } else { 0 }, kids }
    }

    fn denied(name: &str, hidden: bool) -> Node {
        let mut node = Node::dir(name, hidden, Vec::new());
        node.flags |= DENIED;
        node
    }
}

/// Scans `path` with every core. Finished top-level folders are queued in `p.parts` for the window.
pub fn scan(path: &Path, p: &Progress) -> Node {
    walk(path, &path.to_string_lossy(), false, p, true)
}

fn walk(path: &Path, name: &str, hidden: bool, p: &Progress, top: bool) -> Node {
    if p.cancel.load(Relaxed) {
        return Node::dir(name, hidden, Vec::new());
    }
    let Ok(list) = fs::read_dir(path) else {
        p.denied.fetch_add(1, Relaxed);
        return Node::denied(name, hidden);
    };
    let mut files = Vec::new();
    let mut dirs = Vec::new();
    let mut seen = HashSet::new();
    for entry in list.flatten() {
        if p.cancel.load(Relaxed) {
            break;
        }
        // Metadata comes with the listing (no file is opened), so cloud files are never downloaded.
        let Ok(md) = entry.metadata() else { continue };
        // Symbolic links and junctions point at things counted elsewhere, and can loop.
        if md.file_type().is_symlink() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        let attrs = win::attributes(&md);
        let hidden = attrs & (attr::HIDDEN | attr::SYSTEM) != 0 || name.starts_with('.');
        if md.is_dir() {
            // "Windows" and "windows" side by side open the same folder, unless this one is case-sensitive:
            // the second spelling is listed, but not counted again.
            if seen.insert(name.to_lowercase()) || win::case_sensitive(path) {
                dirs.push((entry.path(), name, hidden));
            } else {
                files.push(Node::dir(&name, hidden, Vec::new()));
            }
        } else {
            let size = win::size_on_disk(&entry.path(), &md, attrs);
            p.files.fetch_add(1, Relaxed);
            p.bytes.fetch_add(size, Relaxed);
            files.push(Node::file(&name, size, hidden));
        }
    }
    if let Ok(mut current) = p.current.try_lock() {
        *current = path.to_string_lossy().into_owned();
    }
    let mut kids: Vec<Node> = dirs
        .into_par_iter()
        .map(|(path, name, hidden)| {
            let node = walk(&path, &name, hidden, p, false);
            if top {
                if let Ok(mut parts) = p.parts.lock() {
                    parts.push((node.name.to_string(), node.size));
                }
            }
            node
        })
        .collect();
    kids.append(&mut files);
    Node::dir(name, hidden, kids)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tree::Tree;

    fn temp(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("dysky-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn scans_a_real_folder() {
        let dir = temp("scan");
        fs::create_dir_all(dir.join("inner")).unwrap();
        fs::write(dir.join("a.bin"), vec![0u8; 1000]).unwrap();
        fs::write(dir.join("inner").join("b.bin"), vec![0u8; 3000]).unwrap();
        let progress = Progress::default();
        let t = Tree::new(scan(&dir, &progress));
        let root = t.view(0, 1, true).unwrap();
        assert_eq!(root.size(), 4000);
        assert_eq!(root.names(), ["inner", "a.bin"]);
        assert_eq!(progress.files.load(Relaxed), 2);
        assert_eq!(*progress.parts.lock().unwrap(), [("inner".to_string(), 3000)]);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_cancelled_scan_stops_early() {
        let dir = temp("cancel");
        fs::write(dir.join("a.bin"), vec![0u8; 10]).unwrap();
        let progress = Progress::default();
        progress.cancel.store(true, Relaxed);
        let node = scan(&dir, &progress);
        assert!(node.kids.is_empty());
        assert_eq!(progress.files.load(Relaxed), 0);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_missing_folder_is_counted_as_unreadable() {
        let progress = Progress::default();
        let node = scan(Path::new("Z:\\dysky\\does\\not\\exist"), &progress);
        assert!(node.flags & DENIED != 0);
        assert_eq!(progress.denied.load(Relaxed), 1);
    }

    #[test]
    fn cloud_only_files_take_no_space() {
        let dir = temp("cloud");
        fs::write(dir.join("a.bin"), vec![0u8; 500]).unwrap();
        let md = fs::metadata(dir.join("a.bin")).unwrap();
        assert_eq!(win::size_on_disk(&dir.join("a.bin"), &md, 0), 500);
        assert_eq!(win::size_on_disk(&dir.join("a.bin"), &md, attr::RECALL_ON_DATA_ACCESS), 0);
        fs::remove_dir_all(&dir).unwrap();
    }
}
