// The home page's only script. The demo is the app itself (demo/src, on sample data) in a same-origin
// iframe: this fits it to the page, starts a sample scan once it is in view, and lets the buttons under it
// switch the chart shape. Without JavaScript the page still works, minus the demo.
const frame = document.getElementById('frame'), demo = document.getElementById('demo'), shapes = document.getElementById('shapes');
const W = 1180;
new ResizeObserver(([e]) => frame.style.setProperty('--k', Math.min(1, e.contentRect.width / W))).observe(frame);

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

demo.addEventListener('load', async () => {
  const doc = app();
  for (const type of ['pointerdown', 'keydown', 'wheel']) doc.addEventListener(type, () => { touched = true; }, { capture: true, once: true });
  await until(() => doc.querySelector('#drives .tile'));
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
