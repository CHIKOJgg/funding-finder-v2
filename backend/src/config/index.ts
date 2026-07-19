import dotenv from 'dotenv';
import path from 'path';
import { z } from 'zod';

dotenv.config({
  path: path.resolve(__dirname, '../../.env'),
});

const baseSchema = z.object({
  PORT: z.string().regex(/^\d+$/, 'PORT must be a number').default('3000'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  OPENROUTER_API_KEY: z.string().optional().default(''),
  AI_MODEL: z.string().optional().default('deepseek/deepseek-chat-v3-0324:free'),
  AI_MODELS: z
    .string()
    .optional()
    .default(
      'deepseek/deepseek-chat-v3-0324:free,meta-llama/llama-3.3-70b-instruct:free,google/gemini-2.0-flash-exp:free,qwen/qwen-2.5-72b-instruct:free,mistralai/mistral-small-3.1-24b-instruct:free'
    ),
  AI_APP_URL: z.string().optional().default('https://funding-finder-frontend.onrender.com'),
  AI_APP_TITLE: z.string().optional().default('Funding Finder'),
  SETTLE: z.string().optional().default('usdt'),
  MIN_FUNDING_ABS: z.string().optional().default('0.0005'),
  MIN_VOLUME_24H: z.string().optional().default('1000'),
  CRYPTO_PAY_API_TOKEN: z.string().optional().default(''),
  CRYPTO_BOT_USERNAME: z.string().optional().default('CryptoBot'),
  CRYPTO_PAY_NETWORK: z.enum(['mainnet', 'testnet']).optional().default('testnet'),

  // NOWPayments — crypto gateway for the public website (no Telegram required).
  NOWPAYMENTS_API_KEY: z.string().optional().default(''),
  NOWPAYMENTS_IPN_SECRET: z.string().optional().default(''),
  NOWPAYMENTS_NETWORK: z.enum(['sandbox', 'live']).optional().default('sandbox'),

  // Google OAuth (id_token login for the website).
  GOOGLE_CLIENT_ID: z.string().optional().default(''),

  // Public website / SIWE (Sign-In with Ethereum) settings.
  // The canonical site domain used in SIWE messages and as the Google token
  // audience origin. No scheme — e.g. "fundingfinder.app".
  WEB_AUTH_DOMAIN: z.string().optional().default('localhost'),
  SIWE_EXPIRATION_MINUTES: z.string().optional().default('5'),
  JWT_WEB_TTL: z.string().optional().default('7d'),

  CORS_ORIGINS: z.string().optional().default('https://t.me'),

  // Public base URL of THIS API service, used to build webhook (IPN) callback
  // URLs for crypto gateways. Leave empty to rely on status polling only.
  API_BASE_URL: z.string().optional().default(''),
  REDIS_URL: z.string().optional().default(''),
  SMTP_HOST: z.string().optional().default(''),
  SMTP_PORT: z.string().regex(/^\d*$/, 'SMTP_PORT must be a number').optional().default('587'),
  SMTP_SECURE: z.string().optional().default(''),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASS: z.string().optional().default(''),
  EMAIL_FROM: z.string().optional().default('Funding Finder <noreply@fundingfinder.app>'),
  ADMIN_TELEGRAM_IDS: z.string().optional().default(''),
  DEV_ULTIMATE_TELEGRAM_IDS: z.string().optional().default(''),
  SENTRY_DSN: z.string().optional().default(''),

  // Pushover — push notifications for arbitrage alerts (https://pushover.net).
  PUSHOVER_TOKEN: z.string().optional().default(''),
});

const devSchema = baseSchema.extend({
  DATABASE_URL: z.string().url().optional().default('postgresql://postgres:postgres@localhost:5432/funding_finder'),
  TELEGRAM_BOT_TOKEN: z.string().optional().default(''),
  JWT_SECRET: z.string().optional().default('dev-secret-change-in-production'),
  WEBHOOK_SECRET: z.string().optional().default('changeme'),
  ENCRYPTION_KEY: z.string().optional().default(''),
});

const prodSchema = baseSchema.extend({
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid URL'),
  TELEGRAM_BOT_TOKEN: z.string().min(1, 'TELEGRAM_BOT_TOKEN is required in production'),
  // NOTE: a weak default is intentionally NOT provided in production. If the
  // env var is missing/short, startup fails (fail-closed) instead of shipping a
  // forgeable JWT secret. Generate e.g. `openssl rand -hex 32`.
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be set and at least 32 characters in production'),
  WEBHOOK_SECRET: z.string().min(32, 'WEBHOOK_SECRET must be at least 32 characters in production'),
  ENCRYPTION_KEY: z.string().min(32, 'ENCRYPTION_KEY must be at least 32 characters in production (used to encrypt exchange API keys)'),
});

function validateEnv(): z.infer<typeof baseSchema> & {
  DATABASE_URL: string;
  TELEGRAM_BOT_TOKEN: string;
  JWT_SECRET: string;
  WEBHOOK_SECRET: string;
} {
  const isProduction = process.env.NODE_ENV === 'production';
  const schema = isProduction ? prodSchema : devSchema;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const errors = parsed.error.errors.map((e) => {
      const path = e.path.join('.');
      return `${path}: ${e.message}`;
    }).join('; ');
    throw new Error(`Environment validation failed: ${errors}`);
  }
  return parsed.data as any;
}

