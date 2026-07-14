import request from 'supertest';
import { prismaMock as mockPrisma, createTestApp, makeAuthUser } from '../testkit';
import alertsRoutes from '../../routes/alerts.js';

jest.mock('../../services/prisma', () => ({
  prisma: mockPrisma,
  connectDatabase: jest.fn(),
  disconnectDatabase: jest.fn(),
  checkDatabaseHealth: jest.fn(),
}));
jest.mock('../../services/alertService', () => ({
  createGeneralAlert: jest.fn(),
  getUserGeneralAlerts: jest.fn(),
  deleteGeneralAlert: jest.fn(),
  toggleGeneralAlert: jest.fn(),
}));

import * as alertService from '../../services/alertService';

const authUser = makeAuthUser();
const mkApp = (auth = true) => createTestApp(alertsRoutes, auth ? { authUser } : {});

beforeEach(() => {
  jest.resetAllMocks();
});

describe('alerts routes', () => {
  it('POST / creates a general alert (200)', async () => {
    (alertService.createGeneralAlert as jest.Mock).mockResolvedValue({ id: 'alert-1' });
    const res = await request(mkApp())
      .post('/')
      .send({ pair: 'BTCUSDT', exchange: 'gate', condition: 'above', threshold: 0.01 });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.alert).toEqual({ id: 'alert-1' });
  });

  it('POST / returns 400 on invalid body', async () => {
    const res = await request(mkApp()).post('/').send({ pair: '', exchange: '' });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it('GET / lists alerts (200)', async () => {
    (alertService.getUserGeneralAlerts as jest.Mock).mockResolvedValue({ alerts: [], total: 0 });
    const res = await request(mkApp()).get('/');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('DELETE /:alertId returns 404 when not found', async () => {
    (alertService.deleteGeneralAlert as jest.Mock).mockResolvedValue(false);
    const res = await request(mkApp()).delete('/missing-id');
    expect(res.status).toBe(404);
    expect(res.body.ok).toBe(false);
  });

  it('POST /batch/toggle updates many alerts (200)', async () => {
    mockPrisma.generalAlert.updateMany.mockResolvedValue({ count: 2 });
    const res = await request(mkApp())
      .post('/batch/toggle')
      .send({ alertIds: ['a', 'b'], isActive: true });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.updated).toBe(2);
  });
});
