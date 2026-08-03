import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { AuthenticatedRequest } from '../middleware/auth.js';
import { prisma } from '../services/prisma.js';
import { signAuthToken } from '../services/authService.js';
import { logger } from '../utils/logger.js';
import { sendError } from '../middleware/errorHandler.js';

// Auth guard for QR login request/status. The router is mounted behind the
// unified `authenticate` middleware (accepts both web Bearer tokens AND
// Telegram Mini App init data), which already resolves `req.userId`. This
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

const QR_TOKEN_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * @swagger
 * /qr-login/request:
 *   post:
 *     tags: [QR Login]
 *     summary: Generate a QR login token
 *     description: >
 *       Called by the Telegram Mini App to generate a short-lived login token.
 *       Returns a token that is displayed as a QR code. The desktop browser
 *       scans the QR and calls /qr-login/verify to authenticate.
 *     security:
 *       - telegramAuth: []
 *     responses:
 *       200:
 *         description: QR token generated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                 token:
 *                   type: string
 *                   description: Short-lived token (5 min TTL) to embed in QR
 *                 expiresAt:
 *                   type: integer
 *                   description: Unix timestamp (ms) when token expires
 */
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

/**
 * @swagger
 * /qr-login/status:
 *   get:
 *     tags: [QR Login]
 *     summary: Poll QR token status (SSE)
 *     description: >
 *       Long-poll endpoint called by the Mini App to wait for the desktop
 *       browser to scan and confirm the QR code. Returns when the token is
 *       consumed or after 45 seconds (timeout).
 *     security:
 *       - telegramAuth: []
 *     parameters:
 *       - name: token
 *         in: query
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: QR scan status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                 consumed:
 *                   type: boolean
 *                   description: True if desktop browser successfully verified
 */
qrAuthRouter.get('/qr-login/status', requireQrAuth, async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).userId!;
    const { token } = req.query as { token: string };

    if (!token || typeof token !== 'string') {
      return res.status(400).json({ ok: false, error: 'Missing token parameter' });
    }

    // Poll for up to 45 seconds. Ownership check: only the user who generated
    // the token may poll it (otherwise any authenticated user could probe any
    // token's state).
    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
      const record = await prisma.qrLoginToken.findFirst({ where: { token, userId } });
      if (!record) {
        return res.json({ ok: true, consumed: false, error: 'Token not found' });
      }
      if (record.consumed) {
        return res.json({ ok: true, consumed: true });
      }
      // Clean up expired tokens
      if (Date.now() - record.createdAt.getTime() > QR_TOKEN_TTL_MS) {
        await prisma.qrLoginToken.delete({ where: { token } }).catch(() => {});
        return res.json({ ok: true, consumed: false, error: 'Token expired' });
      }
      // Wait 1s before next poll
      await new Promise((r) => setTimeout(r, 1000));
    }

    return res.json({ ok: true, consumed: false });
  } catch (e) {
    const error = e as Error;
    return sendError(res, 500, 'Failed to check QR status', 'QR_STATUS_ERROR');
  }
});

/**
 * @swagger
 * /qr-login/verify:
 *   post:
 *     tags: [QR Login]
 *     summary: Verify a scanned QR token
 *     description: >
 *       Called by the desktop browser after scanning the QR code. The browser
 *       sends the token, and the server marks it as consumed and returns a
 *       JWT session token for the desktop browser to use.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token]
 *             properties:
 *               token:
 *                 type: string
 *                 description: The QR token scanned by the desktop browser
 *     responses:
 *       200:
 *         description: JWT session for desktop browser
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                 authToken:
 *                   type: string
 *                   description: JWT Bearer token for the desktop browser session
 *                 userId:
 *                   type: string
 *                   description: User ID (tg_XXXX format)
 *       400:
 *         description: Invalid or expired token
 *       404:
 *         description: Token not found
 */
qrPublicRouter.post('/qr-login/verify', async (req, res) => {
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

// Default export is the public router (for verify endpoint)
export default qrPublicRouter;
