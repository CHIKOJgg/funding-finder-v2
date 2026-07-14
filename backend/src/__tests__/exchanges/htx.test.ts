jest.mock('axios');
jest.mock('../../services/contractMetadata.js', () => ({
  upsertContractMetadata: jest.fn().mockResolvedValue(undefined),
}));

import { installMockAxios } from '../testkit';
import { cleanupConnections } from '../../utils/exchangeClient.js';
import { scanHtx } from '../../exchanges/htx.js';

let mock: ReturnType<typeof installMockAxios>;

beforeEach(() => {
  mock = installMockAxios();
  cleanupConnections();
});

describe('scanHtx', () => {
  it('returns normalized ExchangeResult[] for HTX', async () => {
    const now = Date.now();
    mock.routeGet({
      '/linear-swap-api/v1/swap_contract_info': {
        data: [
          { contract_code: 'BTC-USDT', trade_partition: 'USDT', contract_status: 1, business_type: 'swap', settlement_period: '8' },
        ],
      },
      '/linear-swap-api/v1/swap_ticker': {
        data: [{ contract_code: 'BTC-USDT', last_price: '50000' }],
      },
      '/linear-swap-api/v1/swap_funding_rate': {
        data: { funding_rate: '0.0001', funding_time: now + 3600000 },
      },
      '/linear-swap-api/v1/swap_open_interest': {
        data: [{ value: '1000' }],
      },
    });

    const results = await scanHtx();
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    const r = results.find((x) => x.exchange === 'htx');
    expect(r).toBeDefined();
    expect(r!.contract).toBe('BTC-USDT');
    expect(Number.isFinite(r!.funding_rate_per_hour)).toBe(true);
  });

  it('returns [] on network failure (graceful degradation)', async () => {
    mock.rejectGet();
    const results = await scanHtx();
    expect(results).toEqual([]);
  });
});
