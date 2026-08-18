import axios from 'axios';
import { logger } from '../utils/logger';

// ---------------------------------------------------------------------------
// Client-side 429 backoff (global, applies to every request)
// Once the server rate-limits us we stop hammering it: every request is paused
// for `backoffUntil`, then we slow to one request per `minIntervalMs`. This is
// what prevents a 429 from escalating into a retry storm that keeps the limiter
// permanently tripped.
// ---------------------------------------------------------------------------
let backoffUntil = 0;
let minIntervalMs = 0;
const lastRequestAt: { t: number } = { t: 0 };

function onRateLimited(retryAfterHeader?: string) {
  const retry = retryAfterHeader ? Number(retryAfterHeader) * 1000 : 0;
  const wait = Math.max(retry, 30_000);
  backoffUntil = Date.now() + wait;
  minIntervalMs = 2000;
  logger.warn('net', `429 rate-limited — backing off ${wait}ms, throttling to 1 req/2s`);
}

export function isBackingOff(): boolean {
  if (Date.now() >= backoffUntil) {
    minIntervalMs = 0;
    return false;
  }
  return true;
}

async function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  if (now >= backoffUntil) {
    minIntervalMs = 0;
  }
  const waitFor = Math.max(backoffUntil - now, minIntervalMs ? minIntervalMs - (now - lastRequestAt.t) : 0);
  if (waitFor > 0) await new Promise((r) => setTimeout(r, waitFor));
  lastRequestAt.t = Date.now();
  return fn();
}

// Shared API base URL. Used by keep-alive pings (App.tsx), analytics
// (analytics.ts), and the axios client below. The fallback to
// localhost avoids hardcoding a deployment URL in multiple places.
export const API_BASE = (import.meta.env.VITE_API_URL || window.location.origin)
  .replace(/\/$/, '');

const api = axios.create({
  baseURL: API_BASE ? `${API_BASE}/api` : '/api',
  timeout: 45000,
  headers: {
    'Content-Type': 'application/json',
  },
});

let telegramInitData: string | null = null;

// localStorage can throw in privacy/incognito modes or when disabled — the
// module-level read must never brick the whole app.
function safeGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeSet(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
}
function safeRemove(key: string): void {
  try { localStorage.removeItem(key); } catch { /* storage unavailable */ }
}

let authToken: string | null = safeGet('ff_auth_token');

export function setTelegramInitData(data: string | null) {
  telegramInitData = data;
}

export function setAuthToken(token: string | null) {
  authToken = token;
  if (token) safeSet('ff_auth_token', token);
  else safeRemove('ff_auth_token');
}

export function getAuthToken(): string | null {
  return authToken;
}

export function clearAuthToken() {
  setAuthToken(null);
}

// Referral code capture from URL (?ref=CODE) — stored once, consumed by auth
const REFERRAL_STORAGE_KEY = 'ff_referral_code';
export function captureReferralCode() {
  const url = new URL(window.location.href);
  const ref = url.searchParams.get('ref');
  if (ref) {
    safeSet(REFERRAL_STORAGE_KEY, ref);
    url.searchParams.delete('ref');
    window.history.replaceState({}, '', url.toString());
  }
}
export function getStoredReferralCode(): string | undefined {
  return safeGet(REFERRAL_STORAGE_KEY) || undefined;
}
export function clearReferralCode() {
  safeRemove(REFERRAL_STORAGE_KEY);
}

api.interceptors.request.use((config) => {
  // Web session (wallet / Google) — preferred when present.
  if (authToken) {
    config.headers['Authorization'] = `Bearer ${authToken}`;
  }
  // Telegram Mini App init data (used by the mini-app build).
  if (telegramInitData) {
    config.headers['x-telegram-init-data'] = telegramInitData;
  }
  (config as any)._startedAt = Date.now();
  logger.debug('net', `${String(config.method || 'GET').toUpperCase()} ${config.url || ''}`, {
    auth: Boolean(authToken || telegramInitData),
  });
  return config;
});

