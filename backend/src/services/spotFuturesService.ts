import axios from 'axios';
import { logger } from '../utils/logger.js';
import { EXCHANGE_FEES } from './arbitrageService.js';

export interface SpotFuturesOpportunity {
  pair: string;
  exchange: string;
  spotPrice: number;
  futuresPrice: number;
  basis: number; // basis = (futuresPrice - spotPrice) / spotPrice * 100
  fundingRate: number; // current 8h rate in %
  fundingRateHourly: number; // normalized hourly rate in %
  fundingIntervalHours: number;
  estAnnualFundingYield: number; // annualized funding %
  estAnnualTotalYield: number; // funding + basis yield
  netAnnualYield: number; // net of trading fees
  risk: 'LOW' | 'MEDIUM' | 'HIGH';
  direction: 'CASH_AND_CARRY' | 'REVERSE_CASH_AND_CARRY';
  volume24h: number;
}

const SUPPORTED_SF_EXCHANGES = ['binance', 'bybit', 'okx', 'gate'] as const;

/**
 * Scan spot-futures basis and funding arbitrage opportunities.
 * Strategy:
 * - When funding > 0 and futures > spot: Buy Spot + Short Futures (Cash & Carry)
 *   Earns funding rate + basis convergence at expiry/settlement.
 * - When funding < 0 and futures < spot: Sell/Short Spot + Long Futures (Reverse)
 */
export async function scanSpotFuturesOpportunities(
  exchanges: string[] = ['binance', 'bybit', 'okx', 'gate'],
  minYield: number = 5 // minimum 5% annual yield
): Promise<SpotFuturesOpportunity[]> {
  const opportunities: SpotFuturesOpportunity[] = [];
  const targetExchanges = exchanges.filter((e) =>
    SUPPORTED_SF_EXCHANGES.includes(e as any)
  );

  const results = await Promise.allSettled(
    targetExchanges.map((ex) => fetchExchangeSpotFutures(ex))
  );

  for (const res of results) {
    if (res.status === 'fulfilled' && Array.isArray(res.value)) {
      for (const opp of res.value) {
        if (Math.abs(opp.netAnnualYield) >= minYield) {
          opportunities.push(opp);
        }
      }
    }
  }

  return opportunities.sort(
    (a, b) => Math.abs(b.netAnnualYield) - Math.abs(a.netAnnualYield)
  );
}

async function fetchExchangeSpotFutures(
  exchange: string
): Promise<SpotFuturesOpportunity[]> {
  try {
    switch (exchange) {
      case 'binance':
        return await fetchBinanceSpotFutures();
      case 'bybit':
        return await fetchBybitSpotFutures();
      case 'okx':
        return await fetchOkxSpotFutures();
      case 'gate':
        return await fetchGateSpotFutures();
      default:
        return [];
    }
  } catch (err: any) {
    logger.warn({ exchange, err: err.message }, 'Spot-futures fetch failed');
    return [];
  }
}

// --------------------------------------------------------------------------
// Binance Spot + Futures
// --------------------------------------------------------------------------
async function fetchBinanceSpotFutures(): Promise<SpotFuturesOpportunity[]> {
  const [spotRes, futRes, premiumRes] = await Promise.all([
    axios.get('https://api.binance.com/api/v3/ticker/price', { timeout: 10000 }),
    axios.get('https://fapi.binance.com/fapi/v1/ticker/price', { timeout: 10000 }),
    axios.get('https://fapi.binance.com/fapi/v1/premiumIndex', { timeout: 10000 }),
  ]);

  const spotMap = new Map<string, number>();
  for (const s of spotRes.data || []) {
    if (s.symbol.endsWith('USDT')) {
      spotMap.set(s.symbol, parseFloat(s.price));
    }
  }

  const fundingMap = new Map<string, { rate: number; nextTime: number }>();
  for (const p of premiumRes.data || []) {
    if (p.symbol.endsWith('USDT')) {
      fundingMap.set(p.symbol, {
        rate: parseFloat(p.lastFundingRate || '0') * 100, // into %
        nextTime: p.nextFundingTime || 0,
      });
    }
  }

  const opps: SpotFuturesOpportunity[] = [];

  for (const f of futRes.data || []) {
    if (!f.symbol.endsWith('USDT')) continue;
    const spotPrice = spotMap.get(f.symbol);
    const futPrice = parseFloat(f.price);
    const fundInfo = fundingMap.get(f.symbol);

    if (!spotPrice || spotPrice <= 0 || !futPrice || futPrice <= 0 || !fundInfo)
      continue;

    const baseAsset = f.symbol.replace('USDT', '');
    const pair = `${baseAsset}/USDT`;

    const opp = buildOpportunity({
      pair,
      exchange: 'binance',
      spotPrice,
      futuresPrice: futPrice,
      fundingRate8h: fundInfo.rate,
      intervalHours: 8,
      volume24h: 10_000_000,
    });

    if (opp) opps.push(opp);
  }

  return opps;
}

