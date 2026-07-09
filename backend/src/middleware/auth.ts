import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

export interface AuthenticatedRequest extends Request {
  telegramUser?: {
    id: number;
    first_name?: string;
    username?: string;
  };
  userId?: string;
}

const VALID_EXCHANGES = ['gate', 'binance', 'bybit', 'mexc', 'okx'];

// Track user activity (blocking — ensures user exists before any route handler)
async function trackActivity(userId: string): Promise<void> {
  try {
    const { prisma } = await import('../services/prisma.js');
    await prisma.user.upsert({
      where: { telegramId: userId },
      create: { telegramId: userId, lastActive: new Date() },
      update: { lastActive: new Date() },
    });
  } catch (err) {
    logger.debug({ err: (err as Error).message }, 'Failed to track user activity');
  }
}

export async function validateTelegramInitData(req: Request, res: Response, next: NextFunction) {
  const initData = req.headers['x-telegram-init-data'] as string;

  if (!initData) {
    if (config.nodeEnv === 'development') {
      const devUser = { id: 1, first_name: 'Dev', username: 'dev' };
      (req as AuthenticatedRequest).telegramUser = devUser;
      (req as AuthenticatedRequest).userId = `dev_${devUser.id}`;
      return next();
    }
    logger.warn('Missing Telegram init data');
    return res.status(401).json({ ok: false, error: 'Missing Telegram authentication' });
  }

  try {
    const urlParams = new URLSearchParams(initData);
    const hash = urlParams.get('hash');
    urlParams.delete('hash');
    urlParams.delete('signature');

    if (!hash) {
      return res.status(401).json({ ok: false, error: 'Missing hash in init data' });
    }

    const dataCheckString = Array.from(urlParams.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');

    const secretKey = crypto
      .createHmac('sha256', 'WebAppData')
      .update(config.telegram.botToken)
      .digest();

    const computedHash = crypto
      .createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');

    if (!timingSafeEqual(computedHash, hash)) {
      const botId = config.telegram.botToken.split(':')[0] || 'unknown';
      logger.warn(`Invalid Telegram init data hash (validating with bot id: ${botId})`);
      return res.status(401).json({ ok: false, error: 'Invalid authentication' });
    }

    const authDate = urlParams.get('auth_date');
    if (authDate) {
      const authTimestamp = parseInt(authDate, 10) * 1000;
      const now = Date.now();
      const MAX_AGE_MS = 24 * 60 * 60 * 1000;
      if (now - authTimestamp > MAX_AGE_MS) {
        logger.warn('Telegram init data expired');
        return res.status(401).json({ ok: false, error: 'Authentication expired' });
      }
    }

    const userStr = urlParams.get('user');
    if (!userStr) {
      return res.status(401).json({ ok: false, error: 'Missing user data' });
    }

    const user = JSON.parse(userStr);
    if (!user.id) {
      return res.status(401).json({ ok: false, error: 'Invalid user data' });
    }

    (req as AuthenticatedRequest).telegramUser = {
      id: user.id,
      first_name: user.first_name,
      username: user.username,
    };
    (req as AuthenticatedRequest).userId = `tg_${user.id}`;

    // Ensure user exists in DB before any route handler
    await trackActivity((req as AuthenticatedRequest).userId!);

    next();
  } catch (err) {
    logger.error('Telegram auth validation error:', err);
    return res.status(401).json({ ok: false, error: 'Authentication error' });
  }
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return crypto.timingSafeEqual(bufA, bufB);
}

export function validateExchangeList(req: Request, res: Response, next: NextFunction) {
  if (req.body.exchanges && Array.isArray(req.body.exchanges)) {
    const invalid = req.body.exchanges.filter((e: string) => !VALID_EXCHANGES.includes(e));
    if (invalid.length > 0) {
      return res.status(400).json({
        ok: false,
        error: `Invalid exchanges: ${invalid.join(', ')}. Valid: ${VALID_EXCHANGES.join(', ')}`,
      });
    }
  }
  next();
}

export function validateTelegramInitDataSync(initData: string): { userId: string } | null {
  try {
    const urlParams = new URLSearchParams(initData);
    const hash = urlParams.get('hash');
    urlParams.delete('hash');
    urlParams.delete('signature');

    if (!hash) return null;

    const dataCheckString = Array.from(urlParams.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');

    const secretKey = crypto
      .createHmac('sha256', 'WebAppData')
      .update(config.telegram.botToken)
      .digest();

    const computedHash = crypto
      .createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');

    if (!timingSafeEqual(computedHash, hash)) return null;

    const authDate = urlParams.get('auth_date');
    if (authDate) {
      const authTimestamp = parseInt(authDate, 10) * 1000;
      if (Date.now() - authTimestamp > 24 * 60 * 60 * 1000) return null;
    }

    const userStr = urlParams.get('user');
    if (!userStr) return null;

    const user = JSON.parse(userStr);
    if (!user.id) return null;

    return { userId: `tg_${user.id}` };
  } catch {
    return null;
  }
}
