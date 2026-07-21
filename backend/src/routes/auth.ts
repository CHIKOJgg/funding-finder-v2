import { Router, Request, Response } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
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
  provider: 'wallet' | 'google' | 'email';
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
    res.status(500).json({ ok: false, error: error.message });
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
    res.status(500).json({ ok: false, error: error.message });
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

    const telegramId = `google_${result.sub}`;
    const user = await findOrCreateWebUser({
      telegramId,
      provider: 'google',
      googleSub: result.sub,
      email: result.email,
      firstName: result.email ? result.email.split('@')[0] : 'Google User',
      referredByCode,
    });

    const token = signAuthToken({ sub: telegramId, provider: 'google', email: result.email });
    res.json({ ok: true, token, user: publicUser(user) });
  } catch (e) {
    const error = e as Error;
    logger.error({ err: error }, 'Google verify error');
    res.status(500).json({ ok: false, error: error.message });
  }
});

// GET /api/auth/me → current session user
router.get('/me', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const user = await prisma.user.findUnique({ where: { telegramId: userId } });
    if (!user) return res.status(404).json({ ok: false, error: 'User not found' });
    res.json({ ok: true, user: publicUser(user) });
  } catch (e) {
    const error = e as Error;
    logger.error({ err: error }, 'Auth me error');
    res.status(500).json({ ok: false, error: error.message });
  }
});

// GET /api/auth/config → public capabilities for the login screen
router.get('/config', async (_req: Request, res: Response) => {
  res.json({
    ok: true,
    googleEnabled: Boolean(config.google.clientId),
    googleClientId: config.google.clientId || undefined,
    siweDomain: config.webAuth.domain,
    simulation: !config.nowPayments.apiKey,
  });
});

// POST /api/auth/dev-guest → dev-only ephemeral session (no real auth)
if (!config.isProduction) {
  router.post('/dev-guest', async (_req: Request, res: Response) => {
    try {
      const telegramId = `web_dev_${crypto.randomBytes(6).toString('hex')}`;
      const user = await findOrCreateWebUser({
        telegramId,
        provider: 'email',
        firstName: 'Dev Guest',
      });
      const token = signAuthToken({ sub: telegramId, provider: 'email' });
      res.json({ ok: true, token, user: publicUser(user) });
    } catch (e) {
      const error = e as Error;
      logger.error({ err: error }, 'Dev guest error');
      res.status(500).json({ ok: false, error: error.message });
    }
  });
}

// ---------------------------------------------------------------------------
// Email / password registration + login
// ---------------------------------------------------------------------------

const registerSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  firstName: z.string().min(1).max(50).optional(),
  referredByCode: z.string().optional(),
});

// POST /api/auth/register → create account with email + password
router.post('/register', validate(registerSchema), async (req: Request, res: Response) => {
  try {
    const { email, password, firstName, referredByCode } = req.body;
    const normalizedEmail = email.toLowerCase().trim();

    // Check if email is already taken
    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) {
      return res.status(409).json({ ok: false, error: 'An account with this email already exists' });
    }

    const passwordHash = await hashPassword(password);
    const telegramId = `email_${normalizedEmail}`;
    const referrerId = referredByCode
      ? (await prisma.user.findUnique({ where: { referralCode: referredByCode } }))?.id
      : undefined;

    const user = await prisma.user.create({
      data: {
        telegramId,
        authProvider: 'email',
        email: normalizedEmail,
        passwordHash,
        firstName: firstName || normalizedEmail.split('@')[0],
        lastActive: new Date(),
        ...(referrerId ? { referredBy: referrerId } : {}),
      },
    });

    const token = signAuthToken({ sub: telegramId, provider: 'email', email: normalizedEmail });
    res.json({ ok: true, token, user: publicUser(user) });
  } catch (e) {
    const error = e as Error;
    logger.error({ err: error }, 'Email register error');
    res.status(500).json({ ok: false, error: error.message });
  }
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// POST /api/auth/login → sign in with email + password
router.post('/login', validate(loginSchema), async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    const normalizedEmail = email.toLowerCase().trim();

    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (!user || !user.passwordHash) {
      return res.status(401).json({ ok: false, error: 'Invalid email or password' });
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ ok: false, error: 'Invalid email or password' });
    }

    await prisma.user.update({
      where: { telegramId: user.telegramId },
      data: { lastActive: new Date() },
    });

    const token = signAuthToken({ sub: user.telegramId, provider: 'email', email: normalizedEmail });
    res.json({ ok: true, token, user: publicUser(user) });
  } catch (e) {
    const error = e as Error;
    logger.error({ err: error }, 'Email login error');
    res.status(500).json({ ok: false, error: error.message });
  }
});

export default router;
