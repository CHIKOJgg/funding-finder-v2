import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validation.js';
import { AuthenticatedRequest } from '../middleware/auth.js';
import {
  createGeneralAlert,
  getUserGeneralAlerts,
  deleteGeneralAlert,
  toggleGeneralAlert,
} from '../services/alertService.js';
import { prisma } from '../services/prisma.js';
import { logger } from '../utils/logger.js';

const router = Router();

const createAlertSchema = z.object({
  pair: z.string().min(1),
  exchange: z.string().min(1),
  condition: z.enum(['above', 'below']),
  threshold: z.number(),
  cooldown: z.number().optional(),
});

const batchToggleSchema = z.object({
  alertIds: z.array(z.string()).min(1).max(50),
  isActive: z.boolean(),
});

const batchDeleteSchema = z.object({
  alertIds: z.array(z.string()).min(1).max(50),
});

router.post('/', validate(createAlertSchema), async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).userId!;
    const { pair, exchange, condition, threshold, cooldown } = req.body;
    const alert = await createGeneralAlert(userId, {
      pair,
      exchange,
      condition,
      threshold,
      cooldown,
    });
    logger.info(`Created general alert for user ${userId}: ${pair} on ${exchange}`);
    res.json({ ok: true, alert, message: 'Оповещение создано успешно' });
  } catch (e) {
    const error = e as Error;
    logger.error({ err: error }, 'Create alert error');
    res.status(500).json({ ok: false, error: error.message || String(error) });
  }
});

router.get('/', async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).userId!;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const result = await getUserGeneralAlerts(userId, limit, offset);
    res.json({ ok: true, ...result });
  } catch (e) {
    const error = e as Error;
    res.status(500).json({ ok: false, error: error.message || String(error) });
  }
});

// Batch toggle alerts — registered before the `/:alertId` param routes so they
// are not shadowed by `POST /:alertId/toggle`.
router.post('/batch/toggle', validate(batchToggleSchema), async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const { alertIds, isActive } = req.body;

    const result = await prisma.generalAlert.updateMany({
      where: {
        id: { in: alertIds },
        userId,
      },
      data: { isActive },
    });

    res.json({
      ok: true,
      updated: result.count,
      message: `${result.count} оповещений ${isActive ? 'включено' : 'выключено'}`,
    });
  } catch (e) {
    const error = e as Error;
    logger.error({ err: error }, 'Batch toggle error');
    res.status(500).json({ ok: false, error: error.message || String(error) });
  }
});

// Batch delete alerts
router.post('/batch/delete', validate(batchDeleteSchema), async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const { alertIds } = req.body;

    const result = await prisma.generalAlert.deleteMany({
      where: {
        id: { in: alertIds },
        userId,
      },
    });

    res.json({
      ok: true,
      deleted: result.count,
      message: `${result.count} оповещений удалено`,
    });
  } catch (e) {
    const error = e as Error;
    logger.error({ err: error }, 'Batch delete error');
    res.status(500).json({ ok: false, error: error.message || String(error) });
  }
});

router.delete('/:alertId', async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).userId!;
    const { alertId } = req.params;
    const success = await deleteGeneralAlert(userId, alertId);
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

router.post('/:alertId/toggle', async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).userId!;
    const { alertId } = req.params;
    const alert = await toggleGeneralAlert(userId, alertId);
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

// Alert trigger history
router.get('/:alertId/history', async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).userId!;
    const { alertId } = req.params;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);

    // Verify alert belongs to user
    const alert = await prisma.generalAlert.findFirst({
      where: { id: alertId, userId },
    });
    if (!alert) {
      return res.status(404).json({ ok: false, error: 'Alert not found' });
    }

    const triggers = await prisma.alertTrigger.findMany({
      where: { alertId },
      orderBy: { triggeredAt: 'desc' },
      take: limit,
    });

    res.json({ ok: true, triggers });
  } catch (e) {
    const error = e as Error;
    logger.error({ err: error }, 'Alert history error');
    res.status(500).json({ ok: false, error: error.message || String(error) });
  }
});

export default router;
