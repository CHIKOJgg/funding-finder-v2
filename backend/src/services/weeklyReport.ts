import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { sendTelegramMessage } from './telegramNotify.js';
import { detectArbitrageOpportunities } from './arbitrageService.js';
import { getCachedScan, runScan } from './scanService.js';
import { getWarmupPromise } from './fundingWarmup.js';
import { SUPPORTED_EXCHANGES } from '../exchanges/index.js';
import { computeTrackRecord } from './trackRecordService.js';
import { sendWeeklyReportEmail, runWinbackEmails } from './emailNotify.js';
import { prisma } from './prisma.js';

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

let weeklyTimer: ReturnType<typeof setTimeout> | null = null;
let winbackTimer: ReturnType<typeof setTimeout> | null = null;
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
  // annualReturn is ALREADY a percentage (e.g. 15 = 15%/yr). Multiplying by
  // 100 here previously posted "1500%/год" to the public channel.
  if (v == null || isNaN(v)) return '—';
  return `${v.toFixed(0)}%`;
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

  // Newsletter broadcast: email the same report to waitlist subscribers who
  // left an email. Idempotent per calendar day via lastWeeklyYmd so a re-run
  // never double-sends. Best-effort; failures are logged, never fatal.
  await broadcastWeeklyReportEmail(report).catch((e) =>
    logger.warn({ err: (e as Error).message }, 'Weekly report email broadcast failed')
  );

  return ok;
}

// Email the weekly report to every waitlist entry that has an email address
// and hasn't been sent today. Throttled in-process (1 email / 120ms) so we
// don't hammer the SMTP relay; for very large lists this should move to the
// job queue, but the waitlist is small today.
async function broadcastWeeklyReportEmail(report: WeeklyReport): Promise<void> {
  const mskDate = new Date(Date.now() + 3 * 60 * 60 * 1000);
  const ymd = `${mskDate.getUTCFullYear()}-${mskDate.getUTCMonth() + 1}-${mskDate.getUTCDate()}`;

  const recipients = await prisma.waitlist.findMany({
    where: {
      email: { not: null },
      OR: [{ lastWeeklyYmd: null }, { lastWeeklyYmd: { not: ymd } }],
    },
    select: { id: true, email: true, lang: true },
  });
  if (recipients.length === 0) return;

  logger.info(`Weekly report: broadcasting to ${recipients.length} waitlist emails`);
  for (const r of recipients) {
    const sent = await sendWeeklyReportEmail(r.email as string, report, r.lang);
    await prisma.waitlist.update({
      where: { id: r.id },
      data: { lastWeeklyYmd: ymd },
    }).catch(() => {});
    if (sent) {
      logger.info(`Weekly report emailed to waitlist ${r.id}`);
    }
    await new Promise((res) => setTimeout(res, 120));
  }
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

  const POST_HOUR_UTC = 9; // 12:00 MSK = 09:00 UTC
  const WINBACK_HOUR_UTC = 7; // 10:00 MSK = 07:00 UTC
  let lastWinbackYmd = '';

  // Phase-independent scheduling: instead of an hourly setInterval that must
  // happen to land inside the target hour (a restart at 12:10 MSK silently
  // skipped the week before), every run re-arms a setTimeout for the exact
  // next target time and catches up on boot if the window already passed.
  const scheduleAt = (targetUtc: number, run: () => Promise<void> | void, label: string) => {
    const now = new Date();
    const next = new Date(now);
    next.setUTCHours(targetUtc, 0, 0, 0);
    if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
    const delay = Math.min(next.getTime() - now.getTime() + 500, 24 * 60 * 60 * 1000);
    const handle = setTimeout(() => {
      Promise.resolve(run())
        .catch((e) => logger.warn({ err: (e as Error).message }, `${label} run failed`))
        .finally(() => scheduleAt(targetUtc, run, label));
    }, delay);
    if (label === 'Weekly report') weeklyTimer = handle;
    else if (label === 'Winback emails') winbackTimer = handle;
  };

  const tryWeeklyPost = async () => {
    const mskDate = new Date(Date.now() + 3 * 60 * 60 * 1000);
    const ymd = `${mskDate.getUTCFullYear()}-${mskDate.getUTCMonth() + 1}-${mskDate.getUTCDate()}`;
    // Post when it's Monday MSK and at/after 12:00 MSK, once per day. This
    // covers both the exact-hour tick and a late start after a restart.
    if (mskDate.getUTCDay() === POST_WEEKDAY && new Date().getUTCHours() >= POST_HOUR_UTC && ymd !== lastPostedYmd) {
      const ok = await postWeeklyReport();
      // Mark only on success so a failed post is retried by the next tick.
      if (ok) lastPostedYmd = ymd;
    }
  };

  const tryWinback = async () => {
    const mskDate = new Date(Date.now() + 3 * 60 * 60 * 1000);
    const ymd = `${mskDate.getUTCFullYear()}-${mskDate.getUTCMonth() + 1}-${mskDate.getUTCDate()}`;
    if (new Date().getUTCHours() >= WINBACK_HOUR_UTC && ymd !== lastWinbackYmd) {
      lastWinbackYmd = ymd;
      const n = await runWinbackEmails();
      if (n) logger.info(`Winback emails sent: ${n}`);
    }
  };

  scheduleAt(POST_HOUR_UTC, tryWeeklyPost, 'Weekly report');
  scheduleAt(WINBACK_HOUR_UTC, tryWinback, 'Winback emails');

  // Catch up on boot: if the process restarted after the target hour, run the
  // idempotent attempts immediately instead of skipping to next week/day.
  void tryWeeklyPost().catch((e) => logger.warn({ err: (e as Error).message }, 'Weekly report catch-up failed'));
  void tryWinback().catch((e) => logger.warn({ err: (e as Error).message }, 'Winback catch-up failed'));
}

export function stopWeeklyReport(): void {
  if (weeklyTimer) {
    clearTimeout(weeklyTimer);
    weeklyTimer = null;
  }
  if (winbackTimer) {
    clearTimeout(winbackTimer);
    winbackTimer = null;
  }
}
