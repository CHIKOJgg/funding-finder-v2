import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { verifyMessage, getAddress, isAddress } from 'ethers';
import { config } from '../config/index.js';
import { getRedis } from '../utils/redis.js';
import { logger } from '../utils/logger.js';

export type AuthProvider = 'telegram' | 'wallet' | 'google' | 'email' | 'guest';

export interface AuthTokenPayload {
  sub: string; // user.telegramId
  provider: AuthProvider;
  walletAddress?: string;
  email?: string;
  iat?: number;
  exp?: number;
}

const redis = getRedis();

// ---------------------------------------------------------------------------
// JWT
// ---------------------------------------------------------------------------

export function signAuthToken(payload: Omit<AuthTokenPayload, 'iat' | 'exp'>): string {
  // JWT_WEB_TTL may be a duration string ("7d", "30d") or a plain number of
  // SECONDS ("2592000"). jsonwebtoken treats a numeric string as milliseconds
  // (ms() with no unit) — which silently shrinks a 30-day session to ~43
  // minutes — so numeric values must be converted to a number (seconds).
  const ttl = config.jwt.webTtl;
  const expiresIn: jwt.SignOptions['expiresIn'] =
    /^\d+$/.test(ttl) ? parseInt(ttl, 10) : (ttl as jwt.SignOptions['expiresIn']);
  return jwt.sign(payload, config.jwt.secret, { expiresIn });
}

export function verifyAuthToken(token: string): AuthTokenPayload | null {
  try {
    const decoded = jwt.verify(token, config.jwt.secret) as AuthTokenPayload;
    if (!decoded.sub) return null;
    return decoded;
  } catch (err) {
    logger.debug({ err: (err as Error).message }, 'JWT verification failed');
    return null;
  }
}

// ---------------------------------------------------------------------------
// SIWE (Sign-In with Ethereum) — wallet login
// ---------------------------------------------------------------------------

const SIWE_NONCE_TTL_SECONDS = 300; // 5 minutes

/**
 * Store a short-lived nonce keyed by the (lowercased) wallet address. Returns
 * the generated nonce. Uses Redis when available so nonces are shared across
 * instances; otherwise falls back to an in-memory map.
 */
export async function issueSiweNonce(address: string): Promise<string> {
  const normalized = getAddress(address.toLowerCase());
  const nonce = crypto.randomBytes(16).toString('hex');

  if (redis) {
    await redis.set(`siwe:nonce:${normalized}`, nonce, 'EX', SIWE_NONCE_TTL_SECONDS);
  } else {
    siweNonceStore.set(normalized, { nonce, expiresAt: Date.now() + SIWE_NONCE_TTL_SECONDS * 1000 });
  }
  return nonce;
}

