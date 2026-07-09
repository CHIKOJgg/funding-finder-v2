import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import https from 'https';
import { sleep } from './helpers.js';
import { logger } from './logger.js';

export { sleep };

// ==================== Cache ====================

interface CacheEntry<T> {
  data: T;
  expiry: number;
}

class MemoryCache {
  private store = new Map<string, CacheEntry<any>>();
  private defaultTTL = 60_000;
  private maxSize = 1000;

  get<T>(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiry) {
      this.store.delete(key);
      return null;
    }
    return entry.data as T;
  }

  set<T>(key: string, data: T, ttlMs: number = this.defaultTTL): void {
    if (this.store.size >= this.maxSize) {
      this.evictOldest();
    }
    this.store.set(key, {
      data,
      expiry: Date.now() + ttlMs,
    });
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }

  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestExpiry = Infinity;
    for (const [key, entry] of this.store) {
      if (entry.expiry < oldestExpiry) {
        oldestExpiry = entry.expiry;
        oldestKey = key;
      }
    }
    if (oldestKey) {
      this.store.delete(oldestKey);
    }
  }
}

export const cache = new MemoryCache();

// ==================== Circuit Breaker ====================

interface CircuitBreakerState {
  failures: number;
  lastFailure: number;
  state: 'closed' | 'open' | 'half-open';
}

class CircuitBreaker {
  private circuits = new Map<string, CircuitBreakerState>();
  private failureThreshold = 5;
  private resetTimeout = 60_000; // 1 minute

  async execute<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const circuit = this.getCircuit(key);
    
    if (circuit.state === 'open') {
      if (Date.now() - circuit.lastFailure > this.resetTimeout) {
        circuit.state = 'half-open';
        logger.debug(`Circuit breaker half-open for ${key}`);
      } else {
        throw new Error(`Circuit breaker open for ${key}`);
      }
    }

    try {
      const result = await fn();
      if (circuit.state === 'half-open') {
        circuit.failures = 0;
        circuit.state = 'closed';
        logger.debug(`Circuit breaker closed for ${key}`);
      }
      return result;
    } catch (error) {
      circuit.failures++;
      circuit.lastFailure = Date.now();
      if (circuit.failures >= this.failureThreshold) {
        circuit.state = 'open';
        logger.warn(`Circuit breaker opened for ${key} after ${circuit.failures} failures`);
      }
      throw error;
    }
  }

  private getCircuit(key: string): CircuitBreakerState {
    if (!this.circuits.has(key)) {
      this.circuits.set(key, {
        failures: 0,
        lastFailure: 0,
        state: 'closed',
      });
    }
    return this.circuits.get(key)!;
  }

  reset(key?: string): void {
    if (key) {
      this.circuits.delete(key);
    } else {
      this.circuits.clear();
    }
  }
}

export const circuitBreaker = new CircuitBreaker();

// ==================== Connection Pool ====================

const clientPool = new Map<string, AxiosInstance>();

export function getOrCreateClient(baseUrl: string, timeout: number = 30000): AxiosInstance {
  const key = `${baseUrl}:${timeout}`;
  if (!clientPool.has(key)) {
    clientPool.set(key, axios.create({
      baseURL: baseUrl,
      timeout,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      // Connection pooling settings
      maxRedirects: 3,
      httpsAgent: new https.Agent({
        keepAlive: true,
        maxSockets: 10,
        maxFreeSockets: 5,
      }),
    }));
  }
  return clientPool.get(key)!;
}

// Legacy function for backward compatibility
export function createApiClient(baseUrl: string, timeout: number = 30000): AxiosInstance {
  return getOrCreateClient(baseUrl, timeout);
}

// ==================== Concurrency Control ====================

export interface MapWithConcurrencyOptions {
  concurrency: number;
  delayMs?: number;
}

export async function mapWithConcurrency<T, R>(
  arr: T[],
  options: MapWithConcurrencyOptions,
  worker: (item: T, index: number) => Promise<R | null>
): Promise<(R | null)[]> {
  const { concurrency, delayMs = 40 } = options;
  const results = new Array<R | null>(arr.length);
  let index = 0;

  async function runner(): Promise<void> {
    while (index < arr.length) {
      const i = index++;
      try {
        results[i] = await worker(arr[i], i);
      } catch {
        results[i] = null;
      }
      if (delayMs > 0) await sleep(delayMs);
    }
  }

  const runners = Array.from(
    { length: Math.min(concurrency, arr.length) },
    () => runner()
  );

  await Promise.all(runners);
  return results;
}

// ==================== Retry with Backoff ====================

export async function retry<T>(
  fn: () => Promise<T>,
  attempts: number = 3,
  baseDelay: number = 300
): Promise<T> {
  let lastError: Error | undefined;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err as Error;
      // Don't retry on 4xx errors (except 429)
      if (axios.isAxiosError(err) && err.response?.status) {
        const status = err.response.status;
        if (status >= 400 && status < 500 && status !== 429) {
          throw lastError;
        }
      }
      const delay = baseDelay * Math.pow(2, i);
      logger.debug(`Retry attempt ${i + 1}/${attempts} failed, waiting ${delay}ms: ${lastError.message}`);
      await sleep(delay);
    }
  }
  throw lastError;
}

// ==================== Cached Request ====================

export async function cachedRequest<T>(
  cacheKey: string,
  fn: () => Promise<T>,
  ttlMs: number = 60_000
): Promise<T> {
  const cached = cache.get<T>(cacheKey);
  if (cached !== null) {
    return cached;
  }
  
  const data = await fn();
  cache.set(cacheKey, data, ttlMs);
  return data;
}

// ==================== Safe Parsers ====================

export function safeParseFloat(value: unknown, fallback: number = 0): number {
  if (value === null || value === undefined || value === '') return fallback;
  const n = parseFloat(String(value).trim());
  return Number.isFinite(n) ? n : fallback;
}

export function safeParseInt(value: unknown, fallback: number = 0): number {
  if (value === null || value === undefined || value === '') return fallback;
  const n = parseInt(String(value).trim(), 10);
  return Number.isNaN(n) ? fallback : n;
}

// ==================== Cleanup ====================

export function cleanupConnections(): void {
  clientPool.clear();
  cache.clear();
  circuitBreaker.reset();
  logger.debug('Cleaned up all connections and caches');
}
