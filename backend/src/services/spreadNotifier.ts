import { prisma } from './prisma.js';
import { sendSpreadNotification } from './telegramNotify.js';
import { wsManager } from './websocket.js';
import { logger } from '../utils/logger.js';

// Proactive "new spread" push: when the periodic scan finds a fresh arbitrage
// opportunity above a user's threshold, notify subscribed users via Telegram
// (and a WebSocket event). This complements user-created alerts — those only
// fire for explicitly configured pair/exchange thresholds; this surfaces any
// new opportunity across the whole market.
//
// To avoid spamming, each (user, opportunity) pair is rate-limited by an
// in-memory cooldown. The opportunity key is order-independent so that
// (A↔B) and (B↔A) are treated as the same spread.
//
// Note: in-memory state is per-process. Under multiple replicas the same
// opportunity might be delivered by more than one instance; the cooldown still
// bounds volume and Telegram de-duplicates are not guaranteed. For stricter
// exactly-once delivery this would be backed by Redis/DB — out of scope here.

const SPREAD_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour per user+opportunity
const MAX_SPREADS_PER_USER_PER_CYCLE = 5;

const lastNotified = new Map<string, number>(); // `${userId}:${key}` -> timestamp

// Evict entries older than 2× the cooldown every 10 minutes.
setInterval(() => {
  const cutoff = Date.now() - SPREAD_COOLDOWN_MS * 2;
  for (const [k, v] of lastNotified) {
    if (v < cutoff) lastNotified.delete(k);
  }
}, 600_000).unref();

function opportunityKey(pair: string, exchangeA: string, exchangeB: string): string {
  const ex = [exchangeA, exchangeB].sort();
  return `${pair}|${ex[0]}|${ex[1]}`;
}

function chatIdFromUserId(userId: string): number | null {
  // User.telegramId is like "tg_123456"; the numeric chat id is the suffix.
  const n = parseInt(userId.replace(/^tg_/, ''), 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Notify opted-in users about the fresh arbitrage opportunities found in the
 * latest scan cycle. `opportunities` is the already-computed list from
 * detectArbitrageOpportunities (sorted best-first).
 */
export async function notifyNewSpreads(opportunities: any[]): Promise<void> {
  if (!opportunities || opportunities.length === 0) return;

  const users = await prisma.userSettings.findMany({
    where: {
      spreadNotifications: true,
      telegramNotifications: true,
    },
    include: { user: { select: { telegramId: true } } },
  });

  if (users.length === 0) return;

  const now = Date.now();
  const notifications: Promise<any>[] = [];

  for (const settings of users) {
    const userId = settings.userId;
    const chatId = chatIdFromUserId(userId);
    if (!chatId) continue;

    const exchanges = new Set(settings.defaultExchanges || []);
    const threshold = settings.spreadMinThreshold ?? 0.002;

    // Only opportunities involving the user's selected exchanges, above their
    // minimum threshold, best-first, capped per cycle.
    const eligible = opportunities
      .filter(
        (o) =>
          o.difference >= threshold &&
          exchanges.has(o.exchangeA) &&
          exchanges.has(o.exchangeB)
      )
      .slice(0, MAX_SPREADS_PER_USER_PER_CYCLE);

    for (const opp of eligible) {
      const key = opportunityKey(opp.pair, opp.exchangeA, opp.exchangeB);
      const mapKey = `${userId}:${key}`;
      const last = lastNotified.get(mapKey) || 0;
      if (now - last < SPREAD_COOLDOWN_MS) continue;

      lastNotified.set(mapKey, now);

      notifications.push(
        sendSpreadNotification(chatId, opp).catch((err) =>
          logger.error({ err, userId, key }, 'Failed to send new-spread notification')
        )
      );

      // Realtime feed for users connected to the WebSocket.
      notifications.push(
        Promise.resolve(
          wsManager.sendToUser(userId, {
            type: 'new_spread',
            data: opp,
            timestamp: now,
          })
        )
      );
    }
  }

  if (notifications.length > 0) {
    await Promise.allSettled(notifications);
    logger.info(`New-spread notifier dispatched ${notifications.length} events`);
  }
}
