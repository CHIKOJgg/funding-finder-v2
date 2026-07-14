export type PositionSide = 'long' | 'short';

export interface PnlInput {
  side: PositionSide;
  sizeUsd: number;
  leverage: number;
  ratePerHour: number; // normalized hourly funding rate as a fraction
  openedAtMs: number;
  nowMs?: number;
}

export interface PnlResult {
  hoursHeld: number;
  fundingIncome: number; // simulated accumulated funding income (USD)
  annualizedPct: number; // simulated annualized yield on notional (%)
  projectedYearly: number; // simulated yearly funding income (USD)
}

export function sideSign(side: PositionSide): number {
  // Crypto perpetual convention: positive funding rate means longs PAY shorts.
  // So longs have negative income when rate > 0, shorts have positive income.
  return side === 'long' ? -1 : 1;
}

/**
 * Simulate accumulated funding income for a paper position.
 *
 * Positive funding rate: longs PAY shorts (long income negative, short positive).
 * Negative funding rate: shorts PAY longs (long income positive, short negative).
 * Funding is charged on the notional value (sizeUsd * leverage).
 *
 * This is purely a calculation — no exchange keys, no real positions.
 */
export function calcFundingIncome(input: PnlInput): PnlResult {
  const now = input.nowMs ?? Date.now();
  const hoursHeld = Math.max(0, (now - input.openedAtMs) / (1000 * 60 * 60));
  const sign = sideSign(input.side);
  const notional = input.sizeUsd * (input.leverage || 1);

  const fundingIncome = input.ratePerHour * notional * hoursHeld * sign;
  const annualizedPct = input.ratePerHour * 24 * 365 * 100 * sign;
  const projectedYearly = input.ratePerHour * notional * 24 * 365 * sign;

  return {
    hoursHeld,
    fundingIncome,
    annualizedPct,
    projectedYearly,
  };
}
