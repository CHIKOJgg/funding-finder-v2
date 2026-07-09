import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validation.js';
import { AuthenticatedRequest } from '../middleware/auth.js';
import { prisma } from '../services/prisma.js';
import { logger } from '../utils/logger.js';

const router = Router();

const exportSchema = z.object({
  exchange: z.string().optional(),
  days: z.number().min(1).max(30).default(7),
});

function escapeCsvValue(value: unknown): string {
  const str = String(value ?? '');
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

router.get('/export/csv', validate(exportSchema, 'query'), async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ ok: false, error: 'Authentication required' });
    }

    const { exchange, days } = req.query as any;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const where: Record<string, unknown> = {
      records: {
        some: {
          timestamp: { gte: since },
        },
      },
    };

    if (exchange && typeof exchange === 'string') {
      where.key = { startsWith: `${exchange}:` };
    }

    const histories = await prisma.fundingHistory.findMany({
      where,
      include: {
        records: {
          where: { timestamp: { gte: since } },
          orderBy: { timestamp: 'desc' },
          take: 100,
        },
      },
      take: 500,
    });

    const header = 'Exchange,Contract,Timestamp,Funding Rate\n';
    const rows: string[] = [];

    for (const h of histories) {
      const [exch, ...contractParts] = h.key.split(':');
      const contract = contractParts.join(':');

      for (const record of h.records) {
        rows.push([
          escapeCsvValue(exch),
          escapeCsvValue(contract),
          escapeCsvValue(record.timestamp.toISOString()),
          escapeCsvValue(record.funding),
        ].join(','));
      }
    }

    const csv = header + rows.join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="funding-history-${days}d.csv"`);
    res.send(csv);
  } catch (e) {
    const error = e as Error;
    logger.error({ err: error }, 'CSV export error');
    res.status(500).json({ ok: false, error: error.message || String(error) });
  }
});

export default router;
