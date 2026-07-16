import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../services/prisma.js';
import { AuthenticatedRequest } from '../middleware/auth.js';
import { requireSubscription } from '../middleware/subscription.js';
import { validate } from '../middleware/validation.js';
import { decryptJson } from '../services/exchangeKeys.js';
import { getAdapter } from '../services/exchangeClients/index.js';
import { logger } from '../utils/logger.js';
import { perUserLimiter } from '../middleware/rateLimit.js';

const router = Router();

// Live portfolio places real orders on user exchanges — keep it tightly
// throttled per user. Mounted here (not at app.use('/api')) so it only counts
// real /portfolio/live hits, never other /api routes.
router.use(perUserLimiter(20, 15 * 60 * 1000, 'portfolio-live'));

// GET /api/portfolio/live — aggregate real open positions + funding income
// across the user's connected (encrypted) exchange keys. Each exchange is
// isolated: a failure on one never breaks the others.
async function gatherLive(userId: string): Promise<{ exchanges: any[]; totals: any }> {
  const keys = await prisma.apiKey.findMany({ where: { userId } });
  if (keys.length === 0) {
    return { exchanges: [], totals: { positions: 0, unrealized: 0, funding: 0 } };
  }

  const perExchange: any[] = [];
  let totalPositions = 0;
  let totalUnrealized = 0;
  let totalFunding = 0;

  await Promise.all(
    keys.map(async (k) => {
      const entry: any = {
        exchange: k.exchange,
        label: k.label,
        permissions: k.permissions,
        supportsTrading: false,
        positions: [],
        fundingTotal: 0,
        unrealizedTotal: 0,
        error: null,
      };
      try {
        const creds = decryptJson<{ apiKey: string; secret: string; passphrase?: string }>(k.encPayload);
        const adapter = getAdapter(k.exchange);
        entry.supportsTrading = Boolean(adapter.supportsTrading);

        const [positions, funding] = await Promise.all([
          adapter.getPositions(creds),
          adapter.getFundingIncome(creds, { limit: 200 }).catch(() => []),
        ]);

        entry.positions = positions;
        entry.fundingTotal = funding.reduce((s, f) => s + (f.income || 0), 0);
        entry.unrealizedTotal = positions.reduce((s, p) => s + (p.unrealizedPnl || 0), 0);
        totalPositions += positions.length;
        totalUnrealized += entry.unrealizedTotal;
        totalFunding += entry.fundingTotal;

        await prisma.apiKey.update({ where: { id: k.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
      } catch (err) {
        entry.error = (err as Error).message || 'Не удалось получить данные биржи';
        logger.warn({ exchange: k.exchange, err: (err as Error).message }, 'Live portfolio fetch failed');
      }
      perExchange.push(entry);
    })
  );

  return {
    exchanges: perExchange,
    totals: {
      positions: totalPositions,
      unrealized: Number(totalUnrealized.toFixed(2)),
      funding: Number(totalFunding.toFixed(2)),
    },
  };
}

router.get('/portfolio/live', requireSubscription('pro'), async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ ok: false, error: 'Authentication required' });
    const data = await gatherLive(userId);
    res.json({ ok: true, ...data });
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'Live portfolio failed');
    res.status(500).json({ ok: false, error: 'Не удалось загрузить позиции' });
  }
});

// GET /api/portfolio/live/export — CSV of current real open positions + funding.
router.get('/portfolio/live/export', requireSubscription('pro'), async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ ok: false, error: 'Authentication required' });

    const { exchanges } = await gatherLive(userId);
    const esc = (v: unknown) => {
      const s = String(v ?? '');
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows: string[] = ['Exchange,Label,Symbol,Side,Size,Notional,EntryPrice,MarkPrice,Leverage,UnrealizedPnl,FundingIncome'];
    for (const ex of exchanges) {
      if (ex.error) continue;
      for (const p of ex.positions || []) {
        rows.push([
          ex.exchange, ex.label || '', p.symbol, p.side, p.size, p.notional,
          p.entryPrice, p.markPrice, p.leverage, p.unrealizedPnl, ex.fundingTotal,
        ].map(esc).join(','));
      }
    }

    const csv = '﻿' + rows.join('\r\n'); // BOM for Excel (UTF-8)
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="live-positions.csv"');
    res.send(csv);
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'Live portfolio export failed');
    res.status(500).json({ ok: false, error: 'Не удалось экспортировать позиции' });
  }
});

