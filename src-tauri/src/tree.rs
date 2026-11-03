//! The scanned tree as one flat list, and the questions the window asks about it.
//!
//! Entries are stored depth-first, so a folder's contents are the ids `id + 1 .. end`: walking a
//! subtree is a slice, and a whole drive of a million files costs a few dozen bytes per entry.

use crate::scan::{Node, DENIED, DIR, HIDDEN};
use serde::Serialize;
use std::cmp::Reverse;
use std::collections::{BinaryHeap, HashSet};
use std::path::PathBuf;

/// How many children of the open folder the window gets; the rest are summed up as `more`.
const LIST_MAX: usize = 500;
/// Below the open folder, pieces smaller than this share of it are too thin to draw.
const MIN_SHARE: f64 = 0.0015;
/// Search lights the chart for at most this many matches.
const LIT_MAX: usize = 20_000;

struct Entry {
    name: Box<str>,
    size: u64,
    shown: u64,
    parent: u32,
    end: u32,
    flags: u8,
}

pub struct Tree {
    entries: Vec<Entry>,
}

/// One folder or file for the window, with its biggest children when asked for.
/// The field names are short because a view of a drive holds a few thousand of them.
#[derive(Serialize)]
pub struct View {
    id: u32,
    /// name
    n: String,
    /// size in bytes
    s: u64,
    /// is a folder
    d: bool,
    /// has children (a folder that can be opened)
    h: bool,
    /// the children, largest first, when this level was asked for
    #[serde(skip_serializing_if = "Option::is_none")]
    k: Option<Vec<View>>,
    /// children left out of `k`, and their total size
    more: u32,
    #[serde(rename = "moreS")]
    more_s: u64,
    /// the folder could not be read
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    denied: bool,
}

/// A search result or one of the largest files.
#[derive(Serialize)]
pub struct Hit {
    id: u32,
    n: String,
    s: u64,
    d: bool,
    h: bool,
    /// where it is, relative to the folder asked about ("…\Users\Alex")
    at: String,
    /// which of the open folder's children holds it, as an index of that folder's list; -1 if none
    top: i32,
}

#[derive(Serialize, Default)]
pub struct Found {
    total: usize,
    hits: Vec<Hit>,
    /// chart pieces under the open folder that hold a match, up to three levels down
    lit: Vec<u32>,
}

impl Tree {
    pub fn new(root: Node) -> Tree {
        let mut entries = Vec::new();
        push(root, 0, &mut entries);
        Tree { entries }
    }

    fn e(&self, id: u32) -> &Entry {
        &self.entries[id as usize]
    }

    fn has(&self, id: u32) -> bool {
        (id as usize) < self.entries.len()
    }

    fn size(&self, id: u32, all: bool) -> u64 {
        if all {
            self.e(id).size
        } else {
            self.e(id).shown
        }
    }

    fn is_dir(&self, id: u32) -> bool {
        self.e(id).flags & DIR != 0
    }

    fn visible(&self, id: u32, all: bool) -> bool {
        all || self.e(id).flags & HIDDEN == 0
    }

