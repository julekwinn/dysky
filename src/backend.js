// The bridge to the Rust side (src-tauri/src/commands.rs). In a plain browser, where there is no Rust, the
// preview backend in ../dev answers the same commands with sample data, so the window can be tried anywhere.
//
// What the commands return. Field names are short because one view of a drive holds thousands of them:
/**
 * @typedef {{ path: string, letter: string, label: string, total: number, free: number, removable: boolean }} Drive
 * @typedef {object} View  A folder or file, with its biggest children when that level was asked for.
 * @property {number} id
 * @property {string} n      name
 * @property {number} s      size on disk, in bytes
 * @property {boolean} d     is a folder
 * @property {boolean} h     has children (a folder that can be opened)
 * @property {View[]} [k]    children, largest first
 * @property {number} more   children left out of k (past the first 500, or too small to draw)
 * @property {number} moreS  their total size
 * @property {boolean} [denied]  the folder could not be read
 * @typedef {{ id: number, n: string, s: number, d: boolean, h: boolean, at: string, top: number }} Hit
 *   A search result or a large file: `at` is where it is ("…\Users\Alex"), `top` which child of the open folder holds it.
 * @typedef {{ total: number, hits: Hit[], lit: number[] }} Found  `lit`: chart pieces that hold a match.
 * @typedef {{ files: number, bytes: number, path: string, parts: { name: string, size: number }[] }} Tick
 * @typedef {{ files: number, denied: number, secs: number, root: View }} Done
 */
const T = window.__TAURI__;
const preview = T ? null : await import('../dev/preview-backend.js');

/** True in the app, false in the browser preview. */
export const native = !!T;

/** The error a cancelled scan ends with. */
export const CANCELLED = 'cancelled';

export const call = (cmd, args) => T ? T.core.invoke(cmd, args) : preview.invoke(cmd, args);

/**
 * Scans a drive or folder. `onTick` hears how far along it is a few times a second.
 * @returns {Promise<Done>} or fails with CANCELLED when cancel_scan stops it
 */
export function scan(path, all, onTick) {
  if (!T) return preview.scan(path, all, onTick);
  const channel = new T.core.Channel();
  channel.onmessage = onTick;
  return T.core.invoke('scan', { path, all, onTick: channel });
}
