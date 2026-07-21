// Programmatic SEO generator — multilingual (EN, RU, TR, VI, HI, ES).
// -----------------------------------------------------------------------------
// Builds ~190 static, crawlable long-tail landing pages from a curated keyword
// matrix (coins x exchanges x exchange-pairs) × 6 languages. Each page has:
//   - Unique evergreen content + structured data + breadcrumbs
//   - hreflang tags linking all 6 language variants
//   - Live-data section that hydrates client-side from the public API
//   - Translated UI chrome (header, CTAs, footer, disclaimer)
//
// SEO content (titles, h1, FAQs) stays in English — crypto audiences search
// in English regardless of UI language. This gives max organic reach.
//
//   node scripts/gen-seo.mjs
//
// URLs (clean, no .html — nginx try_files adds the extension):
//   /funding/{coin}                  e.g. /funding/btc
//   /funding/{coin}.{lang}           e.g. /funding/btc.ru
//   /exchange/{name}                 e.g. /exchange/binance
//   /exchange/{name}.{lang}          e.g. /exchange/binance.tr
//   /arbitrage/{a}-vs-{b}           e.g. /arbitrage/binance-vs-bybit
//   /arbitrage/{a}-vs-{b}.{lang}    e.g. /arbitrage/binance-vs-bybit.es

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = join(__dirname, '..', 'dist');

const SITE = 'https://funding-finder-frontend.onrender.com';
const API = 'https://funding-finder-api.onrender.com';
const BOT = 'https://t.me/fundinganalyzerbot';

// --- Languages --------------------------------------------------------------
const LANGS = [
  { code: 'en', label: 'English' },
  { code: 'ru', label: 'Русский' },
  { code: 'tr', label: 'Türkçe' },
  { code: 'vi', label: 'Tiếng Việt' },
  { code: 'hi', label: 'हिन्दी' },
  { code: 'es', label: 'Español' },
];

