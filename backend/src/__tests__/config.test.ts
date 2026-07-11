describe('Config validation', () => {
  const OLD_ENV = process.env;
  const VALID_ENV = {
    DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/funding_finder',
    TELEGRAM_BOT_TOKEN: 'test_token',
    JWT_SECRET: 'a'.repeat(32),
    WEBHOOK_SECRET: 'a'.repeat(32),
    ENCRYPTION_KEY: 'a'.repeat(32),
  };

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV, ...VALID_ENV };
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('should use dev defaults when NODE_ENV is development', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.PORT;

    const { config } = require('../config/index.js');
    expect(config.port).toBe(3000);
    expect(config.nodeEnv).toBe('development');
    expect(config.isProduction).toBe(false);
    expect(config.telegram.botToken).toBe('test_token');
  });

  it('should set isProduction=true when NODE_ENV is production', () => {
    process.env.NODE_ENV = 'production';

    const { config } = require('../config/index.js');
    expect(config.isProduction).toBe(true);
  });

  it('should reject short JWT_SECRET in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'short';

    expect(() => require('../config/index.js')).toThrow();
  });

  it('should parse PORT env var correctly', () => {
    process.env.NODE_ENV = 'development';
    process.env.PORT = '8080';

    const { config } = require('../config/index.js');
    expect(config.port).toBe(8080);
  });

  it('should use dev fallback for DATABASE_URL when missing', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.DATABASE_URL;

    const { config } = require('../config/index.js');
    expect(config.databaseUrl).toContain('postgresql://');
  });
});
