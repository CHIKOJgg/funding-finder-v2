// Privacy-first, self-hosted funnel analytics for the marketing + growth loop.
// Events are batched into the FunnelEvent table (no PII) so the CMO dashboard
// and A/B tests run without any third-party tracker (GA, Meta, etc.).
//
// Attribution is persisted in localStorage on the landing page (source + A/B
// variant) and read back when the SPA fires in-app events, so
// landing_view → app_open → scan_run → ... stays linked per browser.

export type TrackEvent =
  | 'landing_view'
  | 'app_open'
  | 'scan_run'
  | 'paywall_view'
  | 'trial_start'
  | 'paid';

const API_URL = (import.meta.env.VITE_API_URL || 'https://funding-finder-api.onrender.com')
  .replace(/\/$/, '');

const SESSION_KEY = 'ff_analytics_session';
const SRC_KEY = 'ff_src';
const VARIANT_KEY = 'ff_ab_variant';

function getSessionId(): string {
  try {
    let id = localStorage.getItem(SESSION_KEY);
    if (!id) {
      id = 's_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return 'anon';
  }
}

// A/B variant: forced via ?v=A|B (campaign/QA), else a stable per-browser
// assignment so a returning visitor always sees the same headline.
export function assignVariant(): string {
  try {
    const params = new URLSearchParams(location.search);
    const forced = params.get('v');
    if (forced === 'A' || forced === 'B') {
      localStorage.setItem(VARIANT_KEY, forced);
      return forced;
    }
    let v = localStorage.getItem(VARIANT_KEY);
    if (!v) {
      v = Math.random() < 0.5 ? 'A' : 'B';
      localStorage.setItem(VARIANT_KEY, v);
    }
    return v;
  } catch {
    return 'A';
  }
}

export function getVariant(): string | undefined {
  try {
    const params = new URLSearchParams(location.search);
    const forced = params.get('v');
    if (forced === 'A' || forced === 'B') return forced;
    return localStorage.getItem(VARIANT_KEY) || undefined;
  } catch {
    return undefined;
  }
}

function persistSource(): string | undefined {
  try {
    const params = new URLSearchParams(location.search);
    const s = params.get('utm_source');
    if (s) {
      localStorage.setItem(SRC_KEY, s);
      return s;
    }
    return localStorage.getItem(SRC_KEY) || undefined;
  } catch {
    return undefined;
  }
}

/** Fire-and-forget event. Never throws — analytics must not break the page. */
export function track(
  event: TrackEvent,
  meta?: Record<string, unknown>,
  userId?: string
): void {
  try {
    const body = {
      event,
      source: persistSource(),
      variant: getVariant(),
      sessionId: getSessionId(),
      userId: userId || undefined,
      meta: meta || undefined,
    };
    // keepalive lets the ping survive navigation (e.g. landing → app CTA).
    fetch(`${API_URL}/api/public/track`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* ignore */
  }
}
