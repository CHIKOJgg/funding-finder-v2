// Privacy-first, self-hosted funnel analytics for the marketing + growth loop.
// Events are batched into the FunnelEvent table (no PII) so the CMO dashboard
// and A/B tests run without any third-party tracker (GA, Meta, etc.).
//
// Attribution is persisted in localStorage on the landing page (source + A/B
// variant) and read back when the SPA fires in-app events, so
// landing_view → app_open → scan_run → ... stays linked per browser.

import { API_BASE } from '../api/client';

export type TrackEvent =
  | 'landing_view'
  | 'app_open'
  | 'scan_run'
  | 'paywall_view'
  | 'trial_start'
  | 'onboarding_complete'
  | 'paid';

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
  event: TrackEvent | string,
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
    fetch(`${API_BASE}/api/public/track`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* ignore */
  }
}

/** Granular user interaction telemetry (buttons, filters, errors, modals). */
export function trackAction(
  category: 'navigation' | 'interaction' | 'conversion' | 'error' | 'scan' | string,
  action: string,
  label?: string,
  value?: number,
  meta?: Record<string, unknown>,
  userId?: string
): void {
  try {
    const body = {
      event: action,
      category,
      action,
      label: label?.slice(0, 150),
      value,
      sessionId: getSessionId(),
      userId: userId || undefined,
      meta: meta || undefined,
      platform: typeof window !== 'undefined' && (window as any).Telegram?.WebApp ? 'miniapp' : 'web',
    };

    fetch(`${API_BASE}/api/public/track`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* ignore */
  }
}

/**
 * Initializes global automatic click & error listeners.
 * Call once at app startup in main.tsx or App.tsx.
 */
export function initAutoTracker(getUserId?: () => string | undefined): () => void {
  if (typeof window === 'undefined') return () => {};

  // 1. Global click listener for buttons, links, and interactive elements
  const handleClick = (e: MouseEvent) => {
    try {
      const target = e.target as HTMLElement | null;
      if (!target) return;

      const clickable = target.closest('button, a, input[type="submit"], [role="button"], [data-track]');
      if (!clickable) return;

      // Extract meaningful label
      const trackAttr = clickable.getAttribute('data-track');
      const ariaLabel = clickable.getAttribute('aria-label');
      const title = clickable.getAttribute('title');
      const textContent = clickable.textContent?.trim().slice(0, 60);

      const label = trackAttr || ariaLabel || title || textContent || clickable.tagName.toLowerCase();
      const action = trackAttr ? `click_${trackAttr}` : 'button_click';

      const userId = getUserId ? getUserId() : undefined;
      trackAction('interaction', action, label, undefined, { path: window.location.pathname }, userId);
    } catch {
      /* ignore */
    }
  };

  // 2. Global error listener
  const handleError = (e: ErrorEvent) => {
    try {
      const msg = e.message || 'Script Error';
      const userId = getUserId ? getUserId() : undefined;
      trackAction('error', 'client_error', msg, undefined, {
        filename: e.filename,
        lineno: e.lineno,
        colno: e.colno,
        path: window.location.pathname,
      }, userId);
    } catch {
      /* ignore */
    }
  };

  // 3. Unhandled promise rejections
  const handleRejection = (e: PromiseRejectionEvent) => {
    try {
      const reason = typeof e.reason === 'string' ? e.reason : e.reason?.message || 'Unhandled Rejection';
      const userId = getUserId ? getUserId() : undefined;
      trackAction('error', 'promise_rejection', reason, undefined, {
        path: window.location.pathname,
      }, userId);
    } catch {
      /* ignore */
    }
  };

  window.addEventListener('click', handleClick, true);
  window.addEventListener('error', handleError);
  window.addEventListener('unhandledrejection', handleRejection);

  return () => {
    window.removeEventListener('click', handleClick, true);
    window.removeEventListener('error', handleError);
    window.removeEventListener('unhandledrejection', handleRejection);
  };
}
