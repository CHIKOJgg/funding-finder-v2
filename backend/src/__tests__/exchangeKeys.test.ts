import { encryptJson, decryptJson } from '../services/exchangeKeys.js';

describe('exchangeKeys encryption', () => {
  const payload = { apiKey: 'abc123', secret: 'supersecret', passphrase: 'pp' };

  it('round-trips encrypted JSON', () => {
    const enc = encryptJson(payload);
    expect(enc).not.toContain(payload.secret);
    expect(enc).not.toContain(payload.apiKey);
    const dec = decryptJson<typeof payload>(enc);
    expect(dec).toEqual(payload);
  });

  it('produces a different ciphertext each time (random IV)', () => {
    const a = encryptJson(payload);
    const b = encryptJson(payload);
    expect(a).not.toEqual(b);
  });

  it('fails to decrypt a tampered payload', () => {
    const enc = encryptJson(payload);
    const buf = Buffer.from(enc, 'base64');
    buf[buf.length - 1] ^= 0xff; // flip a byte
    expect(() => decryptJson(Buffer.from(buf).toString('base64'))).toThrow();
  });
});
