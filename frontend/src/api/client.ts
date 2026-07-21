import axios from 'axios';
import { logger } from '../utils/logger';

// ---------------------------------------------------------------------------
// Client-side 429 backoff (global, applies to every request)
// Once the server rate-limits us we stop hammering it: every request is paused
// for `backoffUntil`, then we slow to one request per `minIntervalMs`. This is
// what prevents a 429 from escalating into a retry storm that keeps the limiter
// permanently tripped (the old behaviour with the per-exchange batch calls).
// ---------------------------------------------------------------------------
let backoffUntil = 0;
let minIntervalMs = 0;
const lastRequestAt: { t: number } = { t: 0 };

function onRateLimited(retryAfterHeader?: string) {
  const retry = retryAfterHeader ? Number(retryAfterHeader) * 1000 : 0;
  const wait = Math.max(retry, 30_000);
  backoffUntil = Date.now() + wait;
  // After a backoff, never fire requests faster than every 2s.
  minIntervalMs = 2000;
  logger.warn('net', `429 rate-limited — backing off ${wait}ms, throttling to 1 req/2s`);
}

export function isBackingOff(): boolean {
  return Date.now() < backoffUntil;
}

async function throttled(fn: () => Promise<any>): Promise<any> {
  const now = Date.now();
  const waitFor = Math.max(backoffUntil - now, minIntervalMs ? minIntervalMs - (now - lastRequestAt.t) : 0);
  if (waitFor > 0) await new Promise((r) => setTimeout(r, waitFor));
  lastRequestAt.t = Date.now();
  return fn();
}

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ? `${import.meta.env.VITE_API_URL}/api` : '/api',
  timeout: 45000,
  headers: {
    'Content-Type': 'application/json',
  },
});

let telegramInitData: string | null = null;
let currentUserId: string | null = null;
let authToken: string | null = localStorage.getItem('ff_auth_token') || null;

export function setTelegramInitData(data: string | null) {
  telegramInitData = data;
}

export function setCurrentUserId(id: string | null) {
  currentUserId = id;
}

