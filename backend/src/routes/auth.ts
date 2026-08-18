import { Router, Request, Response } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { isAddress, getAddress } from 'ethers';
import { validate } from '../middleware/validation.js';
import { authenticate, AuthenticatedRequest } from '../middleware/auth.js';
import {
  issueSiweNonce,
  verifySiweSignature,
  verifyGoogleIdToken,
  signAuthToken,
} from '../services/authService.js';
import { prisma } from '../services/prisma.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { sendError } from '../middleware/errorHandler.js';

// ---------------------------------------------------------------------------
// Email / password helpers (PBKDF2 via Node built-in crypto — no bcrypt dep)
// ---------------------------------------------------------------------------
const KDF_ITERATIONS = 100_000;
const KDF_KEYLEN = 64;
const KDF_DIGEST = 'sha512';

function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString('hex');
    crypto.scrypt(password, salt, KDF_KEYLEN, { N: 16384, r: 8, p: 1 }, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(`${salt}:${derivedKey.toString('hex')}`);
    });
  });
}

function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const [salt, hash] = storedHash.split(':');
    if (!salt || !hash) return resolve(false);
    crypto.scrypt(password, salt, KDF_KEYLEN, { N: 16384, r: 8, p: 1 }, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(crypto.timingSafeEqual(Buffer.from(hash, 'hex'), derivedKey));
    });
  });
}

const router = Router();

async function resolveReferralCode(code?: string): Promise<string | undefined> {
  if (!code) return undefined;
  const referrer = await prisma.user.findUnique({ where: { referralCode: code } });
  return referrer?.id;
}

async function findOrCreateWebUser(params: {
  telegramId: string;
  provider: 'wallet' | 'google' | 'email' | 'guest';
  walletAddress?: string;
  googleSub?: string;
  email?: string;
  firstName?: string;
  referredByCode?: string;
}): Promise<{ telegramId: string; authProvider: string; walletAddress?: string | null; email?: string | null; referralCode: string }> {
  const referrerId = await resolveReferralCode(params.referredByCode);
  const user = await prisma.user.upsert({
    where: { telegramId: params.telegramId },
    create: {
      telegramId: params.telegramId,
      authProvider: params.provider,
      walletAddress: params.walletAddress,
      googleSub: params.googleSub,
      email: params.email,
      firstName: params.firstName,
      lastActive: new Date(),
      ...(referrerId ? { referredBy: referrerId } : {}),
    },
    update: {
      lastActive: new Date(),
      authProvider: params.provider,
      ...(params.walletAddress ? { walletAddress: params.walletAddress } : {}),
      ...(params.email ? { email: params.email } : {}),
    },
  });
  return user;
}

function publicUser(user: any) {
  return {
    id: user.telegramId,
    provider: user.authProvider,
    walletAddress: user.walletAddress,
    email: user.email,
    firstName: user.firstName,
    username: user.username,
    subscription: user.subscription,
    subscriptionExpiresAt: user.subscriptionExpiresAt,
    referralCode: user.referralCode,
  };
}

const nonceSchema = z.object({
  address: z.string().refine((v) => isAddress(v), { message: 'Invalid Ethereum address' }),
});

// GET /api/auth/wallet/nonce?address=0x...  → single-use SIWE nonce
router.get('/wallet/nonce', validate(nonceSchema, 'query'), async (req: Request, res: Response) => {
  try {
    const address = (req.query as any).address as string;
    const nonce = await issueSiweNonce(address);
    res.json({ ok: true, nonce, domain: config.webAuth.domain });
  } catch (e) {
    const error = e as Error;
    logger.error({ err: error }, 'SIWE nonce error');
    sendError(res, 500, 'Failed to generate nonce', 'AUTH_NONCE_ERROR');
  }
});

const walletVerifySchema = z.object({
  message: z.string().min(1),
  signature: z.string().min(1),
  referredByCode: z.string().optional(),
});

