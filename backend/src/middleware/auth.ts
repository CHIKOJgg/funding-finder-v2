import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { config } from '../config/index.js';
import { SUPPORTED_EXCHANGES } from '../exchanges/index.js';
import { logger } from '../utils/logger.js';
import { verifyAuthToken, AuthProvider } from '../services/authService.js';
import { prisma } from '../services/prisma.js';
import { enforceTrialExpiry } from './subscription.js';

export interface AuthenticatedRequest extends Request {
  telegramUser?: {
    id: number;
    first_name?: string;
    username?: string;
  };
  userId?: string;
  authProvider?: AuthProvider;
}

const VALID_EXCHANGES = SUPPORTED_EXCHANGES;

// Developer accounts that should always receive the top-tier ("ultimate")
// subscription regardless of payment state. Keyed by telegram id (numeric
// suffix of the tg_<id> user id).
const DEV_ULTIMATE_TELEGRAM_IDS = new Set(['5915824444']);

// Track user activity (blocking — ensures user exists before any route handler)
async function trackActivity(userId: string, authProvider: AuthProvider = 'telegram'): Promise<void> {
  try {
    const tgId = userId.replace('tg_', '');
    const isAdmin = config.admin.telegramIds.includes(tgId);
    const isDevUltimate = DEV_ULTIMATE_TELEGRAM_IDS.has(tgId);
    await prisma.user.upsert({
      where: { telegramId: userId },
      create: {
        telegramId: userId,
        lastActive: new Date(),
        role: isAdmin ? 'admin' : 'user',
        authProvider,
        subscription: isDevUltimate ? 'ultimate' : 'free',
      },
      update: {
        lastActive: new Date(),
        role: isAdmin ? 'admin' : undefined,
        ...(isDevUltimate ? { subscription: 'ultimate' } : {}),
      },
    });
    // Revert trial-derived Pro once the window has elapsed (skip for dev ultimate).
    if (!isDevUltimate) {
      await enforceTrialExpiry(userId);
    }
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
      (req as AuthenticatedRequest).authProvider = 'telegram';
      return next();
    }
    logger.warn('Missing Telegram init data');
    return res.status(401).json({ ok: false, error: 'Missing Telegram authentication' });
  }

  try {
    const urlParams = new URLSearchParams(initData);
    const hash = urlParams.get('hash');

    if (!hash) {
      return res.status(401).json({ ok: false, error: 'Missing hash in init data' });
    }

    if (!verifyInitDataHash(urlParams, hash)) {
      const botId = config.telegram.botToken.split(':')[0] || 'unknown';
      const keys = Array.from(new URLSearchParams(initData).keys()).sort().join(',');
      logger.warn(`Invalid Telegram init data hash (bot id: ${botId}, fields: ${keys})`);
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

/**
 * Verify the Telegram Mini App init data hash.
 *
 * Telegram added a `signature` field to init data (for third-party Ed25519
 * validation). Different clients/versions differ on whether `signature` is
 * part of the data-check-string used for the bot-token `hash`. To be robust
 * we accept the data if EITHER variant matches (signature excluded or kept).
 *
 * Note: `urlParams` is mutated (the `hash` entry is removed).
 */
function verifyInitDataHash(urlParams: URLSearchParams, hash: string): boolean {
  urlParams.delete('hash');

  const secretKey = crypto
    .createHmac('sha256', 'WebAppData')
    .update(config.telegram.botToken)
    .digest();

  const computeHash = (params: URLSearchParams): string => {
    const dataCheckString = Array.from(params.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');
    return crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  };

  // Variant A: keep signature (if present) in the data-check-string
  if (timingSafeEqual(computeHash(urlParams), hash)) {
    return true;
  }

  // Variant B: exclude signature from the data-check-string
  if (urlParams.has('signature')) {
    const withoutSignature = new URLSearchParams(urlParams.toString());
    withoutSignature.delete('signature');
    if (timingSafeEqual(computeHash(withoutSignature), hash)) {
      return true;
    }
  }

  return false;
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

    if (!hash) return null;

    if (!verifyInitDataHash(urlParams, hash)) return null;

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

/**
 * Unified authentication middleware.
 *
 * Accepts EITHER a web JWT (`Authorization: Bearer <token>`, issued by the
 * wallet / Google login flows) OR Telegram Mini App init data. This lets the
 * exact same REST API serve both the Telegram mini-app and the public website
 * without duplicating routes.
 */
export async function authenticate(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice('Bearer '.length).trim();
    const payload = verifyAuthToken(token);
    if (!payload) {
      return res.status(401).json({ ok: false, error: 'Invalid or expired session' });
    }
    (req as AuthenticatedRequest).userId = payload.sub;
    (req as AuthenticatedRequest).authProvider = payload.provider;
    if (payload.provider === 'telegram') {
      const tgId = payload.sub.replace('tg_', '');
      (req as AuthenticatedRequest).telegramUser = { id: Number(tgId) || 0 };
    }
    await trackActivity(payload.sub, payload.provider);
    return next();
  }

  // Fall back to Telegram init data (existing behaviour).
  return validateTelegramInitData(req, res, next);
}
