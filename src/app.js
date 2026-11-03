// Dysky's window: the pages (home, scan, browse, settings), the list beside the chart, the right-click menu,
// the keyboard and the settings. The chart is drawn by chart.js; the Rust side is reached through backend.js.
import { TAU, fmtSize, fmtCount, esc } from './shapes.js';
import { call, scan as runScan, native, CANCELLED } from './backend.js';
import * as chart from './chart.js';

const T = window.__TAURI__;
const $ = id => document.getElementById(id);

// ---------- settings, remembered between runs ----------
const CHOICES = { theme: ['system', 'light', 'dark'], form: Object.keys(chart.FORMS), units: ['dec', 'bin'] };
const opts = { theme: 'system', form: 'ring', motion: true, hidden: true, units: 'dec' };
try {
  const saved = JSON.parse(localStorage.getItem('dysky-opts') || '{}');
  for (const k in opts) {
    const ok = CHOICES[k] ? CHOICES[k].includes(saved[k]) : typeof saved[k] === typeof opts[k];
    if (ok) opts[k] = saved[k];
  }
} catch { /* first run, or nothing readable: the defaults stand */ }
const saveOpts = () => { try { localStorage.setItem('dysky-opts', JSON.stringify(opts)); } catch { /* still works, just not remembered */ } };

const fmt = b => fmtSize(b, opts.units === 'bin');
const calm = matchMedia('(prefers-reduced-motion: reduce)');
const still = () => calm.matches || !opts.motion;
const GLYPH = { dir: '&#xE8B7;', file: '&#xE8A5;', lock: '&#xE72E;', more: '&#xE712;', check: '&#xE73E;', info: '&#xE946;', add: '&#xE710;' };
const icon = glyph => `<i class="g" aria-hidden="true">${glyph}</i>`;

// ---------- folders the window knows about, by id; each keeps its parent, so paths and breadcrumbs work ----------
const cache = new Map();
function adopt(v, parent) {
  let n = cache.get(v.id);
  if (!n) cache.set(v.id, n = { id: v.id });
  Object.assign(n, { n: v.n, s: v.s, dir: v.d, h: v.h, more: v.more, moreS: v.moreS, denied: !!v.denied });
  if (parent !== undefined) n.parent = parent;
  if (v.k) n.c = v.k.map(k => adopt(k, n));
  else if (!v.h) n.c = [];
  return n;
}
const load = async node => adopt(await call('view', { id: node.id, depth: 3, all: opts.hidden }));

let page = 'home', root = null, cur = null, dirty = false, treePath = null, drives = [];
const driveFor = path => drives.find(d => d.path.toLowerCase() === String(path).toLowerCase());
const label = n => {
  if (n !== root) return n.n;
  const d = driveFor(n.n);
  return d ? `${d.label} (${d.letter})` : n.n;
};
chart.init({ fmt, label, still });

// ---------- pages, with a history for the title bar's back button, like the Settings app ----------
const hist = [];
function show(p, back) {
  if (page === 'scan' && p !== 'scan' && scanning) call('cancel_scan');   // leaving the scan page stops the scan
  if (!back && page !== p && page !== 'scan') hist.push(page);
  while (hist.at(-1) === p) hist.pop();                                     // never "back" to where we already are
  if (hist.length > 20) hist.shift();
  page = p;
  for (const v of ['home', 'scan', 'browse', 'settings']) $(v).hidden = v !== p;
  if (p === 'home') renderHome();
  if (p === 'browse' && dirty) { dirty = false; render(); }
  $('navBack').disabled = !hist.length && p !== 'scan';
  $('gear').disabled = p === 'scan';
  $('gear').setAttribute('aria-pressed', p === 'settings');
}
const goBack = () => { const p = hist.pop(); show(p || 'home', true); };
$('navBack').addEventListener('click', goBack);
$('gear').addEventListener('click', () => page === 'settings' ? goBack() : show('settings'));

let toastT;
function toast(msg, glyph = GLYPH.check) {
  $('toastIcon').innerHTML = glyph;
  $('toastText').textContent = msg;
  $('toast').classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => $('toast').classList.remove('show'), 3200);
}
const fail = err => toast(String(err), GLYPH.info);

