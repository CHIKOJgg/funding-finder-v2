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
  AI_MODEL: z.string().optional().default('x-ai/grok-4.1-fast:free'),
  SETTLE: z.string().optional().default('usdt'),
  MIN_FUNDING_ABS: z.string().optional().default('0.0005'),
  MIN_VOLUME_24H: z.string().optional().default('1000'),
  CRYPTO_PAY_API_TOKEN: z.string().optional().default(''),
  CRYPTO_BOT_USERNAME: z.string().optional().default('CryptoBot'),
  CRYPTO_PAY_NETWORK: z.enum(['mainnet', 'testnet']).optional().default('testnet'),
  CORS_ORIGINS: z.string().optional().default('https://t.me'),
  REDIS_URL: z.string().optional().default(''),
  SMTP_HOST: z.string().optional().default(''),
  SMTP_PORT: z.string().regex(/^\d*$/, 'SMTP_PORT must be a number').optional().default('587'),
  SMTP_SECURE: z.string().optional().default(''),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASS: z.string().optional().default(''),
  EMAIL_FROM: z.string().optional().default('Funding Finder <noreply@fundingfinder.app>'),
});

const devSchema = baseSchema.extend({
  DATABASE_URL: z.string().url().optional().default('postgresql://postgres:postgres@localhost:5432/funding_finder'),
  TELEGRAM_BOT_TOKEN: z.string().optional().default(''),
  JWT_SECRET: z.string().optional().default('dev-secret-change-in-production'),
  WEBHOOK_SECRET: z.string().optional().default('changeme'),
});

const prodSchema = baseSchema.extend({
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid URL'),
  TELEGRAM_BOT_TOKEN: z.string().min(1, 'TELEGRAM_BOT_TOKEN is required in production'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters in production'),
  WEBHOOK_SECRET: z.string().min(32, 'WEBHOOK_SECRET must be at least 32 characters in production'),
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
    botToken: env.TELEGRAM_BOT_TOKEN,
  },

  ai: {
    openrouterApiKey: env.OPENROUTER_API_KEY,
    model: env.AI_MODEL,
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

  webhook: {
    secret: env.WEBHOOK_SECRET,
  },

  cors: {
    origins: env.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean),
  },

  jwt: {
    secret: env.JWT_SECRET,
    expiresIn: '24h',
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
} as const;

export type Config = typeof config;
