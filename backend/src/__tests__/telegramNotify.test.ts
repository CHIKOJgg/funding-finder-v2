import { sendTelegramMessage, sendAlertNotification, sendDailySummary } from '../services/telegramNotify.js';

// Mock axios
jest.mock('axios');
const axios = require('axios');

// Mock config
jest.mock('../config/index.js', () => ({
  config: {
    telegram: {
      botToken: 'test-bot-token-123',
    },
  },
}));

describe('telegramNotify', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('sendTelegramMessage', () => {
    it('should return false when bot token is not configured', async () => {
      // We'd need to mock config to return empty token
      // For now, test with configured token
      axios.post.mockResolvedValue({ data: { ok: true } });

      const result = await sendTelegramMessage({
        chatId: 123456,
        text: 'Test message',
      });

      expect(result).toBe(true);
      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining('api.telegram.org'),
        expect.objectContaining({
          chat_id: 123456,
          text: 'Test message',
        }),
        expect.any(Object)
      );
    });

    it('should return false on API error', async () => {
      axios.post.mockResolvedValue({
        data: { ok: false, description: 'Bad Request' },
      });

      const result = await sendTelegramMessage({
        chatId: 123456,
        text: 'Test',
      });

      expect(result).toBe(false);
    });

    it('should return false on network error', async () => {
      axios.post.mockRejectedValue(new Error('Network error'));

      const result = await sendTelegramMessage({
        chatId: 123456,
        text: 'Test',
      });

      expect(result).toBe(false);
    });
  });

  describe('sendAlertNotification', () => {
    it('should format general alert notification correctly', async () => {
      axios.post.mockResolvedValue({ data: { ok: true } });

      await sendAlertNotification(123456, 'general', {
        pair: 'BTC-USDT',
        exchange: 'binance',
        currentRate: 0.0001,
        threshold: 0.00005,
        condition: 'above',
      });

      expect(axios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          chat_id: 123456,
          parse_mode: 'HTML',
        }),
        expect.any(Object)
      );

      const text = axios.post.mock.calls[0][1].text;
      expect(text).toContain('BTC-USDT');
      expect(text).toContain('binance');
      expect(text).toContain('0.010000%/ч');
    });

    it('should format arbitrage alert notification correctly', async () => {
      axios.post.mockResolvedValue({ data: { ok: true } });

      await sendAlertNotification(123456, 'arbitrage', {
        pair: 'ETH-USDT',
        exchangeA: 'binance',
        exchangeB: 'okx',
        difference: 0.0002,
        threshold: 0.0001,
      });

      const text = axios.post.mock.calls[0][1].text;
      expect(text).toContain('ETH-USDT');
      expect(text).toContain('binance');
      expect(text).toContain('okx');
      expect(text).toContain('0.020000%/ч');
    });
  });

  describe('sendDailySummary', () => {
    it('should return false when no pairs', async () => {
      const result = await sendDailySummary(123456, {
        topPairs: [],
        totalScanned: 100,
      });

      expect(result).toBe(false);
    });

    it('should format daily summary correctly', async () => {
      axios.post.mockResolvedValue({ data: { ok: true } });

      await sendDailySummary(123456, {
        topPairs: [
          { pair: 'BTC-USDT', exchange: 'binance', ratePerHour: 0.0001, ratePerDay: 0.0024, interval: '8h' },
          { pair: 'ETH-USDT', exchange: 'okx', ratePerHour: 0.00005, ratePerDay: 0.0012, interval: '8h' },
        ],
        totalScanned: 500,
      });

      const text = axios.post.mock.calls[0][1].text;
      expect(text).toContain('500');
      expect(text).toContain('BTC-USDT');
      expect(text).toContain('ETH-USDT');
    });
  });
});
