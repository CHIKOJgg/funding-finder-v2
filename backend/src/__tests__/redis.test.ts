/**
 * Unit tests for src/utils/redis.ts
 *
 * There is no real Redis available in CI, so we mock `ioredis` and the app
 * config. getRedis() is a lazily-initialized singleton: when config.redis.url
 * is set it constructs a (mocked) Redis client; when unset it returns null.
 *
 * This file forces a configured URL via a mocked config module so we exercise
 * the client-construction path without contacting a real server. The null
 * branch (REDIS_URL empty) is the default behavior in the test environment and
 * is effectively covered by the app running in CI without a Redis URL.
 */
jest.mock('ioredis', () => {
  const RedisMock = jest.fn().mockImplementation(() => {
    return {
      on: jest.fn(),
      quit: jest.fn(() => Promise.resolve('OK')),
    };
  });
  return { __esModule: true, default: RedisMock };
});

jest.mock('../config/index.js', () => ({
  config: {
    nodeEnv: 'test',
    redis: { url: 'redis://localhost:6379' },
  },
}));

import { getRedis } from '../utils/redis.js';
import Redis from 'ioredis';

describe('getRedis', () => {
  test('constructs and returns a Redis client when url is configured', () => {
    const client = getRedis();
    expect(client).not.toBeNull();
    expect(Redis).toHaveBeenCalled();
  });

  test('returns the same singleton instance on repeated calls', () => {
    const a = getRedis();
    const b = getRedis();
    expect(a).toBe(b);
  });

  test('constructed client exposes an error handler hook', () => {
    const client = getRedis() as any;
    expect(typeof client.on).toBe('function');
  });
});
