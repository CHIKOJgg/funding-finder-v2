import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validation.js';
import { AuthenticatedRequest } from '../middleware/auth.js';
import {
  createArbitrageAlert,
  getUserArbitrageAlerts,
  deleteArbitrageAlert,
  toggleArbitrageAlert,
  detectArbitrageOpportunities,
  calculateProfit,
} from '../services/arbitrageService.js';
import { getSpotFutures, SF_SUPPORTED_EXCHANGES } from '../services/spotFuturesService.js';
import { runScan } from '../services/scanService.js';
import { SUPPORTED_EXCHANGES } from '../exchanges/index.js';
import { logger } from '../utils/logger.js';

const router = Router();

const createAlertSchema = z.object({
  pair: z.string().min(1),
  exchangeA: z.string().min(1),
  exchangeB: z.string().min(1),
  condition: z.string().optional(),
  threshold: z.number().optional(),
  direction: z.string().optional(),
  cooldown: z.number().optional(),
});

const calculateProfitSchema = z.object({
  opportunity: z.object({
    exchangeA: z.string(),
    exchangeB: z.string(),
    difference: z.number(),
    difference_per_day: z.number(),
    volumeA: z.number(),
    volumeB: z.number(),
    intervalA_hours: z.number(),
    intervalB_hours: z.number(),
    intervalMismatch: z.boolean(),
    percentageDiff: z.number(),
  }),
  capital: z.number().min(100),
});

router.post('/alerts/arbitrage', validate(createAlertSchema), async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).userId!;
    const { pair, exchangeA, exchangeB, condition, threshold, direction, cooldown } = req.body;
    const alert = await createArbitrageAlert(userId, {
      pair,
      exchangeA,
      exchangeB,
      condition,
      threshold,
      direction,
      cooldown,
    });
    logger.info(`Created arbitrage alert for user ${userId}: ${pair} ${exchangeA} vs ${exchangeB}`);
    res.json({ ok: true, alert, message: 'Арбитражное оповещение создано успешно' });
  } catch (e) {
    const error = e as Error;
    logger.error({ err: error }, 'Create arbitrage alert error');
    res.status(500).json({ ok: false, error: error.message || String(error) });
  }
});

router.get('/alerts/arbitrage', async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).userId!;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const result = await getUserArbitrageAlerts(userId, limit, offset);
    res.json({ ok: true, ...result });
  } catch (e) {
    const error = e as Error;
    res.status(500).json({ ok: false, error: error.message || String(error) });
  }
});

router.delete('/alerts/arbitrage/:alertId', async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).userId!;
    const { alertId } = req.params;
    const success = await deleteArbitrageAlert(userId, alertId);
    if (success) {
      res.json({ ok: true, message: 'Оповещение удалено' });
    } else {
      res.status(404).json({ ok: false, error: 'Оповещение не найдено' });
    }
  } catch (e) {
    const error = e as Error;
    res.status(500).json({ ok: false, error: error.message || String(error) });
  }
});

router.post('/alerts/arbitrage/:alertId/toggle', async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).userId!;
    const { alertId } = req.params;
    const alert = await toggleArbitrageAlert(userId, alertId);
    if (alert) {
      res.json({ ok: true, alert, message: `Оповещение ${alert.isActive ? 'включено' : 'выключено'}` });
    } else {
      res.status(404).json({ ok: false, error: 'Оповещение не найдено' });
    }
  } catch (e) {
    const error = e as Error;
    res.status(500).json({ ok: false, error: error.message || String(error) });
  }
});

router.get('/arbitrage/opportunities', async (req, res) => {
  try {
    const exchangesParam = req.query.exchanges as string;
    const exchanges = exchangesParam
      ? exchangesParam.split(',').filter((e) => SUPPORTED_EXCHANGES.includes(e))
      : SUPPORTED_EXCHANGES;

    const scanResults = await runScan(exchanges);

    const allResults = [
      ...scanResults.highYield,
      ...scanResults.mediumYield,
      ...scanResults.lowYield,
    ];

    const opportunities = detectArbitrageOpportunities(allResults);

    res.json({
      ok: true,
      opportunities,
      metadata: {
        scanned: scanResults.scanned,
        intervalDistribution: scanResults.metrics.intervalDistribution,
        averageIntervalHours: scanResults.metrics.averageIntervalHours,
      },
    });
  } catch (e) {
    const error = e as Error;
    logger.error({ err: error }, 'Arbitrage opportunities error');
    res.status(500).json({ ok: false, error: error.message || String(error) });
  }
});

router.post('/arbitrage/calculate-profit', validate(calculateProfitSchema), async (req, res) => {
  try {
    const { opportunity, capital } = req.body;
    const result = await calculateProfit(opportunity, capital);
    res.json({
      ok: true,
      profit: result.profit,
      risk: result.risk,
      calculation: {
        capital,
        netHourly: result.profit.netHourly,
        netDaily: result.profit.netDaily,
        netAnnual: result.profit.netAnnual,
        hourlyROI: result.profit.hourlyReturn,
        annualROI: result.profit.annualReturn,
      },
    });
  } catch (e) {
    const error = e as Error;
    logger.error({ err: error }, 'Profit calculation error');
    res.status(500).json({ ok: false, error: error.message || String(error) });
  }
});

export default router;