// Translated UI chrome — SEO body content stays in English for max organic reach.
const UI = {
  en: {
    openApp: 'Open app',
    liveTitle: 'Live opportunities right now',
    heroBtn: '🚀 Find the best spread free',
    tgBtn: 'Open in Telegram',
    faqH: 'FAQ',
    relatedH: 'Related',
    ctaH: 'Scan 23 exchanges in one click',
    ctaP: 'See every funding arbitrage opportunity ranked by yield and risk — free, no card, no deposit to look.',
    ctaBtn: 'Launch app free',
    disc: '⚠️ Not financial advice. Crypto derivatives carry risk of loss. Data is illustrative; verify on the exchange before trading.',
    home: 'Home',
    homeUrl: '/landing.html',
    footerEmbed: 'Embed widget',
    noData: 'Live data unavailable right now.',
    noOpp: 'No fresh opportunities in this window — check the app.',
  },
  ru: {
    openApp: 'Открыть',
    liveTitle: 'Лучшие возможности прямо сейчас',
    heroBtn: '🚀 Найди лучший спред бесплатно',
    tgBtn: 'Открыть в Telegram',
    faqH: 'Частые вопросы',
    relatedH: 'Похожее',
    ctaH: 'Сканируй 23 биржи в один клик',
    ctaP: 'Все возможности фандинг-арбитража по доходности и рискам — бесплатно, без карты и депозита.',
    ctaBtn: 'Запустить бесплатно',
    disc: '⚠️ Не является инвест-рекомендацией. Торговля крипто-деривативами сопряжена с риском потерь. Данные иллюстративные; проверяйте на бирже перед торговлей.',
    home: 'Главная',
    homeUrl: '/landing.ru.html',
    footerEmbed: 'Виджет',
    noData: 'Данные временно недоступны.',
    noOpp: 'Нет свежих возможностей — откройте приложение.',
  },
  tr: {
    openApp: 'Uygulamayı aç',
    liveTitle: 'Şu anki canlı fırsatlar',
    heroBtn: '🚀 En iyi spreadi ücretsiz bul',
    tgBtn: "Telegram'da aç",
    faqH: 'SSS',
    relatedH: 'İlgili',
    ctaH: "23 borsayı tek tıkla tara",
    ctaP: 'Tüm funding arbitraj fırsatlarını getiri ve riske göre sıralı görün — ücretsiz, kartsız, depozitosuz.',
    ctaBtn: 'Ücretsiz başlat',
    disc: '⚠️ Yatırım tavsiyesi değildir. Kripto türevleri kayıp riski taşır. Veriler gösterge niteliğindedir; işleme geçmeden borsada doğrulayın.',
    home: 'Ana sayfa',
    homeUrl: '/landing.tr.html',
    footerEmbed: 'Widget',
    noData: 'Canlı veri şu an mevcut değil.',
    noOpp: 'Bu pencerede taze fırsat yok — uygulamayı kontrol edin.',
  },
  vi: {
    openApp: 'Mở ứng dụng',
    liveTitle: 'Cơ hội đang live ngay bây giờ',
    heroBtn: '🚀 Tìm spread tốt nhất miễn phí',
    tgBtn: 'Mở trên Telegram',
    faqH: 'Câu hỏi thường gặp',
    relatedH: 'Liên quan',
    ctaH: 'Quét 23 sàn chỉ bằng một cú nhấp',
    ctaP: 'Xem mọi cơ hội arbitrage funding được xếp theo lợi nhuận và rủi ro — miễn phí, không cần thẻ, không cần nạp tiền.',
    ctaBtn: 'Bắt đầu miễn phí',
    disc: '⚠️ Không phải lời khuyên đầu tư. Phái sinh crypto có rủi ro mất vốn. Dữ liệu mang tính minh hoạ; xác nhận lại trên sàn trước khi giao dịch.',
    home: 'Trang chủ',
    homeUrl: '/landing.vi.html',
    footerEmbed: 'Widget',
    noData: 'Dữ liệu live hiện không khả dụng.',
    noOpp: 'Không có cơ hội mới — mở ứng dụng để xem.',
  },
  hi: {
    openApp: 'ऐप खोलें',
    liveTitle: 'अभी live अवसर',
    heroBtn: '🚀 मुफ्त में सबसे अच्छा स्प्रेड खोजें',
    tgBtn: 'Telegram पर खोलें',
    faqH: 'अक्सर पूछे जाने वाले सवाल',
    relatedH: 'संबंधित',
    ctaH: '23 exchanges को एक क्लिक में स्कैन करें',
    ctaP: 'हर funding arbitrage अवसर को yield और risk के अनुसार देखें — मुफ्त, बिना कार्ड, बिना deposit.',
    ctaBtn: 'मुफ्त शुरू करें',
    disc: '⚠️ निवेश सलाह नहीं। क्रिप्टो derivatives में नुकसान का जोखिम है। डेटा उदाहरणात्मक है; ट्रेडिंग से पहले exchange पर verify करें।',
    home: 'होम',
    homeUrl: '/landing.hi.html',
    footerEmbed: 'विजेट',
    noData: 'Live data अभी उपलब्ध नहीं है।',
    noOpp: 'इस window में कोई fresh अवसर नहीं — app खोलें।',
  },
  es: {
    openApp: 'Abrir app',
    liveTitle: 'Oportunidades en vivo ahora',
    heroBtn: '🚀 Encuentra el mejor spread gratis',
    tgBtn: 'Abrir en Telegram',
    faqH: 'Preguntas frecuentes',
    relatedH: 'Relacionado',
    ctaH: 'Escanea 23 exchanges con un clic',
    ctaP: 'Ve todas las oportunidades de arbitraje de funding ordenadas por rendimiento y riesgo — gratis, sin tarjeta, sin depósito.',
    ctaBtn: 'Empezar gratis',
    disc: '⚠️ No es asesoría financiera. Los derivados de crypto conllevan riesgo de pérdida. Los datos son ilustrativos; verifica en el exchange antes de operar.',
    home: 'Inicio',
    homeUrl: '/landing.es.html',
    footerEmbed: 'Widget',
    noData: 'Datos en vivo no disponibles ahora.',
    noOpp: 'No hay oportunidades frescas — abre la app.',
  },
};

