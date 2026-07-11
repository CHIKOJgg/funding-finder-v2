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
  return side === 'long' ? 1 : -1;
}

/**
 * Simulate accumulated funding income for a paper position.
 *
 * Longs receive funding when the rate is positive; shorts pay it. Using a
 * representative (latest known) hourly rate, the accumulated income is:
 *   ratePerHour * sizeUsd * hoursHeld * sideSign
 *
 * This is purely a calculation — no exchange keys, no real positions.
 */
export function calcFundingIncome(input: PnlInput): PnlResult {
  const now = input.nowMs ?? Date.now();
  const hoursHeld = Math.max(0, (now - input.openedAtMs) / (1000 * 60 * 60));
  const sign = sideSign(input.side);

  const fundingIncome = input.ratePerHour * input.sizeUsd * hoursHeld * sign;
  const annualizedPct = input.ratePerHour * 24 * 365 * 100 * sign;
  const projectedYearly = input.ratePerHour * input.sizeUsd * 24 * 365 * sign;

  return {
    hoursHeld,
    fundingIncome,
    annualizedPct,
    projectedYearly,
  };
}
