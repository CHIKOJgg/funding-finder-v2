jest.mock('axios');
jest.mock('../../services/contractMetadata.js', () => ({
  upsertContractMetadata: jest.fn().mockResolvedValue(undefined),
}));

import { installMockAxios } from '../testkit';
import { cleanupConnections } from '../../utils/exchangeClient.js';
import { scanHyperliquid } from '../../exchanges/hyperliquid.js';

let fetchMock: jest.Mock;

beforeEach(() => {
  installMockAxios();
  cleanupConnections();

  fetchMock = jest.fn(async (_url: string, opts: any) => {
    const body = JSON.parse(opts.body);
    if (body.type === 'metaAndAssetCtxs') {
      return {
        ok: true,
        json: async () => [
          { universe: [{ name: 'BTC', maxLeverage: 50 }] },
          [{ funding: '0.0001', markPx: '50000', dayNtlVlm: '1000000' }],
        ],
      };
    }
    // predictedFundings
    return {
      ok: true,
      json: async () => [
        ['BTC', [[{ venue: 'hyperliquid' }, { nextFundingTime: Date.now() + 3600000 }]]],
      ],
    };
  });
  (global as any).fetch = fetchMock;
});

describe('scanHyperliquid', () => {
  it('returns normalized ExchangeResult[] for Hyperliquid', async () => {
    const results = await scanHyperliquid();
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    const r = results.find((x) => x.exchange === 'hyperliquid');
    expect(r).toBeDefined();
    expect(r!.contract).toBe('BTC');
    expect(Number.isFinite(r!.funding_rate_per_hour)).toBe(true);
  });

  it('returns [] on fetch failure (graceful degradation)', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'));
    const results = await scanHyperliquid();
    expect(results).toEqual([]);
  });
});
