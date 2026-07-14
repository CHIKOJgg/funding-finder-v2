jest.mock('axios');
jest.mock('../../services/contractMetadata.js', () => ({
  upsertContractMetadata: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../exchanges/binance.js', () => ({
  scanBinance: jest.fn(),
}));
jest.mock('../../exchanges/okx.js', () => ({
  scanOKX: jest.fn(),
}));

import { installMockAxios } from '../testkit';
import { cleanupConnections } from '../../utils/exchangeClient.js';
import { getSupportedExchanges, scanExchanges } from '../../exchanges/index.js';
import { scanBinance } from '../../exchanges/binance.js';
import { scanOKX } from '../../exchanges/okx.js';

beforeEach(() => {
  installMockAxios();
  cleanupConnections();
  (scanBinance as jest.Mock).mockReset();
  (scanOKX as jest.Mock).mockReset();
});

describe('exchanges/index', () => {
  it('getSupportedExchanges returns all supported ids', () => {
    const ids = getSupportedExchanges();
    expect(Array.isArray(ids)).toBe(true);
    expect(ids.length).toBeGreaterThanOrEqual(20);
    expect(ids).toContain('binance');
    expect(ids).toContain('okx');
    expect(ids).toContain('gate');
    expect(ids).toContain('hyperliquid');
    expect(ids).toContain('bluefin');
  });

  it('scanExchanges returns results for a known exchange', async () => {
    (scanBinance as jest.Mock).mockResolvedValue([
      { exchange: 'binance', contract: 'BTCUSDT', funding_rate_per_hour: 0.0001 } as any,
    ]);

    const results = await scanExchanges(['binance']);
    expect(results.length).toBe(1);
    expect(results[0].exchange).toBe('binance');
  });

  it('scanExchanges does not throw on unknown exchange (returns [])', async () => {
    const results = await scanExchanges(['unknown-exchange']);
    expect(results).toEqual([]);
  });

  it('skips a failing exchange but keeps successful ones', async () => {
    (scanBinance as jest.Mock).mockRejectedValue(new Error('boom'));
    (scanOKX as jest.Mock).mockResolvedValue([
      { exchange: 'okx', contract: 'BTC-USDT-SWAP', funding_rate_per_hour: 0.0001 } as any,
    ]);

    const results = await scanExchanges(['binance', 'okx']);
    expect(results.length).toBe(1);
    expect(results[0].exchange).toBe('okx');
    expect(results.some((r) => r.exchange === 'binance')).toBe(false);
  });
});