const executeSchema = z.object({
  exchange: z.enum(['binance', 'bybit', 'okx', 'gate', 'mexc']),
  symbol: z.string().min(2),
  side: z.enum(['long', 'short']),
  notionalUsd: z.number().positive().max(1_000_000),
  maxSlippageBps: z.number().int().min(1).max(5000).optional().default(100),
  confirm: z.literal(true), // explicit confirmation required
});

// Map an exchange order status to our internal lifecycle status. Exchanges use
// different vocabularies, so we normalize the common ones; anything ambiguous
// stays 'sent' (placed but unconfirmed) rather than being falsely reported.
function deriveOrderStatus(order: any): 'filled' | 'sent' | 'failed' {
  if (!order) return 'failed';
  const raw = String(order.status ?? order.orderStatus ?? '').toUpperCase();
  if (['FILLED', 'CLOSED', 'COMPLETED', 'PARTIALLY_FILLED'].includes(raw)) return 'filled';
  if (['REJECTED', 'CANCELED', 'CANCELLED', 'EXPIRED', 'FAILED', 'NEW_REJECTED'].includes(raw)) {
    return 'failed';
  }
  return 'sent';
}

// POST /api/portfolio/auto-execute — place a market order via the user's
// trade-permission API key. Gated behind Pro + a 'trade' key + confirm:true.
router.post('/portfolio/auto-execute', requireSubscription('pro'), validate(executeSchema), async (req: AuthenticatedRequest, res) => {
  const userId = req.userId;
  const { exchange, symbol, side, notionalUsd, maxSlippageBps } = req.body;
  try {
    if (!userId) return res.status(401).json({ ok: false, error: 'Authentication required' });

    const key = await prisma.apiKey.findFirst({
      where: { userId, exchange, permissions: 'trade' },
    });
    if (!key) {
      return res.status(403).json({ ok: false, error: 'Нет ключа с правами торговли для этой биржи' });
    }

    const creds = decryptJson<{ apiKey: string; secret: string; passphrase?: string }>(key.encPayload);
    const adapter = getAdapter(exchange);
    if (!adapter.placeMarketOrder) {
      return res.status(400).json({ ok: false, error: 'Эта биржа не поддерживает авто-исполнение' });
    }

    const order = await adapter.placeMarketOrder(creds, { symbol, side, notionalUsd, maxSlippageBps });

    await prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } }).catch(() => {});

    // Persist for the in-app order history (audit trail of copy-trades),
    // recording the derived fill status so the user sees real outcomes.
    const status = deriveOrderStatus(order);
    try {
      await prisma.executedOrder.create({
        data: {
          userId,
          exchange,
          symbol,
          side,
          notionalUsd,
          status,
          orderId: order?.orderId?.toString() || order?.id?.toString() || null,
          raw: JSON.stringify(order ?? null),
        },
      });
    } catch (persistErr) {
      logger.warn({ err: (persistErr as Error).message }, 'Failed to persist executed order');
    }

    res.json({ ok: true, order, status });
  } catch (err) {
    // Record failed attempts too, so the user sees what didn't go through.
    try {
      const { exchange, symbol, side, notionalUsd } = req.body;
      if (userId) {
        await prisma.executedOrder.create({
          data: { userId, exchange, symbol, side, notionalUsd, status: 'failed', raw: JSON.stringify({ error: (err as Error).message }) },
        });
      }
    } catch { /* ignore persistence failure */ }
    logger.error({ err: (err as Error).message }, 'Auto-execute failed');
    res.status(502).json({ ok: false, error: (err as Error).message || 'Не удалось исполнить ордер' });
  }
});

// GET /api/portfolio/orders — history of auto-executed (copy-trade) orders.
router.get('/portfolio/orders', requireSubscription('pro'), async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ ok: false, error: 'Authentication required' });

    const orders = await prisma.executedOrder.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        exchange: true,
        symbol: true,
        side: true,
        notionalUsd: true,
        status: true,
        orderId: true,
        createdAt: true,
      },
    });

    res.json({ ok: true, orders });
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'Order history failed');
    res.status(500).json({ ok: false, error: 'Не удалось загрузить историю сделок' });
  }
});

export default router;
