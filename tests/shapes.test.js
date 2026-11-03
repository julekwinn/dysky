import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TAU, fmtSize, fmtCount, clip, esc, pct, sunburst, pack } from '../src/shapes.js';

test('sizes read like Windows shows them', () => {
  assert.equal(fmtSize(0), '0 B');
  assert.equal(fmtSize(999), '999 B');
  assert.equal(fmtSize(41.5e9), '41.5 GB');
  assert.equal(fmtSize(210e9), '210 GB');
  assert.equal(fmtSize(1e12), '1.0 TB');
  assert.equal(fmtSize(999.7e6), '1.0 GB');
  assert.equal(fmtSize(210e9, true), '196 GiB');
  assert.equal(fmtSize(1024, true), '1.0 KiB');
});

test('odd sizes never break the text', () => {
  assert.equal(fmtSize(-5), '0 B');
  assert.equal(fmtSize(undefined), '0 B');
  assert.equal(fmtSize(NaN), '0 B');
  assert.equal(fmtSize(5e18), '5000 PB');
});

test('names are escaped before they go into the page', () => {
  assert.equal(esc('<img src=x onerror="a">&'), '&lt;img src=x onerror=&quot;a&quot;&gt;&amp;');
  assert.equal(esc(42), '42');
});

test('shares read as percent', () => {
  assert.equal(pct(.5), '50%');
  assert.equal(pct(.034), '3.4%');
});

test('counts and clipping', () => {
  assert.equal(fmtCount(486213), '486 213');
  assert.equal(clip('Documents', 20), 'Documents');
  assert.equal(clip('Documents', 5), 'Docu…');
});

test('sunburst pieces fill the circle and nest inside their parent', () => {
  const tree = { s: 100, c: [
    { s: 60, c: [{ s: 40 }, { s: 20 }] },
    { s: 40 },
  ] };
  const rings = [[76, 124], [126, 162], [164, 194]];
  const segs = sunburst(tree, rings, TAU, 1);
  const top = segs.filter(s => s.depth === 0);
  assert.equal(top.length, 2);
  assert.ok(Math.abs(top[0].a1 - TAU * .6) < 1e-9);
  const inner = segs.filter(s => s.depth === 1);
  assert.equal(inner.length, 2);
  assert.ok(inner.every(s => s.a0 >= top[0].a0 && s.a1 <= top[0].a1 + 1e-9 && s.top === 0));
});

test('sunburst leaves out pieces too thin to see', () => {
  const tree = { s: 1e6, c: [{ s: 1e6 - 1 }, { s: 1 }] };
  assert.equal(sunburst(tree, [[76, 124]], TAU, 2).length, 1);
});

test('packed circles stay inside and never overlap', () => {
  const nodes = [50, 30, 20, 12, 8, 5, 3, 2, 1].map(s => ({ s }));
  const R = 190, out = pack(nodes, R, 200, 200, 4);
  assert.equal(out.length, nodes.length);
  for (const a of out) assert.ok(Math.hypot(a.x - 200, a.y - 200) + a.r <= R + 1e-6);
  for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) {
    const a = out[i], b = out[j];
    assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= a.r + b.r - 1e-6, `circles ${i} and ${j} overlap`);
  }
  assert.ok(out[0].r > out[1].r, 'bigger folders get bigger circles');
});

test('packing the most bubbles the chart draws stays quick', () => {
  // chart.js packs at most 60 children per level; packing is roughly cubic, so this guards the limit
  const nodes = Array.from({ length: 60 }, (_, i) => ({ s: 1000 - i }));
  const t0 = performance.now();
  pack(nodes, 190, 200, 200, 4);
  assert.ok(performance.now() - t0 < 1000, 'packing 60 near-equal circles took over a second');
});
