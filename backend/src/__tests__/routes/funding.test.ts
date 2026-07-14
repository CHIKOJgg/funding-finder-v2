import request from 'supertest';
import { prismaMock as mockPrisma, createTestApp, makeAuthUser } from '../testkit';
import fundingRoutes from '../../routes/funding.js';

jest.mock('../../services/fundingCalendar', () => ({
  getFundingCalendar: jest.fn(),
}));

import * as fundingCalendar from '../../services/fundingCalendar';

const authUser = makeAuthUser();
const mkApp = () => createTestApp(fundingRoutes, { authUser });

beforeEach(() => {
  jest.resetAllMocks();
});

describe('funding routes', () => {
  it('GET /funding/schedule returns 200', async () => {
    (fundingCalendar.getFundingCalendar as jest.Mock).mockResolvedValue({ events: [], scanned: 0, stale: false });
    const res = await request(mkApp()).get('/funding/schedule');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('GET /funding/schedule returns 500 when calendar service fails', async () => {
    (fundingCalendar.getFundingCalendar as jest.Mock).mockRejectedValue(new Error('calendar down'));
    const res = await request(mkApp()).get('/funding/schedule');
    expect(res.status).toBe(500);
    expect(res.body.ok).toBe(false);
  });
});
