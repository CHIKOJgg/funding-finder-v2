import type { Credentials, ExchangeAdapter, NormalizedPosition, NormalizedFundingIncome } from './types.js';
import axios from 'axios';

// Hyperliquid read-only adapter. Hyperliquid identifies users by their wallet
// address (not an API key/secret), and the `info` endpoints are public — so we
// treat the stored `apiKey` as the user's wallet address and call the public
// info API. No secret is required for read-only PnL.
const BASE = 'https://api.hyperliquid.xyz';

async function info(body: Record<string, any>): Promise<any> {
  const res = await axios.post(`${BASE}/info`, body, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 10000,
  });
  return res.data;
}

export const hyperliquidAdapter: ExchangeAdapter = {
  exchange: 'hyperliquid',
  supportsTrading: false,

  async getPositions(creds: Credentials): Promise<NormalizedPosition[]> {
    // `apiKey` holds the user's 0x wallet address.
    const data = await info({ type: 'clearinghouseState', user: creds.apiKey });
    const list: any[] =
      data?.assetPositions ||
      data?.clearinghouseState?.assetPositions ||
      [];
    const positions: NormalizedPosition[] = [];
    for (const ap of list) {
      const pos = ap?.position;
      if (!pos) continue;
      const szi = parseFloat(pos.szi);
      if (!szi || szi === 0) continue;
      const mark = parseFloat(pos.markPx) || parseFloat(pos.entryPx) || 0;
      const entry = parseFloat(pos.entryPx);
      const positionValue = parseFloat(pos.positionValue);
      positions.push({
        exchange: 'hyperliquid',
        symbol: pos.coin,
        side: szi < 0 ? 'short' : 'long',
        size: Math.abs(szi),
        notional: isFinite(positionValue) ? Math.abs(positionValue) : Math.abs(szi) * (isFinite(mark) ? mark : 0),
        entryPrice: entry,
        markPrice: isFinite(mark) ? mark : entry,
        leverage: parseFloat(pos.leverage?.value ?? pos.leverage) || 1,
        unrealizedPnl: parseFloat(pos.unrealizedPnl) || 0,
      });
    }
    return positions;
  },

  async getFundingIncome(creds: Credentials, _opts: { symbol?: string; limit?: number } = {}): Promise<NormalizedFundingIncome[]> {
    const data = await info({ type: 'userFunding', user: creds.apiKey });
    const list: any[] = Array.isArray(data) ? data : [];
    return list
      .map((r: any) => ({
        symbol: r.coin,
        income: parseFloat(r.delta) || 0,
        time: Number(r.time) * 1000,
        type: 'FUNDING',
      }))
      .filter((f) => f.income !== 0);
  },
};
