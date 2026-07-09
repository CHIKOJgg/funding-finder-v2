import { prisma } from './prisma.js';
import { logger } from '../utils/logger.js';

const MAX_ALERTS_PER_USER = 50;

export async function createGeneralAlert(
  userId: string,
  data: {
    pair: string;
    exchange: string;
    condition: string;
    threshold: number;
    cooldown?: number;
  }
) {
  const count = await prisma.generalAlert.count({ where: { userId } });
  if (count >= MAX_ALERTS_PER_USER) {
    throw new Error(`Maximum ${MAX_ALERTS_PER_USER} alerts per user`);
  }

  return prisma.generalAlert.create({
    data: {
      userId,
      pair: data.pair,
      exchange: data.exchange,
      condition: data.condition,
      threshold: data.threshold,
      cooldown: data.cooldown || 300000,
    },
  });
}

export async function getUserGeneralAlerts(userId: string, limit: number = 50, offset: number = 0) {
  const safeLimit = Math.min(Math.max(limit, 1), 200);
  const safeOffset = Math.max(offset, 0);
  const [alerts, total] = await Promise.all([
    prisma.generalAlert.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: safeLimit,
      skip: safeOffset,
    }),
    prisma.generalAlert.count({ where: { userId } }),
  ]);
  return { alerts, total, limit: safeLimit, offset: safeOffset };
}

export async function deleteGeneralAlert(userId: string, alertId: string) {
  const result = await prisma.generalAlert.deleteMany({
    where: { id: alertId, userId },
  });
  return result.count > 0;
}

export async function toggleGeneralAlert(userId: string, alertId: string) {
  const alert = await prisma.generalAlert.findFirst({
    where: { id: alertId, userId },
  });
  if (!alert) return null;

  return prisma.generalAlert.update({
    where: { id: alertId },
    data: { isActive: !alert.isActive },
  });
}
