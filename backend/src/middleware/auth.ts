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

// Developer accounts that should always receive the top-tier ("proplus")
// subscription regardless of payment state. Keyed by telegram id (numeric
// suffix of the tg_<id> user id). Configured via DEV_ULTIMATE_TELEGRAM_IDS
// (empty by default) so it is never hardcoded.
const DEV_ULTIMATE_TELEGRAM_IDS = new Set(config.admin.devUltimateTelegramIds);

// Track user activity (ensures user exists before any route handler).
// Writes are throttled HARD: a DB write happens at most once per user per
// ENSURE_TTL_MS window (to create the row if missing) plus a lastActive refresh
// every TRACK_INTERVAL_MS. The old code ran `prisma.user.upsert` (a read+write)
// on EVERY authenticated request — the ~10-15 requests a Mini App fires per
// screen load all serialised behind a per-request write, which is what made
// Profile / tabs feel like they took 3-5s to open. A warm user now costs ZERO
// DB ops per request.
const TRACK_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes
const ENSURE_TTL_MS = 15 * 60 * 1000; // 15 minutes

// userId -> last time we confirmed the row exists. Process-lifetime only; if the
// process restarts we re-verify once (a cheap read), not on every request.
const ensuredUsers = new Map<string, number>();

async function ensureUserExists(userId: string, authProvider: AuthProvider): Promise<void> {
  const cached = ensuredUsers.get(userId);
  if (cached !== undefined && Date.now() - cached < ENSURE_TTL_MS) return;

  const tgId = userId.replace('tg_', '');
  const isAdmin = config.admin.telegramIds.includes(tgId);
  const isDevUltimate = DEV_ULTIMATE_TELEGRAM_IDS.has(tgId);
  const now = new Date();
  const subscription = isDevUltimate ? 'proplus' : 'free';
  const trialEndsAt = isDevUltimate ? null : undefined;

  // Find first; only write (create) when the user is genuinely missing.
  const existing = await prisma.user.findUnique({
    where: { telegramId: userId },
    select: { id: true, role: true },
  });
  if (existing) {
    ensuredUsers.set(userId, Date.now());
    // Promote to admin if configured (no-op for the vast majority of users).
    if (isAdmin && existing.role !== 'admin') {
      await prisma.user.updateMany({
        where: { telegramId: userId, role: { not: 'admin' } },
        data: { role: 'admin' },
      });
    }
    return;
  }

  try {
    await prisma.user.create({
      data: {
        telegramId: userId,
        lastActive: now,
        role: isAdmin ? 'admin' : 'user',
        authProvider,
        subscription,
        ...(trialEndsAt !== undefined ? { trialEndsAt } : {}),
      },
    });
  } catch (e: any) {
    // Race: another in-flight request created the user between our read and write.
    if (e?.code !== 'P2002') throw e;
  }
  ensuredUsers.set(userId, Date.now());
}

async function trackActivity(userId: string, authProvider: AuthProvider = 'telegram'): Promise<void> {
  try {
    // ZERO DB ops for a warm user (cached) — removes the per-request write.
    const te0 = Date.now();
    await ensureUserExists(userId, authProvider);
    console.log(`[PERF] trackActivity ensureUserExists ${Date.now() - te0}ms`);

    // Only refresh lastActive (and run the trial-expiry check) when stale.
    const now = new Date();
    const staleCutoff = new Date(now.getTime() - TRACK_INTERVAL_MS);
    const tu0 = Date.now();
    const updated = await prisma.user.updateMany({
      where: { telegramId: userId, lastActive: { lt: staleCutoff } },
      data: { lastActive: now },
    });
    console.log(`[PERF] trackActivity updateMany count=${updated.count} ${Date.now() - tu0}ms`);
    const tgId = userId.replace('tg_', '');
    const isDevUltimate = DEV_ULTIMATE_TELEGRAM_IDS.has(tgId);
    if (updated.count > 0 && !isDevUltimate) {
      const tt0 = Date.now();
      await enforceTrialExpiry(userId);
      console.log(`[PERF] trackActivity enforceTrialExpiry ${Date.now() - tt0}ms`);
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
    if (!authDate) {
      logger.warn('Missing auth_date in Telegram init data');
      return res.status(401).json({ ok: false, error: 'Missing authentication timestamp' });
    }
    {
      const authTimestamp = parseInt(authDate, 10) * 1000;
      const now = Date.now();
      const MAX_AGE_MS = 24 * 60 * 60 * 1000;
      if (!Number.isFinite(authTimestamp) || now - authTimestamp > MAX_AGE_MS) {
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
    const tTrack = Date.now();
    await trackActivity((req as AuthenticatedRequest).userId!);
    console.log(`[PERF] auth trackActivity ${Date.now() - tTrack}ms`);

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
  try {
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
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
    if (!authDate) return null;
    {
      const authTimestamp = parseInt(authDate, 10) * 1000;
      if (!Number.isFinite(authTimestamp) || Date.now() - authTimestamp > 24 * 60 * 60 * 1000) return null;
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
