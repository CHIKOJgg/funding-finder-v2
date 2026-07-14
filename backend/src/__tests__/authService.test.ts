import { ethers } from 'ethers';
import {
  signAuthToken,
  verifyAuthToken,
  parseSiweMessage,
  issueSiweNonce,
  consumeSiweNonce,
  verifySiweSignature,
  verifyGoogleIdToken,
} from '../services/authService.js';

describe('authService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('JWT', () => {
    it('round-trips a signed auth token', () => {
      const token = signAuthToken({ sub: 'tg_123', provider: 'telegram' });
      const decoded = verifyAuthToken(token);
      expect(decoded).not.toBeNull();
      expect(decoded!.sub).toBe('tg_123');
      expect(decoded!.provider).toBe('telegram');
    });

    it('returns null for an invalid token', () => {
      expect(verifyAuthToken('not-a-real-token')).toBeNull();
    });

    it('returns null for a token without a subject', () => {
      const token = signAuthToken({ sub: '', provider: 'email' } as any);
      expect(verifyAuthToken(token)).toBeNull();
    });
  });

  describe('SIWE message parsing', () => {
    const addr = '0x742d35Cc6634C0532925a3b844Bc454e4438f44e';

    it('parses a well-formed SIWE message', () => {
      const msg =
        'localhost wants you to sign in with your Ethereum account:\n' +
        `${addr}\n\n` +
        'URI: https://localhost\n' +
        'Version: 1\n' +
        'Chain ID: 1\n' +
        'Nonce: abc123\n' +
        'Issued At: 2024-01-01T00:00:00Z';
      const parsed = parseSiweMessage(msg);
      expect(parsed).not.toBeNull();
      expect(parsed!.domain).toBe('localhost');
      expect(parsed!.address).toBe(addr);
      expect(parsed!.nonce).toBe('abc123');
      expect(parsed!.version).toBe('1');
    });

    it('returns null for a malformed message', () => {
      expect(parseSiweMessage('garbage')).toBeNull();
      expect(parseSiweMessage('')).toBeNull();
    });

    it('returns null when the address is invalid', () => {
      const msg =
        'localhost wants you to sign in with your Ethereum account:\n' +
        'not-an-address\n\nURI: https://localhost\nVersion: 1\nNonce: x';
      expect(parseSiweMessage(msg)).toBeNull();
    });
  });

  describe('SIWE nonce lifecycle (in-memory, no Redis)', () => {
    const addr = '0x742d35Cc6634C0532925a3b844Bc454e4438f44e';

    it('consumes a previously issued nonce exactly once', async () => {
      const nonce = await issueSiweNonce(addr);
      expect(typeof nonce).toBe('string');
      expect(await consumeSiweNonce(addr, nonce)).toBe(true);
      expect(await consumeSiweNonce(addr, nonce)).toBe(false);
    });

    it('rejects a wrong nonce', async () => {
      const nonce = await issueSiweNonce(addr);
      expect(await consumeSiweNonce(addr, 'wrong-nonce')).toBe(false);
    });
  });

  describe('SIWE signature verification', () => {
    const wallet = ethers.Wallet.createRandom();
    const addr = wallet.address;

    it('verifies a valid signature and consumes the nonce', async () => {
      const nonce = await issueSiweNonce(addr);
      const msg =
        'localhost wants you to sign in with your Ethereum account:\n' +
        `${addr}\n\n` +
        'URI: https://localhost\n' +
        'Version: 1\n' +
        `Nonce: ${nonce}\n` +
        `Issued At: ${new Date().toISOString()}`;
      const sig = await wallet.signMessage(msg);
      const res = await verifySiweSignature(msg, sig);
      expect(res.ok).toBe(true);
      expect(res.address).toBe(addr);
    });

    it('rejects a message for an unexpected domain', async () => {
      const nonce = await issueSiweNonce(addr);
      const msg =
        'evil.com wants you to sign in with your Ethereum account:\n' +
        `${addr}\n\nURI: https://evil.com\nVersion: 1\nNonce: ${nonce}\nIssued At: ${new Date().toISOString()}`;
      const sig = await wallet.signMessage(msg);
      const res = await verifySiweSignature(msg, sig);
      expect(res.ok).toBe(false);
      expect(res.reason).toMatch(/domain/);
    });

    it('rejects when the nonce does not match', async () => {
      const msg =
        'localhost wants you to sign in with your Ethereum account:\n' +
        `${addr}\n\nURI: https://localhost\nVersion: 1\nNonce: never-issued\nIssued At: ${new Date().toISOString()}`;
      const sig = await wallet.signMessage(msg);
      const res = await verifySiweSignature(msg, sig);
      expect(res.ok).toBe(false);
    });
  });

  describe('Google id_token', () => {
    it('reports not-configured when client id is absent', async () => {
      const res = await verifyGoogleIdToken('any.token.here');
      expect(res.ok).toBe(false);
      expect(res.reason).toMatch(/not configured/);
    });
  });
});
