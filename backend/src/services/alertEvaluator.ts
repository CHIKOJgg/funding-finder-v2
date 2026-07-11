import { prisma } from './prisma.js';
import { runScan } from './scanService.js';
import { detectArbitrageOpportunities } from './arbitrageService.js';
import { sendAlertNotification } from './telegramNotify.js';
import { sendAlertEmail } from './emailNotify.js';
import { notifyNewSpreads } from './spreadNotifier.js';
import { wsManager } from './websocket.js';
import { logger } from '../utils/logger.js';

const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
let evaluationTimer: ReturnType<typeof setInterval> | null = null;
let isEvaluating = false;

export function startAlertEvaluator(): void {
  if (evaluationTimer) {
    logger.warn('Alert evaluator already running');
    return;
  }

  logger.info('Starting alert evaluator (checking every 5 minutes)');
  evaluationTimer = setInterval(async () => {
    if (isEvaluating) {
      logger.debug('Alert evaluation already in progress, skipping');
      return;
    }
    try {
      isEvaluating = true;
      await evaluateAllAlerts();
    } catch (err) {
      logger.error({ err }, 'Alert evaluation cycle failed');
    } finally {
      isEvaluating = false;
    }
  }, CHECK_INTERVAL_MS);
}

export function stopAlertEvaluator(): void {
  if (evaluationTimer) {
    clearInterval(evaluationTimer);
    evaluationTimer = null;
    logger.info('Alert evaluator stopped');
  }
}

interface TriggeredAlert {
  alertId: string;
  userId: string;
  type: 'general' | 'arbitrage';
  data: {
    pair: string;
    exchange?: string;
    exchangeA?: string;
    exchangeB?: string;
    currentRate?: number;
    threshold?: number;
    difference?: number;
    condition?: string;
  };
}

async function evaluateAllAlerts(): Promise<void> {
  const now = new Date();

  const [generalAlerts, arbitrageAlerts] = await Promise.all([
    prisma.generalAlert.findMany({
      where: { isActive: true },
    }),
    prisma.arbitrageAlert.findMany({
      where: { isActive: true },
    }),
  ]);

  if (generalAlerts.length === 0 && arbitrageAlerts.length === 0) {
    return;
  }

  logger.info(`Evaluating ${generalAlerts.length} general + ${arbitrageAlerts.length} arbitrage alerts`);

  // Single scan for all exchanges needed by both alert types
  const allExchanges = [
    ...new Set([
      ...generalAlerts.map((a) => a.exchange),
      'gate', 'binance', 'bybit', 'mexc', 'okx',
    ]),
  ];

  const scanResult = await runScan(allExchanges);
  const allResults = [...scanResult.highYield, ...scanResult.mediumYield, ...scanResult.lowYield];
  const opportunities = detectArbitrageOpportunities(allResults);

  const triggeredAlerts: TriggeredAlert[] = [];

  if (generalAlerts.length > 0) {
    const generalTriggered = evaluateGeneralAlerts(generalAlerts, allResults, now);
    triggeredAlerts.push(...generalTriggered);
  }

  if (arbitrageAlerts.length > 0) {
    const arbitrageTriggered = evaluateArbitrageAlerts(arbitrageAlerts, opportunities, now);
    triggeredAlerts.push(...arbitrageTriggered);
  }

  if (triggeredAlerts.length === 0) return;

  // Batch update all triggered alerts
  const now2 = new Date();
  const alertUpdates: Promise<any>[] = [];
  const triggerCreates: Promise<any>[] = [];

  for (const triggered of triggeredAlerts) {
    alertUpdates.push(
      triggered.type === 'general'
        ? prisma.generalAlert.update({
            where: { id: triggered.alertId },
            data: { lastTriggered: now2, triggerCount: { increment: 1 } },
          })
        : prisma.arbitrageAlert.update({
            where: { id: triggered.alertId },
            data: { lastTriggered: now2, triggerCount: { increment: 1 } },
          })
    );

    triggerCreates.push(
      prisma.alertTrigger.create({
        data: {
          alertId: triggered.alertId,
          alertType: triggered.type,
          triggeredAt: now2,
          data: JSON.stringify(triggered.data),
        },
      })
    );
  }

  // Batch user lookups (instead of N+1)
  const uniqueUserIds = [...new Set(triggeredAlerts.map((t) => t.userId))];
  const users = await prisma.user.findMany({
    where: { telegramId: { in: uniqueUserIds } },
  });
  const userMap = new Map(users.map((u) => [u.telegramId, u]));

  // Send notifications (Telegram + Email)
  const notifications: Promise<any>[] = [];
  for (const triggered of triggeredAlerts) {
    const user = userMap.get(triggered.userId);
    if (user) {
      const chatId = parseInt(triggered.userId.replace('tg_', ''), 10);
      if (chatId && !isNaN(chatId)) {
        notifications.push(
          sendAlertNotification(chatId, triggered.type, triggered.data).catch((err) =>
            logger.error({ err, alertId: triggered.alertId }, 'Failed to send Telegram notification')
          )
        );
      }
      // Send email notification if user has email enabled
      const sendEmailNotification = async () => {
        try {
          const settings = await prisma.userSettings.findUnique({ where: { userId: user.telegramId } });
          if (settings?.emailNotifications && settings?.emailAddress) {
            await sendAlertEmail(settings.emailAddress, triggered.type, triggered.data);
          }
        } catch (err) {
          logger.debug({ err, userId: user.telegramId }, 'Failed to send email notification');
        }
      };
      notifications.push(sendEmailNotification());
    }
  }

  // Execute updates and trigger creates in parallel
  await Promise.all([...alertUpdates, ...triggerCreates]);
  await Promise.allSettled(notifications);

  // Broadcast to WebSocket subscribers
  for (const triggered of triggeredAlerts) {
    wsManager.sendToUser(triggered.userId, {
      type: 'alert_triggered',
      alertType: triggered.type,
      data: triggered.data,
      timestamp: Date.now(),
    });
  }

  logger.info(`Batch updated ${triggeredAlerts.length} triggered alerts, sent ${notifications.length} notifications`);

  // Proactive "new spread" pushes for opted-in users (reuses the same scan).
  try {
    await notifyNewSpreads(opportunities);
  } catch (err) {
    logger.error({ err }, 'New-spread notification failed');
  }
}

