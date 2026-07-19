jest.mock('axios');

import { installMockAxios } from './testkit';
import { wooAdapter } from '../services/exchangeClients/woo.js';
import { coinexAdapter } from '../services/exchangeClients/coinex.js';
import { bitmartAdapter } from '../services/exchangeClients/bitmart.js';
import { blofinAdapter } from '../services/exchangeClients/blofin.js';
import { apexAdapter } from '../services/exchangeClients/apex.js';
import { asterAdapter } from '../services/exchangeClients/aster.js';
import { weexAdapter } from '../services/exchangeClients/weex.js';
import { coinwAdapter } from '../services/exchangeClients/coinw.js';

let mock: ReturnType<typeof installMockAxios>;

beforeEach(() => {
  mock = installMockAxios();
});

const creds = { apiKey: 'k', secret: 's' };

describe('new live portfolio adapters', () => {
  it('wooAdapter normalizes positions and funding', async () => {
    mock.routeGet({
      '/v3/positions': { rows: [{ symbol: 'BTC', size: '0.5', markPrice: '50000', averageOpenPrice: '49000', side: 'LONG', leverage: '10', unrealizedPnl: '50' }] },
      '/v3/funding_fee/history': { rows: [] },
    });
    const positions = await wooAdapter.getPositions(creds);
    expect(positions).toHaveLength(1);
    expect(positions[0].exchange).toBe('woo');
    expect(positions[0].side).toBe('long');
    expect(positions[0].notional).toBeCloseTo(25000);
  });

  it('coinexAdapter normalizes positions', async () => {
    mock.routeGet({
      '/v2/futures/position': { data: { list: [{ market: 'BTCUSDT', amount: '-10', last_price: '50000', avg_price: '51000', leverage: '5', unrealized_pnl: '-100' }] } },
      '/v2/futures/funding-history': { data: { list: [] } },
    });
    const positions = await coinexAdapter.getPositions(creds);
    expect(positions[0].side).toBe('short');
    expect(positions[0].unrealizedPnl).toBe(-100);
  });

  it('bitmartAdapter normalizes positions', async () => {
    mock.routeGet({
      '/contract/v1/ifContract/openPositions': { data: { positions: [{ symbol: 'BTCUSDT', position_qty: '0.2', mark_price: '50000', avg_entrance_price: '48000', leverage: '3', unrealized_profit: '400' }] } },
      '/contract/v1/ifContract/fundingHistory': { data: { records: [] } },
    });
    const positions = await bitmartAdapter.getPositions(creds);
    expect(positions[0].side).toBe('long');
    expect(positions[0].notional).toBeCloseTo(10000);
  });

  it('blofinAdapter normalizes positions', async () => {
    mock.routeGet({
      '/api/v1/asset/positions': { data: [{ instId: 'BTC-USDT', holdVol: '1', markPx: '50000', openPx: '49000', holdSide: 'long', lever: '2', upl: '20' }] },
      '/api/v1/asset/bills': { data: [] },
    });
    const positions = await blofinAdapter.getPositions(creds);
    expect(positions[0].exchange).toBe('blofin');
    expect(positions[0].leverage).toBe(2);
  });

  it('apexAdapter normalizes positions', async () => {
    mock.routeGet({
      '/api/v3/position': { data: [{ symbol: 'BTC-USDT', size: '0.1', markPrice: '50000', entryPrice: '49500', leverage: '5', unrealizedPnl: '5' }] },
      '/api/v3/funding-history': { data: [] },
    });
    const positions = await apexAdapter.getPositions(creds);
    expect(positions[0].notional).toBeCloseTo(5000);
  });

  it('asterAdapter normalizes positions (binance-style)', async () => {
    mock.routeGet({
      '/fapi/v2/positionRisk': [{ symbol: 'BTCUSDT', positionAmt: '0.3', markPrice: '50000', entryPrice: '50000', leverage: '10', unRealizedProfit: '0' }],
      '/fapi/v1/income': [],
    });
    const positions = await asterAdapter.getPositions(creds);
    expect(positions[0].side).toBe('long');
  });

  it('weexAdapter and coinwAdapter normalize positions', async () => {
    mock.routeGet({
      '/api/v1/position/list': { data: { positions: [{ symbol: 'BTCUSDT', positionAmt: '0.4', markPrice: '50000', entryPrice: '49000', leverage: '5', unRealizedPnl: '40' }] } },
      '/api/v1/funding/record': { data: { rows: [] } },
    });
    const w = await weexAdapter.getPositions(creds);
    const c = await coinwAdapter.getPositions(creds);
    expect(w[0].exchange).toBe('weex');
    expect(c[0].exchange).toBe('coinw');
    expect(w[0].unrealizedPnl).toBe(40);
  });

  it('returns [] on network failure (graceful)', async () => {
    mock.rejectGet();
    const income = await wooAdapter.getFundingIncome(creds);
    expect(income).toEqual([]);
  });
});
