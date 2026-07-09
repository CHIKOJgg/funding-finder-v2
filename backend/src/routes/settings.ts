import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validation.js';
import { AuthenticatedRequest } from '../middleware/auth.js';
import { prisma } from '../services/prisma.js';
import { logger } from '../utils/logger.js';

const router = Router();

const updateSettingsSchema = z.object({
  telegramNotifications: z.boolean().optional(),
  emailNotifications: z.boolean().optional(),
  emailAddress: z.string().email().optional().nullable(),
  dailySummary: z.boolean().optional(),
  alertSound: z.boolean().optional(),
  defaultExchanges: z.array(z.string()).optional(),
  theme: z.enum(['auto', 'light', 'dark']).optional(),
  language: z.string().optional(),
  timezone: z.string().optional(),
  minVolumeFilter: z.number().min(0).optional(),
  minRateFilter: z.number().optional(),
});

// Get user settings
router.get('/settings', async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ ok: false, error: 'Authentication required' });
    }

    let settings = await prisma.userSettings.findUnique({
      where: { userId },
    });

    // Create default settings if none exist
    if (!settings) {
      settings = await prisma.userSettings.create({
        data: { userId },
      });
    }

    res.json({ ok: true, settings });
  } catch (e) {
    const error = e as Error;
    logger.error({ err: error }, 'Get settings error');
    res.status(500).json({ ok: false, error: error.message || String(error) });
  }
});

// Update user settings
router.put('/settings', validate(updateSettingsSchema), async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ ok: false, error: 'Authentication required' });
    }

    const settings = await prisma.userSettings.upsert({
      where: { userId },
      create: { userId, ...req.body },
      update: req.body,
    });

    res.json({ ok: true, settings });
  } catch (e) {
    const error = e as Error;
    logger.error({ err: error }, 'Update settings error');
    res.status(500).json({ ok: false, error: error.message || String(error) });
  }
});

// Reset settings to defaults
router.post('/settings/reset', async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ ok: false, error: 'Authentication required' });
    }

    const settings = await prisma.userSettings.upsert({
      where: { userId },
      create: { userId },
      update: {
        telegramNotifications: true,
        emailNotifications: false,
        emailAddress: null,
        dailySummary: true,
        alertSound: true,
        defaultExchanges: ['gate', 'binance', 'bybit', 'mexc', 'okx'],
        theme: 'auto',
        language: 'ru',
        timezone: 'Europe/Moscow',
        minVolumeFilter: 1000,
        minRateFilter: 0,
      },
    });

    res.json({ ok: true, settings, message: 'Settings reset to defaults' });
  } catch (e) {
    const error = e as Error;
    logger.error({ err: error }, 'Reset settings error');
    res.status(500).json({ ok: false, error: error.message || String(error) });
  }
});

export default router;
