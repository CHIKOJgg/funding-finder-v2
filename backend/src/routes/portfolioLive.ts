import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../services/prisma.js';
import { AuthenticatedRequest } from '../middleware/auth.js';
import { requireSubscription } from '../middleware/subscription.js';
import { validate } from '../middleware/validation.js';
import { decryptJson } from '../services/exchangeKeys.js';
import { getAdapter } from '../services/exchangeClients/index.js';
import { logger } from '../utils/logger.js';

const router = Router();

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
  confirm: z.literal(true), // explicit confirmation required
});

// POST /api/portfolio/auto-execute — place a market order via the user's
// trade-permission API key. Gated behind Pro + a 'trade' key + confirm:true.
router.post('/portfolio/auto-execute', requireSubscription('pro'), validate(executeSchema), async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ ok: false, error: 'Authentication required' });

    const { exchange, symbol, side, notionalUsd } = req.body;
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

    const order = await adapter.placeMarketOrder(creds, { symbol, side, notionalUsd });

    await prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } }).catch(() => {});

    res.json({ ok: true, order });
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'Auto-execute failed');
    res.status(502).json({ ok: false, error: (err as Error).message || 'Не удалось исполнить ордер' });
  }
});

export default router;