export async function consumeSiweNonce(address: string, nonce: string): Promise<boolean> {
  const normalized = getAddress(address.toLowerCase());
  let stored: string | null = null;

  if (redis) {
    stored = await redis.get(`siwe:nonce:${normalized}`);
    if (stored) await redis.del(`siwe:nonce:${normalized}`);
  } else {
    const entry = siweNonceStore.get(normalized);
    if (entry && entry.expiresAt > Date.now()) {
      stored = entry.nonce;
      siweNonceStore.delete(normalized);
    }
  }

  if (!stored) return false;
  // Constant-time compare to avoid timing leaks.
  const a = Buffer.from(stored);
  const b = Buffer.from(nonce);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const siweNonceStore = new Map<string, { nonce: string; expiresAt: number }>();

export interface ParsedSiweMessage {
  domain: string;
  address: string;
  statement?: string;
  uri: string;
  version: string;
  chainId?: string;
  nonce: string;
  issuedAt: string;
  expirationTime?: string;
}

/**
 * Minimal SIWE (EIP-4361) message parser. Extracts the fields needed to verify
 * the nonce, domain, and expiration before checking the signature.
 */
export function parseSiweMessage(message: string): ParsedSiweMessage | null {
  try {
    const lines = message.split('\n');
    if (lines.length < 5) return null;

    // Line 0: "<domain> wants you to sign in with your Ethereum account:"
    const domainMatch = lines[0].match(/^([^\s]+) wants you to sign in with your Ethereum account:$/);
    if (!domainMatch) return null;
    const domain = domainMatch[1];

    // Line 1: "<address>"
    const address = lines[1].trim();
    if (!isAddress(address)) return null;

    const result: Partial<ParsedSiweMessage> = {
      domain,
      address: getAddress(address.toLowerCase()),
    };

    // Subsequent key-value lines
    for (let i = 2; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const [k, ...vParts] = line.split(': ');
      const v = vParts.join(': ');
      if (!k || !v) continue;

      switch (k) {
        case 'URI':
          result.uri = v;
          break;
        case 'Version':
          result.version = v;
          break;
        case 'Chain ID':
          result.chainId = v;
          break;
        case 'Nonce':
          result.nonce = v;
          break;
        case 'Issued At':
          result.issuedAt = v;
          break;
        case 'Expiration Time':
          result.expirationTime = v;
          break;
      }
    }

    if (!result.nonce || !result.uri || !result.version || !result.issuedAt) {
      return null;
    }
    return result as ParsedSiweMessage;
  } catch (err) {
    logger.debug({ err: (err as Error).message }, 'Failed to parse SIWE message');
    return null;
  }
}

export async function verifySiweSignature(
  message: string,
  signature: string
): Promise<{ ok: boolean; address?: string; reason?: string }> {
  const parsed = parseSiweMessage(message);
  if (!parsed) {
    return { ok: false, reason: 'Invalid SIWE message format' };
  }

  // Domain check: ensure the signature was created for OUR website.
  if (config.webAuth.domain && parsed.domain !== config.webAuth.domain) {
    // In dev / preview environments accept localhost / 127.0.0.1 as well.
    const isLocal =
      config.nodeEnv !== 'production' &&
      (parsed.domain.startsWith('localhost') || parsed.domain.startsWith('127.0.0.1'));
    if (!isLocal) {
      return { ok: false, reason: `Domain mismatch: expected ${config.webAuth.domain}, got ${parsed.domain}` };
    }
  }

  // Expiration check (if specified in message)
  if (parsed.expirationTime) {
    const expires = new Date(parsed.expirationTime).getTime();
    if (Date.now() > expires) {
      return { ok: false, reason: 'SIWE message expired' };
    }
  }

  // Nonce check — consume single-use nonce from Redis/memory.
  const nonceValid = await consumeSiweNonce(parsed.address, parsed.nonce);
  if (!nonceValid) {
    return { ok: false, reason: 'Invalid or expired nonce' };
  }

  // Cryptographic signature recovery via ethers
  try {
    const recoveredAddress = verifyMessage(message, signature);
    const normalizedRecovered = getAddress(recoveredAddress.toLowerCase());
    const normalizedExpected = getAddress(parsed.address.toLowerCase());

    if (normalizedRecovered !== normalizedExpected) {
      return { ok: false, reason: 'Recovered address does not match message address' };
    }
    return { ok: true, address: normalizedRecovered };
  } catch (err) {
    return { ok: false, reason: `Signature recovery failed: ${(err as Error).message}` };
  }
}

// ---------------------------------------------------------------------------
// Google Sign-In (ID token verification via tokeninfo endpoint)
// ---------------------------------------------------------------------------

export interface GoogleProfile {
  sub: string; // unique Google user ID
  email?: string;
  emailVerified?: boolean;
  name?: string;
  picture?: string;
}

/**
 * Verify a Google ID token by calling Google's tokeninfo endpoint. Does not
 * require the heavy google-auth-library SDK (zero extra dependencies).
 */
export async function verifyGoogleIdToken(idToken: string): Promise<GoogleProfile | null> {
  if (!config.google.clientId) {
    logger.warn('Google Sign-In attempted but GOOGLE_CLIENT_ID is not configured');
    return null;
  }

  try {
    const url = `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`;
    const res = await fetch(url, { method: 'GET' });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      logger.warn({ status: res.status, body }, 'Google tokeninfo endpoint returned error');
      return null;
    }

    const payload = (await res.json()) as any;

    // Verify audience matches our Client ID
    if (payload.aud !== config.google.clientId) {
      logger.warn({ aud: payload.aud, expected: config.google.clientId }, 'Google token audience mismatch');
      return null;
    }

    // Verify issuer is Google
    const validIssuers = ['accounts.google.com', 'https://accounts.google.com'];
    if (!validIssuers.includes(payload.iss)) {
      logger.warn({ iss: payload.iss }, 'Google token issuer invalid');
      return null;
    }

    // Expiry check
    const exp = parseInt(payload.exp, 10) * 1000;
    if (Date.now() > exp) {
      logger.warn('Google ID token expired');
      return null;
    }

    return {
      sub: payload.sub,
      email: payload.email,
      emailVerified: payload.email_verified === 'true' || payload.email_verified === true,
      name: payload.name || payload.given_name,
      picture: payload.picture,
    };
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'Failed to verify Google ID token');
    return null;
  }
}