// ---------- window chrome: our own title bar, so the buttons are ours too ----------
let mica = false;
if (T) {
  const win = T.window.getCurrentWindow();
  $('min').addEventListener('click', () => win.minimize());
  $('max').addEventListener('click', () => win.toggleMaximize());
  $('close').addEventListener('click', () => win.close());
  const syncMax = async () => {
    const maxed = await win.isMaximized();
    $('max').innerHTML = maxed ? '&#xE923;' : '&#xE922;';
    $('max').title = $('max').ariaLabel = maxed ? 'Restore' : 'Maximize';
  };
  win.onResized(syncMax);
  syncMax();
  // Like every Windows window, the title bar fades when another window has the focus.
  win.onFocusChanged(({ payload }) => document.body.classList.toggle('inactive', !payload));
  // On Windows 11 the Mica backdrop shows through the window; it follows the theme picked here.
  call('material').then(m => { mica = m === 'mica'; document.documentElement.classList.toggle('mica', mica); applyTheme(); });
  T.app.getVersion().then(v => { $('version').textContent = v; });
} else {
  $('win').querySelector('.caption').hidden = true;
  $('version').textContent = 'preview';
}
// The page's own right-click menu (Back, Reload, Inspect) has no place in an app.
document.addEventListener('contextmenu', e => { if (!e.target.closest('input')) e.preventDefault(); });

// ---------- home: the drives, and a tile to choose any folder ----------
async function renderHome() {
  try { drives = await call('drives'); } catch (err) { drives = []; fail(err); }
  if (page !== 'home') return;
  $('drives').innerHTML = drives.map((d, i) => {
    const used = d.total ? (d.total - d.free) / d.total : 0, C = TAU * 19;
    return `<button class="tile" data-i="${i}" style="--i:${i}">
      <svg viewBox="0 0 46 46" fill="none" stroke-width="5" aria-hidden="true"><circle cx="23" cy="23" r="19" stroke="var(--track)"/>
        <circle class="used" cx="23" cy="23" r="19" stroke="${used > .9 ? 'var(--danger)' : `var(--c${i % 8 + 1})`}" stroke-linecap="round" stroke-dasharray="${(C * used).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 23 23)"/></svg>
      <span class="t-body"><b>${esc(d.label)} (${d.letter})</b><small class="num">${fmt(d.free)} free of ${fmt(d.total)}</small></span></button>`;
  }).join('') + `<button class="tile pick" id="pick" style="--i:${drives.length}">${icon(GLYPH.add)}
    <span class="t-body"><b>Choose a folder…</b><small>Or drop one in the window</small></span></button>`;
}
$('drives').addEventListener('click', e => {
  const b = e.target.closest('.tile');
  if (!b) return;
  if (b.id === 'pick') return pickFolder();
  go(drives[+b.dataset.i].path);
});
async function pickFolder() {
  const ask = { directory: true, title: 'Choose a folder' };
  const path = T ? await (T.dialog ? T.dialog.open(ask) : call('plugin:dialog|open', { options: ask })) : 'C:\\Users\\Alex';
  if (path) go(path);
}
function go(path) { if (root && treePath === path) open(root, root); else scan(path); }

