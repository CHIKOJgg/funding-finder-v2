import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { sendTelegramMessage } from './telegramNotify.js';
import { detectArbitrageOpportunities } from './arbitrageService.js';
import { getCachedScan, runScan } from './scanService.js';
import { getWarmupPromise } from './fundingWarmup.js';
import { SUPPORTED_EXCHANGES } from '../exchanges/index.js';
import { computeTrackRecord } from './trackRecordService.js';

// Weekly Funding Report — a content engine for organic, zero-ad-spend growth.
//
// Once a week we compute a digest (illustrative weekly backtest + the current
// top live spreads) and publish it to the public Telegram channel. It is also
// exposed as JSON at /api/public/weekly-report so the landing page and the
// email newsletter can reuse the exact same numbers.
//
// This complements publicSignalChannel (which posts single opportunities every
// 30 min): the weekly report is the shareable "state of funding this week" post
// that people forward, screenshot and subscribe for.

const POST_HOUR_MSK = 12; // 12:00 MSK
const POST_WEEKDAY = 1; // Monday (0 = Sunday)
const CACHE_TTL_MS = 30 * 60 * 1000;

let weeklyTimer: ReturnType<typeof setInterval> | null = null;
let lastPostedYmd = '';
let cache: { payload: WeeklyReport; ts: number } | null = null;

export interface WeeklyReport {
  available: boolean;
  generatedAt: number;
  windowDays: number;
  exchangesTracked: number;
  pairsAnalyzed: number;
  bestPair: { pair: string; annualizedPct: number } | null;
  diversifiedAnnualizedPct: number | null;
  topLive: Array<{
    pair: string;
    exchangeA: string;
    exchangeB: string;
    annualReturn: number | null;
    riskLevel: string | null;
  }>;
}

async function getTopLive(limit = 5): Promise<WeeklyReport['topLive']> {
  let scan = getCachedScan(SUPPORTED_EXCHANGES);
  if (!scan) {
    const warm = getWarmupPromise();
    if (warm) {
      try {
        await warm;
        scan = getCachedScan(SUPPORTED_EXCHANGES);
      } catch { /* ignore */ }
    }
  }
  if (!scan) {
    try {
      const result = await runScan(SUPPORTED_EXCHANGES);
      scan = { result, ts: Date.now(), ageMs: 0 };
    } catch (e) {
      logger.warn({ err: (e as Error).message }, 'Weekly report: scan failed');
      return [];
    }
  }
  const all = [...scan.result.highYield, ...scan.result.mediumYield, ...scan.result.lowYield];
  return detectArbitrageOpportunities(all)
    .slice(0, limit)
    .map((o: any) => ({
      pair: o.pair,
      exchangeA: o.exchangeA,
      exchangeB: o.exchangeB,
      annualReturn: o.profit?.annualReturn ?? null,
      riskLevel: o.risk?.level ?? null,
    }));
}

export async function computeWeeklyReport(force = false): Promise<WeeklyReport> {
  if (!force && cache && Date.now() - cache.ts < CACHE_TTL_MS) {
    return cache.payload;
  }

  const [rec, topLive] = await Promise.all([
    computeTrackRecord().catch(() => null as any),
    getTopLive(5),
  ]);

  const payload: WeeklyReport = {
    available: Boolean((rec && rec.available) || topLive.length),
    generatedAt: Date.now(),
    windowDays: rec?.windowDays ?? 7,
    exchangesTracked: SUPPORTED_EXCHANGES.length,
    pairsAnalyzed: rec?.pairsAnalyzed ?? 0,
    bestPair: rec?.bestPair
      ? { pair: rec.bestPair.pair, annualizedPct: rec.bestPair.annualizedPct }
      : null,
    diversifiedAnnualizedPct: rec?.diversified ? rec.diversified.annualizedPct : null,
    topLive,
  };

  cache = { payload, ts: Date.now() };
  return payload;
}

function pct(v: number | null | undefined, digits = 0): string {
  if (v == null || isNaN(v)) return '—';
  return `${v.toFixed(digits)}%`;
}

