// Jest setup: provide a safe test environment BEFORE config/index.ts is
// imported (config calls validateEnv() at module load). dotenv.config() never
// overrides variables already present in process.env, so setting these here
// wins over any local .env and lets the suite run without secrets or a real DB.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/funding_finder_test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-at-least-32-characters-long!!';
process.env.WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'test-webhook-secret-at-least-32-chars-long!!';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'test-encryption-key-32-bytes-minimum!!';
process.env.REDIS_URL = process.env.REDIS_URL || '';
process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