const env = validateEnv();
const isProduction = env.NODE_ENV === 'production';

export const config = {
  port: parseInt(env.PORT, 10),
  nodeEnv: env.NODE_ENV,
  isProduction,
  databaseUrl: env.DATABASE_URL,

  telegram: {
    botToken: env.TELEGRAM_BOT_TOKEN.trim(),
  },

  ai: {
    openrouterApiKey: env.OPENROUTER_API_KEY,
    // Primary model + fallback chain. Only free-tier models (":free") are kept.
    model: env.AI_MODEL,
    models: Array.from(
      new Set(
        [env.AI_MODEL, ...env.AI_MODELS.split(',')]
          .map((m) => m.trim())
          .filter(Boolean)
          .filter((m) => m.endsWith(':free'))
      )
    ),
    appUrl: env.AI_APP_URL,
    appTitle: env.AI_APP_TITLE,
  },

  exchange: {
    settle: env.SETTLE,
    minFundingAbs: parseFloat(env.MIN_FUNDING_ABS),
    minVolume24h: parseFloat(env.MIN_VOLUME_24H),
  },

  cryptoPay: {
    apiToken: env.CRYPTO_PAY_API_TOKEN,
    botUsername: env.CRYPTO_BOT_USERNAME,
    network: env.CRYPTO_PAY_NETWORK,
  },

  nowPayments: {
    apiKey: env.NOWPAYMENTS_API_KEY,
    ipnSecret: env.NOWPAYMENTS_IPN_SECRET,
    network: env.NOWPAYMENTS_NETWORK,
    get baseUrl() {
      return env.NOWPAYMENTS_NETWORK === 'live'
        ? 'https://api.nowpayments.io/v1'
        : 'https://api-sandbox.nowpayments.io/v1';
    },
  },

  google: {
    clientId: env.GOOGLE_CLIENT_ID,
  },

  webAuth: {
    domain: env.WEB_AUTH_DOMAIN,
    siweExpirationMinutes: parseInt(env.SIWE_EXPIRATION_MINUTES || '5', 10),
  },

  webhook: {
    secret: env.WEBHOOK_SECRET,
  },

  encryption: {
    key: process.env.ENCRYPTION_KEY || '',
  },

  cors: {
    origins: env.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean),
  },

  apiBaseUrl: env.API_BASE_URL,

  jwt: {
    secret: env.JWT_SECRET,
    expiresIn: '24h',
    webTtl: env.JWT_WEB_TTL,
  },

  redis: {
    url: env.REDIS_URL || undefined,
  },

  email: {
    smtp: {
      host: env.SMTP_HOST,
      port: parseInt(env.SMTP_PORT || '587', 10),
      secure: env.SMTP_SECURE === 'true',
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
    },
    from: env.EMAIL_FROM,
  },

  admin: {
    telegramIds: env.ADMIN_TELEGRAM_IDS.split(',').map((id) => id.trim()).filter(Boolean),
    devUltimateTelegramIds: env.DEV_ULTIMATE_TELEGRAM_IDS.split(',').map((id) => id.trim()).filter(Boolean),
  },

  sentry: {
    dsn: env.SENTRY_DSN || undefined,
  },

  pushover: {
    token: env.PUSHOVER_TOKEN || undefined,
  },
} as const;

export type Config = typeof config;
