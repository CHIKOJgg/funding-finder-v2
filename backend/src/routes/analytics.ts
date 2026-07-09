import { Router } from 'express';
import { prisma } from '../services/prisma.js';
import { logger } from '../utils/logger.js';

const router = Router();

// Get historical trends for a contract
router.get('/analytics/trends/:exchange/:contract', async (req, res) => {
  try {
    const { exchange, contract } = req.params;
    const days = Math.min(parseInt(req.query.days as string) || 7, 30);
    const key = `${exchange}:${contract}`;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const history = await prisma.fundingHistory.findUnique({
      where: { key },
      include: {
        records: {
          where: { timestamp: { gte: since } },
          orderBy: { timestamp: 'asc' },
        },
      },
    });

    if (!history || history.records.length === 0) {
      return res.json({ ok: true, trends: [], summary: null });
    }

    const records = history.records;
    const rates = records.map((r) => r.funding);

    // Calculate trends
    const avgRate = rates.reduce((a, b) => a + b, 0) / rates.length;
    const maxRate = Math.max(...rates);
    const minRate = Math.min(...rates);
    const volatility = Math.sqrt(
      rates.reduce((sum, r) => sum + Math.pow(r - avgRate, 2), 0) / rates.length
    );

    // Detect trend direction (simple linear regression)
    const n = rates.length;
    const xMean = (n - 1) / 2;
    const yMean = avgRate;
    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i++) {
      num += (i - xMean) * (rates[i] - yMean);
      den += (i - xMean) * (i - xMean);
    }
    const slope = den !== 0 ? num / den : 0;
    const trendDirection = slope > 0.00001 ? 'increasing' : slope < -0.00001 ? 'decreasing' : 'stable';

    // hourly rates
    const hourlyRates = rates.map((r) => r * (3600 / (8 * 3600))); // Assuming 8h default

    res.json({
      ok: true,
      trends: records.map((r) => ({
        timestamp: r.timestamp,
        funding: r.funding,
      })),
      summary: {
        avgRate,
        maxRate,
        minRate,
        volatility,
        trendDirection,
        slope,
        dataPoints: n,
        periodDays: days,
      },
    });
  } catch (e) {
    const error = e as Error;
    logger.error({ err: error }, 'Trends analytics error');
    res.status(500).json({ ok: false, error: error.message });
  }
});

// Get top movers (contracts with biggest rate changes)
router.get('/analytics/top-movers', async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days as string) || 1, 7);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const histories = await prisma.fundingHistory.findMany({
      include: {
        records: {
          where: { timestamp: { gte: since } },
          orderBy: { timestamp: 'asc' },
          take: 100,
        },
      },
      take: 100,
    });

    const movers: Array<{
      key: string;
      exchange: string;
      contract: string;
      currentRate: number;
      previousRate: number;
      change: number;
      changePercent: number;
    }> = [];

    for (const h of histories) {
      if (h.records.length < 2) continue;

      const first = h.records[0].funding;
      const last = h.records[h.records.length - 1].funding;
      const change = last - first;
      const changePercent = first !== 0 ? (change / Math.abs(first)) * 100 : 0;

      const [exchange, ...contractParts] = h.key.split(':');
      const contract = contractParts.join(':');

      movers.push({
        key: h.key,
        exchange,
        contract,
        currentRate: last,
        previousRate: first,
        change,
        changePercent,
      });
    }

    // Sort by absolute change
    movers.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));

    res.json({
      ok: true,
      movers: movers.slice(0, 50),
      periodDays: days,
    });
  } catch (e) {
    const error = e as Error;
    logger.error({ err: error }, 'Top movers analytics error');
    res.status(500).json({ ok: false, error: error.message });
  }
});

// Get exchange comparison stats
router.get('/analytics/exchange-stats', async (req, res) => {
  try {
    const histories = await prisma.fundingHistory.findMany({
      include: {
        records: {
          orderBy: { timestamp: 'desc' },
          take: 1,
        },
      },
      take: 500,
    });

    const exchangeStats: Record<string, {
      contractCount: number;
      avgRate: number;
      totalVolume: number;
    }> = {};

    for (const h of histories) {
      const [exchange] = h.key.split(':');
      if (!exchangeStats[exchange]) {
        exchangeStats[exchange] = { contractCount: 0, avgRate: 0, totalVolume: 0 };
      }
      exchangeStats[exchange].contractCount++;
      if (h.records.length > 0) {
        exchangeStats[exchange].avgRate += h.records[0].funding;
      }
    }

    // Calculate averages
    for (const stats of Object.values(exchangeStats)) {
      stats.avgRate = stats.contractCount > 0 ? stats.avgRate / stats.contractCount : 0;
    }

    res.json({
      ok: true,
      stats: exchangeStats,
    });
  } catch (e) {
    const error = e as Error;
    logger.error({ err: error }, 'Exchange stats analytics error');
    res.status(500).json({ ok: false, error: error.message });
  }
});

export default router;
