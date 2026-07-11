// Shared types for read-only / trade exchange adapters used by the live PnL
// dashboard and (gated) auto-execute. Each adapter talks to a single exchange
// using the user's API credentials (fetched decrypted server-side only).

export interface NormalizedPosition {
  exchange: string;
  symbol: string;
  side: 'long' | 'short';
  size: number; // absolute base-asset quantity
  notional: number; // absolute USDT notional (size * markPrice)
  entryPrice: number;
  markPrice: number;
  leverage: number;
  unrealizedPnl: number; // USDT
  fundingIntervalHours?: number; // real per-contract funding interval (hours)
}

export interface NormalizedFundingIncome {
  symbol: string;
  income: number; // USDT
  time: number; // ms epoch
  type: string; // e.g. 'FUNDING'
}

export interface Credentials {
  apiKey: string;
  secret: string;
  passphrase?: string;
}

export interface ExchangeAdapter {
  exchange: string;
  // Whether this adapter can place orders (auto-execute). Read-only adapters
  // simply omit this.
  supportsTrading: boolean;
  getPositions(creds: Credentials): Promise<NormalizedPosition[]>;
  getFundingIncome(creds: Credentials, opts?: { symbol?: string; limit?: number }): Promise<NormalizedFundingIncome[]>;
  placeMarketOrder?(
    creds: Credentials,
    params: {
      symbol: string;
      side: 'long' | 'short';
      notionalUsd: number;
      maxSlippageBps?: number;
    }
  ): Promise<any>;
}
