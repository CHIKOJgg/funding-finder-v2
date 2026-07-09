import { prisma } from './prisma.js';
import { runScan } from './scanService.js';
import { sendDailySummary } from './telegramNotify.js';
import { getIntervalLabel } from '../utils/helpers.js';
import { logger } from '../utils/logger.js';

const DAILY_SUMMARY_HOUR = 9; // 9 AM Moscow time
let dailyTimer: ReturnType<typeof setInterval> | null = null;

export function startDailySummary(): void {
  if (dailyTimer) {
    logger.warn('Daily summary scheduler already running');
    return;
  }

  logger.info('Starting daily summary scheduler (9:00 MSK)');

  // Check every hour if it's time to send
  dailyTimer = setInterval(async () => {
    const now = new Date();
    // Moscow is UTC+3
    const mskHour = (now.getUTCHours() + 3) % 24;
    if (mskHour === DAILY_SUMMARY_HOUR && now.getMinutes() < 5) {
      await sendDailySummaries();
    }
  }, 60 * 60 * 1000); // Check every hour
}

export function stopDailySummary(): void {
  if (dailyTimer) {
    clearInterval(dailyTimer);
    dailyTimer = null;
    logger.info('Daily summary scheduler stopped');
  }
}

export async function sendDailySummaries(): Promise<void> {
  try {
    logger.info('Sending daily summaries...');

    // Run scan on all exchanges
    const exchanges = ['gate', 'binance', 'bybit', 'mexc', 'okx'];
    const scanResult = await runScan(exchanges);
    const allResults = [...scanResult.highYield, ...scanResult.mediumYield, ...scanResult.lowYield];

    if (allResults.length === 0) {
      logger.warn('No results for daily summary');
      return;
    }

    // Get top 5 by normalized hourly rate
    const topPairs = allResults
      .sort((a, b) => Math.abs(b.funding_rate_per_hour) - Math.abs(a.funding_rate_per_hour))
      .slice(0, 5)
      .map((r) => ({
        pair: r.contract,
        exchange: r.exchange,
        ratePerHour: r.funding_rate_per_hour,
        ratePerDay: r.funding_rate_per_day,
        interval: getIntervalLabel(r.funding_interval_seconds),
      }));

    // Get all users with Telegram IDs who have daily summary enabled
    const users = await prisma.user.findMany({
      where: {
        telegramId: { startsWith: 'tg_' },
      },
      include: {
        settings: {
          select: { dailySummary: true },
        },
      },
    });

    const eligibleUsers = users.filter((u) => u.settings?.dailySummary !== false);

    let sentCount = 0;
    let failedCount = 0;
    for (const user of eligibleUsers) {
      try {
        const chatId = parseInt(user.telegramId.replace('tg_', ''), 10);
        if (chatId && !isNaN(chatId)) {
          const sent = await sendDailySummary(chatId, {
            topPairs,
            totalScanned: scanResult.scanned,
          });
          if (sent) sentCount++;
          else failedCount++;
        }
      } catch (err) {
        failedCount++;
        logger.error({ err, telegramId: user.telegramId }, 'Failed to send daily summary to user');
      }
    }

    logger.info(`Daily summary sent to ${sentCount}/${users.length} users (${failedCount} failed)`);
  } catch (err) {
    logger.error({ err }, 'Failed to send daily summaries');
  }
}