    fn kids(&self, id: u32) -> impl Iterator<Item = u32> + '_ {
        let end = self.e(id).end;
        let mut next = id + 1;
        std::iter::from_fn(move || {
            (next < end).then(|| {
                let k = next;
                next = self.e(k).end;
                k
            })
        })
    }

    /// Visible children, largest first (the scan sorted them by full size, so only the
    /// sizes without hidden items need sorting again).
    fn sorted(&self, id: u32, all: bool) -> Vec<u32> {
        let mut list: Vec<u32> = self.kids(id).filter(|&k| self.visible(k, all)).collect();
        if !all {
            list.sort_by_key(|&k| Reverse(self.size(k, false)));
        }
        list
    }

    fn has_kids(&self, id: u32, all: bool) -> bool {
        self.kids(id).any(|k| self.visible(k, all))
    }

    /// Visible entries inside `id`, depth-first, skipping hidden folders whole.
    fn inside(&self, id: u32, all: bool) -> impl Iterator<Item = u32> + '_ {
        let end = self.e(id).end;
        let mut i = id + 1;
        std::iter::from_fn(move || {
            while i < end {
                let k = i;
                if self.visible(k, all) {
                    i += 1;
                    return Some(k);
                }
                i = self.e(k).end;
            }
            None
        })
    }

    pub fn path(&self, id: u32) -> Option<PathBuf> {
        if !self.has(id) {
            return None;
        }
        let mut names = Vec::new();
        let mut x = id;
        while x != 0 {
            names.push(&*self.e(x).name);
            x = self.e(x).parent;
        }
        let mut path = PathBuf::from(&*self.e(0).name);
        path.extend(names.iter().rev());
        Some(path)
    }

    /// "…\a\b" from `base` down to `id`, or the full path when `id` is outside `base`.
    fn rel(&self, id: u32, base: u32) -> String {
        let mut names = Vec::new();
        let mut x = id;
        while x != base && x != 0 {
            names.push(&*self.e(x).name);
            x = self.e(x).parent;
        }
        if x != base {
            return self.path(id).map(|p| p.to_string_lossy().into_owned()).unwrap_or_default();
        }
        if names.is_empty() {
            return String::new();
        }
        names.reverse();
        format!("…\\{}", names.join("\\"))
    }

    /// Which of `cur`'s children holds `id`, as an index into `order`; -1 when none does.
    fn top_of(&self, id: u32, cur: u32, order: &[u32]) -> i32 {
        let mut x = id;
        while x != 0 && self.e(x).parent != cur {
            x = self.e(x).parent;
        }
        if x == 0 {
            return -1;
        }
        order.iter().position(|&k| k == x).map_or(-1, |i| i as i32)
    }

    /// A folder with its children, and their children down to `depth` levels for the chart.
    /// The list gets up to `LIST_MAX` children; deeper levels keep only pieces big enough to draw.
    pub fn view(&self, id: u32, depth: u8, all: bool) -> Option<View> {
        if !self.has(id) {
            return None;
        }
        let min = self.size(id, all) as f64 * MIN_SHARE;
        Some(self.view_at(id, depth, all, true, min))
    }

    fn view_at(&self, id: u32, depth: u8, all: bool, top: bool, min: f64) -> View {
        let e = self.e(id);
        let mut v = View {
            id,
            n: e.name.to_string(),
            s: self.size(id, all),
            d: self.is_dir(id),
            h: false,
            k: None,
            more: 0,
            more_s: 0,
            denied: e.flags & DENIED != 0,
        };
        if !v.d {
            return v;
        }
        if depth == 0 || (!top && (v.s as f64) < min) {
            v.h = self.has_kids(id, all);
            return v;
        }
        let kids = self.sorted(id, all);
        v.h = !kids.is_empty();
        let mut list = Vec::new();
        for (i, k) in kids.into_iter().enumerate() {
            let s = self.size(k, all);
            let keep = if top { i < LIST_MAX } else { s as f64 >= min };
            if keep {
                list.push(self.view_at(k, depth - 1, all, false, min));
            } else {
                v.more += 1;
                v.more_s += s;
            }
        }
        v.k = Some(list);
        v
    }

    /// The chain of folders from the root down to `id`, without their children.
    pub fn trail(&self, id: u32, all: bool) -> Vec<View> {
        if !self.has(id) {
            return Vec::new();
        }
        let mut ids = vec![id];
        let mut x = id;
        while x != 0 {
            x = self.e(x).parent;
            ids.push(x);
        }
        ids.into_iter().rev().map(|k| self.view_at(k, 0, all, false, 0.0)).collect()
    }

    fn hit(&self, id: u32, all: bool, base: u32, cur: u32, order: &[u32]) -> Hit {
        Hit {
            id,
            n: self.e(id).name.to_string(),
            s: self.size(id, all),
            d: self.is_dir(id),
            h: self.is_dir(id) && self.has_kids(id, all),
            at: self.rel(self.e(id).parent, base),
            top: self.top_of(id, cur, order),
        }
    }

    /// The biggest files anywhere inside `cur`.
    pub fn largest(&self, cur: u32, all: bool, n: usize) -> Vec<Hit> {
        if !self.has(cur) {
            return Vec::new();
        }
        let files = self.inside(cur, all).filter(|&k| !self.is_dir(k));
        let order = self.sorted(cur, all);
        top_n(files, n, |k| self.size(k, all)).into_iter().map(|k| self.hit(k, all, cur, cur, &order)).collect()
    }

    /// Everything on the drive named like `query`, biggest first, plus which chart pieces under `cur` hold a match.
    pub fn search(&self, query: &str, cur: u32, all: bool, n: usize) -> Found {
        let q = query.trim().to_lowercase();
        if q.is_empty() || !self.has(cur) {
            return Found::default();
        }
        let matches: Vec<u32> = self.inside(0, all).filter(|&k| contains_ci(&self.e(k).name, &q)).collect();
        let mut lit = HashSet::new();
        for &m in matches.iter().take(LIT_MAX) {
            let mut chain = Vec::new();
            let mut x = m;
            while x != cur && x != 0 {
                chain.push(x);
                x = self.e(x).parent;
            }
            if x == cur {
                lit.extend(chain.into_iter().rev().take(3));
            }
        }
        let order = self.sorted(cur, all);
        let hits = top_n(matches.iter().copied(), n, |k| self.size(k, all)).into_iter().map(|k| self.hit(k, all, 0, cur, &order)).collect();
        Found { total: matches.len(), hits, lit: lit.into_iter().collect() }
    }
}

