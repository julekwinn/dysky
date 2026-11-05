// Builds the website into site/dist: the English and Polish pages from text.json, the assets, and a copy of
// the app itself (src/ with the sample-data backend from dev/) for the live demo. No dependencies:
//   node site/build.mjs
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'site', 'dist');
const read = path => readFileSync(join(ROOT, path), 'utf8');

const ORIGIN = 'https://dysky.youlius.com';
const REPO = 'https://github.com/julekwinn/dysky';
// The Microsoft Store listing, once it is live; until then the Store badge stays off the page.
const STORE_ID = '';
const STORE = STORE_ID && `https://apps.microsoft.com/detail/${STORE_ID}?cid=dysky-site`;
const VERSION = JSON.parse(read('package.json')).version;
const TODAY = new Date().toISOString().slice(0, 10);
const TEXT = JSON.parse(read('site/text.json'));
const BASE = { en: '/', pl: '/pl/' };
const FORMS = ['ring', 'half', 'bubbles', 'spiral', 'dots'];
const ICON = { shield: 'shield_checkmark', flash: 'flash', pie: 'data_pie', shapes: 'shapes', search: 'search', scale: 'scales', window: 'window', lock: 'lock_closed' };

const attr = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fill = s => s.replace(/\{\{version\}\}/g, VERSION);
const icon = (name, cls = '') => read(`site/icons/${name}.svg`).replace(/ width="\d+" height="\d+"/, ` aria-hidden="true" focusable="false"${cls && ` class="${cls}"`}`).trim();
const CHECK = icon('checkmark', 'check');
const THEMES = [['system', 'dark_theme', 'themeSystem'], ['light', 'weather_sunny', 'themeLight'], ['dark', 'weather_moon', 'themeDark']];
const LOGO = `<svg viewBox="0 0 24 24" fill="none" stroke-width="3" aria-hidden="true"><path d="M12.4 4A8 8 0 0 1 15.9 19" stroke="var(--c1)"/><path d="M15.1 19.3A8 8 0 0 1 4.4 14.4" stroke="var(--c2)"/><path d="M4.2 13.6A8 8 0 0 1 6.4 6.3" stroke="var(--c3)"/><path d="M7 5.8A8 8 0 0 1 11.6 4" stroke="var(--c4)"/></svg>`;
const ORG = { '@type': 'Organization', '@id': 'https://youlius.com/#org', name: 'Youlius', url: 'https://youlius.com/', email: 'contact@youlius.com' };

