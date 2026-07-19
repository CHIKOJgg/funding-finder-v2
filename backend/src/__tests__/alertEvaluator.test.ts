import { prismaMock } from './testkit';
import type { ExchangeResult, ScanResult } from '../types/index.js';

jest.mock('../services/prisma', () => ({
  prisma: prismaMock,
  connectDatabase: jest.fn(),
  disconnectDatabase: jest.fn(),
  checkDatabaseHealth: jest.fn().mockResolvedValue({ ok: true, latencyMs: 1 }),
}));

jest.mock('../exchanges/index.js', () => ({
  SUPPORTED_EXCHANGES: ['gate', 'binance'],
  scanExchanges: jest.fn(),
}));

jest.mock('../services/scanService.js', () => ({
  runScan: jest.fn(),
  getCachedScan: jest.fn(),
  scanCacheKey: jest.fn(),
}));

jest.mock('../services/telegramNotify.js', () => ({
  sendAlertNotification: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../services/emailNotify.js', () => ({
  sendAlertEmail: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../services/pushoverNotify.js', () => ({
  sendPushoverAlert: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../services/spreadNotifier.js', () => ({
  notifyNewSpreads: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../services/websocket.js', () => ({
  wsManager: { sendToUser: jest.fn() },
}));

import { runScan } from '../services/scanService.js';
import { startAlertEvaluator, stopAlertEvaluator } from '../services/alertEvaluator.js';
import { notifyNewSpreads } from '../services/spreadNotifier.js';
import { wsManager } from '../services/websocket.js';

const mockRunScan = runScan as jest.Mock;

function mk(partial: Partial<ExchangeResult> & Pick<ExchangeResult, 'exchange' | 'contract' | 'funding_rate_per_hour'>): ExchangeResult {
  return {
    currentFunding: partial.funding_rate_per_hour,
    funding_interval_seconds: 28800,
    funding_interval_hours: 8,
    funding_interval_source: 'default',
    funding_rate_per_day: partial.funding_rate_per_hour * 3,
    annualized_rate: partial.funding_rate_per_hour * 3 * 365,
    funding_next_apply: 0,
    time_until_next_funding_seconds: 0,
    mark_price: 60000,
    volume_24h_settle: 10_000_000,
    med_seconds: 28800,
    med_hours: 8,
    ...partial,
  } as ExchangeResult;
}

function scanWith(item: ExchangeResult): ScanResult {
  return {
    highYield: [item],
    mediumYield: [],
    lowYield: [],
    hourly: [],
    twohour: [],
    fallback: [],
    scanned: 1,
    metrics: { minFundingUsed: 0.000001, totalOpportunities: 1, exchanges: [item.exchange], averageIntervalHours: 8, intervalDistribution: { '8h': 1 } },
  };
}

describe('alertEvaluator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // `findMany` mocks must resolve to arrays (the evaluator indexes `.length`).
    (prismaMock.user.findMany as jest.Mock).mockResolvedValue([]);
    (prismaMock.generalAlert.findMany as jest.Mock).mockResolvedValue([]);
    (prismaMock.arbitrageAlert.findMany as jest.Mock).mockResolvedValue([]);
    (prismaMock.generalAlert.update as jest.Mock).mockResolvedValue({});
    (prismaMock.arbitrageAlert.update as jest.Mock).mockResolvedValue({});
    (prismaMock.alertTrigger.create as jest.Mock).mockResolvedValue({});
  });

  afterEach(() => {
    stopAlertEvaluator();
    jest.useRealTimers();
  });

  it('starts and stops without leaking a timer', () => {
    expect(() => {
      startAlertEvaluator();
      stopAlertEvaluator();
    }).not.toThrow();
    // Calling start again should be a no-op (already stopped).
    expect(() => startAlertEvaluator()).not.toThrow();
    stopAlertEvaluator();
  });

  it('does not evaluate alerts when none are active', async () => {
    jest.useFakeTimers();
    // All alert lists are empty here (findMany mocks default to [] in beforeEach),
    // so the evaluator should return early without performing a scan.
    mockRunScan.mockResolvedValue(scanWith(mk({ exchange: 'binance', contract: 'BTCUSDT', funding_rate_per_hour: 0.0002 })));

    startAlertEvaluator();
    await jest.advanceTimersByTimeAsync(5 * 60 * 1000);

    // Empty alert lists -> early return, no scan performed.
    expect(mockRunScan).not.toHaveBeenCalled();
    expect(prismaMock.alertTrigger.create).not.toHaveBeenCalled();
  });

  it('triggers a general alert when the rate crosses the threshold', async () => {
    jest.useFakeTimers();
    // Return the general alert; arbitrage/user lookups default to [] in beforeEach.
    (prismaMock.generalAlert.findMany as jest.Mock).mockResolvedValue([
      { id: 'a1', userId: 'tg_123', pair: 'BTC', exchange: 'binance', condition: 'above', threshold: 0.00001, cooldown: 0, lastTriggered: null },
    ]);
    mockRunScan.mockResolvedValue(scanWith(mk({ exchange: 'binance', contract: 'BTCUSDT', funding_rate_per_hour: 0.0002 })));

    startAlertEvaluator();
    await jest.advanceTimersByTimeAsync(5 * 60 * 1000);

    expect(prismaMock.alertTrigger.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.generalAlert.update).toHaveBeenCalled();
    expect(wsManager.sendToUser).toHaveBeenCalled();
    expect(notifyNewSpreads).toHaveBeenCalled();
  });

  it('does NOT trigger when the rate is below the threshold', async () => {
    jest.useFakeTimers();
    (prismaMock.generalAlert.findMany as jest.Mock).mockResolvedValue([
      { id: 'a1', userId: 'tg_123', pair: 'BTC', exchange: 'binance', condition: 'above', threshold: 0.0005, cooldown: 0, lastTriggered: null },
    ]);
    mockRunScan.mockResolvedValue(scanWith(mk({ exchange: 'binance', contract: 'BTCUSDT', funding_rate_per_hour: 0.0002 })));

    startAlertEvaluator();
    await jest.advanceTimersByTimeAsync(5 * 60 * 1000);

    expect(prismaMock.alertTrigger.create).not.toHaveBeenCalled();
  });
});
