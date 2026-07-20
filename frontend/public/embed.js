/*!
 * Funding Finder — Embeddable live arbitrage widget
 * ---------------------------------------------------
 * Drop this on any site with a single tag:
 *
 *   <div id="funding-finder-widget"></div>
 *   <script src="https://funding-finder-frontend.onrender.com/embed.js"
 *           data-theme="dark" data-limit="5" data-lang="en" async></script>
 *
 * Config (all optional, via data-* on the <script> tag):
 *   data-theme  "dark" | "light"   (default: dark)
 *   data-limit  1..10               (default: 5)
 *   data-lang   "en" | "ru"         (default: en)
 *   data-title  custom heading text
 *   data-target CSS id of the mount element (default: funding-finder-widget)
 *
 * Renders inside a Shadow DOM (host styles never leak in), and places a
 * crawlable "Powered by Funding Finder" backlink in the light DOM.
 */
(function () {
  'use strict';

  var API_URL = 'https://funding-finder-api.onrender.com';
  var SITE_URL = 'https://funding-finder-frontend.onrender.com';
  var ARB_ENDPOINT = API_URL + '/api/public/arbitrage';
  var REFRESH_MS = 60000;

  // --- Locate our own <script> tag to read config ---
  var self =
    document.currentScript ||
    (function () {
      var s = document.getElementsByTagName('script');
      for (var i = s.length - 1; i >= 0; i--) {
        if ((s[i].src || '').indexOf('embed.js') !== -1) return s[i];
      }
      return null;
    })();

  function attr(name, fallback) {
    if (!self) return fallback;
    var v = self.getAttribute('data-' + name);
    return v == null || v === '' ? fallback : v;
  }

  var THEME = attr('theme', 'dark') === 'light' ? 'light' : 'dark';
  var LIMIT = Math.max(1, Math.min(10, parseInt(attr('limit', '5'), 10) || 5));
  var LANG = attr('lang', 'en') === 'ru' ? 'ru' : 'en';
  var TARGET_ID = attr('target', 'funding-finder-widget');

  var T = {
    en: {
      title: attr('title', 'Best funding arbitrage now'),
      poweredBy: 'Powered by Funding Finder',
      openAll: 'See all opportunities →',
      empty: 'No fresh opportunities right now — refreshing…',
      err: 'Live data unavailable. Retrying…',
      perYr: '/yr',
      updated: 'updated',
      tracking: 'tracking',
      exchanges: 'exchanges',
    },
    ru: {
      title: attr('title', 'Лучший арбитраж фандинга сейчас'),
      poweredBy: 'Работает на Funding Finder',
      openAll: 'Все возможности →',
      empty: 'Нет свежих возможностей — обновляем…',
      err: 'Живые данные недоступны. Повтор…',
      perYr: '/год',
      updated: 'обновлено',
      tracking: 'отслеживаем',
      exchanges: 'бирж',
    },
  }[LANG];

  // --- Resolve mount point (light DOM) ---
  function mount() {
    var host = document.getElementById(TARGET_ID);
    if (!host && self && self.parentNode) {
      host = document.createElement('div');
      host.id = TARGET_ID;
      self.parentNode.insertBefore(host, self.nextSibling);
    }
    if (!host) return;
    render(host);
  }

  function fmtPct(v) {
    if (v == null || isNaN(v)) return '—';
    return (v * 100).toFixed(3) + '%';
  }

  function render(host) {
    // Guard against double-init on the same element.
    if (host.getAttribute('data-ff-init') === '1') return;
    host.setAttribute('data-ff-init', '1');

    var dark = THEME === 'dark';
    var c = dark
      ? { bg: '#0b1220', card: '#111c31', text: '#e2e8f0', muted: '#94a3b8', line: 'rgba(255,255,255,.08)', brand: '#7dd3fc', green: '#22c55e' }
      : { bg: '#ffffff', card: '#f8fafc', text: '#0f172a', muted: '#64748b', line: '#e8edf5', brand: '#1f4fb0', green: '#16a34a' };

    var shadow = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;

    var style = document.createElement('style');
    style.textContent =
      ':host{all:initial}' +
      '*{box-sizing:border-box;margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}' +
      '.ff{background:' + c.bg + ';color:' + c.text + ';border:1px solid ' + c.line + ';border-radius:16px;padding:16px;max-width:440px;line-height:1.5}' +
      '.ff-h{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:12px}' +
      '.ff-t{font-weight:800;font-size:14px;display:flex;align-items:center;gap:8px}' +
      '.ff-dot{width:8px;height:8px;border-radius:50%;background:' + c.green + ';box-shadow:0 0 0 0 rgba(34,197,94,.6);animation:ffp 1.8s infinite}' +
      '@keyframes ffp{0%{box-shadow:0 0 0 0 rgba(34,197,94,.5)}70%{box-shadow:0 0 0 7px rgba(34,197,94,0)}100%{box-shadow:0 0 0 0 rgba(34,197,94,0)}}' +
      '.ff-sub{font-size:11px;color:' + c.muted + '}' +
      '.ff-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;border:1px solid ' + c.line + ';border-radius:10px;margin-bottom:8px;background:' + c.card + '}' +
      '.ff-row:last-child{margin-bottom:0}' +
      '.ff-pair{font-weight:800;font-size:14px}' +
      '.ff-route{font-size:11px;color:' + c.muted + ';margin-top:2px;max-width:210px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.ff-rate{text-align:right;white-space:nowrap}' +
      '.ff-apr{font-weight:800;font-size:14px;color:' + c.green + '}' +
      '.ff-risk{font-size:10px;font-weight:800;padding:1px 7px;border-radius:999px;display:inline-block;margin-top:2px}' +
      '.LOW{background:#dcfce7;color:#15803d}.MEDIUM{background:#fef3c7;color:#b45309}.HIGH{background:#fee2e2;color:#b91c1c}' +
      '.ff-sk{height:46px;border-radius:10px;background:linear-gradient(90deg,' + c.card + ',' + c.line + ',' + c.card + ');background-size:200% 100%;animation:ffsk 1.2s infinite;margin-bottom:8px}' +
      '@keyframes ffsk{0%{background-position:200% 0}100%{background-position:-200% 0}}' +
      '.ff-cta{display:block;text-align:center;margin-top:12px;font-size:13px;font-weight:700;color:#fff;background:#3390ec;padding:10px;border-radius:10px;text-decoration:none}';

    var wrap = document.createElement('div');
    wrap.className = 'ff';
    wrap.innerHTML =
      '<div class="ff-h"><div class="ff-t"><span class="ff-dot"></span>' + esc(T.title) + '</div>' +
      '<div class="ff-sub" data-el="updated">…</div></div>' +
      '<div data-el="body"><div class="ff-sk"></div><div class="ff-sk"></div><div class="ff-sk"></div></div>' +
      '<a class="ff-cta" target="_blank" rel="noopener" href="' + SITE_URL + '/landing.' + (LANG === 'ru' ? 'ru.' : '') + 'html?utm_source=embed&utm_medium=widget">' + esc(T.openAll) + '</a>';

    shadow.appendChild(style);
    shadow.appendChild(wrap);

    // Crawlable attribution backlink in the LIGHT DOM (SEO value for the host).
    var credit = document.createElement('div');
    credit.style.cssText = 'font:12px -apple-system,Segoe UI,Roboto,sans-serif;color:#94a3b8;text-align:center;margin-top:6px';
    var link = document.createElement('a');
    link.href = SITE_URL + '/landing.' + (LANG === 'ru' ? 'ru.' : '') + 'html?utm_source=embed&utm_medium=attribution';
    link.target = '_blank';
    link.rel = 'noopener';
    link.style.cssText = 'color:#3390ec;text-decoration:none';
    link.textContent = T.poweredBy;
    credit.appendChild(link);
    host.appendChild(credit);

    var body = wrap.querySelector('[data-el="body"]');
    var updated = wrap.querySelector('[data-el="updated"]');

    function draw(data) {
      var opps = (data.opportunities || []).slice(0, LIMIT);
      if (!opps.length) {
        body.innerHTML = '<div class="ff-sub" style="text-align:center;padding:10px 0">' + esc(T.empty) + '</div>';
      } else {
        body.innerHTML = opps
          .map(function (o) {
            var risk = o.riskLevel || 'LOW';
            return (
              '<div class="ff-row"><div><div class="ff-pair">' + esc(o.pair || '') + '</div>' +
              '<div class="ff-route">' + esc(o.opportunity || '') + '</div></div>' +
              '<div class="ff-rate"><div class="ff-apr">' + fmtPct(o.annualReturn) + T.perYr + '</div>' +
              '<span class="ff-risk ' + risk + '">' + esc(risk) + '</span></div></div>'
            );
          })
          .join('');
      }
      var when = data.generatedAt ? new Date(data.generatedAt) : new Date();
      var ex = data.exchangesTracked ? ' · ' + T.tracking + ' ' + data.exchangesTracked + ' ' + T.exchanges : '';
      updated.textContent = T.updated + ' ' + when.toLocaleTimeString() + ex;
    }

    function load() {
      fetch(ARB_ENDPOINT, { cache: 'no-store' })
        .then(function (r) { return r.json(); })
        .then(function (d) { if (d && d.ok) draw(d); })
        .catch(function () { updated.textContent = T.err; });
    }

    load();
    setInterval(load, REFRESH_MS);
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