// One page: the shared head, navigation and footer around `main`. `path` is the page inside a language ('' or 'privacy').
function page(lang, path, { title, description, main, ld, script }) {
  const t = TEXT[lang];
  const url = l => ORIGIN + BASE[l] + path;
  const home = BASE[lang];
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${attr(title)}</title>
<meta name="description" content="${attr(description)}">
<meta name="robots" content="index, follow, max-image-preview:large">
<meta name="author" content="Youlius">
<meta name="application-name" content="Dysky">
<meta name="msvalidate.01" content="5BA9C01607883DE0A19D5230E035A39A">
<link rel="canonical" href="${url(lang)}">
<link rel="alternate" hreflang="en" href="${url('en')}">
<link rel="alternate" hreflang="pl" href="${url('pl')}">
<link rel="alternate" hreflang="x-default" href="${url('en')}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Dysky">
<meta property="og:locale" content="${t.locale}">
${Object.keys(BASE).filter(l => l !== lang).map(l => `<meta property="og:locale:alternate" content="${TEXT[l].locale}">`).join('\n')}
<meta property="og:url" content="${url(lang)}">
<meta property="og:title" content="${attr(t.ogTitle)}">
<meta property="og:description" content="${attr(t.ogDescription)}">
<meta property="og:image" content="${ORIGIN}/assets/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${attr(t.ogAlt)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${attr(t.ogTitle)}">
<meta name="twitter:description" content="${attr(t.ogDescription)}">
<meta name="twitter:image" content="${ORIGIN}/assets/og.png">
<meta name="twitter:image:alt" content="${attr(t.ogAlt)}">
<meta name="theme-color" content="#F7F8FB" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#131419" media="(prefers-color-scheme: dark)">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/assets/icon-256.png">
<link rel="stylesheet" href="/assets/site.css">
<script src="/assets/theme.js"></script>
${script ? '<script type="module" src="/assets/site.js"></script>\n' : ''}${ld ? `<script type="application/ld+json">\n${JSON.stringify(ld, null, 1)}\n</script>\n` : ''}</head>
<body>
<a class="skip" href="#main">${t.skip}</a>
<header class="nav">
  <div class="wrap">
    <a class="brand" href="${home}">${LOGO}Dysky</a>
    <nav aria-label="Dysky">
      <a href="${home}#features">${t.navFeatures}</a>
      <a href="${home}#faq">${t.navFaq}</a>
      <a href="${REPO}">${t.navSource}</a>
    </nav>
    <div class="end">
      <button type="button" class="pick" id="langPick" popovertarget="langs">${icon('local_language')}<span class="sr">${t.language}: </span><span>${lang.toUpperCase()}</span>${icon('chevron_down_small', 'chev')}</button>
      <div class="flyout" id="langs" popover>
${Object.keys(BASE).map(l => `        <a href="${BASE[l] + path}" hreflang="${l}" lang="${l}"${l === lang ? ' aria-current="true"' : ''}>${TEXT[l].langName}${CHECK}</a>`).join('\n')}
      </div>
      <button type="button" class="pick theme" id="themePick" popovertarget="themes" aria-label="${attr(t.theme)}">${THEMES.map(([k, ic]) => icon(ic, `t-${k}`)).join('')}${icon('chevron_down_small', 'chev')}</button>
      <div class="flyout" id="themes" popover role="menu" aria-label="${attr(t.theme)}">
${THEMES.map(([k, ic, label]) => `        <button type="button" role="menuitemradio" data-pick="${k}" aria-checked="${k === 'system'}">${icon(ic)}${t[label]}${CHECK}</button>`).join('\n')}
      </div>
      <a class="btn accent small" href="${home}#get">${t.navGet}</a>
    </div>
  </div>
</header>
<main id="main">
${main}
</main>
<footer class="foot">
  <div class="wrap">
    <a class="brand" href="https://youlius.com">${t.footerMade}</a>
    <nav aria-label="${attr(t.footerMade)}">
      <a href="${BASE[lang]}privacy">${t.footerPrivacy}</a>
      <a href="${REPO}">${t.navSource}</a>
      <a href="mailto:contact@youlius.com">${t.footerContact}</a>
    </nav>
    <small>© 2026 Youlius · MIT License. Windows, Microsoft Store and Microsoft Edge are trademarks of the Microsoft group of companies.</small>
  </div>
</footer>
</body>
</html>
`;
}

function home(lang) {
  const t = TEXT[lang];
  const store = STORE ? `<a class="store" href="${STORE}"><img src="/assets/store-${lang}.svg" width="161" height="44" alt="${attr(t.storeAlt)}"></a>` : '';
  const faq = t.faq.map(([q, a]) => [q, STORE && a.includes('SmartScreen') ? `${a} ${t.faqStore}` : a]);
  const main = `<section class="hero" id="get">
  <div class="bloom" aria-hidden="true">${LOGO}</div>
  <div class="wrap">
    <p class="eyebrow">${t.eyebrow}</p>
    <h1>${t.h1}</h1>
    <p class="lead">${t.lead}</p>
    <div class="cta">
      ${store}<a class="btn accent big" href="/download">${icon('arrow_download')}${t.download}</a>
    </div>
    <p class="meta">${fill(t.downloadMeta)}</p>
    <figure class="demo">
      <div class="frame" id="frame"><iframe id="demo" src="/demo/src/window" title="${attr(t.demoTitle)}"></iframe></div>
      <div class="shapes" id="shapes" role="group" aria-label="${attr(t.shapesLabel)}" hidden>
        ${FORMS.map((f, i) => `<button type="button" data-f="${f}" aria-pressed="${i === 0}">${t.shapes[i]}</button>`).join('')}
      </div>
      <figcaption>${t.demoHint}</figcaption>
    </figure>
  </div>
</section>
<section class="features" id="features">
  <div class="wrap">
    <h2>${t.featuresTitle}</h2>
    <p class="lead">${t.featuresLead}</p>
    <ul class="grid">
${t.features.map(([k, h, p]) => `      <li class="card"><span class="ico">${icon(ICON[k])}</span><h3>${h}</h3><p>${p}</p></li>`).join('\n')}
    </ul>
  </div>
</section>
<section class="see" id="screenshots">
  <div class="wrap">
    <h2>${t.seeTitle}</h2>
    <p class="lead">${t.seeLead}</p>
    <div class="gallery">
${t.shots.map(([file, alt, caption]) => `      <figure><img src="/assets/screens/${file}" width="1180" height="760" loading="lazy" decoding="async" alt="${attr(alt)}"><figcaption>${caption}</figcaption></figure>`).join('\n')}
    </div>
  </div>
</section>
<section class="how" id="how">
  <div class="wrap">
    <h2>${t.howTitle}</h2>
    <ol class="steps">
${t.how.map(([h, p]) => `      <li><h3>${h}</h3><p>${p}</p></li>`).join('\n')}
    </ol>
  </div>
</section>
<section class="source">
  <div class="wrap panel">
    <h2>${t.sourceTitle}</h2>
    <p>${t.sourceLead}</p>
    <a class="btn" href="${REPO}">${icon('code')}${t.sourceCta}</a>
  </div>
</section>
<section class="faq" id="faq">
  <div class="wrap">
    <h2>${t.faqTitle}</h2>
    <div class="list">
${faq.map(([q, a]) => `      <details><summary>${q}${icon('chevron_down')}</summary><p>${a}</p></details>`).join('\n')}
    </div>
  </div>
</section>`;
  const ld = { '@context': 'https://schema.org', '@graph': [
    ORG,
    { '@type': 'WebSite', '@id': `${ORIGIN}/#website`, url: `${ORIGIN}/`, name: 'Dysky', inLanguage: ['en', 'pl'], publisher: { '@id': ORG['@id'] } },
    { '@type': 'SoftwareApplication', '@id': `${ORIGIN + BASE[lang]}#app`, name: 'Dysky', url: ORIGIN + BASE[lang], description: t.description, inLanguage: lang,
      applicationCategory: 'UtilitiesApplication', applicationSubCategory: 'Disk space analyzer', operatingSystem: 'Windows 10, Windows 11',
      softwareVersion: VERSION, softwareRequirements: 'Microsoft Edge WebView2', releaseNotes: `${REPO}/blob/main/CHANGELOG.md`, datePublished: '2026-11-05', dateModified: TODAY,
      downloadUrl: `${ORIGIN}/download`, ...(STORE && { installUrl: STORE }), fileSize: '1.5 MB', image: `${ORIGIN}/assets/og.png`,
      screenshot: t.shots.map(([file]) => `${ORIGIN}/assets/screens/${file}`), featureList: t.features.map(([, h]) => h),
      license: 'https://opensource.org/licenses/MIT', sameAs: [REPO], isAccessibleForFree: true,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' }, author: { '@id': ORG['@id'] }, publisher: { '@id': ORG['@id'] } },
    { '@type': 'FAQPage', inLanguage: lang, mainEntity: faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) },
  ] };
  return page(lang, '', { title: t.title, description: t.description, main, ld, script: true });
}