// --------------------------------------------------------------------------
// Bybit Spot + Futures
// --------------------------------------------------------------------------
async function fetchBybitSpotFutures(): Promise<SpotFuturesOpportunity[]> {
  const [spotRes, futRes] = await Promise.all([
    axios.get('https://api.bybit.com/v5/market/tickers?category=spot', {
      timeout: 10000,
    }),
    axios.get('https://api.bybit.com/v5/market/tickers?category=linear', {
      timeout: 10000,
    }),
  ]);

  const spotMap = new Map<string, number>();
  for (const s of spotRes.data?.result?.list || []) {
    if (s.symbol.endsWith('USDT')) {
      spotMap.set(s.symbol, parseFloat(s.lastPrice));
    }
  }

  const opps: SpotFuturesOpportunity[] = [];

  for (const f of futRes.data?.result?.list || []) {
    if (!f.symbol.endsWith('USDT')) continue;
    const spotPrice = spotMap.get(f.symbol);
    const futPrice = parseFloat(f.lastPrice);
    const fundingRate = parseFloat(f.fundingRate || '0') * 100;
    const intervalHours = parseInt(f.fundingIntervalHour || '8') || 8;
    const turnover = parseFloat(f.turnover24h || '0');

    if (!spotPrice || spotPrice <= 0 || !futPrice || futPrice <= 0) continue;

    const baseAsset = f.symbol.replace('USDT', '');
    const pair = `${baseAsset}/USDT`;

    const opp = buildOpportunity({
      pair,
      exchange: 'bybit',
      spotPrice,
      futuresPrice: futPrice,
      fundingRate8h: fundingRate,
      intervalHours,
      volume24h: turnover,
    });

    if (opp) opps.push(opp);
  }

  return opps;
}

// --------------------------------------------------------------------------
// OKX Spot + Futures
// --------------------------------------------------------------------------
async function fetchOkxSpotFutures(): Promise<SpotFuturesOpportunity[]> {
  const [spotRes, swapRes] = await Promise.all([
    axios.get('https://www.okx.com/api/v5/market/tickers?instType=SPOT', {
      timeout: 10000,
    }),
    axios.get('https://www.okx.com/api/v5/market/tickers?instType=SWAP', {
      timeout: 10000,
    }),
  ]);

  const spotMap = new Map<string, number>();
  for (const s of spotRes.data?.data || []) {
    if (s.instId.endsWith('-USDT')) {
      const base = s.instId.replace('-USDT', '');
      spotMap.set(base, parseFloat(s.last));
    }
  }

  const opps: SpotFuturesOpportunity[] = [];

  for (const f of swapRes.data?.data || []) {
    if (!f.instId.endsWith('-USDT-SWAP')) continue;
    const base = f.instId.replace('-USDT-SWAP', '');
    const spotPrice = spotMap.get(base);
    const futPrice = parseFloat(f.last);
    const fundingRate = parseFloat(f.fundingRate || '0') * 100;
    const turnover = parseFloat(f.volCcy24h || '0');

    if (!spotPrice || spotPrice <= 0 || !futPrice || futPrice <= 0) continue;

    const pair = `${base}/USDT`;

    const opp = buildOpportunity({
      pair,
      exchange: 'okx',
      spotPrice,
      futuresPrice: futPrice,
      fundingRate8h: fundingRate,
      intervalHours: 8,
      volume24h: turnover,
    });

    if (opp) opps.push(opp);
  }

  return opps;
}