// --- Keyword matrix ---------------------------------------------------------
const COINS = [
  { s: 'btc', n: 'Bitcoin', sym: 'BTC' },
  { s: 'eth', n: 'Ethereum', sym: 'ETH' },
  { s: 'sol', n: 'Solana', sym: 'SOL' },
  { s: 'xrp', n: 'XRP', sym: 'XRP' },
  { s: 'bnb', n: 'BNB', sym: 'BNB' },
  { s: 'doge', n: 'Dogecoin', sym: 'DOGE' },
  { s: 'ada', n: 'Cardano', sym: 'ADA' },
  { s: 'avax', n: 'Avalanche', sym: 'AVAX' },
  { s: 'link', n: 'Chainlink', sym: 'LINK' },
  { s: 'ton', n: 'Toncoin', sym: 'TON' },
  { s: 'sui', n: 'Sui', sym: 'SUI' },
  { s: 'pepe', n: 'Pepe', sym: 'PEPE' },
];

const EXCHANGES = [
  { s: 'binance', n: 'Binance' },
  { s: 'bybit', n: 'Bybit' },
  { s: 'okx', n: 'OKX' },
  { s: 'gate', n: 'Gate.io' },
  { s: 'mexc', n: 'MEXC' },
  { s: 'bitget', n: 'Bitget' },
  { s: 'hyperliquid', n: 'Hyperliquid' },
  { s: 'bingx', n: 'BingX' },
];

const PAIRS = [
  ['binance', 'bybit'], ['binance', 'okx'], ['binance', 'gate'], ['binance', 'mexc'],
  ['bybit', 'okx'], ['bybit', 'mexc'], ['bybit', 'bitget'], ['okx', 'gate'],
  ['okx', 'bitget'], ['gate', 'mexc'], ['binance', 'hyperliquid'], ['bybit', 'hyperliquid'],
];

const exName = (s) => (EXCHANGES.find((e) => e.s === s) || { n: s }).n;

// --- HTML template ----------------------------------------------------------
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Build hreflang <link> tags for all 6 language variants of a page.
function hreflangTags(basePath, langCode) {
  const tags = LANGS.map((l) => {
    const suffix = l.code === 'en' ? '' : `.${l.code}`;
    return `<link rel="alternate" hreflang="${l.code}" href="${SITE}${basePath}${suffix}" />`;
  }).join('\n');
  // x-default points to the EN variant (no suffix).
  return tags + `\n<link rel="alternate" hreflang="x-default" href="${SITE}${basePath}" />`;
}

