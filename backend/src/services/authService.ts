import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { verifyMessage, getAddress, isAddress } from 'ethers';
import { config } from '../config/index.js';
import { getRedis } from '../utils/redis.js';
import { logger } from '../utils/logger.js';

export type AuthProvider = 'telegram' | 'wallet' | 'google' | 'email';

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
  return jwt.sign(payload, config.jwt.secret, {
    expiresIn: config.jwt.webTtl as jwt.SignOptions['expiresIn'],
  });
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
  issuedAt?: string;
  expirationTime?: string;
  notBefore?: string;
}

/**
 * Parse an EIP-4361 SIWE message. We deliberately keep this minimal but strict:
 * a malformed message fails closed rather than silently accepting a login.
 */
export function parseSiweMessage(message: string): ParsedSiweMessage | null {
  try {
    const lines = message.split('\n');
    // Line 1: "<domain> wants you to sign in with your Ethereum account:"
    const domainMatch = lines[0]?.match(/^(.+?) wants you to sign in with your Ethereum account:$/);
    if (!domainMatch) return null;
    const domain = domainMatch[1].trim();

    // Line 2: the wallet address (may be followed by a " (optional)" suffix).
    const addressLine = (lines[1] || '').trim();
    const address = addressLine.split(/\s+/)[0];
    if (!address || !isAddress(address)) return null;

    // Remaining lines are an optional blank separator, then key: value fields.
    const fields: Record<string, string> = {};
    for (let i = 2; i < lines.length; i++) {
      const line = lines[i];
      if (!line.includes(':')) continue;
      const idx = line.indexOf(':');
      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim();
      if (key) fields[key] = value;
    }

    if (!fields['Nonce']) return null;

    return {
      domain,
      address,
      statement: fields['Statement'],
      uri: fields['URI'] || '',
      version: fields['Version'] || '',
      chainId: fields['Chain ID'],
      nonce: fields['Nonce'],
      issuedAt: fields['Issued At'],
      expirationTime: fields['Expiration Time'],
      notBefore: fields['Not Before'],
    };
  } catch {
    return null;
  }
}

export interface SiweVerifyResult {
  ok: boolean;
  address?: string;
  reason?: string;
}

/**
 * Verify a SIWE signature. Recovers the signer address from the personal_sign
 * signature and checks it against the address in the message, the stored nonce,
 * the expected domain, and the message expiry.
 */
export async function verifySiweSignature(
  message: string,
  signature: string
): Promise<SiweVerifyResult> {
  const parsed = parseSiweMessage(message);
  if (!parsed) return { ok: false, reason: 'Malformed SIWE message' };

  if (parsed.domain !== config.webAuth.domain) {
    return { ok: false, reason: `Unexpected domain: ${parsed.domain}` };
  }

  if (parsed.version !== '1') {
    return { ok: false, reason: 'Unsupported SIWE version' };
  }

  // Expiry / not-before checks.
  const nowMs = Date.now();
  if (parsed.notBefore && new Date(parsed.notBefore).getTime() > nowMs) {
    return { ok: false, reason: 'Message not yet valid' };
  }
  if (parsed.expirationTime) {
    const expMs = new Date(parsed.expirationTime).getTime();
    if (!Number.isNaN(expMs) && expMs < nowMs) {
      return { ok: false, reason: 'Message expired' };
    }
  } else if (parsed.issuedAt) {
    // Fallback: enforce a max age even when an explicit Expiration Time is absent.
    const issued = new Date(parsed.issuedAt).getTime();
    if (!Number.isNaN(issued) && nowMs - issued > config.webAuth.siweExpirationMinutes * 60 * 1000) {
      return { ok: false, reason: 'Message too old' };
    }
  }

  // Recover the signer.
  let recovered: string;
  try {
    recovered = verifyMessage(message, signature);
  } catch (err) {
    return { ok: false, reason: `Invalid signature: ${(err as Error).message}` };
  }

  const expected = getAddress(parsed.address.toLowerCase());
  if (getAddress(recovered.toLowerCase()) !== expected) {
    return { ok: false, reason: 'Signature does not match address' };
  }

  // Nonce must match (and is single-use).
  const nonceOk = await consumeSiweNonce(expected, parsed.nonce);
  if (!nonceOk) {
    return { ok: false, reason: 'Invalid or expired nonce' };
  }

  return { ok: true, address: expected };
}

// ---------------------------------------------------------------------------
// Google id_token verification
// ---------------------------------------------------------------------------

const GOOGLE_CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
let googleCertsCache: { keys: Record<string, crypto.KeyObject>; fetchedAt: number } | null = null;

async function getGoogleSigningKeys(): Promise<Record<string, crypto.KeyObject>> {
  const now = Date.now();
  if (googleCertsCache && now - googleCertsCache.fetchedAt < 60 * 60 * 1000) {
    return googleCertsCache.keys;
  }
  const res = await fetch(GOOGLE_CERTS_URL);
  if (!res.ok) throw new Error(`Failed to fetch Google certs: ${res.status}`);
  const data = (await res.json()) as { keys: Array<{ kid: string; kty: string; n?: string; e?: string; alg?: string }> };
  const keys: Record<string, crypto.KeyObject> = {};
  for (const k of data.keys) {
    if (k.kty === 'RSA' && k.n && k.e) {
      try {
        keys[k.kid] = crypto.createPublicKey({ format: 'jwk', key: { kty: 'RSA', n: k.n, e: k.e } });
      } catch {
        /* skip unusable key */
      }
    }
  }
  googleCertsCache = { keys, fetchedAt: now };
  return keys;
}

export interface GoogleVerifyResult {
  ok: boolean;
  sub?: string;
  email?: string;
  reason?: string;
}

export async function verifyGoogleIdToken(idToken: string): Promise<GoogleVerifyResult> {
  if (!config.google.clientId) {
    return { ok: false, reason: 'Google login is not configured' };
  }

  try {
    const headerB64 = idToken.split('.')[0];
    if (!headerB64) return { ok: false, reason: 'Malformed id_token' };
    const header = JSON.parse(Buffer.from(headerB64, 'base64').toString('utf8')) as { kid?: string; alg?: string };
    if (header.alg !== 'RS256') return { ok: false, reason: 'Unexpected algorithm' };

    const keys = await getGoogleSigningKeys();
    const key = header.kid ? keys[header.kid] : undefined;
    if (!key) return { ok: false, reason: 'Unknown signing key' };

    const payload = jwt.verify(idToken, key, {
      algorithms: ['RS256'],
      audience: config.google.clientId,
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
    }) as { sub: string; email?: string; email_verified?: boolean };

    return { ok: true, sub: payload.sub, email: payload.email };
  } catch (err) {
    return { ok: false, reason: `Google verification failed: ${(err as Error).message}` };
  }
}
