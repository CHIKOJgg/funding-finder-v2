import axios from 'axios';
import { retry, cleanupConnections } from '../../utils/exchangeClient.js';
import { installMockAxios } from '../testkit';

jest.mock('axios');
jest.mock('../../utils/logger.js');

const mockAxios = installMockAxios();

interface AxiosLikeError extends Error {
  isAxiosError: boolean;
  response?: { status: number };
}

function makeAxiosError(status: number, message = `http ${status}`): AxiosLikeError {
  const e = new Error(message) as AxiosLikeError;
  e.isAxiosError = true;
  e.response = { status };
  return e;
}

describe('retry with backoff under load-like conditions', () => {
  beforeEach(() => {
    // Re-bind the mocked axios (create + isAxiosError) so retry() recognises
    // our fake axios errors as retryable 429s. reset() avoids cross-test bleed.
    mockAxios.reset();
    cleanupConnections();
  });

  it('retries a 429 the expected number of times before succeeding', async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      if (calls < 3) throw makeAxiosError(429);
      return 'ok';
    };

    const result = await retry(fn, 3, 1);
    expect(result).toBe('ok');
    // 1 initial attempt + 2 retries == 3 calls.
    expect(calls).toBe(3);
  });

  it('retries many concurrent 429s the expected number of times', async () => {
    const N = 25;
    const counters = Array.from({ length: N }, () => 0);

    const tasks = Array.from({ length: N }, (_, i) =>
      retry(
        async () => {
          counters[i]++;
          throw makeAxiosError(429);
        },
        3,
        1
      ).catch((e) => e)
    );

    const results = await Promise.all(tasks);

    // Every task failed (all 429) and each retried exactly 3 times (1 + 2).
    expect(results.every((r) => r instanceof Error)).toBe(true);
    expect(counters.every((c) => c === 3)).toBe(true);
  });

  it('does NOT retry a 400 (client error)', async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      throw makeAxiosError(400);
    };

    await expect(retry(fn, 3, 1)).rejects.toThrow('http 400');
    expect(calls).toBe(1);
  });

  it('does NOT retry a 404 (client error)', async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      throw makeAxiosError(404);
    };

    await expect(retry(fn, 3, 1)).rejects.toThrow('http 404');
    expect(calls).toBe(1);
  });

  it('gives up after exhausting attempts on persistent 429', async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      throw makeAxiosError(429);
    };

    await expect(retry(fn, 3, 1)).rejects.toThrow('http 429');
    expect(calls).toBe(3);
  });
});