fn push(node: Node, parent: u32, out: &mut Vec<Entry>) {
    let id = out.len();
    out.push(Entry { name: node.name, size: node.size, shown: node.shown, parent, end: 0, flags: node.flags });
    for kid in node.kids {
        push(kid, id as u32, out);
    }
    out[id].end = out.len() as u32;
}

/// Whether `name` holds `lower` (already lowercase), ignoring case. Most names are ASCII, and those are
/// compared in place: a search runs over every name on the drive, and must not allocate for each.
fn contains_ci(name: &str, lower: &str) -> bool {
    if name.is_ascii() && lower.is_ascii() {
        let (h, n) = (name.as_bytes(), lower.as_bytes());
        return n.len() <= h.len() && h.windows(n.len()).any(|w| w.eq_ignore_ascii_case(n));
    }
    name.to_lowercase().contains(lower)
}

fn top_n(ids: impl Iterator<Item = u32>, n: usize, key: impl Fn(u32) -> u64) -> Vec<u32> {
    let mut heap = BinaryHeap::with_capacity(n + 1);
    for id in ids {
        heap.push(Reverse((key(id), Reverse(id))));
        if heap.len() > n {
            heap.pop();
        }
    }
    let mut best: Vec<(u64, Reverse<u32>)> = heap.into_iter().map(|Reverse(x)| x).collect();
    best.sort_unstable_by(|a, b| b.cmp(a));
    best.into_iter().map(|(_, Reverse(id))| id).collect()
}

#[cfg(test)]
impl View {
    pub fn size(&self) -> u64 {
        self.s
    }

