import { prismaMock } from './testkit';

jest.mock('../services/prisma', () => ({
  prisma: prismaMock,
  connectDatabase: jest.fn(),
  disconnectDatabase: jest.fn(),
  checkDatabaseHealth: jest.fn().mockResolvedValue({ ok: true, latencyMs: 1 }),
}));

import {
  upsertContractMetadata,
  getContractMetadata,
  getContractsByExchange,
  getContractsByCurrency,
  getStaleContracts,
  getContractStats,
} from '../services/contractMetadata.js';

describe('contractMetadata', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('buffers and creates metadata with the exchange:contract key', async () => {
    (prismaMock.contractMetadata.createMany as jest.Mock).mockResolvedValue({ count: 1 });
    await upsertContractMetadata({
      exchange: 'binance',
      contract: 'BTCUSDT',
      baseCurrency: 'BTC',
      quoteCurrency: 'USDT',
      maxLeverage: 20,
    });
    // Wait for the scheduled flush
    await new Promise((r) => setImmediate(r));
    const createMany = prismaMock.contractMetadata.createMany as jest.Mock;
    expect(createMany).toHaveBeenCalled();
    const call = createMany.mock.calls[0][0];
    expect(call.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'binance:BTCUSDT',
          exchange: 'binance',
          contract: 'BTCUSDT',
          maxLeverage: 20,
        }),
      ])
    );
  });

  it('falls back to usdt settle currency when omitted', async () => {
    (prismaMock.contractMetadata.createMany as jest.Mock).mockResolvedValue({ count: 1 });
    await upsertContractMetadata({ exchange: 'gate', contract: 'ETH_USDT' });
    await new Promise((r) => setImmediate(r));
    const call = (prismaMock.contractMetadata.createMany as jest.Mock).mock.calls[0][0];
    expect(call.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          settleCurrency: 'usdt',
        }),
      ])
    );
  });

  it('gets a single contract by key', async () => {
    (prismaMock.contractMetadata.findUnique as jest.Mock).mockResolvedValue({ key: 'gate:SOLUSDT' });
    const res = await getContractMetadata('gate:SOLUSDT');
    expect(prismaMock.contractMetadata.findUnique).toHaveBeenCalledWith({ where: { key: 'gate:SOLUSDT' } });
    expect(res).toEqual({ key: 'gate:SOLUSDT' });
  });

  it('lists contracts by exchange ordered ascending', async () => {
    (prismaMock.contractMetadata.findMany as jest.Mock).mockResolvedValue([{ contract: 'A' }, { contract: 'B' }]);
    const res = await getContractsByExchange('bybit');
    expect(prismaMock.contractMetadata.findMany).toHaveBeenCalledWith({ where: { exchange: 'bybit' }, orderBy: { contract: 'asc' } });
    expect(res).toHaveLength(2);
  });

  it('lists contracts by base or quote currency', async () => {
    (prismaMock.contractMetadata.findMany as jest.Mock).mockResolvedValue([{ contract: 'X' }]);
    await getContractsByCurrency('USDT');
    const call = (prismaMock.contractMetadata.findMany as jest.Mock).mock.calls[0][0];
    expect(call.where.OR).toEqual([{ baseCurrency: 'USDT' }, { quoteCurrency: 'USDT' }]);
  });

  it('queries stale contracts older than the cutoff', async () => {
    (prismaMock.contractMetadata.findMany as jest.Mock).mockResolvedValue([]);
    await getStaleContracts(12);
    const call = (prismaMock.contractMetadata.findMany as jest.Mock).mock.calls[0][0];
    expect(call.where.lastUpdated.lt).toBeInstanceOf(Date);
    expect(call.take).toBe(100);
  });

  it('aggregates stats by exchange', async () => {
    (prismaMock.contractMetadata.count as jest.Mock).mockResolvedValue(7);
    (prismaMock.contractMetadata.groupBy as jest.Mock).mockResolvedValue([
      { exchange: 'binance', _count: { id: 4 } },
      { exchange: 'gate', _count: { id: 3 } },
    ]);
    const stats = await getContractStats();
    expect(stats.total).toBe(7);
    expect(stats.byExchange).toEqual([
      { exchange: 'binance', count: 4 },
      { exchange: 'gate', count: 3 },
    ]);
  });
});
