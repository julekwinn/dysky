// The chart: five shapes of the same folder, drawn as SVG into #ring, and the motion between folders.
// Ring and Half share the sunburst drawing and its morphing zoom; the other shapes zoom the whole
// picture in and out of the piece that was clicked. Layout maths lives in shapes.js.
import { TAU, esc, clip, pct, fmtCount, sunburst, pack } from './shapes.js';

export const FORMS = {
  ring: { name: 'Ring', kind: 'burst', cx: 200, cy: 200, from: 0, span: TAU, rings: [[76, 124], [126, 162], [164, 194]], hub: 74, text: 200 },
  half: { name: 'Half', kind: 'burst', cx: 200, cy: 262, from: -Math.PI / 2, span: Math.PI, rings: [[84, 130], [133, 164], [167, 192]], hub: 80, text: 318 },
  bubbles: { name: 'Bubbles', kind: 'bubbles' },
  spiral: { name: 'Spiral', kind: 'spiral', text: 200 },
  dots: { name: 'Dots', kind: 'dots', text: 200 },
};
const CENTRE = { cx: 200, cy: 200, from: 0 };
const GAP = 1;              // px of air between neighbouring pieces
const BUBBLES_MAX = 60;     // circle packing is slow past this many, and the rest would be specks anyway

const svg = document.getElementById('ring'), card = document.getElementById('chart');
let ctx;                    // { fmt, label, still } from the app
let form = FORMS.ring, geo = CENTRE, rings = FORMS.ring.rings, hubR = 74, span = TAU;
let items = [], cur = null, raf = 0;

/** What the chart needs from the app: size formatting, folder names, and whether motion is off. */
export function init(app) { ctx = app; }

export const shape = () => form;
/** The pieces on screen: { node, top, depth, el } with `top` the index of the open folder's child they belong to. */
export const pieces = () => items;

export function useForm(key) {
  form = FORMS[key];
  geo = form.kind === 'burst' ? form : CENTRE;
  rings = form.rings || FORMS.ring.rings;
  hubR = form.hub || 74;
  span = form.span || TAU;
}

// ---------- colours and geometry ----------
const colorOf = top => top >= 0 && top < 8 ? `var(--c${top + 1})` : 'var(--faint)';
const mix = (top, p) => `color-mix(in srgb, ${colorOf(top)} ${p}%, var(--win))`;
const tint = (top, depth) => depth ? `color-mix(in srgb, ${colorOf(top)} var(--t${depth}), var(--win))` : colorOf(top);
export { colorOf };
const pt = (r, a, g = geo) => `${(g.cx + r * Math.sin(a + g.from)).toFixed(2)} ${(g.cy - r * Math.cos(a + g.from)).toFixed(2)}`;

/** Annular sector, angle 0 at the top, clockwise; the gap leaves an even line of air between pieces. */
export function sector(r0, r1, a0, a1, g = geo) {
  if (a1 - a0 > TAU - 1e-4) a1 = a0 + TAU - 1e-4;
  const m = (a0 + a1) / 2;
  r0 += GAP; r1 = Math.max(r0, r1 - GAP);
  const o0 = Math.min(a0 + GAP / r1, m), o1 = Math.max(a1 - GAP / r1, m);
  const i0 = Math.min(a0 + GAP / r0, m), i1 = Math.max(a1 - GAP / r0, m);
  return `M${pt(r1, o0, g)}A${r1} ${r1} 0 ${o1 - o0 > Math.PI ? 1 : 0} 1 ${pt(r1, o1, g)}L${pt(r0, i1, g)}A${r0} ${r0} 0 ${i1 - i0 > Math.PI ? 1 : 0} 0 ${pt(r0, i0, g)}Z`;
}
/** A sector on the plain centred ring, for the scan page. */
export const centred = (r0, r1, a0, a1) => sector(r0, r1, a0, a1, CENTRE);