// --------------------------------------------------------------------------
// Gate.io Spot + Futures
// --------------------------------------------------------------------------
async function fetchGateSpotFutures(): Promise<SpotFuturesOpportunity[]> {
  const [spotRes, futRes] = await Promise.all([
    axios.get('https://api.gateio.ws/api/v4/spot/tickers', { timeout: 10000 }),
    axios.get('https://api.gateio.ws/api/v4/futures/usdt/tickers', {
      timeout: 10000,
    }),
  ]);

  const spotMap = new Map<string, number>();
  for (const s of spotRes.data || []) {
    if (s.currency_pair?.endsWith('_USDT')) {
      const base = s.currency_pair.replace('_USDT', '');
      spotMap.set(base, parseFloat(s.last));
    }
  }

  const opps: SpotFuturesOpportunity[] = [];

  for (const f of futRes.data || []) {
    if (!f.contract?.endsWith('_USDT')) continue;
    const base = f.contract.replace('_USDT', '');
    const spotPrice = spotMap.get(base);
    const futPrice = parseFloat(f.last);
    const fundingRate = parseFloat(f.funding_rate || '0') * 100;
    const volume = parseFloat(f.volume_24h_base || '0') * futPrice;

    if (!spotPrice || spotPrice <= 0 || !futPrice || futPrice <= 0) continue;

    const pair = `${base}/USDT`;

    const opp = buildOpportunity({
      pair,
      exchange: 'gate',
      spotPrice,
      futuresPrice: futPrice,
      fundingRate8h: fundingRate,
      intervalHours: 8,
      volume24h: volume,
    });

    if (opp) opps.push(opp);
  }

  return opps;
}

// --------------------------------------------------------------------------
// Helper: Build standardized opportunity
// --------------------------------------------------------------------------
function buildOpportunity(params: {
  pair: string;
  exchange: string;
  spotPrice: number;
  futuresPrice: number;
  fundingRate8h: number; // in %
  intervalHours: number;
  volume24h: number;
}): SpotFuturesOpportunity | null {
  const {
    pair,
    exchange,
    spotPrice,
    futuresPrice,
    fundingRate8h,
    intervalHours,
    volume24h,
  } = params;

  // Basis %: how much futures trade above/below spot
  const basis = ((futuresPrice - spotPrice) / spotPrice) * 100;

  // Normalized hourly funding rate %
  const fundingRateHourly = fundingRate8h / intervalHours;

  // Annualized funding yield %
  const intervalsPerYear = (365 * 24) / intervalHours;
  const estAnnualFundingYield = fundingRate8h * intervalsPerYear;

  // Basis annual yield (assuming ~30 day holding horizon)
  const basisAnnualized = basis * (365 / 30);

  // Direction logic
  const isCashAndCarry = fundingRate8h > 0;
  const direction: 'CASH_AND_CARRY' | 'REVERSE_CASH_AND_CARRY' = isCashAndCarry
    ? 'CASH_AND_CARRY'
    : 'REVERSE_CASH_AND_CARRY';

  // Fee calculation (spot taker + futures taker, round-trip: open + close)
  const spotTaker = 0.001; // ~0.1% spot fee
  const futTaker = EXCHANGE_FEES[exchange]?.taker || 0.0005;
  const totalRoundTripFeePct = (spotTaker + futTaker) * 2 * 100; // in %

  // Total annual gross yield
  // For cash & carry: earn funding, basis converges to 0 at settlement
  const estAnnualTotalYield = isCashAndCarry
    ? estAnnualFundingYield + basis
    : -estAnnualFundingYield - basis;

  // Net annual yield: Subtract the ONE-TIME round-trip entry/exit fee amortized
  // over a standard 30-day holding horizon. (Previously deducted per 8h interval,
  // which erroneously subtracted ~260% APR in fees).
  const amortizedAnnualFee = totalRoundTripFeePct * (365 / 30);
  const netAnnualYield = estAnnualTotalYield - amortizedAnnualFee;

  // Risk assessment
  let risk: 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW';
  if (Math.abs(basis) > 5 || volume24h < 500_000) {
    risk = 'HIGH';
  } else if (Math.abs(basis) > 2 || volume24h < 2_000_000) {
    risk = 'MEDIUM';
  }

  return {
    pair,
    exchange,
    spotPrice,
    futuresPrice,
    basis: Number(basis.toFixed(3)),
    fundingRate: Number(fundingRate8h.toFixed(4)),
    fundingRateHourly: Number(fundingRateHourly.toFixed(6)),
    fundingIntervalHours: intervalHours,
    estAnnualFundingYield: Number(estAnnualFundingYield.toFixed(2)),
    estAnnualTotalYield: Number(estAnnualTotalYield.toFixed(2)),
    netAnnualYield: Number(netAnnualYield.toFixed(2)),
    risk,
    direction,
    volume24h: Math.round(volume24h),
  };
}