// Retry logic that works with raw Axios requests (before interceptor transforms)
async function retryRequest<T>(
  fn: () => Promise<T>,
  retries: number = 2,
  delay: number = 1000
): Promise<T> {
  let lastError: Error | undefined;
  for (let i = 0; i <= retries; i++) {
    try {
      // Honour the global 429 backoff + per-request throttle before each attempt.
      await throttled(async () => undefined);
      return await fn();
    } catch (err) {
      lastError = err as Error;
      const status = axios.isAxiosError(err) ? err.response?.status : (err as any).status;
      logger.warn('net', `request attempt ${i + 1}/${retries + 1} failed${status ? ` (${status})` : ''}: ${(err as Error).message}`);
      // Check raw Axios error before interceptor transforms it
      if (axios.isAxiosError(err) || status !== undefined) {
        const st = axios.isAxiosError(err) ? err.response?.status : status;
        // 429 rate-limit: trigger the global backoff so we stop hammering the
        // server (retrying only worsens the storm), then surface it immediately.
        if (st === 429) {
          onRateLimited((err as any).retryAfter ? String((err as any).retryAfter) : undefined);
          throw lastError;
        }
        // Other 4xx are client errors and must not be retried. 418 (Binance
        // WAF) is the one 4xx worth a single backoff retry.
        if (st && st >= 400 && st < 500 && st !== 418) {
          throw lastError;
        }
      }
      if (i < retries) {
        await new Promise((resolve) => setTimeout(resolve, delay * Math.pow(2, i)));
      }
    }
  }
  logger.error('net', `request failed after ${retries + 1} attempts: ${(lastError as Error)?.message}`);
  throw lastError;
}

// Response interceptor: transform success data and error messages
let authExpiredNotifiedAt = 0;
const AUTH_EXPIRED_EVENT = 'ff:auth-expired';

