import crypto from 'crypto';

function createTelegramInitData(botToken: string, user: { id: number; first_name: string }): string {
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const userStr = JSON.stringify(user);
  const authDate = Math.floor(Date.now() / 1000).toString();

  const urlParams = new URLSearchParams();
  urlParams.set('auth_date', authDate);
  urlParams.set('user', userStr);

  const dataCheckString = Array.from(urlParams.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  urlParams.set('hash', hash);

  return urlParams.toString();
}

describe('Telegram initData validation', () => {
  const testToken = 'test-bot-token-12345';

  it('should create valid init data', () => {
    const initData = createTelegramInitData(testToken, { id: 123456, first_name: 'Test' });
    expect(initData).toContain('auth_date=');
    expect(initData).toContain('user=');
    expect(initData).toContain('hash=');
  });

  it('should produce different hashes for different data', () => {
    const data1 = createTelegramInitData(testToken, { id: 1, first_name: 'User1' });
    const data2 = createTelegramInitData(testToken, { id: 2, first_name: 'User2' });
    const hash1 = new URLSearchParams(data1).get('hash');
    const hash2 = new URLSearchParams(data2).get('hash');
    expect(hash1).not.toBe(hash2);
  });

  it('should produce same hash for same data', () => {
    const user = { id: 123456, first_name: 'Test' };
    const data1 = createTelegramInitData(testToken, user);
    const data2 = createTelegramInitData(testToken, user);
    const hash1 = new URLSearchParams(data1).get('hash');
    const hash2 = new URLSearchParams(data2).get('hash');
    expect(hash1).toBe(hash2);
  });
});
