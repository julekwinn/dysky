// The preview backend: a stand-in for the Rust side when src/index.html is opened in a plain browser.
// Sample data (a made-up user "Alex"), the same commands and the same answers as src-tauri/src/tree.rs,
// so the window can be tried, tested and recorded without building the app. It never ships in the app.
const GB = 1e9;
const D = (n, ...k) => ({ n, k });
const G = (n, s) => ({ n, s: s * GB, dir: true });   // folder whose contents the sample leaves out
const F = (n, s) => ({ n, s: Math.round(s * GB) });
const X = n => ({ n, s: 0, dir: true, denied: true });   // a folder that could not be read
const hiddenName = n => /^[.$]/.test(n) || /^(pagefile|hiberfil|swapfile)\.sys$/i.test(n);

const SAMPLES = {
  'C:\\': D('C:\\',
    D('Users',
      D('Alex',
        D('AppData',
          D('Local', G('Docker', 14.6), G('Packages', 12.4), G('Google', 9.1), G('Microsoft', 8.2), G('Temp', 7.4), G('npm-cache', 3.1)),
          D('Roaming', G('Spotify', 6.2), G('Code', 2.9), G('Adobe', 2.4), G('Discord', 1.3)),
          G('LocalLow', 1.1)),
        D('Videos',
          D('Vacation 2025', F('beach-sunset-4k.mov', 9.8), F('road-trip.mov', 7.1), F('drone-coast.mov', 6.4), F('family-dinner.mov', 5.9)),
          G('Captures', 12.3)),
        D('Documents',
          D('Projects', G('Website', 6.1), G('Podcast', 5.2), G('Photo book', 4.2), G('Thesis', 3.6), G('Budget', 2.3), G('Recipes', 1.8), G('Taxes', 1.4)),
          G('Blender', 11.3), G('Adobe', 2.1), F('notes.docx', 0.0004)),
        D('Downloads', F('photos-2025.zip', 7.6), F('ubuntu-24.04.2-desktop-amd64.iso', 6.1), F('Win11_24H2_English_x64.iso', 5.8),
          F('DaVinci_Resolve_19.zip', 3.4), G('old', 2.2), F('blender-4.4-windows-x64.msi', 0.38)),
        G('OneDrive', 14.2), G('Pictures', 9.4), G('.gradle', 4.3), G('.android', 3.2), G('Desktop', 3.1), G('.cache', 2.6)),
      G('Public', 0.6), G('Default', 0.4)),
    D('Program Files (x86)',
      D('Steam', D('steamapps', D('common', G('Counter-Strike 2', 34.2), G('Hades II', 12.1), G('Hollow Knight', 8.9), G('Celeste', 1.2)), G('shadercache', 3.1))),
      G('Microsoft', 2.1)),
    D('Program Files', G('WindowsApps', 18.6), G('Adobe', 9.8), G('DaVinci Resolve', 6.9), G('Microsoft Office', 4.1),
      G('Android', 3.4), G('Docker', 3.2), G('NVIDIA Corporation', 2.1), G('Blender Foundation', 1.4)),
    D('Windows', G('WinSxS', 12.1), G('System32', 7.4), G('Installer', 6.2), G('SoftwareDistribution', 4.1), G('SysWOW64', 2.3), G('Temp', 1.4), G('Fonts', 0.9)),
    G('ProgramData', 21.7), F('pagefile.sys', 16), F('hiberfil.sys', 12.8), G('$Recycle.Bin', 4.2), F('swapfile.sys', 0.27), X('System Volume Information')),
  'D:\\': D('D:\\',
    D('Media', G('Movies', 310), G('Music', 82), D('Photos', G('2023', 41), G('2024', 47), G('2025', 39))),
    D('Backups', F('laptop-image.vhdx', 140), F('phone-backup-2025.tar', 120)),
    D('SteamLibrary', G('Baldur’s Gate 3', 128), G('Cyberpunk 2077', 71), G('Elden Ring', 49)),
    G('Recordings', 44), G('Projects archive', 38)),
  'F:\\': D('F:\\',
    D('ISO', F('Win11_24H2_Polish_x64.iso', 5.8), F('ubuntu-24.04.2-desktop-amd64.iso', 6.1), F('fedora-workstation-41.iso', 2.3), F('hirens-boot.iso', 3.1)),
    G('Installers', 4.4), F('ventoy.json', 0.000002), G('Tools', 2.2))
};
const DRIVES = [['C:', 'Windows', 1000, 486213, false], ['D:', 'Data', 1400, 92410, false], ['F:', 'Ventoy', 61.4, 14, true]];

function sizeUp(node) {
  node.dir = node.dir || !!node.k;
  node.hidden = hiddenName(node.n);
  if (!node.k) return (node.size = node.shown = node.s || 0, node);
  node.k.forEach(sizeUp);
  node.k.sort((a, b) => b.size - a.size);
  node.size = node.k.reduce((t, k) => t + k.size, 0);
  node.shown = node.k.reduce((t, k) => t + (k.hidden ? 0 : k.shown), 0);
  return node;
}
Object.values(SAMPLES).forEach(sizeUp);

function flatten(node, parent, out) {
  const id = out.length;
  out.push({ name: node.n, size: node.size, shown: node.shown, parent, end: 0, dir: node.dir, hidden: node.hidden && id > 0, denied: !!node.denied });
  (node.k || []).forEach(k => flatten(k, id, out));
  out[id].end = out.length;
  return out;
}
// The home folder scanned on its own, like "Choose a folder…" would do.
const homeOf = () => { const c = SAMPLES['C:\\']; return c.k[0].k[0]; };

