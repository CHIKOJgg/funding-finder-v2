/**
 * Unit tests for src/utils/featureFlags.ts
 */
import { featureFlags } from '../utils/featureFlags.js';

const ALL_FLAG_NAMES = [
  'websocket',
  'daily_summary',
  'csv_export',
  'advanced_analytics',
  'batch_alerts',
  'ai_analysis',
  'arbitrage_detection',
  'alert_evaluator',
  'api_docs',
];

beforeEach(() => {
  // Remove any overrides set by previous tests to keep flags isolated.
  for (const name of ALL_FLAG_NAMES) featureFlags.clearOverride(name);
});

describe('isEnabled / getAllFlags', () => {
  test('default flags are enabled by default', () => {
    expect(featureFlags.isEnabled('websocket')).toBe(true);
    expect(featureFlags.isEnabled('arbitrage_detection')).toBe(true);
  });

  test('unknown flag is disabled', () => {
    expect(featureFlags.isEnabled('nope')).toBe(false);
  });

  test('getAllFlags returns every default flag with overridden flag', () => {
    featureFlags.setOverride('websocket', false);
    const all = featureFlags.getAllFlags();
    const names = all.map((f) => f.name);
    for (const n of ALL_FLAG_NAMES) expect(names).toContain(n);

    const ws = all.find((f) => f.name === 'websocket')!;
    expect(ws.overridden).toBe(true);
    // getAllFlags returns the *default* flag object; `overridden` marks that a
    // live override exists. The effective state is read via isEnabled().
    expect(ws.enabled).toBe(true);
  });
});

describe('setOverride / clearOverride (enable/disable)', () => {
  test('disabling a flag via override', () => {
    expect(featureFlags.isEnabled('websocket')).toBe(true);
    featureFlags.setOverride('websocket', false);
    expect(featureFlags.isEnabled('websocket')).toBe(false);
  });

  test('enabling a disabled-by-default flag via override', () => {
    // Clear overrides then force-disable, then re-enable
    featureFlags.setOverride('websocket', false);
    expect(featureFlags.isEnabled('websocket')).toBe(false);
    featureFlags.setOverride('websocket', true);
    expect(featureFlags.isEnabled('websocket')).toBe(true);
  });

  test('clearOverride restores default behavior', () => {
    featureFlags.setOverride('websocket', false);
    expect(featureFlags.isEnabled('websocket')).toBe(false);
    featureFlags.clearOverride('websocket');
    expect(featureFlags.isEnabled('websocket')).toBe(true);
  });
});

describe('hasAccess (tier gating)', () => {
  test('flag without minTier is accessible to all', () => {
    expect(featureFlags.hasAccess('websocket', 'free')).toBe(true);
  });

  test('minTier flag respects tier order', () => {
    // daily_summary requires at least 'pro'
    expect(featureFlags.hasAccess('daily_summary', 'free')).toBe(false);
    expect(featureFlags.hasAccess('daily_summary', 'pro')).toBe(true);
  });

  test('pro flag requires pro tier', () => {
    expect(featureFlags.hasAccess('advanced_analytics', 'free')).toBe(false);
    expect(featureFlags.hasAccess('advanced_analytics', 'pro')).toBe(true);
    expect(featureFlags.hasAccess('advanced_analytics', 'proplus')).toBe(true);
  });

  test('disabled flag is never accessible regardless of tier', () => {
    featureFlags.setOverride('daily_summary', false);
    expect(featureFlags.hasAccess('daily_summary', 'pro')).toBe(false);
  });
});
