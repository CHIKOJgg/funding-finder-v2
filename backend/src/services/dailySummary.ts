import { prisma } from './prisma.js';
import { runScan } from './scanService.js';
import { SUPPORTED_EXCHANGES } from '../exchanges/index.js';
import { sendDailySummary, sendTrialReminder } from './telegramNotify.js';
import { getIntervalLabel } from '../utils/helpers.js';
import { TRIAL_REMINDER_DAYS } from '../middleware/subscription.js';
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
    // Trial reminders run on their own cadence (once per matching day).
    await sendTrialReminders();
  }, 60 * 60 * 1000); // Check every hour
}

/**
 * Nudge trial users shortly before their Pro trial expires. Reminders are
 * idempotent: each threshold day (e.g. 2 days left, 1 day left) is sent at most
 * once, tracked via the `trialReminderSent` bitmask on the user.
 */
export async function sendTrialReminders(): Promise<void> {
  try {
    const now = Date.now();
    const users = await prisma.user.findMany({
      where: {
        subscription: 'pro',
        trialEndsAt: { gt: new Date(now) }, // still active
      },
      select: { telegramId: true, trialEndsAt: true, trialReminderSent: true },
    });

    let sent = 0;
    for (const user of users) {
      if (!user.trialEndsAt) continue;
      const msLeft = user.trialEndsAt.getTime() - now;
      const daysLeft = Math.ceil(msLeft / (24 * 60 * 60 * 1000));

      for (const d of TRIAL_REMINDER_DAYS) {
        const bit = 1 << d;
        if (daysLeft === d && (user.trialReminderSent & bit) === 0) {
          const chatId = parseInt(String(user.telegramId).replace('tg_', ''), 10);
          if (chatId && !isNaN(chatId)) {
            const ok = await sendTrialReminder(chatId, d);
            if (ok) {
              await prisma.user.update({
                where: { telegramId: user.telegramId },
                data: { trialReminderSent: user.trialReminderSent | bit },
              });
              sent++;
            }
          }
          // Re-read guard: only one bit per day matters; continue to next day.
        }
      }
    }
    if (sent) logger.info(`Trial reminders sent: ${sent}`);
  } catch (err) {
    logger.error({ err }, 'Failed to send trial reminders');
  }
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
    const exchanges = SUPPORTED_EXCHANGES;
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

    // Index the scan by `${exchange}:${contract}` so we can resolve each
    // user's watchlist pairs against the fresh rates in O(1).
    const byKey = new Map<string, (typeof allResults)[number]>();
    for (const r of allResults) byKey.set(`${r.exchange}:${r.contract}`, r);

    // Get all users with Telegram IDs who have daily summary enabled
    const users = await prisma.user.findMany({
      where: {
        telegramId: { startsWith: 'tg_' },
      },
      include: {
        settings: { select: { dailySummary: true } },
        watchlist: { select: { exchange: true, pair: true } },
      },
    });

    const eligibleUsers = users.filter((u) => u.settings?.dailySummary !== false);

    let sentCount = 0;
    let failedCount = 0;
    for (const user of eligibleUsers) {
      try {
        const chatId = parseInt(user.telegramId.replace('tg_', ''), 10);
        if (!chatId || isNaN(chatId)) continue;

        // Build a personalized watchlist section from the fresh scan. Pairs
        // whose rate moved materially since yesterday are flagged.
        const watchlist = user.watchlist.slice(0, 8).map((w) => {
          const r = byKey.get(`${w.exchange}:${w.pair}`);
          return {
            pair: w.pair,
            exchange: w.exchange,
            ratePerHour: r?.funding_rate_per_hour ?? 0,
            ratePerDay: r?.funding_rate_per_day ?? 0,
            interval: r ? getIntervalLabel(r.funding_interval_seconds) : '',
          };
        });

        const sent = await sendDailySummary(chatId, {
          topPairs,
          watchlist,
          totalScanned: scanResult.scanned,
        });
        if (sent) sentCount++;
        else failedCount++;
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
