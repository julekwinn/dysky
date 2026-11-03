// Pure helpers for sizes and chart layout. No DOM here, so `node --test` can check them.

export const TAU = 2 * Math.PI;

/** Bytes as text: decimal (GB) like drive boxes say, or binary (GiB) like File Explorer counts. */
export function fmtSize(bytes, binary = false) {
  const base = binary ? 1024 : 1000;
  const units = binary ? ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'] : ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let v = Math.max(0, bytes || 0), i = 0;
  while (v >= base && i < units.length - 1) { v /= base; i++; }
  if (i && Math.round(v) >= base && i < units.length - 1) { v /= base; i++; }
  return i === 0 ? `${Math.round(v)} B` : `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export const fmtCount = n => Math.round(n).toLocaleString('en').replace(/,/g, ' ');
export const pct = r => (r * 100).toFixed(r < .1 ? 1 : 0) + '%';
export const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
export const clip = (s, n) => s.length > n ? s.slice(0, Math.max(1, n - 1)) + '…' : s;

/**
 * Sunburst layout: up to three rings below `node` (whose children are in `c`, sizes in `s`).
 * Pieces narrower than `minPx` on the outer edge of their ring are left out.
 */
export function sunburst(node, rings, span, minPx) {
  const out = [];
  (function build(n, depth, a0, a1, top) {
    let a = a0;
    (n.c || []).forEach((ch, i) => {
      const w = n.s ? (a1 - a0) * ch.s / n.s : 0, t = depth ? top : i;
      if (w * rings[depth][1] > minPx) {
        out.push({ node: ch, depth, a0: a, a1: a + w, top: t });
        if (ch.c && ch.c.length && depth < rings.length - 1) build(ch, depth + 1, a, a + w, t);
      }
      a += w;
    });
  })(node, 0, 0, span);
  return out;
}

/** Circle packing: each circle goes where it touches two others, as close to the middle as it can. */
export function pack(nodes, R, cx, cy, pad) {
  const P = [];
  for (const n of nodes) {
    const r = Math.sqrt(n.s);
    let best = null;
    if (!P.length) best = { x: 0, y: 0 };
    else if (P.length === 1) best = { x: P[0].r + r, y: 0 };
    else for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++)
      for (const c of touching(P[i], P[j], r))
        if ((!best || c.d < best.d) && P.every(q => Math.hypot(c.x - q.x, c.y - q.y) >= q.r + r - 1e-9)) best = c;
    if (!best) best = { x: P.reduce((m, q) => Math.max(m, q.x + q.r), 0) + r, y: 0 };
    P.push({ node: n, x: best.x, y: best.y, r });
  }
  if (!P.length) return P;
  const x0 = Math.min(...P.map(p => p.x - p.r)), x1 = Math.max(...P.map(p => p.x + p.r));
  const y0 = Math.min(...P.map(p => p.y - p.r)), y1 = Math.max(...P.map(p => p.y + p.r));
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  const E = Math.max(...P.map(p => Math.hypot(p.x - mx, p.y - my) + p.r)), k = R / (E || 1);
  return P.map(p => ({ node: p.node, x: cx + (p.x - mx) * k, y: cy + (p.y - my) * k, r: Math.max(0, p.r * k - pad / 2) }));
}

function touching(a, b, r) {
  const da = a.r + r, db = b.r + r, dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
  if (!d || d > da + db || d < Math.abs(da - db)) return [];
  const l = (da * da - db * db + d * d) / (2 * d), h = Math.sqrt(Math.max(0, da * da - l * l));
  const mx = a.x + dx * l / d, my = a.y + dy * l / d;
  return [[mx + h * dy / d, my - h * dx / d], [mx - h * dy / d, my + h * dx / d]].map(([x, y]) => ({ x, y, d: Math.hypot(x, y) }));
}