let tree = null, cancel = false;
const E = id => tree[id];
const size = (id, all) => all ? E(id).size : E(id).shown;
const visible = (id, all) => all || !E(id).hidden;
function* kids(id) { for (let c = id + 1; c < E(id).end; c = E(c).end) yield c; }
const sorted = (id, all) => [...kids(id)].filter(k => visible(k, all)).sort((a, b) => size(b, all) - size(a, all));
const hasKids = (id, all) => sorted(id, all).length > 0;
function* inside(id, all) { for (let i = id + 1; i < E(id).end;) { if (visible(i, all)) yield i++; else i = E(i).end; } }
function path(id) {
  const names = [];
  for (let x = id; x !== 0; x = E(x).parent) names.unshift(E(x).name);
  return names.length ? E(0).name.replace(/\\$/, '') + '\\' + names.join('\\') : E(0).name;
}
function rel(id, base) {
  const names = [];
  let x = id;
  while (x !== base && x !== 0) { names.unshift(E(x).name); x = E(x).parent; }
  return x !== base ? path(id) : names.length ? '…\\' + names.join('\\') : '';
}
function topOf(id, cur, order) {
  let x = id;
  while (x !== 0 && E(x).parent !== cur) x = E(x).parent;
  return x === 0 ? -1 : order.indexOf(x);
}
function viewAt(id, depth, all, top, min) {
  const v = { id, n: E(id).name, s: size(id, all), d: E(id).dir, h: false, more: 0, moreS: 0 };
  if (E(id).denied) v.denied = true;
  if (!v.d) return v;
  if (depth === 0 || (!top && v.s < min)) return (v.h = hasKids(id, all), v);
  const list = sorted(id, all);
  v.h = list.length > 0;
  v.k = [];
  list.forEach((k, i) => {
    const s = size(k, all);
    if (top ? i < 500 : s >= min) v.k.push(viewAt(k, depth - 1, all, false, min));
    else { v.more++; v.moreS += s; }
  });
  return v;
}
const view = (id, depth, all) => viewAt(id, depth, all, true, size(id, all) * .0015);
const hit = (id, all, base, cur, order) => ({ id, n: E(id).name, s: size(id, all), d: E(id).dir, h: E(id).dir && hasKids(id, all), at: rel(E(id).parent, base), top: topOf(id, cur, order) });
const biggest = (ids, n, all) => ids.sort((a, b) => size(b, all) - size(a, all)).slice(0, n);
const wait = ms => new Promise(r => setTimeout(r, ms));

const COMMANDS = {
  drives: () => DRIVES.map(([letter, label, total, , removable]) => {
    const s = SAMPLES[letter + '\\'].size;
    return { path: letter + '\\', letter, label, total: total * GB, free: total * GB - s, removable };
  }),
  material: () => 'none',
  cancel_scan: () => { cancel = true; },
  view: ({ id, depth, all }) => view(id, Math.min(depth, 3), all),
  largest: ({ cur, all }) => {
    const order = sorted(cur, all);
    return biggest([...inside(cur, all)].filter(k => !E(k).dir), 20, all).map(k => hit(k, all, cur, cur, order));
  },
  search: ({ query, cur, all }) => {
    const q = query.trim().toLowerCase(), order = sorted(cur, all);
    if (!q) return { total: 0, hits: [], lit: [] };
    const matches = [...inside(0, all)].filter(k => E(k).name.toLowerCase().includes(q)), lit = new Set();
    for (const m of matches) {
      const chain = [];
      let x = m;
      while (x !== cur && x !== 0) { chain.push(x); x = E(x).parent; }
      if (x === cur) chain.reverse().slice(0, 3).forEach(k => lit.add(k));
    }
    return { total: matches.length, hits: biggest([...matches], 40, all).map(k => hit(k, all, 0, cur, order)), lit: [...lit] };
  },
  trail: ({ id, all }) => {
    const ids = [id];
    for (let x = id; x !== 0;) ids.unshift(x = E(x).parent);
    return ids.map(k => viewAt(k, 0, all, false, 0));
  },
  path: ({ id }) => path(id),
  reveal: () => { throw 'Showing files in File Explorer works in the app'; }
};

export async function invoke(cmd, args = {}) {
  await wait(20);
  return COMMANDS[cmd](args);
}

// A scan of the sample takes a second and a half and reports like the real one: a tick every 60 ms with the
// files so far and the top-level folders finished since the last tick.
export async function scan(at, all, onTick) {
  cancel = false;
  const node = SAMPLES[at] || (at.replace(/\\$/, '').endsWith('Alex') ? { ...homeOf(), n: at } : null);
  if (!node) throw "That folder can't be opened";
  const drive = DRIVES.find(d => d[0] + '\\' === at), files = drive ? drive[3] : 52180;
  const tops = node.k.filter(k => k.dir), dur = 1500, t0 = performance.now();
  let sent = 0;
  for (let t = 0; t < dur; t = performance.now() - t0) {
    if (cancel) throw 'cancelled';
    const e = 1 - (1 - t / dur) ** 2.4, parts = [];
    while (sent < tops.length && sent < e * tops.length) parts.push({ name: tops[sent].n, size: tops[sent++].size });
    onTick({ files: Math.round(files * e), bytes: node.size * e, path: at + (tops[Math.min(tops.length - 1, Math.floor(e * tops.length))] || node).n, parts });
    await wait(60);
  }
  onTick({ files, bytes: node.size, path: at, parts: tops.slice(sent).map(p => ({ name: p.n, size: p.size })) });
  tree = flatten(node, 0, []);
  tree[0].name = at;
  return { files, denied: tree.filter(e => e.denied).length, secs: dur / 1000, root: view(0, 3, all) };
}