// ---------- scanning: Rust reports each finished top-level folder, so the ring really fills in as it goes ----------
let scanning = false, scanToken = 0, parts = [], used = 0;
async function scan(path) {
  if (scanning) return toast('A scan is running. Cancel it first to start another.', GLYPH.info);
  scanning = true;
  const token = ++scanToken, d = driveFor(path);
  parts = []; used = d ? d.total - d.free : 0;
  $('scanSegs').innerHTML = '';
  $('scanCount').textContent = '0';
  $('scanPath').textContent = '';
  $('scanTitle').textContent = 'Scanning ' + (d ? `${d.label} (${d.letter})` : String(path).replace(/\\$/, '').split('\\').pop());
  $('scanProgress').classList.toggle('busy', !used);
  $('scanProgress').toggleAttribute('aria-valuenow', !!used);
  $('scanBar').style.width = used ? '0%' : '';
  $('scanHand').classList.toggle('spin', !used);
  $('scanHand').style.transform = '';
  show('scan');
  try {
    const done = await runScan(path, opts.hidden, p => { if (token === scanToken && page === 'scan') tick(p); });
    scanning = false;
    cache.clear();
    treePath = path;
    const r = adopt(done.root, null);
    const skipped = done.denied ? ` · ${fmtCount(done.denied)} folder${done.denied === 1 ? '' : 's'} couldn't be read` : '';
    toast(`${fmtCount(done.files)} files in ${done.secs.toFixed(1)} s${skipped}`);
    open(r, r);
  } catch (err) {
    scanning = false;
    if (String(err) !== CANCELLED) fail(err);
    if (page === 'scan') goBack();
  }
}
function tick(p) {
  $('scanCount').textContent = fmtCount(p.files);
  $('scanPath').textContent = p.path;
  if (p.parts.length) {
    parts.push(...p.parts);
    const sum = parts.reduce((t, x) => t + x.size, 0), total = Math.max(used, sum) || 1;
    let a = 0;
    $('scanSegs').innerHTML = parts.map((x, i) => {
      const w = TAU * x.size / total, seg = w * 184 > 2 ? `<path d="${chart.centred(150, 184, a, a + w)}" style="fill:var(--c${i % 8 + 1})"/>` : '';
      a += w;
      return seg;
    }).join('');
  }
  if (!used) return;
  const e = Math.min(1, p.bytes / used);
  $('scanBar').style.width = (e * 100).toFixed(1) + '%';
  $('scanHand').style.transform = `rotate(${(e * 360).toFixed(1)}deg)`;
  $('scanProgress').setAttribute('aria-valuenow', Math.round(e * 100));
}
$('cancel').addEventListener('click', () => call('cancel_scan'));

// ---------- browse: the chart, the list beside it and the breadcrumbs ----------
let listNodes = [], mode = 'items', found = null, navToken = 0, listToken = 0;

async function open(node, newRoot) {
  const token = ++navToken;
  const motion = chart.leaving(newRoot || page !== 'browse' ? null : cur, node);
  try { await load(node); } catch (err) { return fail(err); }
  if (token !== navToken) return;
  if (newRoot) root = newRoot;
  cur = node;
  dirty = false;
  show('browse');
  render();
  chart.arrive(motion, node);
}

function render() {
  chart.draw(cur, root);
  renderList();
  rest();
  const chain = [];
  for (let n = cur; n; n = n.parent) { chain.unshift(n); if (n === root) break; }
  $('crumbs').innerHTML = '<button data-i="home">Home</button>'
    + chain.map((n, i) => `${icon('&#xE76C;')}<button data-i="${i}"${i === chain.length - 1 ? ' aria-current="location"' : ''}>${esc(label(n))}</button>`).join('');
  $('crumbs').chain = chain;
}

function row(n, i, top, base, sub) {
  const glyph = n.denied ? GLYPH.lock : n.dir ? GLYPH.dir : GLYPH.file;
  const note = n.denied ? 'No access' : sub;
  return `<button class="row${n.denied ? ' denied' : ''}" data-i="${i}" data-top="${top}" tabindex="${i ? -1 : 0}" style="--c:${chart.colorOf(top)};--i:${Math.min(i, 16)}">
    ${icon(glyph)}
    <span class="name" title="${esc(n.n)}">${esc(n.n)}${note ? `<small>${esc(note)}</small>` : ''}</span>
    <span class="size">${n.denied ? '' : fmt(n.s)}</span>
    <span class="meter" aria-hidden="true"><i style="width:${base ? n.s / base * 100 : 0}%"></i></span>
  </button>`;
}
const hitNode = h => ({ id: h.id, n: h.n, s: h.s, dir: h.d, h: h.h, hit: true });

async function renderList() {
  const token = ++listToken, q = $('q').value.trim();
  let html = '';
  found = null;
  try {
    if (q) {
      const r = await call('search', { query: q, cur: cur.id, all: opts.hidden });
      if (token !== listToken) return;
      found = { total: r.total, lit: new Set(r.lit) };
      listNodes = r.hits.map(hitNode);
      html = r.hits.map((h, i) => row(listNodes[i], i, h.top, root.s, h.at)).join('')
        || `<p class="empty">Nothing called “${esc(q)}” in ${esc(label(root))}</p>`;
    } else if (mode === 'files') {
      const hits = await call('largest', { cur: cur.id, all: opts.hidden });
      if (token !== listToken) return;
      listNodes = hits.map(hitNode);
      html = hits.map((h, i) => row(listNodes[i], i, h.top, cur.s, h.at)).join('') || '<p class="empty">No files in here.</p>';
    } else {
      listNodes = cur.c;
      const empty = cur.denied ? "Dysky isn't allowed to look inside this folder." : 'This folder is empty.';
      html = cur.c.map((n, i) => row(n, i, i, cur.s)).join('')
        + (cur.more ? `<div class="row rest">${icon(GLYPH.more)}<span class="name">${fmtCount(cur.more)} more items</span><span class="size">${fmt(cur.moreS)}</span></div>` : '')
        || `<p class="empty">${empty}</p>`;
    }
  } catch (err) { if (token === listToken) fail(err); return; }
  $('list').innerHTML = html;
  $('list').scrollTop = 0;
  if (found) rest();
}

