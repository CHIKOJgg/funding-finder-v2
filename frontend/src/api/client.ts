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

export function setTelegramInitData(data: string | null) {
  telegramInitData = data;
}

export function setCurrentUserId(id: string | null) {
  currentUserId = id;
}

api.interceptors.request.use((config) => {
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
        if (status && status >= 400 && status < 500 && status !== 429) {
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
    const message = error.response?.data?.error || error.message || 'Network error';
    return Promise.reject(new Error(message));
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

  async createOrder(planId: string) {
    return api.post('/createOrder', { planId, currency: 'USDT' });
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
};