// ---------- the five shapes: each fills `items` in the same order as the .it elements it returns ----------
const bubble = (b, fill, extra, k) => `<circle class="it" data-k="${k}" cx="${b.x.toFixed(1)}" cy="${b.y.toFixed(1)}" r="${b.r.toFixed(1)}" style="fill:${fill};${extra}"/>`;
const BUILD = {
  burst() {
    items = sunburst(cur, rings, span, 1.2 + GAP * 1.4);
    return items.map((s, k) => `<path class="it" data-k="${k}" style="fill:${tint(s.top, s.depth)}"/>`).join('');
  },
  bubbles() {
    let out = '', labels = '';
    pack(cur.c.filter(n => n.s > 0).slice(0, BUBBLES_MAX), 190, 200, 200, 4).forEach((b, top) => {
      if (b.r < 1.5) return;
      const kids = (b.node.c || []).filter(n => n.s > 0).slice(0, BUBBLES_MAX);
      const inner = kids.length && b.r > 16 ? pack(kids, b.r - 5, b.x, b.y, 2).filter(g => g.r >= 1.2) : [];
      out += bubble(b, inner.length ? mix(top, 14) : mix(top, 72), `stroke:${colorOf(top)};--d:${top * 45}ms`, items.push({ node: b.node, top, depth: 0 }) - 1);
      inner.forEach((g, j) => { out += bubble(g, mix(top, 58), `stroke:none;--d:${top * 45 + 160 + j * 25}ms`, items.push({ node: g.node, top, depth: 1 }) - 1); });
      // Labels sit on a small card so they stay crisp over the inner bubbles.
      if (b.r > 30) labels += `<g class="blab" data-t="${top}"><rect/>
        <text class="bn" x="${b.x.toFixed(1)}" y="${(b.y - 3).toFixed(1)}">${esc(clip(b.node.n, Math.floor((1.7 * b.r - 16) / 6.8)))}</text>
        <text class="bs num" x="${b.x.toFixed(1)}" y="${(b.y + 12).toFixed(1)}">${ctx.fmt(b.node.s)}</text></g>`;
    });
    return out + labels;
  },
  spiral() {
    const R0 = 180, R1 = 100, turns = 2.2, w = (R0 - R1) / turns * .72, rad = u => R0 - (R0 - R1) * u;
    hubR = R1 - w / 2 - 6;
    const line = (u0, u1) => {
      const n = Math.max(2, Math.ceil((u1 - u0) * turns * TAU * rad((u0 + u1) / 2) / 4));
      let s = '';
      for (let j = 0; j <= n; j++) { const u = u0 + (u1 - u0) * j / n; s += pt(rad(u), u * turns * TAU) + ' '; }
      return s;
    };
    let u = 0, out = `<polyline class="sp-bg" points="${line(0, 1)}" style="stroke-width:${w.toFixed(1)}px"/>`;
    cur.c.forEach((ch, i) => {
      const share = cur.s ? ch.s / cur.s : 0, rm = rad(u + share / 2), gap = 2 / (turns * TAU * rm), len = share * turns * TAU * rm;
      if (len > 5) {
        const k = items.push({ node: ch, top: i, depth: 0 }) - 1;
        out += `<polyline class="it" data-k="${k}" points="${line(u + gap, u + share - gap)}" style="stroke:${colorOf(i)};stroke-width:${w.toFixed(1)}px;--len:${len.toFixed(1)};--u:${u.toFixed(3)}"/>`;
      }
      u += share;
    });
    return out;
  },
  dots() {
    const segs = sunburst(cur, rings, TAU, 0), groups = new Map();
    hubR = 88;
    [[104, 7], [142, 6.2], [178, 5.4]].forEach(([r, d], depth) => {
      const ring = segs.filter(s => s.depth === depth), n = Math.floor(TAU * r / (2 * d + 4.5));
      let j = 0;
      for (let k = 0; k < n; k++) {
        const a = (k + .5) / n * TAU;
        while (j < ring.length && ring[j].a1 < a) j++;
        const s = ring[j];
        if (!s || s.a0 > a) continue;
        const [x, y] = pt(r, a).split(' ');
        groups.set(s, (groups.get(s) || '') + `<circle cx="${x}" cy="${y}" r="${d}" style="--d:${Math.round(a / TAU * 500 + depth * 140)}"/>`);
      }
    });
    return [...groups].map(([s, dots]) => `<g class="it" data-k="${items.push(s) - 1}" style="fill:${tint(s.top, s.depth)}">${dots}</g>`).join('');
  },
};