function evaluateGeneralAlerts(alerts: any[], allResults: any[], now: Date): TriggeredAlert[] {
  const triggered: TriggeredAlert[] = [];

  for (const alert of alerts) {
    try {
      if (alert.cooldown && alert.lastTriggered) {
        const lastTriggered = new Date(alert.lastTriggered).getTime();
        if (now.getTime() - lastTriggered < alert.cooldown) {
          continue;
        }
      }

      const matching = allResults.find(
        (r) =>
          r.exchange === alert.exchange &&
          r.contract.includes(alert.pair)
      );

      if (!matching) continue;

      const currentRate = matching.funding_rate_per_hour;
      let isTriggered = false;

      if (alert.condition === 'above' && currentRate > alert.threshold) {
        isTriggered = true;
      } else if (alert.condition === 'below' && currentRate < alert.threshold) {
        isTriggered = true;
      }

      if (isTriggered) {
        triggered.push({
          alertId: alert.id,
          userId: alert.userId,
          type: 'general',
          data: {
            pair: alert.pair,
            exchange: alert.exchange,
            currentRate,
            threshold: alert.threshold,
            condition: alert.condition,
          },
        });
        logger.info(
          { alertId: alert.id, pair: alert.pair, exchange: alert.exchange, currentRate, threshold: alert.threshold },
          'General alert triggered'
        );
      }
    } catch (err) {
      logger.error({ err, alertId: alert.id }, 'Failed to evaluate general alert');
    }
  }

  return triggered;
}

function evaluateArbitrageAlerts(alerts: any[], opportunities: any[], now: Date): TriggeredAlert[] {
  const triggered: TriggeredAlert[] = [];

  for (const alert of alerts) {
    try {
      if (alert.cooldown && alert.lastTriggered) {
        const lastTriggered = new Date(alert.lastTriggered).getTime();
        if (now.getTime() - lastTriggered < alert.cooldown) {
          continue;
        }
      }

      const matchingOpp = opportunities.find(
        (opp) =>
          opp.pair === alert.pair &&
          ((opp.exchangeA === alert.exchangeA && opp.exchangeB === alert.exchangeB) ||
            (opp.exchangeA === alert.exchangeB && opp.exchangeB === alert.exchangeA))
      );

      if (!matchingOpp) continue;

      let isTriggered = false;
      if (alert.condition === 'difference' || !alert.condition) {
        if (matchingOpp.difference > alert.threshold) {
          isTriggered = true;
        }
      }

      if (isTriggered) {
        triggered.push({
          alertId: alert.id,
          userId: alert.userId,
          type: 'arbitrage',
          data: {
            pair: alert.pair,
            exchangeA: alert.exchangeA,
            exchangeB: alert.exchangeB,
            difference: matchingOpp.difference,
            threshold: alert.threshold,
            condition: alert.condition,
          },
        });
        logger.info(
          { alertId: alert.id, pair: alert.pair, difference: matchingOpp.difference, threshold: alert.threshold },
          'Arbitrage alert triggered'
        );
      }
    } catch (err) {
      logger.error({ err, alertId: alert.id }, 'Failed to evaluate arbitrage alert');
    }
  }

  return triggered;
}