    pub fn names(&self) -> Vec<&str> {
        self.k.as_ref().unwrap().iter().map(|k| k.n.as_str()).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Tree {
        Tree::new(Node::dir(
            "C:\\",
            false,
            vec![
                Node::dir(
                    "Users",
                    false,
                    vec![
                        Node::file("video.mov", 900, false),
                        Node::dir(".cache", true, vec![Node::file("blob", 300, false)]),
                        Node::file("notes.txt", 10, false),
                    ],
                ),
                Node::file("pagefile.sys", 500, true),
                Node::dir("Windows", false, vec![Node::file("kernel.dll", 200, false)]),
            ],
        ))
    }

    #[test]
    fn sizes_add_up_and_children_are_sorted() {
        let t = sample();
        let root = t.view(0, 1, true).unwrap();
        assert_eq!(root.s, 1910);
        assert_eq!(root.names(), ["Users", "pagefile.sys", "Windows"]);
    }

    #[test]
    fn hidden_items_drop_out_with_their_size() {
        let t = sample();
        let root = t.view(0, 2, false).unwrap();
        assert_eq!(root.s, 1110);
        assert_eq!(root.names(), ["Users", "Windows"]);
        let users = &root.k.as_ref().unwrap()[0];
        assert_eq!(users.s, 910);
        assert_eq!(users.names(), ["video.mov", "notes.txt"]);
    }

    #[test]
    fn long_lists_are_cut_and_summed_up() {
        let kids = (0..LIST_MAX + 20).map(|i| Node::file(&format!("f{i}"), 1000 + i as u64, false)).collect();
        let t = Tree::new(Node::dir("D:\\", false, kids));
        let root = t.view(0, 1, true).unwrap();
        assert_eq!(root.k.as_ref().unwrap().len(), LIST_MAX);
        assert_eq!(root.more, 20);
        assert_eq!(root.more_s, (1000..1020).sum::<u64>());
    }

    #[test]
    fn deeper_levels_keep_only_drawable_pieces() {
        let t = Tree::new(Node::dir(
            "D:\\",
            false,
            vec![Node::dir("big", false, vec![Node::file("large", 1_000_000, false), Node::file("crumb", 1, false)])],
        ));
        let big = &t.view(0, 2, true).unwrap().k.unwrap()[0];
        assert_eq!(big.names(), ["large"]);
        assert_eq!(big.more, 1);
    }

    #[test]
    fn a_file_has_no_children() {
        let t = sample();
        let file = t.view(2, 3, true).unwrap();
        assert_eq!(file.n, "video.mov");
        assert!(!file.d && !file.h && file.k.is_none());
    }

    #[test]
    fn largest_files_and_their_place() {
        let t = sample();
        let hits = t.largest(0, true, 2);
        assert_eq!(hits.iter().map(|h| h.n.as_str()).collect::<Vec<_>>(), ["video.mov", "pagefile.sys"]);
        assert_eq!(hits[0].at, "…\\Users");
        assert_eq!(hits[0].top, 0);
        assert_eq!(hits[1].at, "");
        assert_eq!(t.largest(0, false, 5).len(), 3);
    }

    #[test]
    fn search_finds_names_and_lights_the_way() {
        let t = sample();
        let found = t.search("BLOB", 0, true, 10);
        assert_eq!(found.total, 1);
        assert_eq!(found.hits[0].at, "…\\Users\\.cache");
        let users = 1;
        assert!(found.lit.contains(&users));
        assert_eq!(t.search("blob", 0, false, 10).total, 0);
        assert_eq!(t.search("  ", 0, true, 10).total, 0);
    }

    #[test]
    fn search_from_a_subfolder_lights_only_what_is_inside_it() {
        let t = sample();
        let windows = t.search("windows", 0, true, 1).hits[0].id;
        let found = t.search("video", windows, true, 10);
        assert_eq!(found.total, 1);
        assert!(found.lit.is_empty());
        assert_eq!(found.hits[0].top, -1);
    }

    #[test]
    fn case_is_ignored_in_any_script() {
        assert!(contains_ci("Win11_24H2_English_x64.ISO", "iso"));
        assert!(contains_ci("Zdjęcia ŁÓDŹ", "łódź"));
        assert!(!contains_ci("abc", "abcd"));
    }

    #[test]
    fn paths_and_trails() {
        let t = sample();
        let blob = t.search("blob", 0, true, 1).hits[0].id;
        assert_eq!(t.path(blob).unwrap(), PathBuf::from("C:\\Users\\.cache\\blob"));
        let trail: Vec<String> = t.trail(blob, true).into_iter().map(|v| v.n).collect();
        assert_eq!(trail, ["C:\\", "Users", ".cache", "blob"]);
        assert!(t.view(999, 1, true).is_none());
        assert!(t.path(999).is_none());
    }
}
