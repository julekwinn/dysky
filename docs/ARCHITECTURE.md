# Architecture

How Dysky is put together, for people who want to change it. The user-facing overview is in the [README](../README.md).

```text
 Windows file system
        │  read_dir + metadata, one rayon task per folder
        ▼
 scan.rs ─────────► Node tree (sized, children sorted)  ──► Tick over a Channel (progress)
        │  Tree::new flattens it depth-first
        ▼
 tree.rs ─────────► Vec<Entry> arena, the last scan, kept on the Rust side
        │  view / largest / search / trail / path
        ▼
 commands.rs ─────► Tauri IPC, JSON with short field names
        │
        ▼
 backend.js ──► app.js (pages, list, node cache) ──► chart.js + shapes.js ──► SVG
```

## Design rules

These hold for every change:

- **Read-only.** No code path writes, moves, renames or deletes the user's files. The only things Dysky writes are its own: settings in the WebView's `localStorage`, the window size and position (tauri-plugin-window-state), and a crash log in `%LOCALAPPDATA%\com.youlius.dysky\crash.log`.
- **No network.** The Content Security Policy in `src-tauri/tauri.conf.json` allows connections only to Tauri's IPC (`connect-src ipc: http://ipc.localhost`), there is no HTTP client among the Rust dependencies, and the drive list leaves out network drives.
- **The window only gets what it draws.** The tree stays in Rust; the window asks small questions about it.
- **Minimal dependencies.** Rust: `tauri`, `tauri-plugin-dialog` (folder picker), `tauri-plugin-window-state`, `serde`, `serde_json`, `rayon` and `windows-sys`. JavaScript: none at runtime; `@tauri-apps/cli` is the only dev dependency. The frontend has no build step.

## Backend (`src-tauri/src`)

| File | Role |
| --- | --- |
| `main.rs` | Starts the app: plugins, state, command list, a 32 MiB stack for rayon threads, a panic hook that writes the crash log and shows a message box |
| `commands.rs` | The IPC commands and their wire types `Tick`, `Part`, `Done` |
| `scan.rs` | The parallel walk into a tree of `Node`s |
| `tree.rs` | The flat arena and every query; the wire types `View`, `Hit`, `Found` |
| `drives.rs` | Drives for the home page |
| `win.rs` | The few Win32 calls beyond `std`, each with a plain stand-in on other systems so `cargo test` runs anywhere |

### Scanner (`scan.rs`)

`scan(path, &Progress) -> Node` calls `walk` for the root, which:

1. Lists the folder with `fs::read_dir`. If that fails (System Volume Information, another user's profile), the folder gets the `DENIED` flag, counts as empty and bumps `Progress::denied`.
2. Reads each entry's metadata from the listing itself. No file is opened, so OneDrive never downloads a placeholder.
3. Skips symbolic links and junctions (`FileType::is_symlink`, which on Windows covers both). They point at things counted elsewhere and can loop.
4. Marks an entry hidden when it has `FILE_ATTRIBUTE_HIDDEN` or `FILE_ATTRIBUTE_SYSTEM`, or its name starts with a dot.
5. Sizes files with `win::size_on_disk`: online-only cloud files (`RECALL_ON_DATA_ACCESS`, `RECALL_ON_OPEN` or `OFFLINE`) are 0; compressed, sparse and other reparse-point files (CompactOS, dedup) use `GetCompressedFileSizeW`; everything else uses its length, not rounded up to clusters.
6. Walks subfolders with `into_par_iter()`, so rayon's work stealing spreads folders over all cores.

Two folder names that differ only by case ("Windows" and "windows") open the same folder on an ordinary NTFS folder, so the second spelling is listed as an empty folder instead of being counted twice, unless `win::case_sensitive` says the folder tells case apart (WSL and developer folders can).

`Node::dir` sorts the children by size, largest first, and sums two totals: `size` (everything) and `shown` (without hidden items, recursively). With both stored, the "Show hidden and system items" setting is just the `all` flag on every query, and needs no rescan.

`Progress` is shared by all scan threads: atomic `files`, `bytes` and `denied` counters, a `cancel` flag checked for every folder and entry, the folder being read now (`current`, updated with `try_lock` so threads never wait for it), and a queue of finished top-level folders (`parts`) that the window draws as the ring fills in.

### Arena (`tree.rs`)

`Tree::new` flattens the `Node` tree depth-first into one `Vec<Entry>`:

```rust
struct Entry { name: Box<str>, size: u64, shown: u64, parent: u32, end: u32, flags: u8 }
```

The id of an entry is its index. The root is id 0, and its name is the full scanned path (`C:\`). Because the order is depth-first, **a folder's contents are exactly the ids `id + 1 .. end`**:

- the children of `id` start at `id + 1`, and each next child starts at the previous child's `end`;
- the whole subtree is one contiguous slice, so `inside()` (every visible entry below a folder, skipping hidden subtrees whole) is a linear scan with no pointers to chase;
- a path is rebuilt by following `parent` up to 0.

Ids stay valid until the next scan replaces the tree. The app keeps only the last finished scan.

The queries:

- **`view(id, depth, all)`** returns the folder and its children down to `depth` levels (the window asks for 3). The first level gets up to `LIST_MAX` = 500 children for the list; deeper levels keep only pieces of at least `MIN_SHARE` = 0.15% of the viewed folder, about the smallest slice the chart can draw. Left-out children are counted in `more` and summed in `moreS`. Children come largest first: the scan's order is reused, and only the sizes without hidden items are sorted again.
- **`largest(cur, all, 20)`** keeps the 20 biggest files inside `cur` in a min-heap of size 20 (`top_n`), one pass over the subtree.
- **`search(query, cur, all, 40)`** matches every visible name in the whole scan, not just under `cur`, as a case-insensitive substring. ASCII names are compared in place without allocating; other names are lowercased. It returns the total, the 40 biggest matches, and `lit`: for up to `LIT_MAX` = 20 000 matches under `cur`, the ids of their ancestors on the first three levels below `cur`, which are the chart pieces to light up.
- **`trail(id, all)`** returns the chain from the root down to `id` as childless views. The window uses it to jump to a search hit or a large file, and to refresh breadcrumbs.
- **`path(id)`** returns the full path.

### Commands (`commands.rs`)

Every command is `async`, so Tauri runs it off the main thread and the window never freezes; the scan itself runs in `spawn_blocking`. The state is `Scans { tree: RwLock<Option<Tree>>, progress: RwLock<Arc<Progress>> }`. Errors reach JavaScript as a rejected promise with a plain English string.

Argument names are what JavaScript passes. Tauri maps Rust's snake_case to camelCase, so `on_tick` becomes `onTick`. `all` is the "Show hidden and system items" setting; `cur` is the id of the open folder.

| Command | Arguments | Returns |
| --- | --- | --- |
| `material` | none | `"mica"` on Windows 11, where the window has the Mica backdrop, `"none"` elsewhere |
| `drives` | none | `Drive[]` |
| `scan` | `path: string`, `all: bool`, `onTick: Channel<Tick>` | `Done`. Rejects with `"cancelled"` after `cancel_scan` |
| `cancel_scan` | none | nothing; stops the running scan |
| `view` | `id: u32`, `depth: u8` (capped at 3), `all: bool` | `View` |
| `largest` | `cur: u32`, `all: bool` | `Hit[]`, the 20 biggest files inside `cur` |
| `search` | `query: string`, `cur: u32`, `all: bool` | `Found` |
| `trail` | `id: u32`, `all: bool` | `View[]` from the root to `id`, without `k` |
| `path` | `id: u32` | the full path as a string |
| `reveal` | `id: u32` | nothing; opens File Explorer with the item selected |

`scan` accepts a file too (a dropped file means its folder). It sends a `Tick` about every 120 ms through the per-scan channel, and a last one when the walk ends. `reveal` and `path` look the path up by id, so the window can never hand the shell a path of its own. `reveal` uses `SHOpenFolderAndSelectItems` on a short-lived COM thread and falls back to `explorer /select,"<path>"`.

The app's own commands need no entry in `capabilities/default.json`; only plugin and window APIs do.

### Wire format

The views use one-letter field names because a view of a drive holds a few thousand of them.

**`View`** (`view`, `trail`, `Done.root`)

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | u32 | entry id |
| `n` | string | name; for the root, the full scanned path |
| `s` | u64 | size in bytes (without hidden items unless `all`) |
| `d` | bool | is a folder |
| `h` | bool | has visible children, so it can be opened. Not "hidden" |
| `k` | View[] | children, largest first. **Left out** when this level wasn't expanded (depth reached, or too small to draw) |
| `more` | u32 | children left out of `k` |
| `moreS` | u64 | their total size |
| `denied` | bool | the folder could not be read. **Left out** when false |

A `view` of a small drive with `depth: 1` and `all: true` (the window asks for depth 3, which nests `k` two levels further). Ids jump because each folder's whole subtree comes right after it:

```json
{
  "id": 0, "n": "C:\\", "s": 228851707904, "d": true, "h": true, "more": 0, "moreS": 0,
  "k": [
    { "id": 1, "n": "Users", "s": 180214558720, "d": true, "h": true, "more": 0, "moreS": 0 },
    { "id": 1048211, "n": "Windows", "s": 31457280000, "d": true, "h": true, "more": 0, "moreS": 0 },
    { "id": 1391877, "n": "pagefile.sys", "s": 17179869184, "d": false, "h": false, "more": 0, "moreS": 0 },
    { "id": 1391878, "n": "System Volume Information", "s": 0, "d": true, "h": false, "more": 0, "moreS": 0, "denied": true }
  ]
}
```

**`Hit`** (`largest`, `Found.hits`)

| Field | Type | Meaning |
| --- | --- | --- |
| `id`, `n`, `s`, `d` | | as in `View` |
| `h` | bool | is a folder with visible children |
| `at` | string | where it lives: `"…\Users\Alex"` relative to `cur` for `largest` and to the scan root for `search`; `""` when it sits right there |
| `top` | i32 | which child of `cur` holds it, as an index into `cur`'s children in view order, so the row gets that slice's color; `-1` when it is outside `cur` |

**`Found`** (`search`): `total` (all matches), `hits` (`Hit[]`, the 40 biggest), `lit` (`u32[]`, chart pieces under `cur` that hold a match).

**`Drive`** (`drives`): `path` (`"C:\\"`), `letter` (`"C:"`), `label`, `total` and `free` in bytes, `removable`. Only fixed and removable drives are listed; an empty card reader is skipped.

**`Tick`** (scan channel): `files`, `bytes`, `path` (the folder being read), `parts` (`{ name, size }[]`, top-level folders finished since the last tick).

**`Done`** (`scan` result): `files`, `denied` (folders that could not be read), `secs`, `root` (a `View` of the root, depth 3).

## Frontend (`src`)

Plain HTML, CSS and ES modules. Tauri serves `src/` as is (`frontendDist`), and `withGlobalTauri` exposes `window.__TAURI__`. Every name from the disk goes through `esc()` before it reaches `innerHTML`.

- **`index.html`** holds the four pages (`home`, `scan`, `browse`, `settings`), the context menu, the drop overlay and the toast. The window has no system frame (`decorations: false`), so the title bar and its caption buttons are ours.
- **`backend.js`** is the bridge: `call(cmd, args)` invokes a Tauri command, or the preview backend when `window.__TAURI__` is missing, and `scan(path, all, onTick)` wraps the per-scan channel. Its JSDoc types are the wire format below.
- **`app.js`** runs the window:
  - `adopt(view, parent)` merges every `View` into a `Map` by id and links each node to its parent; breadcrumbs, labels and zoom animations walk those links. The map is cleared on each new scan.
  - Pages: drive tiles and "Choose a folder…" (or drop a folder anywhere); the scan page, whose ring grows from `Tick.parts` while the hand moves with `bytes` against the drive's used space; the browse page with the chart, the Contents and Largest files tabs, breadcrumbs and search; Settings. A short history drives the title bar's Back button.
  - The list has one tab stop; arrow keys, Home, End and Page Up/Down move inside it, and focus lights the chart like hover does.
  - Settings are validated when they are read back, and the theme is left to CSS (see below) except for telling Mica which tint to use.
- **`chart.js`** draws the chart. Chart forms live in the `FORMS` table. Ring and Half are the `burst` kind: a three-ring sunburst whose zoom morphs each piece's radii and angles from where it was to where it goes. Bubbles packs two levels of circles, Spiral lays the top level along a spiral, and Dots samples the sunburst as a grid of dots; these three zoom the whole picture in or out of the clicked piece. Each builder in `BUILD` returns SVG and fills `items`, which maps every drawn piece to its node, its top-level index (its color, `--c1` to `--c8`) and its depth, for hover, click, keyboard and search lighting.
  Bubbles packs at most 60 circles per level (packing is roughly cubic). `leaving()` and `arrive()` wrap a change of folder: where the clicked piece was, and the zoom from it.
- Settings are kept in `localStorage` under `dysky-opts` (theme, form, motion, hidden, units). Motion is off when Animations is off or the system asks for reduced motion.
- **`shapes.js`** is pure, with no DOM: `fmtSize` (decimal or binary units), `fmtCount`, `pct`, `esc`, `clip`, `sunburst(node, rings, span, minPx)` (pieces with angles, depth and top-level index; pieces narrower than `minPx` are left out) and `pack(nodes, R, cx, cy, pad)` (circle packing). Tested by `tests/shapes.test.js`.
- **`styles.css`**: the Windows 11 look. Every colour token is `light-dark(light, dark)` and `color-scheme` picks the side, so with no `data-theme` on `<html>` the window follows Windows without a flash, and Settings can pin either theme. The dropdowns are real `<select>`s styled with `appearance: base-select` (Chromium 135+); on Windows 11 the body is transparent so the Mica backdrop shows through (`.mica`).

### Preview backend (`dev/preview-backend.js`)

When the page runs in a plain browser, a preview backend answers the same commands with the same JSON shapes, computed from a built-in sample tree (a user "Alex", drives C:, D: and F:). It mirrors the algorithms in `tree.rs` (flattening, the view limits, `top`, `at`) and fakes a 1.5-second scan with progress ticks; `reveal` reports that it only works in the app. Screenshots for the README are taken from it, so they never show anyone's real folders.

Serve the project root and open `/src/index.html` (see [CONTRIBUTING.md](../CONTRIBUTING.md#preview-in-a-browser)).

## Adding a command

1. Add the query to `Tree` in `tree.rs`, with a unit test.
2. Add a `#[tauri::command] pub async fn` in `commands.rs` and list it in `generate_handler!` in `main.rs`.
3. Answer the same command in `dev/preview-backend.js`, with the same JSON shape.
4. Call it from `app.js` through `call()` in `backend.js`.
5. Document it in the tables above.

## Tests

- `cargo test --manifest-path src-tauri/Cargo.toml`: `tree.rs` checks sizes, sorting, hidden items, the 500-item and 0.15% limits, largest files, search and lighting, paths and trails on a small sample tree; `scan.rs` scans a real temporary folder and checks cancelling, unreadable folders and cloud-only sizes.
- `node --test`: `tests/shapes.test.js` checks size formatting, escaping, the sunburst layout and circle packing (and that packing the most bubbles stays quick); `tests/preview-backend.test.js` checks that the preview backend answers like `tree.rs`.

`npm test` runs both. CI also runs `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings` and a release build without the installer.