function privacy(lang) {
  const t = TEXT[lang];
  const main = `<article class="wrap page">
  <h1>${t.privacyTitle}</h1>
  <p class="updated">${t.privacyUpdated}</p>
  ${t.privacyBody}
</article>`;
  return page(lang, 'privacy', { title: `${t.privacyTitle} · Dysky`, description: t.privacyDescription, main });
}

// Firebase serves this for any address it doesn't have, in either language, so it says it in both.
function notFound() {
  const [en, pl] = [TEXT.en, TEXT.pl];
  const main = `<article class="wrap page center">
  <h1>${en.notFoundTitle}</h1>
  <p>${en.notFoundLead}</p>
  <p lang="pl">${pl.notFoundTitle} ${pl.notFoundLead}</p>
  <p class="cta"><a class="btn accent" href="/">${en.notFoundCta}</a> <a class="btn" href="/pl/" lang="pl">${pl.notFoundCta}</a></p>
</article>`;
  return page('en', '', { title: `${en.notFoundTitle} · Dysky`, description: en.notFoundLead, main }).replace(/<link rel="(canonical|alternate)"[^>]*>\n/g, '');
}

function sitemap() {
  // Every address lists all its language versions, itself included, as search engines ask.
  const links = path => [...Object.keys(BASE).map(l => [l, l]), ['x-default', 'en']].map(([tag, l]) => `    <xhtml:link rel="alternate" hreflang="${tag}" href="${ORIGIN}${BASE[l]}${path}"/>`).join('\n');
  const entry = path => Object.keys(BASE).map(l => `  <url>\n    <loc>${ORIGIN}${BASE[l]}${path}</loc>\n    <lastmod>${TODAY}</lastmod>\n${links(path)}\n  </url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${['', 'privacy'].map(entry).join('\n')}
</urlset>
`;
}

function write(path, text) {
  mkdirSync(dirname(join(OUT, path)), { recursive: true });
  writeFileSync(join(OUT, path), text);
}

rmSync(OUT, { recursive: true, force: true });
cpSync(join(ROOT, 'site', 'assets'), join(OUT, 'assets'), { recursive: true });
cpSync(join(ROOT, 'app-icon.svg'), join(OUT, 'favicon.svg'));
cpSync(join(ROOT, 'src-tauri', 'icons', 'icon.ico'), join(OUT, 'favicon.ico'));
cpSync(join(ROOT, 'src-tauri', 'icons', '128x128@2x.png'), join(OUT, 'assets', 'icon-256.png'));
for (const lang of Object.keys(BASE)) {
  write(`${BASE[lang].slice(1)}index.html`, home(lang));
  write(`${BASE[lang].slice(1)}privacy.html`, privacy(lang));
}
write('404.html', notFound());
write('sitemap.xml', sitemap());
write('robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${ORIGIN}/sitemap.xml\n`);

// The demo is the app's own window on sample data: src/ as it ships, plus the preview backend it loads in a
// browser, plus icons for systems without Segoe Fluent Icons. Crawlers may fetch it to draw the home page, but
// a noindex here and on /demo/** in firebase.json keeps it out of search results.
cpSync(join(ROOT, 'src'), join(OUT, 'demo', 'src'), { recursive: true });
cpSync(join(ROOT, 'dev', 'preview-backend.js'), join(OUT, 'demo', 'dev', 'preview-backend.js'));
// Not index.html: clean URLs would serve that as /demo/src, and the window's relative links would miss src/.
const demo = join(OUT, 'demo', 'src', 'index.html');
rmSync(demo);
writeFileSync(join(OUT, 'demo', 'src', 'window.html'), read('src/index.html').replace('<link rel="stylesheet" href="styles.css">',
  '<meta name="robots" content="noindex">\n<link rel="stylesheet" href="styles.css">\n<link rel="stylesheet" href="/assets/demo.css">'));
console.log(`site/dist: Dysky ${VERSION}, ${Object.keys(BASE).length} languages${STORE ? ', with the Store badge' : ''}`);