function fitLabels() {
  svg.querySelectorAll('.blab').forEach(g => {
    const bs = [...g.querySelectorAll('text')].map(t => t.getBBox());
    const x0 = Math.min(...bs.map(b => b.x)) - 8, x1 = Math.max(...bs.map(b => b.x + b.width)) + 8;
    const y0 = Math.min(...bs.map(b => b.y)) - 4, y1 = Math.max(...bs.map(b => b.y + b.height)) + 4;
    const r = g.querySelector('rect');
    r.setAttribute('x', x0.toFixed(1)); r.setAttribute('y', y0.toFixed(1));
    r.setAttribute('width', (x1 - x0).toFixed(1)); r.setAttribute('height', (y1 - y0).toFixed(1));
  });
}

/** Draws `node`'s chart; `root` decides whether the middle leads one level up. */
export function draw(node, root) {
  cancelAnimationFrame(raf);
  cur = node;
  items = [];
  hubR = form.hub || 74;
  const kind = form.kind, body = BUILD[kind](), up = cur !== root ? ' up' : '', title = up ? '<title>Up one level</title>' : '';
  svg.setAttribute('class', `ring form-${kind}`);
  svg.style.setProperty('--ox', geo.cx + 'px');
  svg.style.setProperty('--oy', geo.cy + 'px');
  card.classList.toggle('bubbles', kind === 'bubbles');
  const hubEl = kind === 'bubbles' ? `<circle class="hub${up}" cx="200" cy="200" r="196">${title}</circle>`
    : form === FORMS.half ? `<path class="hub${up}" d="M${geo.cx - hubR} ${geo.cy}A${hubR} ${hubR} 0 0 1 ${geo.cx + hubR} ${geo.cy}Z">${title}</path>`
    : `<circle class="hub${up}" cx="200" cy="200" r="${hubR.toFixed(1)}">${title}</circle>`;
  const y = form.text;
  svg.innerHTML = `${hubEl}<g class="stage">${body}</g>` + (y ? `<text class="h-name" x="200" y="${y - 18}" id="hName"></text>
    <text class="h-size num" x="200" y="${y + 14}" id="hSize"></text><text class="h-sub" x="200" y="${y + 36}" id="hSub"></text>` : '');
  const els = svg.querySelectorAll('.stage .it');
  items.forEach((s, k) => { s.el = els[k]; });
  if (kind === 'burst') items.forEach(s => place(s, goal(s)));
  if (kind === 'bubbles') fitLabels();
}

// ---------- motion ----------
const lerp = (a, b, k) => a + (b - a) * k;
const easeOut = k => 1 - (1 - k) ** 3;
const easeInOut = k => k < .5 ? 4 * k ** 3 : 1 - (-2 * k + 2) ** 3 / 2;

// Sunburst motion: each piece moves from start(piece) = [r0, r1, a0, a1, opacity, delay] to its place.
const ringAt = i => i < 0 ? [hubR, hubR] : i > 2 ? [rings[2][1] + 2, rings[2][1] + 10] : rings[i];
const goal = s => [...rings[s.depth], s.a0, s.a1, 1];
function place(s, [r0, r1, a0, a1, o], moving) {
  s.el.setAttribute('d', sector(r0, r1, a0, a1));
  s.el.style.opacity = moving ? Math.max(0, Math.min(o, (a1 - a0) * r1 / 2)) : '';
}
function play(start, dur, ease) {
  cancelAnimationFrame(raf);
  if (ctx.still()) return;
  const list = items, from = list.map(start), to = list.map(goal), t0 = performance.now();
  (function step(t) {
    const k = Math.min(1, (t - t0) / dur);
    list.forEach((s, i) => {
      const f = from[i], d = f[5] || 0, e = ease(Math.min(1, Math.max(0, (k - d) / (1 - d))));
      place(s, to[i].map((v, j) => lerp(f[j], v, e)), k < 1);
    });
    if (k < 1) raf = requestAnimationFrame(step);
  })(t0);
}
const bloom = s => { const o = span < TAU ? 0 : -.6; return [hubR, hubR, s.a0 + o, s.a1 + o, 0, s.depth * .14]; };
const zoomIn = from => s => {        // the clicked piece opens up into the whole ring
  const i = s.depth + from.depth + 1, k = (from.a1 - from.a0) / span;
  return [...ringAt(i), from.a0 + s.a0 * k, from.a0 + s.a1 * k, i > 2 ? 0 : 1];
};
const zoomOut = into => s => {       // the old ring folds back into its piece
  const i = s.depth - into.depth - 1, k = span / (into.a1 - into.a0), m = a => Math.max(0, Math.min(span, (a - into.a0) * k));
  return [...ringAt(i), m(s.a0), m(s.a1), i < 0 ? 0 : 1];
};