function fmtApr(v: number | null): string {
  if (v == null || isNaN(v)) return '—';
  return `${(v * 100).toFixed(0)}%`;
}

function formatMessage(r: WeeklyReport): string {
  const lines: string[] = [
    `📊 <b>Weekly Funding Report</b>`,
    `<i>Ставки финансирования ${r.exchangesTracked} бирж за неделю</i>`,
    ``,
  ];

  if (r.bestPair) {
    lines.push(`🏆 Лучшая пара: <b>${r.bestPair.pair}</b> — до ${pct(r.bestPair.annualizedPct)}/год`);
  }
  if (r.diversifiedAnnualizedPct != null) {
    lines.push(`🧺 Диверсиф. портфель: ~${pct(r.diversifiedAnnualizedPct)}/год`);
  }
  if (r.pairsAnalyzed) {
    lines.push(`🔎 Проанализировано пар: ${r.pairsAnalyzed}`);
  }

  if (r.topLive.length) {
    lines.push(``, `🔥 <b>Топ-спреды прямо сейчас:</b>`);
    r.topLive.forEach((o, i) => {
      lines.push(`${i + 1}. ${o.pair} — ${o.exchangeA} ↔ ${o.exchangeB} · до ${fmtApr(o.annualReturn)}/год`);
    });
  }

  lines.push(
    ``,
    `⚠️ Иллюстративно, рыночно-нейтрально. Не инвест-рекомендация.`,
    `Лови такие спреды первым 👇`,
  );

  return lines.join('\n');
}

export async function postWeeklyReport(force = false): Promise<boolean> {
  const channel = config.telegram.publicSignalChannel;
  if (!channel) return false;

  const report = await computeWeeklyReport(force);
  if (!report.available) {
    logger.info('Weekly report: not enough data to post');
    return false;
  }

  const replyMarkup = config.ai.appUrl
    ? {
        inline_keyboard: [
          [{ text: '🚀 Открыть Funding Finder', url: `${config.ai.appUrl}/?utm_source=weekly&utm_medium=telegram` }],
          [{ text: '🎁 7 дней Pro бесплатно', url: `${config.ai.appUrl}/?plan=pro&utm_source=weekly` }],
        ],
      }
    : undefined;

  const ok = await sendTelegramMessage({
    chatId: channel,
    text: formatMessage(report),
    parseMode: 'HTML',
    disableNotification: false,
    replyMarkup,
  });

  if (ok) {
    logger.info({ channel }, 'Weekly report: posted');
  }
  return ok;
}

export function startWeeklyReport(): void {
  if (!config.telegram.publicSignalChannel) {
    logger.info('Weekly report disabled (PUBLIC_SIGNAL_CHANNEL not set)');
    return;
  }
  if (!config.telegram.botToken) {
    logger.warn('Weekly report disabled: TELEGRAM_BOT_TOKEN missing');
    return;
  }
  logger.info(`Weekly report enabled → Mondays ${POST_HOUR_MSK}:00 MSK`);

  // Check hourly; post once on the target weekday+hour (idempotent per day).
  weeklyTimer = setInterval(() => {
    const now = new Date();
    const mskHour = (now.getUTCHours() + 3) % 24;
    // Weekday in MSK (adding 3h can roll the day over).
    const mskDate = new Date(now.getTime() + 3 * 60 * 60 * 1000);
    const weekday = mskDate.getUTCDay();
    const ymd = `${mskDate.getUTCFullYear()}-${mskDate.getUTCMonth() + 1}-${mskDate.getUTCDate()}`;

    if (weekday === POST_WEEKDAY && mskHour === POST_HOUR_MSK && ymd !== lastPostedYmd) {
      lastPostedYmd = ymd;
      void postWeeklyReport();
    }
  }, 60 * 60 * 1000);
}

export function stopWeeklyReport(): void {
  if (weeklyTimer) {
    clearInterval(weeklyTimer);
    weeklyTimer = null;
  }
}
