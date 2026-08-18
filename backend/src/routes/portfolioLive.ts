import { Router } from 'express';
import { prisma } from '../services/prisma.js';
import { AuthenticatedRequest } from '../middleware/auth.js';
import { requireSubscription } from '../middleware/subscription.js';
import { decryptJson } from '../services/exchangeKeys.js';
import { getAdapter, supportedExchanges } from '../services/exchangeClients/index.js';
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
        if (!supportedExchanges().includes(k.exchange.toLowerCase())) {
          entry.supported = false;
          const dexExchanges = ['dydx', 'paradex', 'drift', 'helix', 'bluefin'];
          entry.error = dexExchanges.includes(k.exchange.toLowerCase())
            ? 'DEX требует подключение через кошелёк (пока не поддерживается)'
            : 'Биржа пока не поддерживается для подключения по API';
          return;
        }
        const creds = decryptJson<{ apiKey: string; secret: string; passphrase?: string }>(k.encPayload);
        const adapter = getAdapter(k.exchange);
        entry.supportsTrading = Boolean(adapter.supportsTrading);
        entry.supported = true;

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

// POST /api/portfolio/auto-execute — DISABLED. Trading via API keys is now
// read-only for safety. Kept as a 403 so existing clients fail closed.
router.post('/portfolio/auto-execute', requireSubscription('pro'), async (_req: AuthenticatedRequest, res) => {
  return res.status(403).json({ ok: false, error: 'Trading via API keys is disabled. Portfolio connections are read-only.' });
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
