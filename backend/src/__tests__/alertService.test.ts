import { prismaMock } from './testkit';

jest.mock('../services/prisma', () => ({
  prisma: prismaMock,
  connectDatabase: jest.fn(),
  disconnectDatabase: jest.fn(),
  checkDatabaseHealth: jest.fn().mockResolvedValue({ ok: true, latencyMs: 1 }),
}));

import {
  createGeneralAlert,
  getUserGeneralAlerts,
  deleteGeneralAlert,
  toggleGeneralAlert,
} from '../services/alertService.js';

describe('alertService (general alerts)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('throws when a user already has the maximum number of alerts', async () => {
    (prismaMock.generalAlert.count as jest.Mock).mockResolvedValue(50);
    await expect(
      createGeneralAlert('u1', { pair: 'BTC', exchange: 'binance', condition: 'above', threshold: 0.01 })
    ).rejects.toThrow(/Maximum 50/);
    expect(prismaMock.generalAlert.create).not.toHaveBeenCalled();
  });

  it('creates a general alert with defaults applied', async () => {
    (prismaMock.generalAlert.count as jest.Mock).mockResolvedValue(0);
    (prismaMock.generalAlert.create as jest.Mock).mockResolvedValue({ id: 'a1' });
    const res = await createGeneralAlert('u1', { pair: 'BTC', exchange: 'binance', condition: 'above', threshold: 0.01 });
    expect(prismaMock.generalAlert.create).toHaveBeenCalledTimes(1);
    const data = (prismaMock.generalAlert.create as jest.Mock).mock.calls[0][0].data;
    expect(data.cooldown).toBe(300000);
    expect(res).toEqual({ id: 'a1' });
  });

  it('clamps pagination limits and offsets', async () => {
    (prismaMock.generalAlert.findMany as jest.Mock).mockResolvedValue([{ id: 'a' }]);
    (prismaMock.generalAlert.count as jest.Mock).mockResolvedValue(1);
    const res = await getUserGeneralAlerts('u1', 9999, -5);
    expect(res.limit).toBe(200);
    expect(res.offset).toBe(0);
    const find = (prismaMock.generalAlert.findMany as jest.Mock).mock.calls[0][0];
    expect(find.take).toBe(200);
    expect(find.skip).toBe(0);
  });

  it('returns total alongside the alerts page', async () => {
    (prismaMock.generalAlert.findMany as jest.Mock).mockResolvedValue([{ id: 'a' }]);
    (prismaMock.generalAlert.count as jest.Mock).mockResolvedValue(3);
    const res = await getUserGeneralAlerts('u1');
    expect(res.total).toBe(3);
    expect(res.alerts).toHaveLength(1);
  });

  it('deletes an alert only when it belongs to the user', async () => {
    (prismaMock.generalAlert.deleteMany as jest.Mock).mockResolvedValue({ count: 1 });
    const ok = await deleteGeneralAlert('u1', 'a1');
    expect(prismaMock.generalAlert.deleteMany).toHaveBeenCalledWith({ where: { id: 'a1', userId: 'u1' } });
    expect(ok).toBe(true);
  });

  it('returns false when nothing was deleted', async () => {
    (prismaMock.generalAlert.deleteMany as jest.Mock).mockResolvedValue({ count: 0 });
    expect(await deleteGeneralAlert('u1', 'missing')).toBe(false);
  });

  it('toggles isActive and returns null when alert is missing', async () => {
    (prismaMock.generalAlert.findFirst as jest.Mock).mockResolvedValue({ id: 'a1', isActive: false });
    (prismaMock.generalAlert.update as jest.Mock).mockResolvedValue({ id: 'a1', isActive: true });
    const res = await toggleGeneralAlert('u1', 'a1');
    expect(res.isActive).toBe(true);

    (prismaMock.generalAlert.findFirst as jest.Mock).mockResolvedValue(null);
    expect(await toggleGeneralAlert('u1', 'nope')).toBeNull();
  });
});
