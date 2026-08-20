import request from 'supertest';
import { prismaMock as mockPrisma, createTestApp, makeAuthUser } from '../testkit';
import supportRoutes from '../../routes/support.js';

jest.mock('../../services/prisma', () => ({
  prisma: mockPrisma,
  connectDatabase: jest.fn(),
  disconnectDatabase: jest.fn(),
  checkDatabaseHealth: jest.fn(),
}));

jest.mock('../../services/supportService', () => ({
  submitSupportTicket: jest.fn(),
  getPredefinedTopics: jest.fn(),
  buildTopicUrl: jest.fn(),
}));

import * as supportService from '../../services/supportService';

const authUser = makeAuthUser();
const mkApp = (auth = true) => createTestApp(supportRoutes, auth ? { authUser } : {});

beforeEach(() => {
  jest.resetAllMocks();
});

describe('support routes', () => {
  describe('GET /topics', () => {
    it('returns predefined topics and support group URL (200)', async () => {
      (supportService.getPredefinedTopics as jest.Mock).mockReturnValue([
        { id: 'faq', title: 'FAQ', url: 'https://t.me/fundingfindersupport' },
      ]);
      (supportService.buildTopicUrl as jest.Mock).mockReturnValue('https://t.me/fundingfindersupport');

      const res = await request(mkApp(false)).get('/topics');
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.topics).toHaveLength(1);
      expect(res.body.supportGroupUrl).toBe('https://t.me/fundingfindersupport');
    });
  });

  describe('POST /ticket', () => {
    it('creates support ticket and returns topic details (201)', async () => {
      (supportService.submitSupportTicket as jest.Mock).mockResolvedValue({
        ok: true,
        ticketId: 't123',
        topicUrl: 'https://t.me/fundingfindersupport/42',
        threadId: 42,
        message: 'Ticket created successfully',
      });

      const res = await request(mkApp(false))
        .post('/ticket')
        .send({
          category: 'billing',
          message: 'Need help with Pro subscription renewal',
          name: 'Alex',
          contact: '@alex',
        });

      expect(res.status).toBe(201);
      expect(res.body.ok).toBe(true);
      expect(res.body.ticketId).toBe('t123');
      expect(res.body.topicUrl).toBe('https://t.me/fundingfindersupport/42');
      expect(supportService.submitSupportTicket).toHaveBeenCalledTimes(1);
    });

    it('rejects too short message (<3 chars) with 400', async () => {
      const res = await request(mkApp(false))
        .post('/ticket')
        .send({
          category: 'billing',
          message: 'hi',
        });

      expect(res.status).toBe(400);
    });
  });
});
