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

export function buildShareCard(opps: ShareOpportunity[], opts?: { username?: string }): HTMLCanvasElement {
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
  ctx.fillText('Где фандинг сейчас самый выгодный', 60, 124);

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
    ctx.fillText(`до ${(annual * 100).toFixed(1)}%/год`, W - 90, y + 56);
    ctx.textAlign = 'left';

    y += rowH;
  }

  // Footer
  ctx.fillStyle = BRAND;
  ctx.font = '700 26px sans-serif';
  ctx.fillText('@FundingFinderBot', 60, H - 40);
  ctx.fillStyle = MUTED;
  ctx.font = '500 22px sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(opts?.username ? `от ${opts.username}` : '23 биржи · Live arbitrage', W - 60, H - 40);
  ctx.textAlign = 'left';

  return canvas;
}

export async function shareCardAsImage(opps: ShareOpportunity[], opts?: { username?: string }): Promise<void> {
  const canvas = buildShareCard(opps, opts);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) return;

  const file = new File([blob], 'funding-finder.png', { type: 'image/png' });
  const text = 'Лучший фандинг на 23 биржах прямо сейчас — Funding Finder';

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
