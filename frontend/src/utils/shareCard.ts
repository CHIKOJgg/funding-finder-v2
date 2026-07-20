// Client-side share-card generator (no backend deps). Renders a branded
// "best funding opportunities" card to a canvas and returns a PNG Blob so it
// can be shared via navigator.share (mobile) or downloaded. This is the
// viral hook: users post a real, fresh arbitrage snapshot to Twitter/TG/IG.

export interface ShareOpportunity {
  pair: string;
  exchangeA: string;
  exchangeB: string;
  annualReturn?: number;
  rate?: number;
}

export type ShareLang = 'ru' | 'en' | 'tr' | 'vi' | 'hi' | 'es';

interface ShareCopy {
  subtitle: string;
  perYear: (v: string) => string;
  from: (u: string) => string;
  tagline: string;
  shareText: string;
}

const SITE_URL = 'https://funding-finder-frontend.onrender.com';

// Language-aware copy so a shared card matches the user's UI language and
// reaches the widest audience. Falls back to English.
const COPY: Record<ShareLang, ShareCopy> = {
  en: {
    subtitle: 'Where funding pays the most right now',
    perYear: (v) => `up to ${v}/yr`,
    from: (u) => `by ${u}`,
    tagline: '23 exchanges · Live arbitrage',
    shareText: 'Best funding rates across 23 exchanges right now — Funding Finder',
  },
  ru: {
    subtitle: 'Где фандинг сейчас самый выгодный',
    perYear: (v) => `до ${v}/год`,
    from: (u) => `от ${u}`,
    tagline: '23 биржи · Live arbitrage',
    shareText: 'Лучший фандинг на 23 биржах прямо сейчас — Funding Finder',
  },
  tr: {
    subtitle: 'Funding su an nerede en cok oduyor',
    perYear: (v) => `y/y ${v}'e kadar`,
    from: (u) => `${u} tarafindan`,
    tagline: '23 borsa · Canli arbitraj',
    shareText: 'Su an 23 borsada en iyi funding oranlari — Funding Finder',
  },
  vi: {
    subtitle: 'Funding dang tra cao nhat o dau',
    perYear: (v) => `toi ${v}/nam`,
    from: (u) => `boi ${u}`,
    tagline: '23 san · Arbitrage truc tiep',
    shareText: 'Funding tot nhat tren 23 san ngay bay gio — Funding Finder',
  },
  hi: {
    subtitle: 'Funding abhi kahan sabse zyada de raha hai',
    perYear: (v) => `${v}/saal tak`,
    from: (u) => `${u} dwara`,
    tagline: '23 exchanges · Live arbitrage',
    shareText: '23 exchanges par abhi best funding rates — Funding Finder',
  },
  es: {
    subtitle: 'Donde el funding paga mas ahora',
    perYear: (v) => `hasta ${v}/ano`,
    from: (u) => `por ${u}`,
    tagline: '23 exchanges · Arbitraje en vivo',
    shareText: 'Las mejores tasas de funding en 23 exchanges ahora — Funding Finder',
  },
};

function copyFor(lang?: string): ShareCopy {
  return COPY[(lang as ShareLang)] || COPY.en;
}

const BRAND = '#3390ec';
const DARK = '#0f172a';
const GREEN = '#22c55e';
const WHITE = '#ffffff';
const MUTED = '#94a3b8';

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function buildShareCard(opps: ShareOpportunity[], opts?: { username?: string; lang?: string }): HTMLCanvasElement {
  const copy = copyFor(opts?.lang);
  const W = 1200;
  const rows = Math.min(opps.length, 5);
  const H = 630 + Math.max(0, rows - 3) * 90;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  // Background
  ctx.fillStyle = DARK;
  ctx.fillRect(0, 0, W, H);

  // Header
  ctx.fillStyle = BRAND;
  ctx.font = '800 44px sans-serif';
  ctx.fillText('Funding Finder', 60, 80);
  ctx.fillStyle = WHITE;
  ctx.font = '600 30px sans-serif';
  ctx.fillText(copy.subtitle, 60, 124);

  // Divider
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(60, 160);
  ctx.lineTo(W - 60, 160);
  ctx.stroke();

  // Opportunity rows
  let y = 210;
  for (let i = 0; i < rows; i++) {
    const o = opps[i];
    const rowH = 92;
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    roundRect(ctx, 60, y, W - 120, rowH - 16, 16);
    ctx.fill();

    ctx.fillStyle = WHITE;
    ctx.font = '700 34px sans-serif';
    ctx.fillText(o.pair, 90, y + 42);

    ctx.fillStyle = MUTED;
    ctx.font = '500 24px sans-serif';
    ctx.fillText(`${o.exchangeA} ↔ ${o.exchangeB}`, 90, y + 74);

    // Annual return (right)
    const annual = o.annualReturn ?? 0;
    ctx.fillStyle = GREEN;
    ctx.font = '800 38px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(copy.perYear(`${(annual * 100).toFixed(1)}%`), W - 90, y + 56);
    ctx.textAlign = 'left';

    y += rowH;
  }

  // Footer: brand handle + the site URL so the card is self-promoting even
  // when reshared as a bare image (viral attribution / SEO awareness).
  ctx.fillStyle = BRAND;
  ctx.font = '700 26px sans-serif';
  ctx.fillText('@fundinganalyzerbot', 60, H - 40);
  ctx.fillStyle = MUTED;
  ctx.font = '500 22px sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(opts?.username ? copy.from(opts.username) : copy.tagline, W - 60, H - 40);
  ctx.textAlign = 'left';

  return canvas;
}

export async function shareCardAsImage(opps: ShareOpportunity[], opts?: { username?: string; lang?: string }): Promise<void> {
  const copy = copyFor(opts?.lang);
  const canvas = buildShareCard(opps, opts);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) return;

  const file = new File([blob], 'funding-finder.png', { type: 'image/png' });
  const text = `${copy.shareText}\n${SITE_URL}`;

  // Prefer native share with the image (mobile: posts image to TG/Twitter).
  if (navigator.share && (navigator as any).canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text, title: 'Funding Finder' });
      return;
    } catch {
      /* user cancelled — fall through to download */
    }
  }

  // Fallback: download so the user can attach it manually.
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'funding-finder.png';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
