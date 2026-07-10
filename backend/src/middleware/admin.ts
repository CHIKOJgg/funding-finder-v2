import { Response, NextFunction } from 'express';
import { prisma } from '../services/prisma.js';
import { AuthenticatedRequest } from './auth.js';
import { logger } from '../utils/logger.js';

export async function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    if (!req.userId) {
      return res.status(401).json({ ok: false, error: 'Authentication required' });
    }

    const user = await prisma.user.findUnique({
      where: { telegramId: req.userId },
      select: { role: true },
    });

    if (!user || user.role !== 'admin') {
      logger.warn({ userId: req.userId }, 'Non-admin attempted to access admin route');
      return res.status(403).json({ ok: false, error: 'Admin access required' });
    }

    next();
  } catch (err) {
    logger.error('Admin middleware error:', err);
    return res.status(500).json({ ok: false, error: 'Internal error' });
  }
}