// The chart and the list light up together: hovering either shows the folder in both.
function focus(top, node) {
  chart.highlight(top, node);
  $('list').querySelectorAll('.row').forEach(r => r.classList.toggle('on', top != null && +r.dataset.top === top));
}
// At rest the chart shows everything, or, while searching, lights up wherever matches are.
function rest() {
  if (found) {
    chart.light(found.lit);
    $('list').querySelectorAll('.row.on').forEach(r => r.classList.remove('on'));
  } else focus(null);
  chart.readOut(cur, null, found);
}
function enter(n) {
  if (n.denied) toast("Dysky isn't allowed to look inside this folder", GLYPH.lock);
  else if (n.h) open(n);
  else if (n.dir) toast(n.s ? 'Nothing more to show in here' : 'This folder is empty', GLYPH.info);
}
function flash(n) {
  const i = cur.c.findIndex(x => x.id === n.id);
  const r = $('list').querySelector(`.row[data-i="${i}"]`);
  if (r) { r.classList.add('flash'); r.scrollIntoView({ block: 'nearest', behavior: still() ? 'auto' : 'smooth' }); }
  chart.pulse(n);
}
async function copyPath(n) {
  try {
    await navigator.clipboard.writeText(await call('path', { id: n.id }));
    toast('Path copied');
  } catch (err) { fail(err); }
}
// Search results and largest files jump to where the item lives.
async function jump(n) {
  try {
    const chain = await call('trail', { id: n.id, all: opts.hidden });
    let p = null;
    for (const v of chain) p = adopt(v, p);
    const at = p.h ? p : p.parent;
    closeFind();
    setTab('items', true);
    await open(at);
    if (at !== p) flash(p);
  } catch (err) { fail(err); }
}

$('ring').addEventListener('mouseover', e => {
  const p = e.target.closest('.it');
  if (p) { const s = chart.pieces()[p.dataset.k]; focus(s.top, s.node); chart.readOut(s.node, cur); return; }
  rest();
  if (e.target.closest('.hub.up')) chart.readUp(label(cur.parent));
});
$('ring').addEventListener('mouseleave', rest);
$('ring').addEventListener('click', e => {
  const p = e.target.closest('.it');
  if (p) return enter(chart.pieces()[p.dataset.k].node);
  if (e.target.closest('.hub.up')) open(cur.parent);
});

const rowNode = el => { const r = el.closest && el.closest('.row[data-i]'); return r ? [r, listNodes[r.dataset.i]] : [null, null]; };
const point = (r, n) => { focus(+r.dataset.top, n); chart.readOut(n, found ? root : cur); };
$('list').addEventListener('mouseover', e => { const [r, n] = rowNode(e.target); if (r) point(r, n); });
$('list').addEventListener('mouseleave', () => { if (!$('list').contains(document.activeElement)) rest(); });
$('list').addEventListener('focusin', e => { const [r, n] = rowNode(e.target); if (r) point(r, n); });
$('list').addEventListener('focusout', e => { if (!$('list').contains(e.relatedTarget)) rest(); });
$('list').addEventListener('click', e => {
  const [r, n] = rowNode(e.target);
  if (r) n.hit ? jump(n) : enter(n);
});
// One tab stop for the whole list; the arrow keys move inside it, like a list in any Windows app.
$('list').addEventListener('keydown', e => {
  const rows = [...$('list').querySelectorAll('.row[data-i]')], i = rows.indexOf(document.activeElement);
  const to = i < 0 ? undefined : { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: rows.length - 1, PageDown: i + 10, PageUp: i - 10 }[e.key];
  if (to === undefined) return;
  e.preventDefault();
  const k = Math.max(0, Math.min(rows.length - 1, to));
  rows.forEach((r, j) => { r.tabIndex = j === k ? 0 : -1; });
  rows[k].focus();
});

