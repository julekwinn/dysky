// The home page's only module. The demo is the app itself (demo/src, on sample data) in a same-origin iframe:
// this fits it to the page, starts a sample scan once it is in view, lets the buttons under it switch the chart
// shape, and keeps its theme the same as the site's. Without JavaScript the page still works, minus the demo.
const frame = document.getElementById('frame'), demo = document.getElementById('demo'), shapes = document.getElementById('shapes');
const W = 1180;

// CSS zoom lays the app out at full size and draws it at the size it shows, so text and chart stay sharp.
// Where a browser's zoom doesn't reach into frames, a scale transform does the fitting (a little softer).
let scaled = false;
function fit() {
  const k = Math.min(1, frame.clientWidth / W);
  frame.style.setProperty('--k', k);
  demo.style.zoom = scaled ? '' : k;
}
new ResizeObserver(fit).observe(frame);

const app = () => demo.contentDocument;
const until = test => new Promise(done => { const look = () => test() ? done() : setTimeout(look, 100); look(); });
const browsing = () => !app().getElementById('browse').hidden;
const scanning = () => !app().getElementById('scan').hidden;
let touched = false;

// Opens drive C: of the sample, unless the visitor already did something in the window.
async function showDrive() {
  if (browsing()) return;
  if (!scanning()) {
    if (!app().getElementById('home').hidden) app().querySelector('#drives .tile[data-i="0"]')?.click();
    else return;
  }
  await until(browsing);
}

function mark(form) {
  shapes.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b.dataset.f === form));
}

// The app's own theme setting follows the site's Theme menu.
function theme(value = document.documentElement.dataset.theme ?? 'system') {
  const pick = app()?.getElementById('optTheme');
  if (!pick || pick.value === value) return;
  pick.value = value;
  pick.dispatchEvent(new Event('change'));
}
document.addEventListener('themechange', e => theme(e.detail));

demo.addEventListener('load', async () => {
  const doc = app();
  if (demo.style.zoom && Math.abs(demo.contentWindow.innerWidth - W) > 2) { scaled = true; frame.classList.add('scaled'); fit(); }
  for (const type of ['pointerdown', 'keydown', 'wheel']) doc.addEventListener(type, () => { touched = true; }, { capture: true, once: true });
  await until(() => doc.querySelector('#drives .tile'));
  theme();
  // The shape picked in the app's own Settings shows here too.
  mark(doc.querySelector('#forms [aria-checked="true"]')?.dataset.f);
  doc.getElementById('forms').addEventListener('click', e => { const b = e.target.closest('button'); if (b) mark(b.dataset.f); });
  shapes.hidden = false;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  new IntersectionObserver(([e], seen) => {
    if (!e.isIntersecting) return;
    seen.disconnect();
    setTimeout(() => { if (!touched) showDrive(); }, 900);
  }, { threshold: .25 }).observe(frame);
});

shapes.addEventListener('click', async e => {
  const b = e.target.closest('button');
  if (!b) return;
  mark(b.dataset.f);
  await showDrive();
  app().querySelector(`#forms [data-f="${b.dataset.f}"]`)?.click();
});
