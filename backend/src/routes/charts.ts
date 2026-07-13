import { Router } from 'express';
import { getOpenInterest } from '../services/oiService.js';

const router = Router();

// Live open-interest snapshot for a perpetual pair on a supported exchange.
// Returns current OI (base contracts), mark price, notional USD, and a short
// in-memory series for the sparkline on the OI Tracker page.
router.get('/charts/oi', async (req, res) => {
  try {
    const exchange = (req.query.exchange as string) || 'binance';
    const pair = (req.query.pair as string) || 'BTCUSDT';
    const data = await getOpenInterest(exchange, pair);
    res.json({ ok: true, ...data });
  } catch (e) {
    const error = e as Error;
    res.status(500).json({ ok: false, error: error.message || String(error) });
  }
});

export default router;