export function setAuthToken(token: string | null) {
  authToken = token;
  if (token) localStorage.setItem('ff_auth_token', token);
  else localStorage.removeItem('ff_auth_token');
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
    localStorage.setItem(REFERRAL_STORAGE_KEY, ref);
    url.searchParams.delete('ref');
    window.history.replaceState({}, '', url.toString());
  }
}
export function getStoredReferralCode(): string | undefined {
  return localStorage.getItem(REFERRAL_STORAGE_KEY) || undefined;
}
export function clearReferralCode() {
  localStorage.removeItem(REFERRAL_STORAGE_KEY);
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
  if (currentUserId) {
    if (config.method === 'get' || config.method === 'delete') {
      config.params = { ...config.params, userId: currentUserId };
    } else if (config.data) {
      try {
        const body = typeof config.data === 'string' ? JSON.parse(config.data) : config.data;
        if (!body.userId) {
          body.userId = currentUserId;
          config.data = JSON.stringify(body);
        }
      } catch { /* ignore parse errors */ }
    }
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
      const status = axios.isAxiosError(err) ? err.response?.status : undefined;
      logger.warn('net', `request attempt ${i + 1}/${retries + 1} failed${status ? ` (${status})` : ''}: ${(err as Error).message}`);
      // Check raw Axios error before interceptor transforms it
      if (axios.isAxiosError(err)) {
        const st = err.response?.status;
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
api.interceptors.response.use(
  (response) => {
    const ms = Date.now() - (((response.config as any)._startedAt as number) || Date.now());
    logger.info('net', `${response.status} ${String(response.config.method || 'GET').toUpperCase()} ${response.config.url || ''} (${ms}ms)`);
    return response.data;
  },
  (error) => {
    const res = error.response;
    const ms = res ? Date.now() - (((res.config as any)._startedAt as number) || Date.now()) : 0;
    const message = res?.data?.error || error.message || 'Network error';
    logger.error('net', `${res?.status || 'ERR'} ${error.config?.method?.toUpperCase?.() || 'GET'} ${error.config?.url || ''} (${ms}ms): ${message}`);
    const err = new Error(message);
    // Surface rate-limit responses as a distinct, recoverable condition so
    // callers can show a friendly message and back off instead of crashing
    // or hammering the server.
    if (res && res.status === 429) {
      const retryAfter = res.headers?.['retry-after'];
      (err as any).rateLimited = true;
      (err as any).retryAfter = retryAfter ? Number(retryAfter) : undefined;
    }
    return Promise.reject(err);
  }
);

export const apiClient = {
  async scan(exchanges: string[]) {
    // Scans hit many exchange APIs (hundreds of contracts) and can take a while
    // on a cold cache, so allow a much longer timeout than the global default.
    return retryRequest(() => api.post('/scan', { exchanges }, { timeout: 120000 }));
  },

  async aiAnalyze(listText: string) {
    return retryRequest(() => api.post('/ai', { listText }));
  },

  async getRecommendations(list: any[], capital: number) {
    return retryRequest(() => api.post('/recommend', { list, capital }));
  },

  async getArbitrageOpportunities(exchanges?: string[]) {
    const params = exchanges ? { exchanges: exchanges.join(',') } : {};
    // This endpoint runs a full multi-exchange scan server-side, which can take
    // well over the default timeout, so allow a longer window.
    return retryRequest(() => api.get('/arbitrage/opportunities', { params, timeout: 120000 }));
  },

  async calculateProfit(opportunity: any, capital: number) {
    return retryRequest(() => api.post('/arbitrage/calculate-profit', { opportunity, capital }));
  },

  async getHistory(exchange: string, contract: string, limit = 100, offset = 0) {
    return retryRequest(() => api.get(`/history/${exchange}/${contract}`, { params: { limit, offset } }));
  },

  async createOrder(planId: string, options?: { provider?: 'crypto_pay' | 'nowpayments'; payCurrency?: string; currency?: string }) {
    return api.post('/createOrder', {
      planId,
      provider: options?.provider || 'crypto_pay',
      payCurrency: options?.payCurrency,
      currency: options?.currency || 'USDT',
    });
  },

  async getOrderStatus(orderId: string) {
    return retryRequest(() => api.get(`/orderStatus/${orderId}`));
  },

  async withdraw(amount: number, currency: string, address: string, network: string) {
    return api.post('/withdraw', { amount, currency, address, network });
  },

  async getWithdrawalHistory() {
    return retryRequest(() => api.get('/withdrawalHistory'));
  },

  async getPaymentHistory() {
    return retryRequest(() => api.get('/paymentHistory'));
  },

  async getBalance() {
    return retryRequest(() => api.get('/balance'));
  },

  async getReferralLink() {
    return retryRequest(() => api.get('/referral/link'));
  },

  async getReferralList() {
    return retryRequest(() => api.get('/referral/list'));
  },

  async createGeneralAlert(data: { pair: string; exchange: string; condition: string; threshold: number }) {
    return api.post('/alerts', data);
  },

  async getGeneralAlerts() {
    return retryRequest(() => api.get('/alerts'));
  },

  async toggleGeneralAlert(alertId: string) {
    return api.post(`/alerts/${alertId}/toggle`);
  },

  async deleteGeneralAlert(alertId: string) {
    return api.delete(`/alerts/${alertId}`);
  },

  async createArbitrageAlert(data: {
    pair: string;
    exchangeA: string;
    exchangeB: string;
    condition?: string;
    threshold?: number;
    direction?: string;
  }) {
    return api.post('/alerts/arbitrage', data);
  },

  async getArbitrageAlerts() {
    return retryRequest(() => api.get('/alerts/arbitrage'));
  },

  async toggleArbitrageAlert(alertId: string) {
    return api.post(`/alerts/arbitrage/${alertId}/toggle`);
  },

  async deleteArbitrageAlert(alertId: string) {
    return api.delete(`/alerts/arbitrage/${alertId}`);
  },

  async getProfile() {
    return retryRequest(() => api.get('/profile'));
  },

  async getAlertHistory(alertId: string, limit: number = 50) {
    return retryRequest(() => api.get(`/alerts/${alertId}/history`, { params: { limit } }));
  },

  async exportCsv(exchange?: string, days: number = 7) {
    const params: any = { days };
    if (exchange) params.exchange = exchange;
    return retryRequest(() => api.get('/export/csv', { params, responseType: 'blob' }));
  },

  // Settings
  async getSettings() {
    return retryRequest(() => api.get('/settings'));
  },

  async updateSettings(settings: Record<string, any>) {
    return api.put('/settings', settings);
  },

  async resetSettings() {
    return api.post('/settings/reset');
  },

  // Analytics
  async getTrends(exchange: string, contract: string, days: number = 7) {
    return retryRequest(() => api.get(`/analytics/trends/${exchange}/${contract}`, { params: { days } }));
  },

  async getTopMovers(days: number = 1) {
    return retryRequest(() => api.get('/analytics/top-movers', { params: { days } }));
  },

  async getExchangeStats() {
    return retryRequest(() => api.get('/analytics/exchange-stats'));
  },

  // Batch operations
  async batchToggleAlerts(alertIds: string[], isActive: boolean) {
    return api.post('/alerts/batch/toggle', { alertIds, isActive });
  },

  async batchDeleteAlerts(alertIds: string[]) {
    return api.post('/alerts/batch/delete', { alertIds });
  },

  // Generic HTTP methods (for admin panel, etc.)
  async get<T = any>(url: string) {
    return api.get(url) as Promise<T>;
  },

  async post<T = any>(url: string, data?: any) {
    return api.post(url, data) as Promise<T>;
  },

  async put<T = any>(url: string, data?: any) {
    return api.put(url, data) as Promise<T>;
  },

  async patch<T = any>(url: string, data?: any) {
    return api.patch(url, data) as Promise<T>;
  },

  async delete<T = any>(url: string) {
    return api.delete(url) as Promise<T>;
  },

  // ---- Trial ----
  async activateTrial() {
    return retryRequest(() => api.post('/trial/activate'));
  },

  async getTrialStatus() {
    return retryRequest(() => api.get('/trial/status'));
  },

  // ---- Web auth (wallet SIWE + Google) ----
  async getAuthConfig() {
    return api.get('/auth/config');
  },

  async walletNonce(address: string) {
    return api.get(`/auth/wallet/nonce`, { params: { address } });
  },

  async walletVerify(message: string, signature: string) {
    const referredByCode = getStoredReferralCode();
    return api.post('/auth/wallet/verify', { message, signature, referredByCode });
  },

  async googleLogin(idToken: string) {
    const referredByCode = getStoredReferralCode();
    return api.post('/auth/google', { idToken, referredByCode });
  },

  async emailRegister(email: string, password: string, firstName?: string) {
    const referredByCode = getStoredReferralCode();
    return api.post('/auth/register', { email, password, firstName, referredByCode });
  },

  async emailLogin(email: string, password: string) {
    return api.post('/auth/login', { email, password });
  },

  async getMe() {
    return api.get('/auth/me');
  },

  // Dev-only: mint a guest session (no real auth) for local development.
  async devGuest() {
    return api.post('/auth/dev-guest');
  },

  // Dev-only: simulate a successful crypto payment (no real gateway).
  async simulatePayment(orderId: string) {
    return api.post(`/payments/simulate/${orderId}`);
  },

  // ---- Funding calendar ----
  async getFundingSchedule(exchanges?: string[], limit = 12) {
    const params: any = { limit };
    if (exchanges && exchanges.length) params.exchanges = exchanges.join(',');
    return retryRequest(() => api.get('/funding/schedule', { params }));
  },

  // ---- APR analytics ----
  async getApr(exchange: string, contract: string, days = 30) {
    return retryRequest(() => api.get('/analytics/apr', { params: { exchange, contract, days } }));
  },

  // ---- Watchlist ----
  async getWatchlist() {
    return retryRequest(() => api.get('/watchlist'));
  },

  async addWatchlist(exchange: string, pair: string) {
    return retryRequest(() => api.post('/watchlist', { exchange, pair }));
  },

  async removeWatchlist(exchange: string, pair: string) {
    return api.delete('/watchlist', { data: { exchange, pair } });
  },

  // ---- Portfolio (Pro) ----
  async getPortfolio() {
    return retryRequest(() => api.get('/portfolio'));
  },

  async addPortfolio(data: { exchange: string; pair: string; side: 'long' | 'short'; sizeUsd: number; leverage?: number }) {
    return retryRequest(() => api.post('/portfolio', data));
  },

  async removePortfolio(id: string) {
    return api.delete('/portfolio', { data: { id } });
  },

  // ---- Exchange API keys + live PnL (Pro) ----
  async getApiKeys() {
    return retryRequest(() => api.get('/keys'));
  },

  async addApiKey(data: { exchange: string; label?: string; apiKey: string; secret: string; passphrase?: string; permissions: 'read' | 'trade' }) {
    return retryRequest(() => api.post('/keys', data));
  },

  async deleteApiKey(id: string) {
    return api.delete(`/keys/${id}`);
  },

  async getLivePortfolio() {
    return retryRequest(() => api.get('/portfolio/live'));
  },

  async exportLivePortfolio() {
    const res = await api.get('/portfolio/live/export', { responseType: 'blob' });
    return res;
  },

  async autoExecuteOrder(data: { exchange: string; symbol: string; side: 'long' | 'short'; notionalUsd: number; confirm: true }) {
    return retryRequest(() => api.post('/portfolio/auto-execute', data));
  },

  async getExecutedOrders() {
    return retryRequest(() => api.get('/portfolio/orders'));
  },

  // ---- Spot-Futures (cash-and-carry) ----
  async getSpotFutures(exchange: string, pair: string) {
    return retryRequest(() => api.get('/arbitrage/spot-futures', { params: { exchange, pair } }));
  },

  // ---- Feature flags (gates UI features independently of subscription tier) ----
  async getFeatureFlags() {
    try {
      const res: any = await retryRequest(() => api.get('/feature-flags'));
      return res?.flags ?? [];
    } catch {
      return [];
    }
  },

  // ---- Live perp prices for visible Funding rows (batched, per exchange) ----
  // Kept for backwards compatibility; prefer getLiveBatch for multi-exchange use.
  async getPriceBatch(exchange: string, symbols: string[]) {
    return retryRequest(() => api.get('/price/batch', { params: { exchange, symbols: symbols.join(',') } }));
  },

  // ---- Live funding rates for visible Arbitrage rows (batched, per exchange) ----
  async getFundingBatch(exchange: string, symbols: string[]) {
    return retryRequest(() => api.get('/funding/batch', { params: { exchange, symbols: symbols.join(',') } }));
  },

  // ---- Unified live snapshot (ONE request per tick, all exchanges) ----
  // Collapses the old one-request-per-exchange price+funding polling into a
  // single call so selecting many exchanges no longer blows any rate budget.
  // Client-side cache + 429 backoff live here so every caller benefits.
  //
  // Cache/dedupe: identical request sets within LIVE_BATCH_CACHE_MS are served
  // from the last response, so overlapping tabs / re-renders never dupe a hit
  // against the budget. While backing off after a 429 we return the last-good
  // snapshot (so the UI stays populated) instead of hitting the limiter again.
  LIVE_BATCH_CACHE_MS: 4000,
  _liveBatchCache: { key: '', at: 0, data: null as any } as { key: string; at: number; data: any },
  async getLiveBatch(requests: { exchange: string; symbols: string[] }[]) {
    const key = requests
      .map((r) => `${r.exchange}:${[...r.symbols].sort().join(',')}`)
      .sort()
      .join('|');
    const cache = this._liveBatchCache;
    const now = Date.now();
    if (key && cache.key === key && now - cache.at < this.LIVE_BATCH_CACHE_MS && cache.data) {
      return cache.data;
    }
    // During a 429 backoff serve the last good snapshot rather than re-hitting
    // the server and keeping the limiter permanently tripped.
    if (isBackingOff() && cache.key && cache.data) {
      return cache.data;
    }
    const res: any = await retryRequest(() => api.post('/live/batch', { requests }));
    if (res?.ok) {
      this._liveBatchCache = { key, at: now, data: res };
    }
    return res;
  },

  // QR Login: generate a token for the desktop browser to scan
  async qrLoginRequest() {
    const res: any = await retryRequest(() => api.post('/qr-login/request'));
    return res;
  },

  // QR Login: poll status (long-poll, 45s timeout)
  async qrLoginStatus(token: string) {
    const res: any = await retryRequest(() => api.get('/qr-login/status', { params: { token } }));
    return res;
  },

  // QR Login: verify scanned token (unauthenticated, called from desktop browser)
  async qrLoginVerify(token: string) {
    const res = await retryRequest(() => api.post('/qr-login/verify', { token }));
    return (res as any).data;
  },
};
