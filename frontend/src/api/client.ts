import axios from 'axios';

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
      return await fn();
    } catch (err) {
      lastError = err as Error;
      // Check raw Axios error before interceptor transforms it
      if (axios.isAxiosError(err)) {
        const status = err.response?.status;
        // 4xx are client errors and must not be retried (this includes 429
        // rate-limit responses — retrying them only放大 the load and trips
        // the limiter harder). 418 (Binance WAF) is the one 4xx worth a
        // single backoff retry.
        if (status && status >= 400 && status < 500 && status !== 418) {
          throw lastError;
        }
      }
      if (i < retries) {
        await new Promise((resolve) => setTimeout(resolve, delay * Math.pow(2, i)));
      }
    }
  }
  throw lastError;
}

// Response interceptor: transform success data and error messages
api.interceptors.response.use(
  (response) => response.data,
  (error) => {
    const res = error.response;
    const message = res?.data?.error || error.message || 'Network error';
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
    return api.post('/auth/wallet/verify', { message, signature });
  },

  async googleLogin(idToken: string) {
    return api.post('/auth/google', { idToken });
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

  // ---- Live perp prices for visible Funding rows (batched, per exchange) ----
  async getPriceBatch(exchange: string, symbols: string[]) {
    return retryRequest(() => api.get('/price/batch', { params: { exchange, symbols: symbols.join(',') } }));
  },

  // ---- Live funding rates for visible Arbitrage rows (batched, per exchange) ----
  async getFundingBatch(exchange: string, symbols: string[]) {
    return retryRequest(() => api.get('/funding/batch', { params: { exchange, symbols: symbols.join(',') } }));
  },
};
