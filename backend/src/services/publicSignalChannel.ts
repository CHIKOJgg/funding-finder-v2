import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { sendTelegramMessage } from './telegramNotify.js';
import { detectArbitrageOpportunities } from './arbitrageService.js';
import { getCachedScan, runScan } from './scanService.js';
import { getWarmupPromise } from './fundingWarmup.js';
import { SUPPORTED_EXCHANGES } from '../exchanges/index.js';

// Organic growth engine: every POST_INTERVAL_MS the bot posts the single best
// live arbitrage opportunity to a PUBLIC Telegram channel (configured via
// PUBLIC_SIGNAL_CHANNEL). This is the top-of-funnel for the "sell without
// ad spend" strategy — strangers discover the product for free, see real value,
// and click through to the Mini App. No-op when the channel is not configured.
//
// A per-opportunity cooldown prevents spamming the same spread repeatedly.

const POST_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const OPP_COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4h per opportunity key

let timer: ReturnType<typeof setInterval> | null = null;
let lastPostedKey = '';
let lastPostedAt = 0;

function opportunityKey(pair: string, exchangeA: string, exchangeB: string): string {
  return `${pair}|${[exchangeA, exchangeB].sort().join('|')}`;
}

async function getTopOpportunity(): Promise<any | null> {
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
      logger.warn({ err: (e as Error).message }, 'Public signal channel: scan failed');
      return null;
    }
  }

  const allResults = [
    ...scan.result.highYield,
    ...scan.result.mediumYield,
    ...scan.result.lowYield,
  ];

  const opportunities = detectArbitrageOpportunities(allResults);
  return opportunities.length > 0 ? opportunities[0] : null;
}

function formatMessage(opp: any): string {
  const diffPct = ((opp.difference ?? 0) * 100).toFixed(4);
  const diffDayPct = ((opp.difference_per_day ?? 0) * 100).toFixed(2);
  const annual = opp.profit?.annualReturn !== undefined
    ? `${(opp.profit.annualReturn * 100).toFixed(0)}%`
    : '—';
  const risk = opp.risk?.level || '—';

  const lines = [
    `🔥 <b>Топ-арбитраж сейчас: ${opp.pair}</b>`,
    ``,
    `${opp.exchangeA} ↔ ${opp.exchangeB}`,
    `Разница ставок: <b>${diffPct}%/ч</b> (${diffDayPct}%/д)`,
    `📈 Потенциал: ~${annual}/год (рыночно-нейтрально)`,
    `⚠️ Риск: ${risk}`,
    ``,
    `🤖 Funding Finder сканирует ${SUPPORTED_EXCHANGES.length} бирж в реальном времени.`,
    `Открывай приложение, чтобы ловить такие спреды первым.`,
  ];

  return lines.join('\n');
}

async function postOnce(): Promise<void> {
  const channel = config.telegram.publicSignalChannel;
  if (!channel) return;

  const opp = await getTopOpportunity();
  if (!opp) return;

  const key = opportunityKey(opp.pair, opp.exchangeA, opp.exchangeB);
  const now = Date.now();
  if (key === lastPostedKey && now - lastPostedAt < OPP_COOLDOWN_MS) {
    return; // same opportunity still within cooldown — skip
  }

  const text = formatMessage(opp);
  const replyMarkup = config.ai.appUrl
    ? {
        inline_keyboard: [
          [{ text: '🚀 Открыть Funding Finder', url: config.ai.appUrl }],
          [{ text: '🎁 7 дней Pro бесплатно', url: config.ai.appUrl }],
        ],
      }
    : undefined;

  const ok = await sendTelegramMessage({
    chatId: channel,
    text,
    parseMode: 'HTML',
    disableNotification: false,
    replyMarkup,
  });

  if (ok) {
    lastPostedKey = key;
    lastPostedAt = now;
    logger.info({ channel, pair: opp.pair }, 'Public signal channel: posted top arbitrage');
  }
}

export function startPublicSignalChannel(): void {
  if (!config.telegram.publicSignalChannel) {
    logger.info('Public signal channel disabled (PUBLIC_SIGNAL_CHANNEL not set)');
    return;
  }
  if (!config.telegram.botToken) {
    logger.warn('Public signal channel disabled: TELEGRAM_BOT_TOKEN missing');
    return;
  }
  logger.info(`Public signal channel enabled → ${config.telegram.publicSignalChannel} every ${POST_INTERVAL_MS / 60000} min`);
  // Immediate first post shortly after startup (let the warm-up populate).
  timer = setInterval(() => { void postOnce(); }, POST_INTERVAL_MS);
  setTimeout(() => { void postOnce(); }, 60_000);
}

export function stopPublicSignalChannel(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