function notifyAuthExpired() {
  // Throttle: at most one notification per 30s (polling loops would otherwise
  // spam the event on every concurrent 401).
  const now = Date.now();
  if (now - authExpiredNotifiedAt < 30_000) return;\n  authExpiredNotifiedAt = now;\n  try {\n    window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT));\n  } catch {\n    /* non-DOM environments */\n  }\n}\n\nexport function onAuthExpired(listener: () => void): () => void {\n  try {\n    window.addEventListener(AUTH_EXPIRED_EVENT, listener);\n    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, listener);\n  } catch {\n    return () => {};\n  }\n}\n\n// Endpoints that must NEVER trigger the session-expired flow (unauthenticated\n// by design, or handling their own auth failures).\nconst AUTH_EXEMPT_PATHS = ['/auth/login', '/auth/register', '/auth/google', '/auth/wallet/verify', '/auth/wallet/nonce', '/auth/dev-guest', '/qr-login/verify'];\n\napi.interceptors.response.use(\n  (response) => {\n    const ms = Date.now() - (((response.config as any)._startedAt as number) || Date.now());\n    logger.info('net', `${response.status} ${String(response.config.method || 'GET').toUpperCase()} ${response.config.url || ''} (${ms}ms)`);\n    return response.data;\n  },\n  (error) => {\n    const res = error.response;\n    const ms = res ? Date.now() - (((res.config as any)._startedAt as number) || Date.now()) : 0;\n    const message = res?.data?.error || error.message || 'Network error';\n    logger.error('net', `${res?.status || 'ERR'} ${error.config?.method?.toUpperCase?.() || 'GET'} ${error.config?.url || ''} (${ms}ms): ${message}`);\n    const err = new Error(message);\n    (err as any).status = res?.status;\n    // Surface rate-limit responses as a distinct, recoverable condition so\n    // callers can show a friendly message and back off instead of crashing\n    // or hammering the server.\n    if (res && res.status === 429) {\n      const retryAfter = res.headers?.['retry-after'];\n      (err as any).rateLimited = true;\n      (err as any).retryAfter = retryAfter ? Number(retryAfter) : undefined;\n    }\n    // Expired / invalid session: notify the app so it can drop the stale token\n    // and prompt for re-auth instead of silently degrading to \"free\".\n    if (res && res.status === 401) {\n      const url = String(error.config?.url || '');\n      const exempt = AUTH_EXEMPT_PATHS.some((p) => url.includes(p));\n      if (!exempt) notifyAuthExpired();\n      (err as any).authExpired = true;\n    }\n    return Promise.reject(err);\n  }\n);\n\nexport const apiClient = {\n  // Client-side cache for instant profile / settings rendering\n  _profileCache: null as { data: any; at: number } | null,\n  _settingsCache: null as { data: any; at: number } | null,\n\n  clearProfileCache() {\n    this._profileCache = null;\n  },\n\n  clearSettingsCache() {\n    this._settingsCache = null;\n  },\n\n  async scan(exchanges: string[]) {\n    // Scans hit many exchange APIs (hundreds of contracts) and can take a while\n    // on a cold cache, so allow a much longer timeout than the global default.\n    return retryRequest(() => api.post('/scan', { exchanges }, { timeout: 120000 }));\n  },\n\n  async aiAnalyze(listText: string) {\n    return retryRequest(() => api.post('/ai', { listText }));\n  },\n\n  async getRecommendations(list: any[], capital: number) {\n    return retryRequest(() => api.post('/recommend', { list, capital }));\n  },\n\n  async getArbitrageOpportunities(exchanges?: string[]) {\n    const params = exchanges ? { exchanges: exchanges.join(',') } : {};\n    // This endpoint runs a full multi-exchange scan server-side, which can take\n    // well over the default timeout, so allow a longer window.\n    return retryRequest(() => api.get('/arbitrage/opportunities', { params, timeout: 120000 }));\n  },\n\n  async calculateProfit(opportunity: any, capital: number) {\n    return retryRequest(() => api.post('/arbitrage/calculate-profit', { opportunity, capital }));\n  },\n\n  async getBacktest(pair: string, exchangeA: string, exchangeB: string, capital: number, days = 30) {\n    return retryRequest(() => api.get('/arbitrage/backtest', { params: { pair, exchangeA, exchangeB, capital, days } }));\n  },\n\n  async getHistory(exchange: string, contract: string, limit = 100, offset = 0) {\n    return retryRequest(() => api.get(`/history/${exchange}/${contract}`, { params: { limit, offset } }));\n  },\n\n  async createOrder(planId: string, options?: { provider?: 'crypto_pay' | 'nowpayments'; payCurrency?: string; currency?: string }) {\n    this.clearProfileCache();\n    return api.post('/createOrder', {\n      planId,\n      provider: options?.provider || 'crypto_pay',\n      payCurrency: options?.payCurrency,\n      currency: options?.currency || 'USDT',\n    });\n  },\n\n  async getOrderStatus(orderId: string) {\n    return retryRequest(() => api.get(`/orderStatus/${orderId}`));\n  },\n\n  async withdraw(amount: number, currency: string, address: string, network: string) {\n    this.clearProfileCache();\n    return api.post('/withdraw', { amount, currency, address, network });\n  },\n\n  async getWithdrawalHistory() {\n    return retryRequest(() => api.get('/withdrawalHistory'));\n  },\n\n  async getPaymentHistory() {\n    return retryRequest(() => api.get('/paymentHistory'));\n  },\n\n  async getBalance() {\n    return retryRequest(() => api.get('/balance'));\n  },\n\n  async getReferralLink() {\n    return retryRequest(() => api.get('/referral/link'));\n  },\n\n  async getReferralList() {\n    return retryRequest(() => api.get('/referral/list'));\n  },\n\n  async createGeneralAlert(data: { pair: string; exchange: string; condition: string; threshold: number }) {\n    return api.post('/alerts', data);\n  },\n\n  async getGeneralAlerts() {\n    return retryRequest(() => api.get('/alerts'));\n  },\n\n  async toggleGeneralAlert(alertId: string) {\n    return api.post(`/alerts/${alertId}/toggle`);\n  },\n\n  async deleteGeneralAlert(alertId: string) {\n    return api.delete(`/alerts/${alertId}`);\n  },\n\n  async createArbitrageAlert(data: {\n    pair: string;\n    exchangeA: string;\n    exchangeB: string;\n    condition?: string;\n    threshold?: number;\n    direction?: string;\n  }) {\n    return api.post('/alerts/arbitrage', data);\n  },\n\n  async getArbitrageAlerts() {\n    return retryRequest(() => api.get('/alerts/arbitrage'));\n  },\n\n  async toggleArbitrageAlert(alertId: string) {\n    return api.post(`/alerts/arbitrage/${alertId}/toggle`);\n  },\n\n  async deleteArbitrageAlert(alertId: string) {\n    return api.delete(`/alerts/arbitrage/${alertId}`);\n  },\n\n  async getProfile(force = false) {\n    const now = Date.now();\n    if (!force && this._profileCache && now - this._profileCache.at < 10000) {\n      return this._profileCache.data;\n    }\n    const res = await retryRequest(() => api.get('/profile'));\n    if (res && (res as any).ok) {\n      this._profileCache = { data: res, at: now };\n    }\n    return res;\n  },\n\n  async getAlertHistory(alertId: string, limit: number = 50) {\n    return retryRequest(() => api.get(`/alerts/${alertId}/history`, { params: { limit } }));\n  },\n\n  async exportCsv(exchange?: string, days: number = 7) {\n    const params: any = { days };\n    if (exchange) params.exchange = exchange;\n    return retryRequest(() => api.get('/export/csv', { params, responseType: 'blob' }));\n  },\n\n  // Settings\n  async getSettings(force = false) {\n    const now = Date.now();\n    if (!force && this._settingsCache && now - this._settingsCache.at < 15000) {\n      return this._settingsCache.data;\n    }\n    const res = await retryRequest(() => api.get('/settings'));\n    if (res && (res as any).ok) {\n      this._settingsCache = { data: res, at: now };\n    }\n    return res;\n  },\n\n  async updateSettings(settings: Record<string, any>) {\n    this._settingsCache = { data: { ok: true, settings }, at: Date.now() };\n    const res = await api.put('/settings', settings);\n    if (res && (res as any).ok) {\n      this._settingsCache = { data: res, at: Date.now() };\n    }\n    return res;\n  },\n\n  async resetSettings() {\n    this.clearSettingsCache();\n    return api.post('/settings/reset');\n  },\n\n  // Analytics\n  async getTrends(exchange: string, contract: string, days: number = 7) {\n    return retryRequest(() => api.get(`/analytics/trends/${exchange}/${contract}`, { params: { days } }));\n  },\n\n  async getTopMovers(days: number = 1) {\n    return retryRequest(() => api.get('/analytics/top-movers', { params: { days } }));\n  },\n\n  async getExchangeStats() {\n    return retryRequest(() => api.get('/analytics/exchange-stats'));\n  },\n\n  // Batch operations\n  async batchToggleAlerts(alertIds: string[], isActive: boolean) {\n    return api.post('/alerts/batch/toggle', { alertIds, isActive });\n  },\n\n  async batchDeleteAlerts(alertIds: string[]) {\n    return api.post('/alerts/batch/delete', { alertIds });\n  },\n\n  // Generic HTTP methods (for admin panel, etc.)\n  async get<T = any>(url: string) {\n    return api.get(url) as Promise<T>;\n  },\n\n  async post<T = any>(url: string, data?: any) {\n    return api.post(url, data) as Promise<T>;\n  },\n\n  async put<T = any>(url: string, data?: any) {\n    return api.put(url, data) as Promise<T>;\n  },\n\n  async patch<T = any>(url: string, data?: any) {\n    return api.patch(url, data) as Promise<T>;\n  },\n\n  async delete<T = any>(url: string) {\n    return api.delete(url) as Promise<T>;\n  },\n\n  // Admin Withdrawals\n  async getAdminWithdrawals(status?: string, limit: number = 50, offset: number = 0) {\n    const params: any = { limit, offset };\n    if (status && status !== 'all') params.status = status;\n    return api.get('/admin/withdrawals', { params }) as Promise<any>;\n  },\n\n  async completeAdminWithdrawal(id: string, transactionId?: string) {\n    return api.patch(`/admin/withdrawals/${id}/complete`, { transactionId }) as Promise<any>;\n  },\n\n  async rejectAdminWithdrawal(id: string) {\n    return api.patch(`/admin/withdrawals/${id}/reject`) as Promise<any>;\n  },\n\n  // ---- Trial ----\n  async activateTrial() {\n    this.clearProfileCache();\n    return retryRequest(() => api.post('/trial/activate'));\n  },\n\n  async getTrialStatus() {\n    return retryRequest(() => api.get('/trial/status'));\n  },\n\n  // ---- Web auth (wallet SIWE + Google) ----\n  async getAuthConfig() {\n    return api.get('/auth/config');\n  },\n\n  async walletNonce(address: string) {\n    return api.get(`/auth/wallet/nonce`, { params: { address } });\n  },\n\n  async walletVerify(message: string, signature: string) {\n    const referredByCode = getStoredReferralCode();\n    const res: any = await api.post('/auth/wallet/verify', { message, signature, referredByCode });\n    // The response interceptor already unwraps to response.data, so `res.ok`\n    // is the correct check (not res.data?.ok — that is always undefined and\n    // would leak the referral code into the next registration).\n    if (res?.ok) clearReferralCode();\n    return res;\n  },\n\n  async googleLogin(idToken: string) {\n    const referredByCode = getStoredReferralCode();\n    const res: any = await api.post('/auth/google', { idToken, referredByCode });\n    if (res?.ok) clearReferralCode();\n    return res;\n  },\n\n  async emailRegister(email: string, password: string, firstName?: string) {\n    const referredByCode = getStoredReferralCode();\n    const res: any = await api.post('/auth/register', { email, password, firstName, referredByCode });\n    if (res?.ok) clearReferralCode();\n    return res;\n  },\n\n  async emailLogin(email: string, password: string) {\n    return api.post('/auth/login', { email, password });\n  },\n\n  async getMe() {\n    return api.get('/auth/me');\n  },\n\n  // Dev-only: mint a guest session (no real auth) for local development.\n  async devGuest() {\n    return api.post('/auth/dev-guest');\n  },\n\n  // Dev-only: simulate a successful crypto payment (no real gateway).\n  async simulatePayment(orderId: string) {\n    this.clearProfileCache();\n    return api.post(`/payments/simulate/${orderId}`);\n  },\n\n  // ---- Funding calendar ----\n  async getFundingSchedule(exchanges?: string[], limit = 12) {\n    const params: any = { limit };\n    if (exchanges && exchanges.length) params.exchanges = exchanges.join(',');\n    return retryRequest(() => api.get('/funding/schedule', { params }));\n  },\n\n  // ---- APR analytics ----\n  async getApr(exchange: string, contract: string, days = 30) {\n    return retryRequest(() => api.get('/analytics/apr', { params: { exchange, contract, days } }));\n  },\n\n  // ---- Watchlist ----\n  async getWatchlist() {\n    return retryRequest(() => api.get('/watchlist'));\n  },\n\n  async addWatchlist(exchange: string, pair: string) {\n    return retryRequest(() => api.post('/watchlist', { exchange, pair }));\n  },\n\n  async removeWatchlist(exchange: string, pair: string) {\n    return api.delete('/watchlist', { data: { exchange, pair } });\n  },\n\n  // ---- Portfolio (Pro) ----\n  async getPortfolio() {\n    return retryRequest(() => api.get('/portfolio'));\n  },\n\n  async addPortfolio(data: { exchange: string; pair: string; side: 'long' | 'short'; sizeUsd: number; leverage?: number }) {\n    return retryRequest(() => api.post('/portfolio', data));\n  },\n\n  async removePortfolio(id: string) {\n    return api.delete('/portfolio', { data: { id } });\n  },\n\n  // ---- Exchange API keys + live PnL (Pro) ----\n  async getApiKeys() {\n    return retryRequest(() => api.get('/keys'));\n  },\n\n  async addApiKey(data: { exchange: string; label?: string; apiKey: string; secret: string; passphrase?: string; permissions: 'read' | 'trade' }) {\n    return retryRequest(() => api.post('/keys', data));\n  },\n\n  async deleteApiKey(id: string) {\n    return api.delete(`/keys/${id}`);\n  },\n\n  async getLivePortfolio() {\n    return retryRequest(() => api.get('/portfolio/live'));\n  },\n\n  async exportLivePortfolio() {\n    const res = await api.get('/portfolio/live/export', { responseType: 'blob' });\n    return res;\n  },\n\n  async autoExecuteOrder(data: { exchange: string; symbol: string; side: 'long' | 'short'; notionalUsd: number; confirm: true }) {\n    return retryRequest(() => api.post('/portfolio/auto-execute', data));\n  },\n\n  async getExecutedOrders() {\n    return retryRequest(() => api.get('/portfolio/orders'));\n  },\n\n  // ---- Spot-Futures (cash-and-carry) ----\n  async getSpotFutures(exchange: string, pair: string) {\n    return retryRequest(() => api.get('/arbitrage/spot-futures', { params: { exchange, pair } }));\n  },\n\n  // ---- Feature flags (gates UI features independently of subscription tier) ----\n  async getFeatureFlags() {\n    try {\n      const res: any = await retryRequest(() => api.get('/feature-flags'));\n      return res?.flags ?? [];\n    } catch {\n      return [];\n    }\n  },\n\n  // ---- Live perp prices for visible Funding rows (batched, per exchange) ----\n  // Kept for backwards compatibility; prefer getLiveBatch for multi-exchange use.\n  async getPriceBatch(exchange: string, symbols: string[]) {\n    return retryRequest(() => api.get('/price/batch', { params: { exchange, symbols: symbols.join(',') } }));\n  },\n\n  // ---- Live funding rates for visible Arbitrage rows (batched, per exchange) ----\n  async getFundingBatch(exchange: string, symbols: string[]) {\n    return retryRequest(() => api.get('/funding/batch', { params: { exchange, symbols: symbols.join(',') } }));\n  },\n\n  // ---- Unified live snapshot (ONE request per tick, all exchanges) ----\n  // Collapses the old one-request-per-exchange price+funding polling into a\n  // single call so selecting many exchanges no longer blows any rate budget.\n  // Client-side cache + 429 backoff live here so every caller benefits.\n  //\n  // Cache/dedupe: identical request sets within LIVE_BATCH_CACHE_MS are served\n  // from the last response, so overlapping tabs / re-renders never dupe a hit\n  // against the budget. While backing off after a 429 we return the last-good\n  // snapshot (so the UI stays populated) instead of hitting the limiter again.\n  LIVE_BATCH_CACHE_MS: 4000,\n  _liveBatchCache: { key: '', at: 0, data: null as any } as { key: string; at: number; data: any },\n  setProPlusRefresh(enabled: boolean) {\n    this.LIVE_BATCH_CACHE_MS = enabled ? 2000 : 4000;\n  },\n  async getLiveBatch(requests: { exchange: string; symbols: string[] }[]) {\n    const key = requests\n      .map((r) => `${r.exchange}:${[...r.symbols].sort().join(',')}`)\n      .sort()\n      .join('|');\n    const cache = this._liveBatchCache;\n    const now = Date.now();\n    if (key && cache.key === key && now - cache.at < this.LIVE_BATCH_CACHE_MS && cache.data) {\n      return cache.data;\n    }\n    // During a 429 backoff serve the last good snapshot rather than re-hitting\n    // the server and keeping the limiter permanently tripped.\n    if (isBackingOff() && cache.key && cache.data) {\n      return cache.data;\n    }\n    const res: any = await retryRequest(() => api.post('/live/batch', { requests }));\n    if (res?.ok) {\n      this._liveBatchCache = { key, at: now, data: res };\n    }\n    return res;\n  },\n\n  // QR Login: generate a token for the desktop browser to scan\n  async qrLoginRequest() {\n    const res: any = await retryRequest(() => api.post('/qr-login/request'));\n    return res;\n  },\n\n  // QR Login: poll status (long-poll, 45s timeout)\n  async qrLoginStatus(token: string) {\n    const res: any = await retryRequest(() => api.get('/qr-login/status', { params: { token } }));\n    return res;\n  },\n\n  // QR Login: verify scanned token (unauthenticated, called from desktop browser)\n  async qrLoginVerify(token: string) {\n    return retryRequest(() => api.post('/qr-login/verify', { token }));\n  },\n\n  // ── Market Data (OI, LSR, Liquidations) ──────────────────────────────\n\n  async getLatestOpenInterest(exchange: string, contract: string) {\n    const res = await retryRequest(() =>\n      api.get(`/market/open-interest/${exchange}/${contract}`)\n    );\n    return (res as any).data;\n  },\n\n  async getOpenInterestHistory(\n    exchange: string,\n    contract: string,\n    hours: number = 168\n  ) {\n    const res = await retryRequest(() =>\n      api.get('/market/open-interest-history', {\n        params: { exchange, contract, hours },\n      })\n    );\n    return (res as any).data;\n  },\n\n  async getLongShortRatio(exchange: string, contract: string) {\n    const res = await retryRequest(() =>\n      api.get(`/market/long-short-ratio/${exchange}/${contract}`)\n    );\n    return (res as any).data;\n  },\n\n  async getLongShortRatioHistory(\n    exchange: string,\n    contract: string,\n    hours: number = 168\n  ) {\n    const res = await retryRequest(() =>\n      api.get('/market/long-short-ratio-history', {\n        params: { exchange, contract, hours },\n      })\n    );\n    return (res as any).data;\n  },\n\n  async getLiquidationSnapshots(\n    exchange: string,\n    contract: string,\n    hours: number = 24\n  ) {\n    const res = await retryRequest(() =>\n      api.get(`/market/liquidation-snapshots/${exchange}/${contract}`, {\n        params: { hours },\n      })\n    );\n    return (res as any).data;\n  },\n\n  async getOiWeightedRate(\n    contract: string,\n    exchanges: string[]\n  ) {\n    const res = await retryRequest(() =>\n      api.get('/market/oi-weighted-rate', {\n        params: { contract, exchanges: exchanges.join(',') },\n      })\n    );\n    return (res as any).data;\n  },\n};\n