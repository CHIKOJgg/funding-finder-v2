import {
  getPredefinedTopics,
  buildTopicUrl,
  submitSupportTicket,
} from '../services/supportService.js';
import { prisma } from '../services/prisma.js';

jest.mock('../services/prisma.js', () => ({
  prisma: {
    supportTicket: {
      create: jest.fn(),
      update: jest.fn(),
    },
  },
}));

jest.mock('../config/index.js', () => ({
  config: {
    telegram: {
      botToken: 'mock_token',
      supportChatId: '-1004303355395',
      supportGroupUsername: 'fundingfindersupport',
      supportInviteLink: 'https://t.me/fundingfindersupport',
    },
    branding: {
      supportUsername: 'fundingfindersupport',
    },
  },
}));

jest.mock('../utils/logger.js', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('axios');

describe('supportService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getPredefinedTopics', () => {
    it('returns all standard forum topics with titles and icons', () => {
      const topics = getPredefinedTopics();
      expect(Array.isArray(topics)).toBe(true);
      expect(topics.length).toBe(6);

      const ids = topics.map((t) => t.id);
      expect(ids).toContain('faq');
      expect(ids).toContain('billing');
      expect(ids).toContain('arbitrage');
      expect(ids).toContain('bug');
      expect(ids).toContain('feature');
      expect(ids).toContain('general');

      for (const topic of topics) {
        expect(topic.title).toBeTruthy();
        expect(topic.description).toBeTruthy();
        expect(topic.icon).toBeTruthy();
        expect(topic.url).toContain('t.me');
      }
    });
  });

  describe('buildTopicUrl', () => {
    it('builds group url without threadId', () => {
      const url = buildTopicUrl();
      expect(url).toBe('https://t.me/fundingfindersupport');
    });

    it('builds direct thread url when threadId is provided', () => {
      const url = buildTopicUrl(42);
      expect(url).toBe('https://t.me/fundingfindersupport/42');
    });
  });

  describe('submitSupportTicket', () => {
    it('creates a ticket in database and returns topic url', async () => {
      const mockTicket = {
        id: 'cltestticket123',
        userId: 'tg_12345',
        name: 'Alex',
        contact: '@alex_trader',
        category: 'billing',
        message: 'How to pay with USDT?',
        status: 'open',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (prisma.supportTicket.create as jest.Mock).mockResolvedValue(mockTicket);
      (prisma.supportTicket.update as jest.Mock).mockResolvedValue({
        ...mockTicket,
        threadId: 101,
        topicUrl: 'https://t.me/fundingfindersupport/101',
      });

      const axios = require('axios');
      axios.post = jest.fn()
        .mockResolvedValueOnce({ data: { ok: true, result: { message_thread_id: 101, name: 'Billing' } } })
        .mockResolvedValueOnce({ data: { ok: true, result: { message_id: 202 } } });

      const result = await submitSupportTicket({
        userId: 'tg_12345',
        name: 'Alex',
        contact: '@alex_trader',
        category: 'billing',
        message: 'How to pay with USDT?',
        subscription: 'pro',
      });

      expect(result.ok).toBe(true);
      expect(result.ticketId).toBe('cltestticket123');
      expect(result.topicUrl).toBe('https://t.me/fundingfindersupport/101');
      expect(result.threadId).toBe(101);
      expect(prisma.supportTicket.create).toHaveBeenCalledTimes(1);
    });
  });
});