// ---------- the right-click menu, like File Explorer's, with nothing that changes a file ----------
let menuNode = null, menuFrom = null;
function openMenu(n, x, y) {
  menuNode = n;
  menuFrom = document.activeElement;
  const m = $('menu'), w = $('win').getBoundingClientRect();
  m.querySelector('[data-m="open"]').hidden = !n.h;
  m.hidden = false;
  m.style.left = Math.min(x - w.left, w.width - m.offsetWidth - 8) + 'px';
  m.style.top = Math.min(y - w.top, w.height - m.offsetHeight - 8) + 'px';
  m.querySelector('button:not([hidden])').focus();
}
function closeMenu(refocus) {
  if ($('menu').hidden) return;
  $('menu').hidden = true;
  menuNode = null;
  if (refocus && menuFrom && menuFrom.isConnected) menuFrom.focus();
}
$('ring').addEventListener('contextmenu', e => { const p = e.target.closest('.it'); if (p) openMenu(chart.pieces()[p.dataset.k].node, e.clientX, e.clientY); });
$('list').addEventListener('contextmenu', e => { const [r, n] = rowNode(e.target); if (r) openMenu(n, e.clientX, e.clientY); });
$('menu').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  const n = menuNode;
  closeMenu(true);
  if (b.dataset.m === 'open') !n.hit && n.parent === cur ? open(n) : jump(n);
  else if (b.dataset.m === 'copy') copyPath(n);
  else call('reveal', { id: n.id }).catch(fail);
});
document.addEventListener('mousedown', e => { if (!e.target.closest('#menu')) closeMenu(); });
$('menu').addEventListener('focusout', e => { if (!$('menu').contains(e.relatedTarget)) closeMenu(); });
$('list').addEventListener('scroll', () => closeMenu());
window.addEventListener('resize', () => closeMenu());

// ---------- the list's tabs and the search box ----------
function setTab(t, quiet) {
  mode = t;
  $('tabs').querySelectorAll('button').forEach(b => { const on = b.dataset.tab === t; b.setAttribute('aria-selected', on); b.tabIndex = on ? 0 : -1; });
  if (!quiet) { renderList(); rest(); }
}
function closeFind() { $('q').value = ''; }
$('tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { closeFind(); setTab(b.dataset.tab); } });
$('tabs').addEventListener('keydown', e => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  const b = $('tabs').querySelector(`[data-tab="${mode === 'items' ? 'files' : 'items'}"]`);
  b.focus();
  b.click();
});
let searchT;
$('q').addEventListener('input', () => { clearTimeout(searchT); searchT = setTimeout(() => { renderList(); rest(); }, 120); });
$('q').addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeFind(); renderList(); rest(); $('q').blur(); }
  if (e.key === 'Enter' && found && listNodes.length) jump(listNodes[0]);
});

$('crumbs').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.i === 'home') show('home'); else open($('crumbs').chain[b.dataset.i]);
});
const up = () => cur !== root ? open(cur.parent) : show('home');
$('back').addEventListener('click', up);
$('rescan').addEventListener('click', () => scan(treePath));

// ---------- the keyboard ----------
document.addEventListener('keydown', e => {
  if (!$('menu').hidden) {
    const btns = [...$('menu').querySelectorAll('button:not([hidden])')], i = btns.indexOf(document.activeElement);
    if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); closeMenu(true); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); btns[(i + (e.key === 'ArrowDown' ? 1 : btns.length - 1)) % btns.length].focus(); }
    return;
  }
  if (page === 'scan' && e.key === 'Escape') return call('cancel_scan');
  if (e.key === 'F5' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r')) { e.preventDefault(); if (page === 'browse') scan(treePath); return; }
  if (e.altKey && e.key === 'ArrowLeft' && page !== 'browse') { e.preventDefault(); return goBack(); }
  if (page !== 'browse') return;
  const mod = e.ctrlKey || e.metaKey, [r, n] = rowNode(document.activeElement);
  if (mod && e.key.toLowerCase() === 'f') { e.preventDefault(); $('q').focus(); return; }
  if (e.target === $('q')) return;
  if (r && (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10'))) {
    e.preventDefault();
    const box = r.getBoundingClientRect();
    return openMenu(n, box.left + 40, box.bottom - 4);
  }
  if (mod && e.key.toLowerCase() === 'c') { if (r) { e.preventDefault(); copyPath(n); } return; }
  if (e.key === 'Backspace' || (e.altKey && e.key === 'ArrowLeft')) { e.preventDefault(); up(); return; }
  if (e.key.length === 1 && e.key !== ' ' && !mod && !e.altKey) $('q').focus();   // type anywhere to search
});

