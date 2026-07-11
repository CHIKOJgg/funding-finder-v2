import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../services/prisma.js';
import { AuthenticatedRequest } from '../middleware/auth.js';
import { requireSubscription } from '../middleware/subscription.js';
import { validate } from '../middleware/validation.js';
import { encryptJson } from '../services/exchangeKeys.js';
import { supportedExchanges } from '../services/exchangeClients/index.js';
import { logger } from '../utils/logger.js';

const router = Router();

// Exchange API keys are stored ENCRYPTED. Only Pro users may connect them.
// The secret is never returned to the client.

const addSchema = z.object({
  exchange: z.enum(['binance', 'bybit', 'okx', 'gate', 'mexc']),
  label: z.string().max(40).optional(),
  apiKey: z.string().min(1),
  secret: z.string().min(1),
  passphrase: z.string().optional(),
  permissions: z.enum(['read', 'trade']).default('read'),
});

const deleteSchema = z.object({
  id: z.string().min(1),
});

// GET /api/keys — list connected keys (no secrets)
router.get('/keys', requireSubscription('pro'), async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ ok: false, error: 'Authentication required' });

    const keys = await prisma.apiKey.findMany({
      where: { userId },
      select: {
        id: true,
        exchange: true,
        label: true,
        permissions: true,
        createdAt: true,
        lastUsedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ ok: true, keys, supported: supportedExchanges() });
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'Failed to list API keys');
    res.status(500).json({ ok: false, error: 'Не удалось получить список ключей' });
  }
});

// POST /api/keys — add (encrypted) exchange credentials
router.post('/keys', requireSubscription('pro'), validate(addSchema), async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ ok: false, error: 'Authentication required' });

    const { exchange, label, apiKey, secret, passphrase, permissions } = req.body;
    const encPayload = encryptJson({ apiKey, secret, passphrase });

    const key = await prisma.apiKey.create({
      data: { userId, exchange, label: label || null, encPayload, permissions },
      select: {
        id: true,
        exchange: true,
        label: true,
        permissions: true,
        createdAt: true,
      },
    });

    res.json({ ok: true, key });
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'Failed to add API key');
    res.status(500).json({ ok: false, error: 'Не удалось сохранить ключ' });
  }
});

// DELETE /api/keys/:id
router.delete('/keys/:id', requireSubscription('pro'), validate(deleteSchema), async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ ok: false, error: 'Authentication required' });

    await prisma.apiKey.deleteMany({
      where: { id: req.params.id, userId },
    });

    res.json({ ok: true });
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'Failed to delete API key');
    res.status(500).json({ ok: false, error: 'Не удалось удалить ключ' });
  }
});

export default router;
