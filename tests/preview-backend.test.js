// The preview backend (dev/preview-backend.js) stands in for Rust in a plain browser, so it must answer the
// way src-tauri/src/tree.rs does. These checks mirror the Rust tests on the sample drive.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scan, invoke } from '../dev/preview-backend.js';

const C = 'C:' + String.fromCharCode(92);
const done = await scan(C, true, () => {});

test('a scan reports files, unreadable folders and the root view', () => {
  assert.ok(done.files > 0);
  assert.equal(done.denied, 1);
  const sizes = done.root.k.map(k => k.s);
  assert.deepEqual(sizes, [...sizes].sort((a, b) => b - a), 'children come largest first');
  assert.equal(done.root.k.find(k => k.n === 'System Volume Information').denied, true);
});

test('hidden items drop out with their size', async () => {
  const all = await invoke('view', { id: 0, depth: 1, all: true });
  const shown = await invoke('view', { id: 0, depth: 1, all: false });
  assert.ok(shown.s < all.s);
  assert.ok(!shown.k.some(k => k.n === 'pagefile.sys'));
});

test('search finds names anywhere and lights the way under the open folder', async () => {
  const found = await invoke('search', { query: 'ISO', cur: 0, all: true });
  assert.ok(found.total >= 2);
  assert.ok(found.hits.every(h => h.n.toLowerCase().includes('iso')));
  assert.ok(found.lit.length > 0);
  const users = done.root.k.find(k => k.n === 'Users').id;
  const top = found.hits.find(h => h.at.includes('Downloads')).top;
  assert.equal(done.root.k[top].id, users, 'the hit sits under Users');
});

test('largest files are files, biggest first, with where they are', async () => {
  const hits = await invoke('largest', { cur: 0, all: true });
  assert.ok(hits.length > 0 && hits.every(h => !h.d));
  assert.ok(hits.every((h, i) => !i || hits[i - 1].s >= h.s));
  assert.ok(hits.every(h => typeof h.at === 'string'));
});

test('trails and paths lead back to the root', async () => {
  const hit = (await invoke('search', { query: 'beach-sunset', cur: 0, all: true })).hits[0];
  const trail = await invoke('trail', { id: hit.id, all: true });
  assert.equal(trail[0].n, C);
  assert.equal(trail.at(-1).id, hit.id);
  assert.ok((await invoke('path', { id: hit.id })).endsWith('beach-sunset-4k.mov'));
});
