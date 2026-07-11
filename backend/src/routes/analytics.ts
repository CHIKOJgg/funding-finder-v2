import { Router } from 'express';
import { prisma } from '../services/prisma.js';
import { AuthenticatedRequest } from '../middleware/auth.js';
import { getPlanTier } from '../middleware/subscription.js';
import { logger } from '../utils/logger.js';

const router = Router();

// Annualized funding return from historical funding rates.
// Summary (APR) is visible to everyone; the detailed daily series is Pro-only.
router.get('/analytics/apr', async (req: AuthenticatedRequest, res) => {
  try {
    const exchange = (req.query.exchange as string) || '';
    const contract = (req.query.contract as string) || '';
    const days = Math.min(parseInt(req.query.days as string) || 30, 365);
    if (!exchange || !contract) {
      return res.status(400).json({ ok: false, error: 'exchange and contract are required' });
    }

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
      return res.json({
        ok: true,
        exchange,
        contract,
        periodDays: days,
        avgRate: 0,
        apr: 0,
        intervalHours: 8,
        settlementsPerYear: 1095,
        dataPoints: 0,
        series: null,
      });
    }

    const records = history.records;
    const rates = records.map((r) => r.funding);
    const avgRate = rates.reduce((a, b) => a + b, 0) / rates.length;

    // Determine settlement interval from contract metadata if available.
    let intervalHours = 8;
    try {
      const meta = await prisma.contractMetadata.findUnique({ where: { key } });
      if (meta?.fundingFloor !== null && meta) {
        // Funding interval is not stored on metadata; fall back to 8h default
        // unless we can infer from records spacing.
      }
    } catch { /* ignore */ }

    // Infer interval from the median gap between consecutive records when
    // enough history exists; otherwise use the 8h default.
    if (records.length >= 3) {
      const gaps: number[] = [];
      for (let i = 1; i < records.length; i++) {
        gaps.push(records[i].timestamp.getTime() - records[i - 1].timestamp.getTime());
      }
      gaps.sort((a, b) => a - b);
      const medianGapMs = gaps[Math.floor(gaps.length / 2)];
      if (medianGapMs > 0) {
        intervalHours = medianGapMs / (1000 * 60 * 60);
      }
    }

    const settlementsPerYear = intervalHours > 0 ? (365 * 24) / intervalHours : 1095;
    const apr = avgRate * settlementsPerYear;

    // Detailed daily series — Pro only.
    const isPro = req.userId
      ? getPlanTier((await prisma.user.findUnique({ where: { telegramId: req.userId }, select: { subscription: true } }))?.subscription || 'free') !== 'free'
      : false;

    const series = isPro
      ? records.map((r) => ({ timestamp: r.timestamp, funding: r.funding }))
      : null;

    res.json({
      ok: true,
      exchange,
      contract,
      periodDays: days,
      avgRate,
      apr,
      intervalHours,
      settlementsPerYear,
      dataPoints: records.length,
      series,
    });
  } catch (e) {
    const error = e as Error;
    logger.error({ err: error }, 'APR analytics error');
    res.status(500).json({ ok: false, error: error.message });
  }
});

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