function page({ url, basePath, lang, title, description, keywords, h1, intro, live, faqs, related, breadcrumb }) {
  const u = UI[lang];
  const faqLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
  };
  const crumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: breadcrumb.map((b, i) => ({ '@type': 'ListItem', position: i + 1, name: b.name, item: SITE + b.url })),
  };
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="theme-color" content="#3390ec" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}" />
<meta name="keywords" content="${esc(keywords)}" />
<link rel="canonical" href="${SITE}${url}" />
${hreflangTags(basePath, lang)}
<meta name="robots" content="index, follow, max-image-preview:large" />
<meta property="og:type" content="article" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(description)}" />
<meta property="og:url" content="${SITE}${url}" />
<meta property="og:image" content="${SITE}/icon.svg" />
<meta property="og:locale" content="${lang === 'en' ? 'en_US' : lang + '_' + lang.toUpperCase()}" />
<meta name="twitter:card" content="summary_large_image" />
<link rel="icon" type="image/svg+xml" href="/icon.svg" />
<style>
:root{--brand:#3390ec;--bg:#f4f6fb;--card:#fff;--text:#0f172a;--muted:#64748b;--dark:#0b1220;--line:#e8edf5;--green:#16a34a}
*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:var(--bg);color:var(--text);line-height:1.65}
a{color:var(--brand);text-decoration:none}.wrap{max-width:820px;margin:0 auto;padding:0 18px}
header{background:var(--dark);color:#fff;padding:14px 0}header .wrap{display:flex;align-items:center;justify-content:space-between}
.logo{font-weight:800}.logo span{color:var(--brand)}
.crumb{font-size:13px;color:var(--muted);padding:16px 0 0}.crumb a{color:var(--muted)}
h1{font-size:clamp(24px,5vw,34px);letter-spacing:-.02em;margin:12px 0 10px}
h2{font-size:22px;margin:28px 0 10px}p{margin:10px 0;color:#334155}
.hero{background:linear-gradient(180deg,#eaf3ff,var(--bg));padding:8px 0 24px}
.live{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:18px;margin:18px 0}
.live-h{font-weight:800;font-size:15px;display:flex;align-items:center;gap:8px;margin-bottom:12px}
.dot{width:9px;height:9px;border-radius:50%;background:#22c55e;animation:p 1.8s infinite}@keyframes p{0%{box-shadow:0 0 0 0 rgba(34,197,94,.5)}70%{box-shadow:0 0 0 8px rgba(34,197,94,0)}100%{box-shadow:0 0 0 0 rgba(34,197,94,0)}}
.opp{display:flex;justify-content:space-between;gap:10px;padding:10px 12px;border:1px solid var(--line);border-radius:10px;margin-bottom:8px}
.opp .pair{font-weight:800}.opp .route{font-size:12px;color:var(--muted)}.opp .apr{font-weight:800;color:var(--green);text-align:right}
.sk{height:44px;border-radius:10px;background:linear-gradient(90deg,#eef2f7,#f7fafc,#eef2f7);background-size:200% 100%;animation:s 1.2s infinite;margin-bottom:8px}@keyframes s{0%{background-position:200% 0}100%{background-position:-200% 0}}
.btn{display:inline-block;background:var(--brand);color:#fff;padding:13px 24px;border-radius:12px;font-weight:700;margin:6px 6px 6px 0}
.btn.g{background:#22c55e}
.cta{background:var(--dark);color:#fff;border-radius:16px;padding:24px;text-align:center;margin:26px 0}
.cta h2{color:#fff;margin-top:0}.cta p{color:#cbd5e1}
.rel{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0}
.rel a{background:var(--card);border:1px solid var(--line);border-radius:999px;padding:7px 14px;font-size:13px;font-weight:600}
.faq details{background:var(--card);border:1px solid var(--line);border-radius:12px;margin-bottom:10px}
.faq summary{padding:14px 16px;font-weight:700;cursor:pointer;list-style:none;display:flex;justify-content:space-between}
.faq summary::-webkit-details-marker{display:none}.faq summary::after{content:"+";color:var(--brand);font-weight:800}
.faq details[open] summary::after{content:"−"}.faq p{padding:0 16px 14px;color:var(--muted)}
.disc{font-size:12px;color:var(--muted);text-align:center;margin:22px 0}
footer{text-align:center;color:var(--muted);font-size:13px;padding:26px 0;border-top:1px solid var(--line)}
.lang-bar{display:flex;gap:8px;justify-content:center;margin:8px 0}
.lang-bar a{font-size:12px;padding:3px 8px;border-radius:6px;background:var(--card);border:1px solid var(--line);font-weight:600}
.lang-bar a.active{background:var(--brand);color:#fff;border-color:var(--brand)}
</style>
<script type="application/ld+json">${JSON.stringify(faqLd)}</script>
<script type="application/ld+json">${JSON.stringify(crumbLd)}</script>
</head>
<body>
<header><div class="wrap"><a class="logo" href="${u.homeUrl}">Funding<span>Finder</span></a><a class="btn" style="margin:0;padding:9px 16px;font-size:13px" href="/?app=1&utm_source=seo&utm_medium=header">${esc(u.openApp)}</a></div></header>
<div class="hero"><div class="wrap">
<div class="crumb">${breadcrumb.map((b, i) => (i < breadcrumb.length - 1 ? `<a href="${b.url}">${esc(b.name)}</a> › ` : esc(b.name))).join('')}</div>
<h1>${esc(h1)}</h1>
${intro}
<div class="live" data-live='${esc(JSON.stringify(live))}'>
<div class="live-h"><span class="dot"></span> ${esc(u.liveTitle)}</div>
<div data-el="body"><div class="sk"></div><div class="sk"></div><div class="sk"></div></div>
</div>
<a class="btn g" href="/?app=1&utm_source=seo&utm_medium=hero">${esc(u.heroBtn)}</a>
<a class="btn" href="${BOT}" target="_blank" rel="noopener">${esc(u.tgBtn)}</a>
</div></div>
<div class="wrap">
${faqs.length ? `<h2>${esc(u.faqH)}</h2><div class="faq">${faqs.map((f) => `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('')}</div>` : ''}
${related.length ? `<h2>${esc(u.relatedH)}</h2><div class="rel">${related.map((r) => `<a href="${r.url}">${esc(r.name)}</a>`).join('')}</div>` : ''}
<div class="cta"><h2>${esc(u.ctaH)}</h2><p>${esc(u.ctaP)}</p><a class="btn g" href="/?app=1&utm_source=seo&utm_medium=cta">${esc(u.ctaBtn)}</a></div>
<p class="disc">${esc(u.disc)}</p>
<div class="lang-bar">${LANGS.map((l) => {
  const suffix = l.code === 'en' ? '' : `.${l.code}`;
  const isActive = l.code === lang;
  return `<a href="${basePath}${suffix}" class="${isActive ? 'active' : ''}">${l.label}</a>`;
}).join('')}</div>
</div>
<footer><div class="wrap">Funding Finder • <a href="${u.homeUrl}">${esc(u.home)}</a> • <a href="${BOT}">Telegram</a> • <a href="/embed.html">${esc(u.footerEmbed)}</a></div></footer>
<script>
(function(){
  var API=${JSON.stringify(API)};
  try{
    var ss=localStorage.getItem('ff_analytics_session');
    if(!ss){ss='s_'+Math.random().toString(36).slice(2)+Date.now().toString(36);localStorage.setItem('ff_analytics_session',ss);}
    fetch(API+'/api/public/track',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({event:'landing_view',source:'seo',variant:localStorage.getItem('ff_ab_variant')||undefined,sessionId:ss,meta:{page:location.pathname,lang:'${lang}'}}),keepalive:true}).catch(function(){});
  }catch(e){}
  var el=document.querySelector('.live'); if(!el) return;
  var cfg={}; try{cfg=JSON.parse(el.getAttribute('data-live'))}catch(e){}
  var body=el.querySelector('[data-el="body"]');
  function pct(v){return (v==null||isNaN(v))?'—':(v*100).toFixed(3)+'%'}
  function match(o){
    if(cfg.coin){return (o.pair||'').toUpperCase().indexOf(cfg.coin)===0}
    if(cfg.exchange){return o.exchangeA===cfg.exchange||o.exchangeB===cfg.exchange}
    if(cfg.a&&cfg.b){var s=[o.exchangeA,o.exchangeB];return s.indexOf(cfg.a)!==-1&&s.indexOf(cfg.b)!==-1}
    return true;
  }
  fetch(API+'/api/public/arbitrage',{cache:'no-store'}).then(function(r){return r.json()}).then(function(d){
    if(!d||!d.ok){body.innerHTML='<div style="color:#64748b;font-size:13px">${esc(u.noData)}</div>';return}
    var opps=(d.opportunities||[]).filter(match).slice(0,5);
    if(!opps.length)opps=(d.opportunities||[]).slice(0,3);
    if(!opps.length){body.innerHTML='<div style="color:#64748b;font-size:13px">${esc(u.noOpp)}</div>';return}
    body.innerHTML=opps.map(function(o){return '<div class="opp"><div><div class="pair">'+o.pair+'</div><div class="route">'+(o.opportunity||(o.exchangeA+' ↔ '+o.exchangeB))+'</div></div><div class="apr">up to '+pct(o.annualReturn)+'/yr</div></div>'}).join('');
  }).catch(function(){body.innerHTML='<div style="color:#64748b;font-size:13px">${esc(u.noData)}</div>'});
})();
</script>
</body>
</html>`;
}

// --- Builders ---------------------------------------------------------------
const urls = [];     // all generated page URLs for sitemap
const emitted = {}; // basePath → [lang, ...] for hreflang cross-linking

function emit(relPath, html, priority) {
  const full = join(DIST, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, html, 'utf8');
  urls.push({ loc: SITE + '/' + relPath.replace(/\.html$/, ''), priority });
}

// Emit a page in all 6 languages. The EN variant has no suffix (clean URL).
function emitMultilang(basePath, contentFn, priority) {
  emitted[basePath] = [];
  for (const lang of LANGS) {
    const suffix = lang.code === 'en' ? '' : `.${lang.code}`;
    const ext = lang.code === 'en' ? '.html' : `.${lang.code}.html`;
    const url = basePath + suffix;
    const content = contentFn(lang.code);
    const relPath = basePath.slice(1) + ext; // strip leading /
    emit(relPath, page({ ...content, url, basePath, lang: lang.code }), priority);
    emitted[basePath].push(lang.code);
  }
}

// --- Coin pages -------------------------------------------------------------
for (const c of COINS) {
  const basePath = `/funding/${c.s}`;
  emitMultilang(basePath, (lang) => ({
    title: `${c.sym} funding rate — live rates & arbitrage across 23 exchanges | Funding Finder`,
    description: `Live ${c.n} (${c.sym}) perpetual funding rates across Binance, Bybit, OKX and 20 more exchanges. Find the best ${c.sym} funding arbitrage and earn market-neutral yield.`,
    keywords: `${c.sym} funding rate, ${c.n} funding rate, ${c.sym} funding arbitrage, ${c.sym} perpetual funding, ${c.sym} funding binance bybit`,
    h1: `${c.n} (${c.sym}) funding rates & arbitrage`,
    intro: `<p>Track the ${c.n} <strong>${c.sym}USDT perpetual funding rate</strong> across all 23 exchanges we aggregate. When the rate differs between venues, you can capture the spread market-neutrally — long on the low/negative-funding exchange, short on the high one. Below are the best live ${c.sym} opportunities right now.</p>`,
    live: { coin: c.sym },
    faqs: [
      { q: `What is the ${c.sym} funding rate?`, a: `The ${c.sym} funding rate is a periodic payment exchanged between longs and shorts on ${c.sym} perpetual futures. A positive rate means longs pay shorts; negative means shorts pay longs. Funding Finder shows the live ${c.sym} rate on every major exchange.` },
      { q: `How do I arbitrage ${c.sym} funding?`, a: `Open a long on the exchange with the lowest (or most negative) ${c.sym} funding and a short on the exchange with the highest, in equal size. You stay delta-neutral and collect the funding difference each interval.` },
      { q: `Which exchange has the best ${c.sym} funding rate?`, a: `It changes constantly. Funding Finder compares ${c.sym} funding across Binance, Bybit, OKX, Gate, MEXC, Bitget, Hyperliquid and 16 more in real time so you always see the best one.` },
    ],
    related: [
      ...COINS.filter((x) => x.s !== c.s).slice(0, 5).map((x) => ({ url: `/funding/${x.s}`, name: `${x.sym} funding` })),
      { url: '/arbitrage/binance-vs-bybit', name: 'Binance vs Bybit' },
    ],
    breadcrumb: [{ name: UI[lang].home, url: UI[lang].homeUrl }, { name: 'Funding', url: '/funding/btc' }, { name: `${c.sym}`, url: basePath }],
  }), '0.7');
}

// --- Exchange pages ---------------------------------------------------------
for (const e of EXCHANGES) {
  const basePath = `/exchange/${e.s}`;
  emitMultilang(basePath, (lang) => ({
    title: `${e.n} funding rates — live & compared to 22 other exchanges | Funding Finder`,
    description: `Live ${e.n} perpetual funding rates, compared against 22 other exchanges. Find where ${e.n} funding is mispriced and capture cross-exchange arbitrage.`,
    keywords: `${e.n} funding rate, ${e.n} funding, ${e.n} perpetual funding, ${e.n} arbitrage, ${e.n} vs binance funding`,
    h1: `${e.n} funding rates & cross-exchange arbitrage`,
    intro: `<p>See ${e.n}'s live perpetual <strong>funding rates</strong> side by side with 22 other exchanges. The biggest opportunities appear when ${e.n}'s funding diverges from the rest of the market — Funding Finder surfaces those spreads automatically. Live ${e.n} opportunities below.</p>`,
    live: { exchange: e.s },
    faqs: [
      { q: `How often does ${e.n} pay funding?`, a: `Most ${e.n} perpetuals settle funding every 8 hours, though some pairs use 1h or 4h intervals. Funding Finder normalizes intervals so you compare true annualized yield across exchanges.` },
      { q: `Is ${e.n} funding arbitrage profitable?`, a: `It can be, when ${e.n}'s funding differs enough from another exchange to cover fees and slippage. Funding Finder computes net profit after costs so you only act on real edges.` },
      { q: `Can I connect ${e.n} to Funding Finder?`, a: `Yes. You can add read-first ${e.n} API keys (encrypted at rest) for live PnL and optional auto-execution on Pro.` },
    ],
    related: [
      ...EXCHANGES.filter((x) => x.s !== e.s).slice(0, 5).map((x) => ({ url: `/exchange/${x.s}`, name: x.n })),
      { url: '/funding/btc', name: 'BTC funding' },
    ],
    breadcrumb: [{ name: UI[lang].home, url: UI[lang].homeUrl }, { name: 'Exchanges', url: '/exchange/binance' }, { name: e.n, url: basePath }],
  }), '0.7');
}

// --- Exchange-pair arbitrage pages ------------------------------------------
for (const [a, b] of PAIRS) {
  const basePath = `/arbitrage/${a}-vs-${b}`;
  const A = exName(a), B = exName(b);
  emitMultilang(basePath, (lang) => ({
    title: `${A} vs ${B} funding arbitrage — live spreads | Funding Finder`,
    description: `Live funding rate arbitrage between ${A} and ${B}. See where the ${A}/${B} funding spread is widest and earn market-neutral yield.`,
    keywords: `${A} vs ${B} funding, ${A} ${B} arbitrage, funding arbitrage ${A} ${B}, ${A} ${B} funding spread`,
    h1: `${A} vs ${B} funding arbitrage`,
    intro: `<p>The <strong>${A} ↔ ${B}</strong> funding spread is one of the most-traded cross-exchange arbitrages. When ${A}'s funding is higher than ${B}'s (or vice-versa), you short the high-funding side and long the low-funding side to pocket the difference while staying delta-neutral. Live ${A}/${B} spreads below.</p>`,
    live: { a, b },
    faqs: [
      { q: `How does ${A} vs ${B} funding arbitrage work?`, a: `You open opposite, equal-sized positions: long the exchange with lower funding, short the one with higher funding. Your directional exposure cancels out and you collect the funding difference each interval.` },
      { q: `What are the risks of ${A}/${B} arbitrage?`, a: `Main risks are execution/slippage, funding flipping before you exit, and withdrawal/latency between ${A} and ${B}. Funding Finder shows net profit after fees and a risk score for each spread.` },
      { q: `How much can I earn on the ${A}/${B} spread?`, a: `It depends on the live spread and your capital. Use the free scanner to see the current annualized yield for ${A} vs ${B} in real time.` },
    ],
    related: [
      ...PAIRS.filter(([x, y]) => !(x === a && y === b)).slice(0, 5).map(([x, y]) => ({ url: `/arbitrage/${x}-vs-${y}`, name: `${exName(x)} vs ${exName(y)}` })),
      { url: `/exchange/${a}`, name: `${A} funding` },
    ],
    breadcrumb: [{ name: UI[lang].home, url: UI[lang].homeUrl }, { name: 'Arbitrage', url: '/arbitrage/binance-vs-bybit' }, { name: `${A} vs ${B}`, url: basePath }],
  }), '0.6');
}

// --- Sitemap (landings + all SEO pages) -------------------------------------
const staticUrls = [
  { loc: SITE + '/landing.html', priority: '1.0', freq: 'daily' },
  { loc: SITE + '/landing.ru.html', priority: '0.9', freq: 'weekly' },
  { loc: SITE + '/landing.tr.html', priority: '0.8', freq: 'weekly' },
  { loc: SITE + '/landing.es.html', priority: '0.7', freq: 'weekly' },
  { loc: SITE + '/landing.vi.html', priority: '0.7', freq: 'weekly' },
  { loc: SITE + '/landing.hi.html', priority: '0.7', freq: 'weekly' },
  { loc: SITE + '/embed.html', priority: '0.6', freq: 'monthly' },
];
const sitemap =
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  staticUrls.map((u) => `  <url><loc>${u.loc}</loc><changefreq>${u.freq}</changefreq><priority>${u.priority}</priority></url>`).join('\n') +
  '\n' +
  urls.map((u) => `  <url><loc>${u.loc}</loc><changefreq>weekly</changefreq><priority>${u.priority}</priority></url>`).join('\n') +
  `\n</urlset>\n`;
writeFileSync(join(DIST, 'sitemap.xml'), sitemap, 'utf8');

console.log(`[gen-seo] Generated ${urls.length} SEO pages (${Object.keys(emitted).length} topics × ${LANGS.length} languages) + sitemap (${urls.length + staticUrls.length} urls).`);
