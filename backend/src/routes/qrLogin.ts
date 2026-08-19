import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import { AuthenticatedRequest } from '../middleware/auth.js';
import { prisma } from '../services/prisma.js';
import { signAuthToken } from '../services/authService.js';
import { logger } from '../utils/logger.js';
import { sendError } from '../middleware/errorHandler.js';

// Auth guard for QR login request/status. The router is mounted behind the
// unified authenticate middleware (accepts both web Bearer tokens AND
// Telegram Mini App init data), which already resolves req.userId. This
// route-level check only confirms the caller is authenticated — it never
// re-parses credentials, so both auth methods keep working.
function requireQrAuth(req: Request, res: Response, next: NextFunction) {
  if (!(req as AuthenticatedRequest).userId) {
    return res.status(401).json({ ok: false, error: 'Authentication required' });
  }
  return next();
}

// Authenticated router (request + status) — mounted behind auth middleware
export const qrAuthRouter = Router();
// Unauthenticated router (verify) — mounted without auth
export const qrPublicRouter = Router();

const qrVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Too many verification attempts, please try again later' },
});

const QR_TOKEN_TTL_MS = 5 * 60 * 1000; // 5 minutes

qrAuthRouter.post('/qr-login/request', requireQrAuth, async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).userId!;
    const token = crypto.randomBytes(32).toString('hex');

    await prisma.qrLoginToken.create({
      data: { token, userId },
    });

    logger.debug({ userId, tokenPrefix: token.slice(0, 8) }, 'QR login token generated');

    return res.json({
      ok: true,
      token,
      expiresAt: Date.now() + QR_TOKEN_TTL_MS,
    });
  } catch (e) {
    const error = e as Error;
    logger.error({ err: error }, 'QR login token generation failed');
    return sendError(res, 500, 'Failed to generate QR token', 'QR_TOKEN_ERROR');
  }
});

qrAuthRouter.get('/qr-login/status', requireQrAuth, async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).userId!;
    const { token } = req.query as { token: string };

    if (!token || typeof token !== 'string') {
      return res.status(400).json({ ok: false, error: 'Missing token parameter' });
    }

    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
      const record = await prisma.qrLoginToken.findFirst({ where: { token, userId } });
      if (!record) {
        return res.json({ ok: true, consumed: false, error: 'Token not found' });
      }
      if (record.consumed) {
        return res.json({ ok: true, consumed: true });
      }
      if (Date.now() - record.createdAt.getTime() > QR_TOKEN_TTL_MS) {
        await prisma.qrLoginToken.delete({ where: { token } }).catch(() => {});
        return res.json({ ok: true, consumed: false, error: 'Token expired' });
      }
      await new Promise((r) => setTimeout(r, 1000));
    }

    return res.json({ ok: true, consumed: false });
  } catch (e) {
    const error = e as Error;
    return sendError(res, 500, 'Failed to check QR status', 'QR_STATUS_ERROR');
  }
});

qrPublicRouter.post('/qr-login/verify', qrVerifyLimiter, async (req, res) => {
  try {
    const { token } = req.body as { token: string };

    if (!token || typeof token !== 'string') {
      return res.status(400).json({ ok: false, error: 'Missing token' });
    }

    const record = await prisma.qrLoginToken.findUnique({ where: { token } });
    if (!record) {
      return res.status(404).json({ ok: false, error: 'Token not found' });
    }

    if (record.consumed) {
      return res.status(400).json({ ok: false, error: 'Token already consumed' });
    }

    if (Date.now() - record.createdAt.getTime() > QR_TOKEN_TTL_MS) {
      await prisma.qrLoginToken.delete({ where: { token } }).catch(() => {});
      return res.status(400).json({ ok: false, error: 'Token expired' });
    }

    // Consume atomically so two concurrent scans cannot mint two sessions.
    const consumed = await prisma.qrLoginToken.updateMany({
      where: { token, consumed: false },
      data: { consumed: true },
    });
    if (consumed.count !== 1) {
      return res.status(400).json({ ok: false, error: 'Token already consumed' });
    }

    // Generate a JWT session for the desktop browser
    const authToken = signAuthToken({ sub: record.userId, provider: 'telegram' });

    logger.info({ userId: record.userId }, 'QR login verified');

    return res.json({
      ok: true,
      authToken,
      userId: record.userId,
    });
  } catch (e) {
    const error = e as Error;
    logger.error({ err: error }, 'QR login verification failed');
    return sendError(res, 500, 'QR verification failed', 'QR_VERIFY_ERROR');
  }
});

export default qrPublicRouter;