// Other shapes: the whole picture grows out of the clicked piece, or shrinks back into it.
function box(el) {
  const r = el.getBoundingClientRect(), s = svg.getBoundingClientRect(), k = 400 / s.width;
  return { x: (r.left - s.left) * k, y: (r.top - s.top) * k, w: r.width * k, h: r.height * k };
}
function zoomStage(b, inward) {
  if (ctx.still()) return;
  let from = 'translate(20px, 20px) scale(.9)', o = 0;
  if (b) {
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2, size = Math.max(b.w, b.h, 8);
    const k = inward ? Math.min(1, size / 380) : Math.min(6, 380 / size);
    from = inward ? `translate(${cx - k * 200}px, ${cy - k * 200}px) scale(${k})` : `translate(${200 - k * cx}px, ${200 - k * cy}px) scale(${k})`;
    o = inward ? .4 : 0;
  }
  svg.querySelector('.stage').animate([{ transform: from, opacity: o }, { transform: 'none', opacity: 1 }], { duration: 520, easing: 'cubic-bezier(.65, 0, .35, 1)' });
}
let introT;
/** The chart grows in, as it does after a scan or a change of shape. */
export function intro() {
  if (form.kind === 'burst') return play(bloom, 780, easeOut);
  svg.classList.add('intro');
  clearTimeout(introT);
  introT = setTimeout(() => svg.classList.remove('intro'), 1700);
}

const within = (n, anc) => { for (let x = n.parent; x; x = x.parent) if (x === anc) return true; return false; };
const nearest = (list, n, stop) => { for (let x = n; x && x !== stop; x = x.parent) { const s = list.find(o => o.node === x); if (s) return s; } return null; };
/** Before the chart changes from `prev` to `next`: where on the old chart the next folder is. */
export function leaving(prev, next) {
  const from = prev && within(next, prev) ? nearest(items, next, prev) : null;
  return { prev, from, box: from && form.kind !== 'burst' ? box(from.el) : null };
}
/** After draw(): zoom into the piece we came from, fold back into the parent's piece, or just grow in. */
export function arrive({ prev, from, box: fromBox }, node) {
  if (!prev) return intro();
  const into = within(prev, node) ? nearest(items, prev, node) : null;
  if (form.kind === 'burst') {
    if (from) return play(zoomIn(from), 540, easeInOut);
    if (into) return play(zoomOut(into), 540, easeInOut);
    return play(bloom, 780, easeOut);
  }
  if (fromBox) return zoomStage(fromBox, true);
  zoomStage(into ? box(into.el) : null, false);
}

// ---------- the readout in the middle and the highlight ----------
// The readout sits in the middle of the shape, or under it for Bubbles.
const readout = () => (form.kind === 'bubbles' ? ['cName', 'cSize', 'cSub'] : ['hName', 'hSize', 'hSub']).map(id => document.getElementById(id));
let hubVal = 0, hubRaf = 0;
/** Shows `n` in the middle: its share of `base` when given, else the matches of `found` or its item count. */
export function readOut(n, base, found) {
  const [name, size, sub] = readout();
  name.textContent = clip(ctx.label(n), form.kind === 'bubbles' ? 40 : 20);
  sub.textContent = base ? `${pct(base.s ? n.s / base.s : 0)} of ${clip(ctx.label(base), 14)}`
    : found ? `${fmtCount(found.total)} match${found.total === 1 ? '' : 'es'}` : n.h ? `${fmtCount(n.c ? n.c.length + (n.more || 0) : 0)} items` : '';
  cancelAnimationFrame(hubRaf);
  const from = hubVal, t0 = performance.now();
  (function step(t) {
    const k = ctx.still() ? 1 : Math.min(1, (t - t0) / 280);
    hubVal = lerp(from, n.s, easeOut(k));
    size.textContent = ctx.fmt(hubVal);
    if (k < 1) hubRaf = requestAnimationFrame(step);
  })(t0);
}
/** While pointing at the middle of a subfolder's chart: where a click would go. */
export function readUp(parentLabel) { readout()[2].textContent = '↑ back to ' + clip(parentLabel, 16); }

