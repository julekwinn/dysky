// The site's theme: the system's, light or dark. Loaded in <head> without defer, so the choice is applied before
// the page is drawn (no flash), then it runs the Theme menu. The choice is remembered in this browser only, and
// the page hears about changes through a "themechange" event (site.js passes it on to the demo).
(() => {
  const KEY = 'dysky-site-theme', root = document.documentElement;
  const saved = () => { try { return localStorage.getItem(KEY) || 'system'; } catch { return 'system'; } };
  const apply = theme => { if (theme === 'light' || theme === 'dark') root.dataset.theme = theme; else delete root.dataset.theme; };
  apply(saved());
  document.addEventListener('DOMContentLoaded', () => {
    const menu = document.getElementById('themes');
    const mark = theme => menu.querySelectorAll('[data-pick]').forEach(b => b.setAttribute('aria-checked', b.dataset.pick === theme));
    mark(saved());
    menu.addEventListener('click', e => {
      const theme = e.target.closest('[data-pick]')?.dataset.pick;
      if (!theme) return;
      try { if (theme === 'system') localStorage.removeItem(KEY); else localStorage.setItem(KEY, theme); } catch { /* applies, just not remembered */ }
      apply(theme);
      mark(theme);
      menu.hidePopover();
      document.dispatchEvent(new CustomEvent('themechange', { detail: theme }));
    });
  });
})();
