# Changelog

All notable changes to Dysky are listed here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and Dysky uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-11-03

First release.

### Added

- Home page with your drives (size, free space, usage ring) and "Choose a folder…"; a folder can also be dropped onto the window.
- Parallel scanner in Rust: 1.6 million files on C: in about 30 seconds on a laptop. The ring fills in live as top-level folders finish, and the scan can be cancelled.
- Sizes as files sit on the disk: OneDrive online-only files count as 0 bytes, compressed and sparse files count what they actually take.
- Folders that can't be read without admin rights are counted and reported after the scan.
- Interactive chart with the folder list beside it: click a slice to zoom in, hover a folder to light it up in both, breadcrumbs, Up and Backspace to go back.
- Five chart shapes: Ring, Half, Bubbles, Spiral and Dots.
- Search by name (just start typing); the chart lights up where the matches are.
- "Largest files" tab for the current folder.
- Right-click menu: Open, Copy path, Show in File Explorer.
- Settings: light, dark or system theme; chart shape; animations; show or hide hidden and system items; decimal (GB) or binary (GiB) units.
- Windows 11 look: the Mica backdrop, WinUI-style dropdowns, toggle switches and menus, Fluent overlay scrollbars, Segoe Fluent Icons, a title bar that fades when the window is inactive, and high contrast support.
- The window remembers its size and position.
- Keyboard and screen reader support: one tab stop for the list with arrow keys, labelled switches, a progress bar for the scan, the menu returns focus where it came from.
- A crash leaves a message and a log in `%LOCALAPPDATA%\com.youlius.dysky\crash.log` instead of a window that just disappears.
- Read-only by design: Dysky never changes or deletes anything and makes no network requests.
- Per-user NSIS installer (about 1.4 MB, no admin needed).

[Unreleased]: https://github.com/julekwinn/dysky/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/julekwinn/dysky/releases/tag/v0.1.0
