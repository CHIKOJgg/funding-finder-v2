jest.mock('axios');
jest.mock('../../services/contractMetadata.js', () => ({ upsertContractMetadata: jest.fn().mockResolvedValue(undefined) }));

import { installMockAxios } from '../testkit';
import { cleanupConnections } from '../../utils/exchangeClient.js';
import { scanKraken } from '../../exchanges/kraken.js';
import { scanCoinbase } from '../../exchanges/coinbase.js';
import { scanBitunix } from '../../exchanges/bitunix.js';
import { scanOrderly } from '../../exchanges/orderly.js';
import { scanAevo } from '../../exchanges/aevo.js';

let mock: ReturnType<typeof installMockAxios>;
beforeEach(() => { mock = installMockAxios(); cleanupConnections(); });

describe('new public funding scanners', () => {
  it('parses Kraken perpetual ticker data', async () => {
    mock.routeGet({ instruments: { result: 'success', instruments: [{ symbol: 'PI_XBTUSD' }] }, tickers: { result: 'success', tickers: [{ symbol: 'PI_XBTUSD', tag: 'perpetual', markPrice: '100', fundingRate: '0.001' }] } });
    const result = await scanKraken();
    expect(result[0]).toMatchObject({ exchange: 'kraken', contract: 'PI_XBTUSD', currentFunding: 0.001 });
  });

  it('parses Coinbase International quote data', async () => {
    mock.routeGet({ quote: { predicted_funding: '0.0002', mark_price: '50000' }, instruments: [{ instrument: 'BTC-PERP', type: 'PERP' }] });
    const result = await scanCoinbase();
    expect(result[0]).toMatchObject({ exchange: 'coinbase', contract: 'BTC-PERP', currentFunding: 0.0002, mark_price: 50000 });
  });

  it('parses Bitunix per-symbol funding data', async () => {
    mock.routeGet({ trading_pairs: { code: 0, data: [{ symbol: 'BTCUSDT' }] }, tickers: { code: 0, data: [{ symbol: 'BTCUSDT', markPrice: '50000', volume: '10' }] }, funding_rate: { code: 0, data: { fundingRate: '0.0003', fundingInterval: 4, nextFundingTime: 1700000000000 } } });
    const result = await scanBitunix();
    expect(result[0]).toMatchObject({ exchange: 'bitunix', contract: 'BTCUSDT', currentFunding: 0.0003, funding_interval_seconds: 14400 });
  });

  it('parses Orderly market summary data', async () => {
    mock.routePost({ '*': { success: true, data: { markets: [{ symbol: 'PERP_BTC_USDC', mark_price: '50000', last_funding_rate: '0.0004', total_24h_volume: '1000' }] } } });
    const result = await scanOrderly();
    expect(result[0]).toMatchObject({ exchange: 'orderly', contract: 'PERP_BTC_USDC', currentFunding: 0.0004 });
  });

  it('parses Aevo market and funding data', async () => {
    mock.routeGet({ markets: [{ instrument_name: 'ETH-PERP', instrument_type: 'PERPETUAL', mark_price: '3000' }], funding: { funding_rate: '0.0005', next_epoch: 1700000000000 } });
    const result = await scanAevo();
    expect(result[0]).toMatchObject({ exchange: 'aevo', contract: 'ETH-PERP', currentFunding: 0.0005, mark_price: 3000 });
  });

  it('gracefully returns empty arrays on failures', async () => {
    mock.rejectGet();
    await expect(scanKraken()).resolves.toEqual([]);
    await expect(scanCoinbase()).resolves.toEqual([]);
    await expect(scanBitunix()).resolves.toEqual([]);
    await expect(scanAevo()).resolves.toEqual([]);
  });
});
