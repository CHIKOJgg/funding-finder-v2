import crypto from 'crypto';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

// AES-256-GCM encryption for stored exchange API credentials.
// The encryption key is derived (scrypt) from ENCRYPTION_KEY. In production
// ENCRYPTION_KEY MUST be set; otherwise we fall back to JWT_SECRET and warn so
// the service still boots in dev without leaking plaintext secrets.

function deriveKey(): Buffer {
  if (!config.encryption.key) {
    if (config.isProduction) {
      // Fail closed in production: encrypting exchange API keys with the JWT
      // secret is unacceptable. Refuse to boot rather than silently weaken
      // credential encryption.
      throw new Error(
        'ENCRYPTION_KEY is not set — refusing to start in production. API keys would be encrypted with an insecure fallback. Set ENCRYPTION_KEY (>=32 chars).'
      );
    }
    logger.warn('ENCRYPTION_KEY not set — using JWT secret fallback (development only).');
    return crypto.scryptSync(config.jwt.secret, 'funding-finder-apikey-salt', 32);
  }
  return crypto.scryptSync(config.encryption.key, 'funding-finder-apikey-salt', 32);
}

const KEY = deriveKey();
const IV_LEN = 12;
const TAG_LEN = 16;

export function encryptJson(data: unknown): string {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decryptJson<T = any>(payload: string): T {
  const buf = Buffer.from(payload, 'base64');
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const enc = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
  decipher.setAuthTag(tag);
  const json = Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  return JSON.parse(json) as T;
}