// POST /api/auth/wallet/verify  → verify signature, issue JWT
router.post('/wallet/verify', validate(walletVerifySchema), async (req: Request, res: Response) => {
  try {
    const { message, signature, referredByCode } = req.body;
    const result = await verifySiweSignature(message, signature);
    if (!result.ok || !result.address) {
      return res.status(401).json({ ok: false, error: result.reason || 'Signature verification failed' });
    }

    const address = result.address; // checksummed, lowercased
    const telegramId = `wallet_${address}`;
    const user = await findOrCreateWebUser({
      telegramId,
      provider: 'wallet',
      walletAddress: address,
      firstName: 'Wallet User',
      referredByCode,
    });

    const token = signAuthToken({ sub: telegramId, provider: 'wallet', walletAddress: address });
    res.json({ ok: true, token, user: publicUser(user) });
  } catch (e) {
    const error = e as Error;
    logger.error({ err: error }, 'Wallet verify error');
    sendError(res, 500, 'Wallet verification failed', 'AUTH_WALLET_VERIFY_ERROR');
  }
});

const googleSchema = z.object({
  idToken: z.string().min(1),
  referredByCode: z.string().optional(),
});

// POST /api/auth/google  → verify Google id_token, issue JWT
router.post('/google', validate(googleSchema), async (req: Request, res: Response) => {
  try {
    const { idToken, referredByCode } = req.body;
    const result = await verifyGoogleIdToken(idToken);
    if (!result.ok || !result.sub) {
      return res.status(401).json({ ok: false, error: result.reason || 'Google authentication failed' });
    }

    const telegramId = `google_${result.sub}`;\n    const user = await findOrCreateWebUser({\n      telegramId,\n      provider: 'google',\n      googleSub: result.sub,\n      email: result.email,\n      firstName: result.email ? result.email.split('@')[0] : 'Google User',\n      referredByCode,\n    });\n\n    const token = signAuthToken({ sub: telegramId, provider: 'google', email: result.email });\n    res.json({ ok: true, token, user: publicUser(user) });\n  } catch (e) {\n    const error = e as Error;\n    logger.error({ err: error }, 'Google verify error');\n    sendError(res, 500, 'Google authentication failed', 'AUTH_GOOGLE_VERIFY_ERROR');\n  }\n});\n\n// GET /api/auth/me → current session user\nrouter.get('/me', authenticate, async (req: AuthenticatedRequest, res: Response) => {\n  try {\n    const userId = req.userId!;\n    const user = await prisma.user.findUnique({ where: { telegramId: userId } });\n    if (!user) return res.status(404).json({ ok: false, error: 'User not found' });\n    res.json({ ok: true, user: publicUser(user) });\n  } catch (e) {\n    const error = e as Error;\n    logger.error({ err: error }, 'Auth me error');\n    sendError(res, 500, 'Failed to fetch user profile', 'AUTH_ME_ERROR');\n  }\n});\n\n// GET /api/auth/config → public capabilities for the login screen\nrouter.get('/config', async (_req: Request, res: Response) => {\n  res.json({\n    ok: true,\n    googleEnabled: Boolean(config.google.clientId),\n    googleClientId: config.google.clientId || undefined,\n    siweDomain: config.webAuth.domain,\n    simulation: !config.nowPayments.apiKey,\n  });\n});\n\n// POST /api/auth/guest → seamless guest session for web visitors\nrouter.post('/guest', async (req: Request, res: Response) => {\n  try {\n    const { referredByCode } = req.body || {};\n    const telegramId = `guest_${crypto.randomBytes(8).toString('hex')}`;\n    const user = await findOrCreateWebUser({\n      telegramId,\n      provider: 'guest',\n      firstName: 'Гость',\n      referredByCode,\n    });\n    const token = signAuthToken({ sub: telegramId, provider: 'guest' });\n    res.json({ ok: true, token, user: publicUser(user) });\n  } catch (e) {\n    const error = e as Error;\n    logger.error({ err: error }, 'Guest auth error');\n    sendError(res, 500, 'Guest session failed', 'AUTH_GUEST_ERROR');\n  }\n});\n\n// POST /api/auth/dev-guest → dev-only ephemeral session (no real auth)\nif (!config.isProduction) {\n  router.post('/dev-guest', async (_req: Request, res: Response) => {\n    try {\n      const telegramId = `web_dev_${crypto.randomBytes(6).toString('hex')}`;\n      const user = await findOrCreateWebUser({\n        telegramId,\n        provider: 'guest',\n        firstName: 'Dev Guest',\n      });\n      const token = signAuthToken({ sub: telegramId, provider: 'guest' });\n      res.json({ ok: true, token, user: publicUser(user) });\n    } catch (e) {\n      const error = e as Error;\n      logger.error({ err: error }, 'Dev guest error');\n      sendError(res, 500, 'Dev guest session failed', 'AUTH_DEV_GUEST_ERROR');\n    }\n  });\n}\n\n// ---------------------------------------------------------------------------\n// Email / password registration + login\n// ---------------------------------------------------------------------------\n\n// Per-account brute-force protection. The shared IP-based `authLimiter`\n// (3000 req/15 min) is useless against a distributed attack on one account;\n// this keys on the normalized email so ~20 attempts per account per 15 min is\n// the ceiling. Falls back to IP when the body isn't parseable.\nconst credentialLimiter = rateLimit({\n  windowMs: 15 * 60 * 1000,\n  limit: 20,\n  standardHeaders: true,\n  legacyHeaders: false,\n  keyGenerator: (req: Request): string => {\n    const email = (req.body as { email?: unknown } | undefined)?.email;\n    if (typeof email === 'string' && email.trim()) {\n      return `cred:${email.trim().toLowerCase()}`;\n    }\n    return `cred:ip:${ipKeyGenerator(req.ip || 'unknown')}`;\n  },\n  message: { ok: false, error: 'Too many attempts. Try again later.' },\n});\n\nconst registerSchema = z.object({\n  email: z.string().email('Invalid email address'),\n  password: z.string().min(8, 'Password must be at least 8 characters'),\n  firstName: z.string().min(1).max(50).optional(),\n  referredByCode: z.string().optional(),\n});\n\n// POST /api/auth/register → create account with email + password\nrouter.post('/register', credentialLimiter, validate(registerSchema), async (req: Request, res: Response) => {\n  try {\n    const { email, password, firstName, referredByCode } = req.body;\n    const normalizedEmail = email.toLowerCase().trim();\n\n    // Check if email is already taken\n    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });\n    if (existing) {\n      return res.status(409).json({ ok: false, error: 'An account with this email already exists' });\n    }\n\n    const passwordHash = await hashPassword(password);\n    const telegramId = `email_${normalizedEmail}`;\n    const referrerId = referredByCode\n      ? (await prisma.user.findUnique({ where: { referralCode: referredByCode } }))?.id\n      : undefined;\n\n    const user = await prisma.user.create({\n      data: {\n        telegramId,\n        authProvider: 'email',\n        email: normalizedEmail,\n        passwordHash,\n        firstName: firstName || normalizedEmail.split('@')[0],\n        lastActive: new Date(),\n        ...(referrerId ? { referredBy: referrerId } : {}),\n      },\n    });\n\n    const token = signAuthToken({ sub: telegramId, provider: 'email', email: normalizedEmail });\n    res.json({ ok: true, token, user: publicUser(user) });\n  } catch (e) {\n    const error = e as Error;\n    logger.error({ err: error }, 'Email register error');\n    sendError(res, 500, 'Registration failed', 'AUTH_REGISTER_ERROR');\n  }\n});\n\nconst loginSchema = z.object({\n  email: z.string().email(),\n  password: z.string().min(1),\n});\n\n// POST /api/auth/login → sign in with email + password\nrouter.post('/login', credentialLimiter, validate(loginSchema), async (req: Request, res: Response) => {\n  try {\n    const { email, password } = req.body;\n    const normalizedEmail = email.toLowerCase().trim();\n\n    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });\n    if (!user || !user.passwordHash) {\n      return res.status(401).json({ ok: false, error: 'Invalid email or password' });\n    }\n\n    const valid = await verifyPassword(password, user.passwordHash);\n    if (!valid) {\n      return res.status(401).json({ ok: false, error: 'Invalid email or password' });\n    }\n\n    await prisma.user.update({\n      where: { telegramId: user.telegramId },\n      data: { lastActive: new Date() },\n    });\n\n    const token = signAuthToken({ sub: user.telegramId, provider: 'email', email: normalizedEmail });\n    res.json({ ok: true, token, user: publicUser(user) });\n  } catch (e) {\n    const error = e as Error;\n    logger.error({ err: error }, 'Email login error');\n    sendError(res, 500, 'Login failed', 'AUTH_LOGIN_ERROR');\n  }\n});\n\nexport default router;\n