/** Lights the pieces of the open folder's child number `top` (null: all of them), and lifts `node`'s own piece. */
export function highlight(top, node) {
  svg.classList.toggle('focus', top != null);
  for (const s of items) { s.el.classList.toggle('on', top != null && s.top === top); s.el.classList.toggle('lift', !!node && s.node.id === node.id); }
  svg.querySelectorAll('.blab').forEach(l => l.classList.toggle('on', top != null && +l.dataset.t === top));
}
/** Lights the pieces that hold a search match. */
export function light(lit) {
  svg.classList.add('focus');
  for (const s of items) { s.el.classList.toggle('on', lit.has(s.node.id)); s.el.classList.remove('lift'); }
  svg.querySelectorAll('.blab').forEach(l => l.classList.toggle('on', lit.has(cur.c[l.dataset.t].id)));
}
/** Lifts one piece for a moment, to show where an item that was jumped to lives. */
export function pulse(node) {
  const s = items.find(x => x.node.id === node.id);
  if (s) { s.el.classList.add('lift'); setTimeout(() => s.el.classList.remove('lift'), 1400); }
}

// ---------- the small pictures of each shape in Settings ----------
const SAMPLE = [.34, .22, .16, .12, .09, .07];
export function thumbnail(kind) {
  const P = (cx, cy, r, a) => [cx + r * Math.sin(a), cy - r * Math.cos(a)];
  const xy = p => p.map(v => v.toFixed(1)).join(' ');
  const sec = (cx, cy, r0, r1, a0, a1) => {
    a0 += .03; a1 -= .03;
    const L = a1 - a0 > Math.PI ? 1 : 0;
    return `M${xy(P(cx, cy, r1, a0))}A${r1} ${r1} 0 ${L} 1 ${xy(P(cx, cy, r1, a1))}L${xy(P(cx, cy, r0, a1))}A${r0} ${r0} 0 ${L} 0 ${xy(P(cx, cy, r0, a0))}Z`;
  };
  const c = i => `var(--c${i + 1})`, m = i => `color-mix(in srgb, var(--c${i + 1}) 50%, var(--win))`;
  let s = '';
  const burst = (cx, cy, from, sweep, R) => {
    let a = from;
    SAMPLE.forEach((v, i) => { const w = v * sweep; s += `<path d="${sec(cx, cy, R[0], R[1], a, a + w)}" fill="${c(i)}"/><path d="${sec(cx, cy, R[1] + 1.5, R[2], a, a + w * .6)}" fill="${m(i)}"/>`; a += w; });
  };
  if (kind === 'ring') burst(30, 30, 0, TAU, [12, 20, 28]);
  if (kind === 'half') burst(30, 44, -Math.PI / 2, Math.PI, [11, 19, 27]);
  if (kind === 'bubbles') [[22, 26, 14, 0], [42, 20, 9, 1], [41, 39, 8, 2], [24, 46, 6, 3], [52, 32, 4, 4]]
    .forEach(([x, y, r, i]) => { s += `<circle cx="${x}" cy="${y}" r="${r}" fill="${m(i)}" stroke="${c(i)}" stroke-width="1.2"/>`; });
  if (kind === 'spiral') {
    let u = 0;
    SAMPLE.forEach((v, i) => {
      let pts = '';
      for (let t = u + .01; t <= u + v - .01; t += .005) pts += xy(P(30, 30, 27 - 16 * t, t * 2.2 * TAU)) + ' ';
      s += `<polyline points="${pts}" fill="none" stroke="${c(i)}" stroke-width="4.5"/>`;
      u += v;
    });
  }
  if (kind === 'dots') [[14, 18, 2.2], [22, 26, 2.2]].forEach(([r, n, d], lvl) => {
    let acc = 0, j = 0;
    for (let q = 0; q < n; q++) {
      const f = (q + .5) / n;
      while (j < SAMPLE.length - 1 && f > acc + SAMPLE[j]) acc += SAMPLE[j++];
      const [x, y] = P(30, 30, r, f * TAU);
      s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${d}" fill="${lvl ? m(j) : c(j)}"/>`;
    }
  });
  return `<svg viewBox="0 0 60 60" aria-hidden="true">${s}</svg>`;
}