// ---------- drop a folder anywhere in the window ----------
const dropped = paths => { $('drop').hidden = true; if (paths && paths.length) scan(paths[0]); };
if (T) {
  T.webview.getCurrentWebview().onDragDropEvent(e => {
    const t = e.payload.type;
    if (t === 'enter' || t === 'over') $('drop').hidden = false;
    else if (t === 'leave') $('drop').hidden = true;
    else if (t === 'drop') dropped(e.payload.paths);
  });
} else {
  let drags = 0;
  const files = e => [...(e.dataTransfer ? e.dataTransfer.types : [])].includes('Files');
  document.addEventListener('dragenter', e => { if (files(e)) { drags++; $('drop').hidden = false; } });
  document.addEventListener('dragleave', e => { if (files(e) && --drags <= 0) { drags = 0; $('drop').hidden = true; } });
  document.addEventListener('dragover', e => { if (files(e)) e.preventDefault(); });
  document.addEventListener('drop', e => { if (files(e)) { e.preventDefault(); drags = 0; dropped(['C:\\Users\\Alex']); } });
}

// ---------- settings ----------
$('forms').innerHTML = Object.entries(chart.FORMS).map(([k, f]) => `<button role="radio" data-f="${k}" aria-checked="false" tabindex="-1">${chart.thumbnail(k)}<span>${f.name}</span></button>`).join('');
$('forms').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setForm(b.dataset.f); });
$('forms').addEventListener('keydown', e => {
  const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
  if (!step) return;
  e.preventDefault();
  const keys = Object.keys(chart.FORMS), next = keys[(keys.indexOf(opts.form) + step + keys.length) % keys.length];
  setForm(next);
  $('forms').querySelector(`[data-f="${next}"]`).focus();
});
function setForm(key) {
  opts.form = key;
  chart.useForm(key);
  $('forms').querySelectorAll('button').forEach(b => { const on = b.dataset.f === key; b.setAttribute('aria-checked', on); b.tabIndex = on ? 0 : -1; });
  saveOpts();
  if (cur) dirty = true;
  if (page === 'browse') { dirty = false; render(); chart.intro(); }
}
// The theme is the CSS's job (light, dark, or whatever Windows uses); Mica is told too, so its tint matches.
function applyTheme() {
  if (opts.theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = opts.theme;
  if (mica) T.window.getCurrentWindow().setTheme(opts.theme === 'system' ? null : opts.theme).catch(() => {});
}
function bindSwitch(id, key, after) {
  const el = $(id), sync = () => { el.previousElementSibling.textContent = el.checked ? 'On' : 'Off'; };
  el.checked = !!opts[key];
  sync();
  el.addEventListener('change', () => { opts[key] = el.checked; sync(); saveOpts(); if (after) after(); });
}
function bindSelect(id, key, after) {
  const el = $(id);
  el.value = opts[key];
  el.addEventListener('change', () => { opts[key] = el.value; saveOpts(); after(); });
}
// Hidden items change every size, so the folders on screen are asked for again.
async function refresh() {
  if (!cur) return;
  try {
    const chain = await call('trail', { id: cur.id, all: opts.hidden });
    cache.clear();
    let p = null;
    for (const v of chain) p = adopt(v, p);
    root = cache.get(chain[0].id);
    cur = p;
    await load(cur);
    dirty = true;
    if (page === 'browse') { dirty = false; render(); }
  } catch (err) { fail(err); }
}
bindSelect('optTheme', 'theme', applyTheme);
bindSwitch('optMotion', 'motion', () => document.body.classList.toggle('still', !opts.motion));
bindSwitch('optHidden', 'hidden', refresh);
bindSelect('optUnits', 'units', () => { if (cur) dirty = true; });
document.body.classList.toggle('still', !opts.motion);

applyTheme();
setForm(opts.form);
show('home');
if (!native) document.documentElement.classList.add('preview');
