import { prisma } from './prisma.js';
import { runScan } from './scanService.js';
import { SUPPORTED_EXCHANGES } from '../exchanges/index.js';
import { sendDailySummary, sendSubscriptionExpired, sendSubscriptionReminder, sendTrialReminder } from './telegramNotify.js';
import { getIntervalLabel } from '../utils/helpers.js';
import { enforceSubscriptionExpiry, SUBSCRIPTION_REMINDER_DAYS, TRIAL_REMINDER_DAYS } from '../middleware/subscription.js';
import { logger } from '../utils/logger.js';

const DAILY_SUMMARY_HOUR_UTC = 6; // 9:00 MSK = 06:00 UTC
let dailyTimer: ReturnType<typeof setTimeout> | null = null;
let trialTimer: ReturnType<typeof setInterval> | null = null;
let lastSentYmd = '';

export function startDailySummary(): void {
  if (dailyTimer) {
    logger.warn('Daily summary scheduler already running');
    return;
  }

  logger.info('Starting daily summary scheduler (9:00 MSK)');

  // Phase-independent: instead of an hourly setInterval that only fired when a
  // tick happened to land inside 09:00–09:04 MSK (a restart at 09:10 silently
  // disabled the summary until the next lucky restart), self-schedule a
  // setTimeout for the exact next 09:00 MSK boundary and catch up on boot.
  const scheduleNext = () => {
    const now = new Date();
    const next = new Date(now);
    next.setUTCHours(DAILY_SUMMARY_HOUR_UTC, 0, 0, 0);
    if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
    const delay = Math.min(next.getTime() - now.getTime() + 500, 24 * 60 * 60 * 1000);
    dailyTimer = setTimeout(async () => {
      try {
        await sendDailySummaries();
      } catch (err) {
        logger.error({ err }, 'Daily summary run failed');
      } finally {
        scheduleNext();
      }
    }, delay);
  };
  scheduleNext();

  // Catch up on boot: if the process started after 09:00 MSK and today's
  // summary hasn't been sent yet, send it right away instead of waiting a
  // full day (the old phase-locked hourly check skipped it entirely).
  const todayYmd = nowYmd();
  if (new Date().getUTCHours() >= DAILY_SUMMARY_HOUR_UTC && todayYmd !== lastSentYmd) {
    lastSentYmd = todayYmd;
    void sendDailySummaries().catch((e) => logger.warn({ err: (e as Error).message }, 'Daily summary catch-up failed'));
  }

  // Trial reminders stay on a plain hourly cadence (idempotent via bitmask).
  trialTimer = setInterval(() => {
    sendTrialReminders().catch((e) => logger.warn({ err: (e as Error).message }, 'Trial reminder tick failed'));
    sendSubscriptionReminders().catch((e) => logger.warn({ err: (e as Error).message }, 'Subscription reminder tick failed'));
  }, 60 * 60 * 1000);

  // Catch up immediately after deploy/restart instead of waiting for the first
  // hourly tick.
  void sendSubscriptionReminders().catch((e) => logger.warn({ err: (e as Error).message }, 'Subscription reminder catch-up failed'));
}

/** Notify paid users at 3 days, 1 day and expiry, once per threshold. */
export async function sendSubscriptionReminders(): Promise<void> {
  try {
    const now = Date.now();
    const users = await prisma.user.findMany({
      where: {
        subscription: { in: ['pro', 'proplus'] },
        subscriptionExpiresAt: { not: null },
      },
      select: { telegramId: true, subscription: true, subscriptionExpiresAt: true, subscriptionReminderSent: true },
    });

    let sent = 0;
    for (const user of users) {
      if (!user.subscriptionExpiresAt) continue;
      const chatId = parseInt(String(user.telegramId).replace('tg_', ''), 10);
      if (!chatId || isNaN(chatId)) continue;

      const msLeft = user.subscriptionExpiresAt.getTime() - now;
      const daysLeft = Math.ceil(msLeft / (24 * 60 * 60 * 1000));
      if (daysLeft < 0) {
        await enforceSubscriptionExpiry(user.telegramId);
        if (await sendSubscriptionExpired(chatId, user.subscription)) sent++;
        continue;
      }

      for (const d of SUBSCRIPTION_REMINDER_DAYS) {
        const bit = 1 << d;
        if (daysLeft === d && (user.subscriptionReminderSent & bit) === 0) {
          if (await sendSubscriptionReminder(chatId, user.subscription, d, user.subscriptionExpiresAt)) {
            await prisma.user.update({
              where: { telegramId: user.telegramId },
              data: { subscriptionReminderSent: user.subscriptionReminderSent | bit },
            });
            sent++;
          }
        }
      }
    }
    if (sent) logger.info(`Subscription reminders sent: ${sent}`);
  } catch (err) {
    logger.error({ err }, 'Failed to send subscription reminders');
  }
}

function nowYmd(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
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
    clearTimeout(dailyTimer);
    dailyTimer = null;
  }
  if (trialTimer) {
    clearInterval(trialTimer);
    trialTimer = null;
  }
  logger.info('Daily summary scheduler stopped');
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
